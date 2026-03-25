import {
  AI_CHAT_HISTORY_LIMITS,
  AI_CHAT_REQUEST_LIMITS,
} from "../modules/ai/ai.config.js";
import { runAiTurn } from "../modules/ai/ai.service.js";
import { filterWebSourcesForPolicy } from "../modules/ai/ai.webSearchPolicy.js";
import { circuitBreaker } from "../modules/ai/ai.telemetry.js";
import { saveAssistantState } from "../modules/ai/ai.stateStore.js";
import { isAssistantEnabled } from "../services/aiAssistant.service.js";
import {
  resolveWebbedsClassificationLabel,
  resolveWebbedsHotelStars,
} from "../utils/webbedsStars.js";
import {
  appendAssistantChatMessage,
  createAssistantSessionForUser,
  deleteAssistantSession,
  fetchAssistantMessages,
  getAssistantSessionWithMessages,
  listAssistantSessionsForUser,
} from "../services/aiAssistantHistory.service.js";
import {
  isContentAllowed,
  CONTENT_NOT_ALLOWED_CODE,
} from "../services/aiContentModeration.service.js";

const QUICK_START_PROMPTS = [
  "Show me hotels for 4 people in downtown Cordoba with parking for the third week of January.",
  "Looking for a business-class hotel in Buenos Aires with breakfast included.",
  "Need a pet-friendly hotel near Bariloche for 6 guests.",
];

const SESSION_TURN_TTL_MS = 90_000; // 90s hard cap — any AI turn exceeding this is considered stale
const activeSessionTurns = new Map(); // sessionId → acquiredAt (ms timestamp)

const buildAiError = (message, code, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const buildPayloadTooLargeError = (message = "AI chat payload too large.") =>
  buildAiError(message, "AI_PAYLOAD_TOO_LARGE", 413);

const buildInvalidPayloadError = (message = "Invalid AI chat payload.") =>
  buildAiError(message, "AI_INVALID_PAYLOAD", 400);

const buildTurnInProgressError = () =>
  buildAiError(
    "This chat is already processing another request. Please wait a moment.",
    "AI_CHAT_TURN_IN_PROGRESS",
    409,
  );

const trySendKnownAiError = (res, err) => {
  const status = Number(err?.status);
  if (!Number.isFinite(status) || status < 400 || status > 599) return false;
  const payload = {
    error: err?.message || "Unable to process the AI chat request.",
  };
  if (typeof err?.code === "string" && err.code) {
    payload.code = err.code;
  }
  res.status(status).json(payload);
  return true;
};

const normalizeMessagesInput = (messages) => {
  if (!Array.isArray(messages)) return [];
  if (messages.length > AI_CHAT_REQUEST_LIMITS.maxMessagesInput) {
    throw buildPayloadTooLargeError(
      "Too many messages were provided in a single AI chat request.",
    );
  }
  return messages
    .map((message, index) => {
      if (!message) return null;
      const role = typeof message.role === "string" ? message.role : "user";
      const content =
        typeof message.content === "string" ? message.content.trim() : "";
      if (content.length > AI_CHAT_REQUEST_LIMITS.maxMessageChars) {
        throw buildPayloadTooLargeError(
          `messages[${index}].content exceeds the maximum allowed length.`,
        );
      }
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);
};

const getAuthenticatedUserId = (req) => {
  const value = Number(req.user?.id);
  return Number.isFinite(value) ? value : null;
};

const clampLimitNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.min(
    AI_CHAT_REQUEST_LIMITS.maxLimitValue,
    Math.max(1, Math.floor(numeric)),
  );
};

const sanitizeSearchLimits = (value) => {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    const shorthandLimit = clampLimitNumber(value);
    if (shorthandLimit != null) {
      return { maxResults: shorthandLimit };
    }
    throw buildInvalidPayloadError(
      "limit must be a number or an object when provided.",
    );
  }
  const normalized = {};
  for (const key of ["maxResults", "homes", "hotels"]) {
    const clamped = clampLimitNumber(value[key]);
    if (clamped != null) normalized[key] = clamped;
  }
  return Object.keys(normalized).length ? normalized : undefined;
};

const sanitizeRecentChats = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, AI_CHAT_REQUEST_LIMITS.maxContextRecentChats)
    .map((chat) => {
      if (!chat || typeof chat !== "object" || Array.isArray(chat)) return null;
      const normalized = {};
      if (typeof chat.id === "string" && chat.id.trim()) {
        normalized.id = chat.id
          .trim()
          .slice(0, AI_CHAT_REQUEST_LIMITS.maxSessionIdChars);
      }
      if (typeof chat.title === "string" && chat.title.trim()) {
        normalized.title = chat.title
          .trim()
          .slice(0, AI_CHAT_REQUEST_LIMITS.maxRecentChatTitleChars);
      }
      if (typeof chat.lastMessageAt === "string" && chat.lastMessageAt.trim()) {
        normalized.lastMessageAt = chat.lastMessageAt.trim().slice(0, 80);
      }
      if (!normalized.id && !normalized.title) return null;
      return normalized;
    })
    .filter(Boolean);
};

