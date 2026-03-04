import {
  AI_CHAT_HISTORY_LIMITS,
  AI_CHAT_REQUEST_LIMITS,
} from "../modules/ai/ai.config.js";
import { runAiTurn } from "../modules/ai/ai.service.js";
import { saveAssistantState } from "../modules/ai/ai.stateStore.js";
import { isAssistantEnabled } from "../services/aiAssistant.service.js";
import {
  appendAssistantChatMessage,
  createAssistantSessionForUser,
  deleteAssistantSession,
  fetchAssistantMessages,
  getAssistantSessionWithMessages,
  listAssistantSessionsForUser,
} from "../services/aiAssistantHistory.service.js";

const QUICK_START_PROMPTS = [
  "Show me hotels for 4 people in downtown Cordoba with parking for the third week of January.",
  "Looking for a business-class hotel in Buenos Aires with breakfast included.",
  "Need a pet-friendly hotel near Bariloche for 6 guests.",
];

const activeSessionTurns = new Set();

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
    409
  );

const trySendKnownAiError = (res, err) => {
  const status = Number(err?.status);
  if (!Number.isFinite(status) || status < 400 || status > 599) return false;
  const payload = { error: err?.message || "Unable to process the AI chat request." };
  if (typeof err?.code === "string" && err.code) {
    payload.code = err.code;
  }
  res.status(status).json(payload);
  return true;
};

const normalizeMessagesInput = (messages) => {
  if (!Array.isArray(messages)) return [];
  if (messages.length > AI_CHAT_REQUEST_LIMITS.maxMessagesInput) {
    throw buildPayloadTooLargeError("Too many messages were provided in a single AI chat request.");
  }
  return messages
    .map((message, index) => {
      if (!message) return null;
      const role = typeof message.role === "string" ? message.role : "user";
      const content = typeof message.content === "string" ? message.content.trim() : "";
      if (content.length > AI_CHAT_REQUEST_LIMITS.maxMessageChars) {
        throw buildPayloadTooLargeError(
          `messages[${index}].content exceeds the maximum allowed length.`
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
  return Math.min(AI_CHAT_REQUEST_LIMITS.maxLimitValue, Math.max(1, Math.floor(numeric)));
};

const sanitizeSearchLimits = (value) => {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    const shorthandLimit = clampLimitNumber(value);
    if (shorthandLimit != null) {
      return { maxResults: shorthandLimit };
    }
    throw buildInvalidPayloadError("limit must be a number or an object when provided.");
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
        normalized.id = chat.id.trim().slice(0, AI_CHAT_REQUEST_LIMITS.maxSessionIdChars);
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

const sanitizeContextPayload = (value) => {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw buildInvalidPayloadError("context must be an object.");
  }
  const next = { ...value };
  if (Object.prototype.hasOwnProperty.call(next, "recentChats")) {
    next.recentChats = sanitizeRecentChats(next.recentChats);
  }
  let serialized = "";
  try {
    serialized = JSON.stringify(next) || "";
  } catch (_) {
    throw buildInvalidPayloadError("context must be JSON serializable.");
  }
  if (serialized.length > AI_CHAT_REQUEST_LIMITS.maxContextChars) {
    throw buildPayloadTooLargeError("context exceeds the maximum allowed size.");
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
      throw buildPayloadTooLargeError("message exceeds the maximum allowed length.");
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
  if (activeSessionTurns.has(sessionId)) return false;
  activeSessionTurns.add(sessionId);
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
    [location.city, location.state, location.country].filter(Boolean).join(", ") ||
    null;
  if (!where && !dest?.placeId) return null;

  const dates = plan?.dates || state?.dates || {};
  const guests = plan?.guests || state?.guests || {};
  const adults = guests.adults ?? 1;
  const children = guests.children ?? 0;
  const childrenAges = Array.isArray(guests.childrenAges) ? guests.childrenAges : [];

  let guestsSummary = "";
  if (adults > 0) guestsSummary = `${adults} adult${adults !== 1 ? "s" : ""}`;
  if (children > 0) guestsSummary += guestsSummary ? `, ${children} child${children !== 1 ? "ren" : ""}` : `${children} child${children !== 1 ? "ren" : ""}`;
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
    return res.status(400).json({ error: "Invalid AI chat payload.", code: "AI_INVALID_PAYLOAD" });
  }

  let { conversationId, incomingMessage, limits, context, uiEvent } = requestPayload;
  if (!incomingMessage && !uiEvent) {
    return res.status(400).json({ error: "message is required", code: "AI_INVALID_PAYLOAD" });
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
      role: msg.role === "assistant" ? "assistant" : msg.role === "system" ? "system" : "user",
      content: msg.content,
    }));

    try {
      const result = await runAiTurn({
        sessionId: conversationId,
        userId,
        messages: normalizedMessages,
        limits,
        uiEvent,
        context,
      });

      try {
        await appendAssistantChatMessage(conversationId, userId, {
          role: "assistant",
          content: result.reply || "Ok.",
          planSnapshot: result.plan,
          inventorySnapshot: result.inventory,
          uiSnapshot: result.ui ?? null,
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
        return res.status(500).json({ error: "Unable to save assistant reply" });
      }

      const replyText = result.assistant?.text || result.reply || "";
      const searchContext = buildSearchContext(result);
      const counts = {
        homes: Array.isArray(result.inventory?.homes) ? result.inventory.homes.length : 0,
        hotels: Array.isArray(result.inventory?.hotels) ? result.inventory.hotels.length : 0,
      };
      return res.json({
        ok: true,
        conversationId,
        sessionId: conversationId,
        reply: replyText,
        assistant: result.assistant || { text: replyText, tone: "neutral", disclaimers: [] },
        ui: result.ui,
        state: result.state,
        plan: result.plan,
        inventory: result.inventory,
        carousels: Array.isArray(result.carousels) ? result.carousels : [],
        trip: result.trip,
        counts,
        searchContext: searchContext || undefined,
        followUps: result.followUps,
        intent: result.intent,
        nextAction: result.nextAction,
        assistantReady: isAssistantEnabled(),
        quickStartPrompts: QUICK_START_PROMPTS,
      });
    } catch (err) {
      if (trySendKnownAiError(res, err)) return;
      console.error("[ai] chat failed", err);
      return res.status(500).json({ error: "Unable to process assistant query right now" });
    }
  } finally {
    releaseSessionTurn(conversationId);
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
    const limit = Number(req.query?.limit) || AI_CHAT_HISTORY_LIMITS.listDefault;
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
    const limit = Number(req.query?.limit) || AI_CHAT_HISTORY_LIMITS.detailDefault;
    const payload = await getAssistantSessionWithMessages(sessionId, userId, { limit });
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