const CONTEXT_STRING_MAX = {
  now: 80,
  localDate: 80,
  localTime: 40,
  localWeekday: 40,
  timeZone: 60,
  locale: 40,
  userName: 60,
  userRole: 20,
  userLanguage: 20,
  userCity: 80,
  userCountry: 80,
  locationCity: 80,
  locationCountry: 80,
  tripSummary: 500,
  tripStayName: 120,
  tripLocationText: 120,
  confirmedWhere: 200,
  confirmedPlaceId: 200,
  confirmedPlaceSelectionId: 200,
  confirmedWhen: 100,
  confirmedWho: 100,
  nationalityCode: 20,
  residenceCode: 20,
};

const truncate = (val, maxLen) => {
  if (val == null) return undefined;
  const s = typeof val === "string" ? val.trim() : String(val).trim();
  if (!s) return undefined;
  return s.slice(0, maxLen);
};

const sanitizeContextPayload = (value) => {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw buildInvalidPayloadError("context must be an object.");
  }
  const raw = value;
  const next = {};

  if (Object.prototype.hasOwnProperty.call(raw, "recentChats")) {
    next.recentChats = sanitizeRecentChats(raw.recentChats);
  }
  const setStr = (key, max) => {
    const v = truncate(raw[key], max);
    if (v !== undefined) next[key] = v;
  };
  if (raw.now != null) setStr("now", CONTEXT_STRING_MAX.now);
  if (raw.localDate != null) setStr("localDate", CONTEXT_STRING_MAX.localDate);
  if (raw.localTime != null) setStr("localTime", CONTEXT_STRING_MAX.localTime);
  if (raw.localWeekday != null)
    setStr("localWeekday", CONTEXT_STRING_MAX.localWeekday);
  if (raw.timeZone != null) setStr("timeZone", CONTEXT_STRING_MAX.timeZone);
  if (raw.locale != null) setStr("locale", CONTEXT_STRING_MAX.locale);

  if (raw.passengerNationality != null) {
    const v =
      typeof raw.passengerNationality === "object"
        ? (raw.passengerNationality?.code ?? raw.passengerNationality)
        : raw.passengerNationality;
    const s = truncate(String(v), CONTEXT_STRING_MAX.nationalityCode);
    if (s !== undefined) next.passengerNationality = s;
  }
  if (raw.passengerCountryOfResidence != null) {
    const v =
      typeof raw.passengerCountryOfResidence === "object"
        ? (raw.passengerCountryOfResidence?.code ??
          raw.passengerCountryOfResidence)
        : raw.passengerCountryOfResidence;
    const s = truncate(String(v), CONTEXT_STRING_MAX.residenceCode);
    if (s !== undefined) next.passengerCountryOfResidence = s;
  }
  if (raw.nationality != null) {
    const v =
      typeof raw.nationality === "object"
        ? (raw.nationality?.code ?? raw.nationality)
        : raw.nationality;
    const s = truncate(String(v), CONTEXT_STRING_MAX.nationalityCode);
    if (s !== undefined) next.nationality = s;
  }
  if (raw.residence != null) {
    const v =
      typeof raw.residence === "object"
        ? (raw.residence?.code ?? raw.residence)
        : raw.residence;
    const s = truncate(String(v), CONTEXT_STRING_MAX.residenceCode);
    if (s !== undefined) next.residence = s;
  }

  if (raw.user != null && typeof raw.user === "object") {
    const u = raw.user;
    next.user = {};
    if (u.name != null)
      next.user.name = truncate(u.name, CONTEXT_STRING_MAX.userName);
    if (u.role != null)
      next.user.role = truncate(u.role, CONTEXT_STRING_MAX.userRole);
    if (u.language != null)
      next.user.language = truncate(
        u.language,
        CONTEXT_STRING_MAX.userLanguage,
      );
    if (u.id != null) next.user.id = truncate(String(u.id), 24);
    if (u.city != null)
      next.user.city = truncate(u.city, CONTEXT_STRING_MAX.userCity);
    if (u.country != null)
      next.user.country = truncate(u.country, CONTEXT_STRING_MAX.userCountry);
    if (Object.keys(next.user).length === 0) delete next.user;
  }
  if (raw.location != null && typeof raw.location === "object") {
    const loc = raw.location;
    next.location = {};
    if (loc.city != null)
      next.location.city = truncate(loc.city, CONTEXT_STRING_MAX.locationCity);
    if (loc.country != null)
      next.location.country = truncate(
        loc.country,
        CONTEXT_STRING_MAX.locationCountry,
      );
    if (Object.keys(next.location).length === 0) delete next.location;
  }
  if (raw.confirmedSearch != null && typeof raw.confirmedSearch === "object") {
    const cs = raw.confirmedSearch;
    next.confirmedSearch = {};
    if (cs.where != null)
      next.confirmedSearch.where = truncate(
        cs.where,
        CONTEXT_STRING_MAX.confirmedWhere,
      );
    if (cs.placeId != null)
      next.confirmedSearch.placeId = truncate(
        cs.placeId,
        CONTEXT_STRING_MAX.confirmedPlaceId,
      );
    if (cs.placeSelectionId != null) {
      next.confirmedSearch.placeSelectionId = truncate(
        cs.placeSelectionId,
        CONTEXT_STRING_MAX.confirmedPlaceSelectionId,
      );
    }
    if (cs.lat != null) {
      const lat = Number(cs.lat);
      if (Number.isFinite(lat)) next.confirmedSearch.lat = lat;
    }
    if (cs.lng != null) {
      const lng = Number(cs.lng);
      if (Number.isFinite(lng)) next.confirmedSearch.lng = lng;
    }
    if (cs.when != null)
      next.confirmedSearch.when = truncate(
        cs.when,
        CONTEXT_STRING_MAX.confirmedWhen,
      );
    if (cs.who != null)
      next.confirmedSearch.who = truncate(
        cs.who,
        CONTEXT_STRING_MAX.confirmedWho,
      );
    if (Object.keys(next.confirmedSearch).length === 0)
      delete next.confirmedSearch;
  }
  if (raw.trip != null && typeof raw.trip === "object") {
    const t = raw.trip;
    next.trip = {};
    if (t.summary != null)
      next.trip.summary = truncate(t.summary, CONTEXT_STRING_MAX.tripSummary);
    if (t.stayName != null)
      next.trip.stayName = truncate(
        t.stayName,
        CONTEXT_STRING_MAX.tripStayName,
      );
    if (t.locationText != null)
      next.trip.locationText = truncate(
        t.locationText,
        CONTEXT_STRING_MAX.tripLocationText,
      );
    if (t.bookingId != null)
      next.trip.bookingId = truncate(String(t.bookingId), 24);
    if (t.imageUrl != null)
      next.trip.imageUrl = truncate(String(t.imageUrl), 512);
    if (t.location != null && typeof t.location === "object")
      next.trip.location = t.location;
    if (t.dates != null && typeof t.dates === "object")
      next.trip.dates = t.dates;
    if (t.guests != null && typeof t.guests === "object")
      next.trip.guests = t.guests;
    if (Object.keys(next.trip).length === 0) delete next.trip;
  }
  if (raw.tripContext != null && typeof raw.tripContext === "object") {
    const t = raw.tripContext;
    next.tripContext = {};
    if (t.summary != null)
      next.tripContext.summary = truncate(
        t.summary,
        CONTEXT_STRING_MAX.tripSummary,
      );
    if (t.stayName != null)
      next.tripContext.stayName = truncate(
        t.stayName,
        CONTEXT_STRING_MAX.tripStayName,
      );
    if (t.locationText != null)
      next.tripContext.locationText = truncate(
        t.locationText,
        CONTEXT_STRING_MAX.tripLocationText,
      );
    if (Object.keys(next.tripContext).length === 0) delete next.tripContext;
  }
  if (raw.weather != null && typeof raw.weather === "object")
    next.weather = raw.weather;

  // Flow-control flags — boolean signals from the frontend
  if (raw.cancelPending === true) next.cancelPending = true;
  if (raw.skipDataCollection === true) next.skipDataCollection = true;
  if (raw.forceLiveAvailability === true) next.forceLiveAvailability = true;

  let serialized = "";
  try {
    serialized = JSON.stringify(next) || "";
  } catch (_) {
    throw buildInvalidPayloadError("context must be JSON serializable.");
  }
  if (serialized.length > AI_CHAT_REQUEST_LIMITS.maxContextChars) {
    throw buildPayloadTooLargeError(
      "context exceeds the maximum allowed size.",
    );
  }
  return next;
};

const extractLatestMessageFromBody = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw buildInvalidPayloadError();
  }
  if (typeof body.message === "string" && body.message.trim()) {
    const message = body.message.trim();
    if (message.length > AI_CHAT_REQUEST_LIMITS.maxMessageChars) {
      throw buildPayloadTooLargeError(
        "message exceeds the maximum allowed length.",
      );
    }
    return message;
  }
  const normalized = normalizeMessagesInput(body.messages);
  if (!normalized.length) return "";
  return normalized[normalized.length - 1].content || "";
};

const normalizeConversationId = (body) => {
  const raw = body?.conversationId ?? body?.sessionId ?? null;
  if (raw == null) return null;
  if (typeof raw !== "string") {
    throw buildInvalidPayloadError("sessionId must be a string.");
  }
  const normalized = raw.trim();
  if (!normalized) return null;
  if (normalized.length > AI_CHAT_REQUEST_LIMITS.maxSessionIdChars) {
    throw buildInvalidPayloadError("sessionId is invalid.");
  }
  return normalized;
};

const normalizeAiRequest = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw buildInvalidPayloadError();
  }
  return {
    conversationId: normalizeConversationId(body),
    incomingMessage: extractLatestMessageFromBody(body),
    limits: sanitizeSearchLimits(body.limit),
    context: sanitizeContextPayload(body.context ?? body.tripContext ?? null),
    uiEvent: body.uiEvent,
  };
};

const tryAcquireSessionTurn = (sessionId) => {
  if (!sessionId) return true;
  const existing = activeSessionTurns.get(sessionId);
  if (existing) {
    if (Date.now() - existing < SESSION_TURN_TTL_MS) return false;
    // Stale lock expired — release and allow new turn
    console.warn("[ai] releasing stale session lock", {
      sessionId,
      ageMs: Date.now() - existing,
    });
    activeSessionTurns.delete(sessionId);
  }
  activeSessionTurns.set(sessionId, Date.now());
  return true;
};

const releaseSessionTurn = (sessionId) => {
  if (!sessionId) return;
  activeSessionTurns.delete(sessionId);
};

/**
 * Build searchContext for client "See all results" navigation when we ran a search.
 * Used to open Explore/Search with the same params (where, dates, guests, nationality, residence).
 */
const buildSearchContext = (result) => {
  if (result?.nextAction !== "RUN_SEARCH") return null;
  const plan = result?.plan || {};
  const state = result?.state || {};
  const location = plan?.location || {};
  const dest = state?.destination || {};
  const where =
    dest?.name ||
    [location.city, location.state, location.country]
      .filter(Boolean)
      .join(", ") ||
    null;
  if (!where && !dest?.placeId) return null;

  const dates = plan?.dates || state?.dates || {};
  const guests = plan?.guests || state?.guests || {};
  const adults = guests.adults ?? 1;
  const children = guests.children ?? 0;
  const childrenAges = Array.isArray(guests.childrenAges)
    ? guests.childrenAges
    : [];

  let guestsSummary = "";
  if (adults > 0) guestsSummary = `${adults} adult${adults !== 1 ? "s" : ""}`;
  if (children > 0)
    guestsSummary += guestsSummary
      ? `, ${children} child${children !== 1 ? "ren" : ""}`
      : `${children} child${children !== 1 ? "ren" : ""}`;
  if (!guestsSummary) guestsSummary = "1 adult";

  return {
    where: where || undefined,
    placeId: dest?.placeId || location?.placeId || undefined,
    lat: dest?.lat ?? location?.lat ?? undefined,
    lng: dest?.lon ?? dest?.lng ?? location?.lng ?? location?.lon ?? undefined,
    country: location?.country || undefined,
    checkIn: dates.checkIn || undefined,
    checkOut: dates.checkOut || undefined,
    adults: Number.isFinite(adults) ? adults : 1,
    children: Number.isFinite(children) ? children : 0,
    childrenAges: childrenAges.length ? childrenAges : undefined,
    guests: guestsSummary,
    nationality: plan.passengerNationality || undefined,
    residence: plan.passengerCountryOfResidence || undefined,
  };
};

/**
 * Build flat items array from inventory for block-based response (sections + items).
 * Each item has id, inventoryType (HOTEL|HOME), and fields needed for cards.
 */
const buildItemsFromInventory = (inventory) => {
  if (!inventory || typeof inventory !== "object") return [];
  const items = [];
  (inventory.hotels || []).forEach((h) => {
    const stars = resolveWebbedsHotelStars(h);
    const classificationLabel = resolveWebbedsClassificationLabel(h);
    items.push({
      id: h.id != null ? String(h.id) : null,
      inventoryType: "HOTEL",
      name: h.name ?? h.title ?? "",
      city: h.city ?? "",
      stars,
      classificationLabel,
      pricePerNight: h.pricePerNight ?? h.price_per_night ?? null,
      currency: h.currency ?? "USD",
      coverImage: h.coverImage ?? h.image ?? null,
      image: h.coverImage ?? h.image ?? null,
      images: Array.isArray(h.images) ? h.images : null,
      hotelDetails: {
        hotelName: h.name ?? h.title ?? "",
        city: h.city ?? "",
        country: h.country ?? "",
        rating: stars,
        classification: classificationLabel
          ? {
              name: classificationLabel,
              code: h.classification?.code ?? h.classification_code ?? null,
            }
          : null,
        coverImage: h.coverImage ?? h.image ?? null,
        images: Array.isArray(h.images) ? h.images : null,
      },
      amenities: Array.isArray(h.amenities)
        ? h.amenities.map((a) =>
            typeof a === "string" ? a : (a?.name ?? String(a)),
          )
        : [],
      ...(h.shortDescription && { description: h.shortDescription }),
    });
  });
  (inventory.homes || []).forEach((h) => {
    items.push({
      id: h.id != null ? String(h.id) : null,
      inventoryType: "HOME",
      title: h.title ?? h.name ?? "",
      name: h.title ?? h.name ?? "",
      city: h.city ?? "",
      pricePerNight: h.pricePerNight ?? h.price_per_night ?? null,
      currency: h.currency ?? "USD",
      coverImage: h.coverImage ?? h.image ?? null,
      image: h.coverImage ?? h.image ?? null,
      amenities: Array.isArray(h.amenities)
        ? h.amenities.map((a) =>
            typeof a === "string" ? a : (a?.name ?? String(a)),
          )
        : [],
    });
  });
  return items.filter((i) => i.id);
};

const normalizeAssistantWebSources = (
  sources = [],
  { allowCompetitors = false } = {},
) => {
  const normalizedSources = Array.isArray(sources)
    ? sources
        .map((source) => {
          const title =
            typeof source?.title === "string" ? source.title.trim() : "";
          const url = typeof source?.url === "string" ? source.url.trim() : "";
          if (!url) return null;
          return { title, url };
        })
        .filter(Boolean)
    : [];
  return filterWebSourcesForPolicy(normalizedSources, { allowCompetitors })
    .safeSources;
};

const buildAssistantUiSnapshot = (ui, webSources = [], options = {}) => {
  const normalizedWebSources = normalizeAssistantWebSources(
    webSources,
    options,
  );
  const baseUi = ui && typeof ui === "object" && !Array.isArray(ui) ? ui : null;
  if (!baseUi && !normalizedWebSources.length) return null;
  if (!normalizedWebSources.length) return baseUi;
  return {
    ...(baseUi || {}),
    webSources: normalizedWebSources,
  };
};

export const handleAiChat = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let requestPayload;
  try {
    requestPayload = normalizeAiRequest(req.body || {});
  } catch (err) {
    if (trySendKnownAiError(res, err)) return;
    return res
      .status(400)
      .json({ error: "Invalid AI chat payload.", code: "AI_INVALID_PAYLOAD" });
  }

  let { conversationId, incomingMessage, limits, context, uiEvent } =
    requestPayload;

  // Validate that context.user.id (if provided) matches the authenticated user
  if (context?.user?.id != null) {
    const ctxId = String(context.user.id).trim();
    if (ctxId && ctxId !== String(userId)) {
      return res
        .status(403)
        .json({
          error: "Forbidden: context user mismatch.",
          code: "AI_CONTEXT_USER_MISMATCH",
        });
    }
  }

  if (!incomingMessage && !uiEvent) {
    return res
      .status(400)
      .json({ error: "message is required", code: "AI_INVALID_PAYLOAD" });
  }

  if (incomingMessage) {
    const moderation = await isContentAllowed(incomingMessage);
    if (!moderation.allowed) {
      return res.status(400).json({
        error:
          "Your message contains content that is not allowed. Please keep the conversation respectful.",
        code: CONTENT_NOT_ALLOWED_CODE,
      });
    }
  }

  try {
    if (!conversationId) {
      const session = await createAssistantSessionForUser(userId);
      conversationId = session.id;
    }
  } catch (err) {
    if (trySendKnownAiError(res, err)) return;
    console.error("[ai] failed to create session", err);
    return res.status(500).json({ error: "Unable to create chat session" });
  }

  if (!tryAcquireSessionTurn(conversationId)) {
    return trySendKnownAiError(res, buildTurnInProgressError());
  }

  try {
    if (incomingMessage) {
      try {
        await appendAssistantChatMessage(conversationId, userId, {
          role: "user",
          content: incomingMessage,
          reserveSlots: 1,
        });
      } catch (err) {
        if (trySendKnownAiError(res, err)) return;
        console.error("[ai] failed to persist user message", err);
        return res.status(500).json({ error: "Unable to save chat message" });
      }
    }

    let storedMessages = [];
    try {
      storedMessages = await fetchAssistantMessages(conversationId, userId, {
        limit: AI_CHAT_HISTORY_LIMITS.contextDefault,
      });
    } catch (err) {
      if (trySendKnownAiError(res, err)) return;
      console.error("[ai] failed to load messages", err);
      return res.status(500).json({ error: "Unable to load messages" });
    }

    const normalizedMessages = storedMessages.map((msg) => ({
      role:
        msg.role === "assistant"
          ? "assistant"
          : msg.role === "system"
            ? "system"
            : "user",
      content: msg.content,
    }));

    const turnController = new AbortController();
    const onClientClose = () => {
      console.warn("[ai] client disconnected mid-turn, aborting", {
        sessionId: conversationId,
        userId,
      });
      turnController.abort();
    };
    res.on("close", onClientClose);

    try {
      const result = await runAiTurn({
        sessionId: conversationId,
        userId,
        messages: normalizedMessages,
        limits,
        uiEvent,
        context,
        signal: turnController.signal,
      });

      try {
        const assistantUiSnapshot = buildAssistantUiSnapshot(
          result.ui,
          result.webSources,
          {
            allowCompetitors: Boolean(result.allowCompetitorWebSources),
          },
        );
        const orientationText =
          typeof result?.orientationMessage === "string"
            ? result.orientationMessage.trim()
            : "";
        if (
          orientationText &&
          orientationText !== (result.reply || "").trim()
        ) {
          try {
            await appendAssistantChatMessage(conversationId, userId, {
              role: "assistant",
              content: orientationText,
            });
          } catch (orientationErr) {
            console.warn(
              "[ai] failed to persist assistant orientation",
              orientationErr?.message || orientationErr,
            );
          }
        }
        await appendAssistantChatMessage(conversationId, userId, {
          role: "assistant",
          content: result.reply || "Ok.",
          planSnapshot: result.plan,
          inventorySnapshot: result.inventory,
          uiSnapshot: assistantUiSnapshot,
        });
        try {
          await saveAssistantState({
            sessionId: conversationId,
            userId,
            state: result.state,
          });
        } catch (stateErr) {
          console.warn("[ai] failed to persist state", stateErr);
        }
      } catch (err) {
        if (trySendKnownAiError(res, err)) return;
        console.error("[ai] failed to persist assistant reply", err);
        return res
          .status(500)
          .json({ error: "Unable to save assistant reply" });
      }

      const replyText = result.assistant?.text || result.reply || "";
      const searchContext = buildSearchContext(result);
      const counts = {
        homes: Array.isArray(result.inventory?.homes)
          ? result.inventory.homes.length
          : 0,
        hotels: Array.isArray(result.inventory?.hotels)
          ? result.inventory.hotels.length
          : 0,
      };
      const sections = Array.isArray(result.ui?.sections)
        ? result.ui.sections
        : [];
      const quick_replies = Array.isArray(result.followUps)
        ? result.followUps
        : [];
      const cappedInventory = {
        hotels: (result.inventory?.hotels || []).slice(0, 30),
        homes: (result.inventory?.homes || []).slice(0, 30),
      };
      const items = buildItemsFromInventory(cappedInventory);
      res.removeListener("close", onClientClose);
      return res.json({
        ok: true,
        conversationId,
        sessionId: conversationId,
        message: replyText,
        assistant: result.assistant || {
          text: replyText,
          tone: "neutral",
          disclaimers: [],
        },
        ui: result.ui,
        state: result.state,
        plan: result.plan,
        carousels: Array.isArray(result.carousels) ? result.carousels : [],
        trip: result.trip,
        counts,
        webSources: normalizeAssistantWebSources(result.webSources, {
          allowCompetitors: Boolean(result.allowCompetitorWebSources),
        }),
        searchContext: searchContext || undefined,
        sections,
        quick_replies,
        items,
        intent: result.intent,
        nextAction: result.nextAction,
        followUpKind:
          result.followUpKind || result.ui?.meta?.followUpKind || null,
        replyMode: result.replyMode || result.ui?.meta?.replyMode || null,
        referencedHotelIds: Array.isArray(result.referencedHotelIds)
          ? result.referencedHotelIds
          : Array.isArray(result.ui?.meta?.referencedHotelIds)
            ? result.ui.meta.referencedHotelIds
            : [],
        webSearchUsed: Boolean(
          result.webSearchUsed || result.ui?.meta?.webSearchUsed,
        ),
        assistantReady: isAssistantEnabled(),
        quickStartPrompts: QUICK_START_PROMPTS,
      });
    } catch (err) {
      if (trySendKnownAiError(res, err)) return;
      const isAborted =
        err?.name === "AbortError" || err?.code === "ERR_CANCELED";
      if (isAborted) {
        // Client disconnected — don't send response (headers may already be sent)
        console.info("[ai] turn aborted (client disconnected)", {
          sessionId: conversationId,
          userId,
        });
        return;
      }
      // Track failure in circuit breaker (skip circuit-open errors — those are already tracked)
      if (err?.code !== "AI_CIRCUIT_OPEN") {
        circuitBreaker.onFailure({
          sessionId: conversationId,
          userId,
          error: err?.message,
        });
      }
      console.error("[ai] chat failed", {
        sessionId: conversationId,
        userId,
        error: err?.message,
        code: err?.code,
      });
      if (trySendKnownAiError(res, err)) return;
      return res
        .status(500)
        .json({ error: "Unable to process assistant query right now" });
    }
  } finally {
    releaseSessionTurn(conversationId);
  }
};

export const handleAiChatStream = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  let requestPayload;
  try {
    requestPayload = normalizeAiRequest(req.body || {});
  } catch (err) {
    if (trySendKnownAiError(res, err)) return;
    return res
      .status(400)
      .json({ error: "Invalid AI chat payload.", code: "AI_INVALID_PAYLOAD" });
  }

  let { conversationId, incomingMessage, limits, context, uiEvent } =
    requestPayload;

  if (context?.user?.id != null) {
    const ctxId = String(context.user.id).trim();
    if (ctxId && ctxId !== String(userId)) {
      return res
        .status(403)
        .json({
          error: "Forbidden: context user mismatch.",
          code: "AI_CONTEXT_USER_MISMATCH",
        });
    }
  }

  if (!incomingMessage && !uiEvent) {
    return res
      .status(400)
      .json({ error: "message is required", code: "AI_INVALID_PAYLOAD" });
  }

  if (incomingMessage) {
    const moderation = await isContentAllowed(incomingMessage);
    if (!moderation.allowed) {
      return res.status(400).json({
        error:
          "Your message contains content that is not allowed. Please keep the conversation respectful.",
        code: CONTENT_NOT_ALLOWED_CODE,
      });
    }
  }

  // Set SSE headers immediately so client gets feedback fast
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (type, data) => {
    try {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  sendEvent("thinking", {});

  try {
    if (!conversationId) {
      const session = await createAssistantSessionForUser(userId);
      conversationId = session.id;
    }
  } catch (err) {
    sendEvent("error", { message: "Unable to create chat session" });
    return res.end();
  }

  if (!tryAcquireSessionTurn(conversationId)) {
    sendEvent("error", {
      message: "This chat is already processing another request. Please wait.",
      code: "AI_CHAT_TURN_IN_PROGRESS",
    });
    return res.end();
  }

  try {
    if (incomingMessage) {
      try {
        await appendAssistantChatMessage(conversationId, userId, {
          role: "user",
          content: incomingMessage,
          reserveSlots: 1,
        });
      } catch (err) {
        if (trySendKnownAiError(res, err)) {
          res.end();
          return;
        }
        sendEvent("error", { message: "Unable to save chat message" });
        return res.end();
      }
    }

    let storedMessages = [];
    try {
      storedMessages = await fetchAssistantMessages(conversationId, userId, {
        limit: AI_CHAT_HISTORY_LIMITS.contextDefault,
      });
    } catch (err) {
      sendEvent("error", { message: "Unable to load messages" });
      return res.end();
    }

    const normalizedMessages = storedMessages.map((msg) => ({
      role:
        msg.role === "assistant"
          ? "assistant"
          : msg.role === "system"
            ? "system"
            : "user",
      content: msg.content,
    }));

    let accumulatedText = "";
    let accumulatedKickoffText = "";
    let accumulatedClosingText = "";

    const result = await runAiTurn({
      sessionId: conversationId,
      userId,
      messages: normalizedMessages,
      limits,
      uiEvent,
      context,
      onEvent: (event) => {
        if (!event?.type) return;
        if (event.type === "assistant_message") {
          accumulatedKickoffText =
            String(event?.data?.text || accumulatedKickoffText || "").trim() ||
            accumulatedKickoffText;
          sendEvent(event.type, event.data || {});
          return;
        }
        if (event.type === "results_partial") {
          const partialInventory = event.data?.inventory ?? null;
          const cappedPartialInventory = partialInventory
            ? {
                hotels: (partialInventory.hotels || []).slice(0, 30),
                homes: (partialInventory.homes || []).slice(0, 30),
              }
            : null;
          const partialItems = buildItemsFromInventory(cappedPartialInventory);
          const partialSearchContext = buildSearchContext({
            nextAction: "RUN_SEARCH",
            plan: event.data?.plan ?? null,
            state: event.data?.state ?? null,
          });
          sendEvent(event.type, {
            destination: event.data?.destination || undefined,
            counts: event.data?.counts || undefined,
            total: event.data?.total || 0,
            inventory: cappedPartialInventory,
            items: partialItems,
            searchContext: partialSearchContext || undefined,
          });
          return;
        }
        if (event.type === "closing_delta") {
          accumulatedClosingText += event.data?.content || "";
          sendEvent("closing_delta", { content: event.data?.content });
          return;
        }
        if (event.type === "assistant_closing") {
          sendEvent("assistant_closing", event.data || {});
          return;
        }
        sendEvent(event.type, event.data || {});
      },
      onKickoffChunk: (chunk) => {
        accumulatedKickoffText += chunk;
        sendEvent("kickoff_delta", { content: chunk });
      },
      onTextChunk: (chunk) => {
        accumulatedText += chunk;
        sendEvent("delta", { content: chunk });
      },
    });

    const replyText =
      accumulatedText || result.assistant?.text || result.reply || "";

    const searchContext = buildSearchContext(result);
    const counts = {
      homes: Array.isArray(result.inventory?.homes)
        ? result.inventory.homes.length
        : 0,
      hotels: Array.isArray(result.inventory?.hotels)
        ? result.inventory.hotels.length
        : 0,
    };
    const sections = Array.isArray(result.ui?.sections)
      ? result.ui.sections
      : [];
    const quick_replies = Array.isArray(result.followUps)
      ? result.followUps
      : [];
    const cappedInventory = {
      hotels: (result.inventory?.hotels || []).slice(0, 30),
      homes: (result.inventory?.homes || []).slice(0, 30),
    };
    const items = buildItemsFromInventory(cappedInventory);

    sendEvent("results_final", {
      counts,
      total: counts.homes + counts.hotels,
      searchContext: searchContext || undefined,
    });

    sendEvent("done", {
      ok: true,
      conversationId,
      sessionId: conversationId,
      reply: replyText,
      message: replyText,
      assistant: result.assistant || {
        text: replyText,
        tone: "neutral",
        disclaimers: [],
      },
      ui: result.ui,
      state: result.state,
      plan: result.plan,
      carousels: Array.isArray(result.carousels) ? result.carousels : [],
      trip: result.trip,
      counts,
      webSources: normalizeAssistantWebSources(result.webSources, {
        allowCompetitors: Boolean(result.allowCompetitorWebSources),
      }),
      searchContext: searchContext || undefined,
      sections,
      quick_replies,
      items,
      intent: result.intent,
      nextAction: result.nextAction,
      followUpKind:
        result.followUpKind || result.ui?.meta?.followUpKind || null,
      replyMode: result.replyMode || result.ui?.meta?.replyMode || null,
      referencedHotelIds: Array.isArray(result.referencedHotelIds)
        ? result.referencedHotelIds
        : Array.isArray(result.ui?.meta?.referencedHotelIds)
          ? result.ui.meta.referencedHotelIds
          : [],
      webSearchUsed: Boolean(
        result.webSearchUsed || result.ui?.meta?.webSearchUsed,
      ),
      assistantReady: isAssistantEnabled(),
      quickStartPrompts: QUICK_START_PROMPTS,
      closingMessage: accumulatedClosingText || result.closingMessage || null,
    });

    // Persist in background — does not block the client
    const assistantUiSnapshot = buildAssistantUiSnapshot(
      result.ui,
      result.webSources,
      {
        allowCompetitors: Boolean(result.allowCompetitorWebSources),
      },
    );
    (async () => {
      const orientationText =
        typeof result?.orientationMessage === "string"
          ? result.orientationMessage.trim()
          : "";
      if (orientationText && orientationText !== (replyText || "").trim()) {
        try {
          await appendAssistantChatMessage(conversationId, userId, {
            role: "assistant",
            content: orientationText,
          });
        } catch (orientationErr) {
          console.warn(
            "[ai] stream: failed to persist assistant orientation",
            orientationErr?.message || orientationErr,
          );
        }
      }
      await appendAssistantChatMessage(conversationId, userId, {
        role: "assistant",
        content: replyText || "Ok.",
        planSnapshot: result.plan,
        inventorySnapshot: result.inventory,
        uiSnapshot: assistantUiSnapshot,
      });
      await saveAssistantState({
        sessionId: conversationId,
        userId,
        state: result.state,
      });
    })().catch((err) =>
      console.error("[ai] stream: failed to persist assistant reply", err),
    );
  } catch (err) {
    console.error("[ai] stream: chat failed", {
      sessionId: conversationId,
      userId,
      error: err?.message,
    });
    sendEvent("error", {
      message: "Unable to process assistant query right now",
    });
  } finally {
    releaseSessionTurn(conversationId);
    res.end();
  }
};

export const createAiChat = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const session = await createAssistantSessionForUser(userId);
    const messages = await fetchAssistantMessages(session.id, userId, {
      limit: AI_CHAT_HISTORY_LIMITS.contextDefault,
    });
    return res.status(201).json({ ok: true, session, messages });
  } catch (err) {
    if (trySendKnownAiError(res, err)) return;
    console.error("[ai] failed to create session", err);
    return res.status(500).json({ error: "Unable to create chat session" });
  }
};

export const listAiChats = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const limit =
      Number(req.query?.limit) || AI_CHAT_HISTORY_LIMITS.listDefault;
    const chats = await listAssistantSessionsForUser(userId, { limit });
    return res.json({ ok: true, chats });
  } catch (err) {
    if (trySendKnownAiError(res, err)) return;
    console.error("[ai] failed to list sessions", err);
    return res.status(500).json({ error: "Unable to load chat history" });
  }
};

export const getAiChat = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const sessionId = req.params?.sessionId;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  try {
    const limit =
      Number(req.query?.limit) || AI_CHAT_HISTORY_LIMITS.detailDefault;
    const payload = await getAssistantSessionWithMessages(sessionId, userId, {
      limit,
    });
    return res.json({ ok: true, ...payload });
  } catch (err) {
    if (trySendKnownAiError(res, err)) return;
    console.error("[ai] failed to load session", err);
    return res.status(500).json({ error: "Unable to load chat session" });
  }
};

export const deleteAiChat = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const sessionId = req.params?.sessionId;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  try {
    await deleteAssistantSession(sessionId, userId);
    return res.json({ ok: true });
  } catch (err) {
    if (trySendKnownAiError(res, err)) return;
    console.error("[ai] failed to delete session", err);
    return res.status(500).json({ error: "Unable to delete chat session" });
  }
};

/**
 * Health check — returns circuit breaker state and assistant readiness.
 * Useful for monitoring dashboards and uptime checks.
 */
export const getAiHealth = async (req, res) => {
  const cb = circuitBreaker.status();
  const ready = isAssistantEnabled() && cb.state !== "OPEN";
  return res.status(ready ? 200 : 503).json({
    ok: ready,
    assistant: isAssistantEnabled(),
    circuitBreaker: cb,
    activeTurns: activeSessionTurns.size,
    ts: new Date().toISOString(),
  });
};
