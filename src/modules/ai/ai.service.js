import OpenAI from "openai";
import { generateTripAddons } from "../../services/aiAssistant.service.js";
import { AI_FLAGS, AI_LIMITS } from "./ai.config.js";
import { buildInventoryCarousels } from "./ai.carousels.js";
import { applyPlanToState, INTENTS, NEXT_ACTIONS, updateStageFromAction } from "./ai.planner.js";
import { renderAssistantPayload } from "./ai.renderer.js";
import { AI_TOOLS, buildPlanFromToolArgs, TOOL_TO_NEXT_ACTION, TOOL_TO_INTENT } from "./ai.tools.js";
import { buildSystemPrompt, buildCall2SystemPrompt } from "./ai.systemPrompt.js";
import { loadAssistantState, saveAssistantState, getDefaultState } from "./ai.stateStore.js";
import {
  assessWebSearchResult,
  decideCall2WebSearch,
} from "./ai.webSearchPolicy.js";
import { geocodePlace, getNearbyPlaces, getWeatherSummary, searchStays, searchDestinationImages, getStayDetails } from "./tools/index.js";
import { logAiEvent, circuitBreaker } from "./ai.telemetry.js";

const _fcApiKey = process.env.OPENAI_API_KEY;
let _fcClient = null;
const ensureFCClient = () => {
  if (!_fcApiKey) return null;
  if (!_fcClient) _fcClient = new OpenAI({ apiKey: _fcApiKey });
  return _fcClient;
};

const CALL2_WEB_SEARCH_MODEL = "gpt-4o-search-preview";

const normalizeWebSource = (annotation) => {
  if (annotation?.type !== "url_citation") return null;
  const title = typeof annotation?.url_citation?.title === "string"
    ? annotation.url_citation.title.trim()
    : "";
  const url = typeof annotation?.url_citation?.url === "string"
    ? annotation.url_citation.url.trim()
    : "";
  if (!url) return null;
  return { title, url };
};

const dedupeWebSources = (annotations = []) => {
  const seen = new Set();
  const sources = [];
  annotations.forEach((annotation) => {
    const source = normalizeWebSource(annotation);
    if (!source) return;
    const dedupeKey = `${source.url}::${source.title}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    sources.push(source);
  });
  return sources;
};

const streamCall2Completion = async ({
  client,
  messages,
  onTextChunk = null,
  useWebSearch = false,
  onWebSearchStart = null,
  webSearchContext = null,
  streamText = true,
} = {}) => {
  if (useWebSearch) {
    onWebSearchStart?.(webSearchContext || {});
  }
  const request = {
    model: useWebSearch
      ? CALL2_WEB_SEARCH_MODEL
      : (process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini"),
    stream: true,
    messages,
  };
  if (useWebSearch) {
    request.web_search_options = {};
  }

  const stream = await client.chat.completions.create(request);
  let accumulated = "";
  const annotations = [];

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    const content = typeof delta.content === "string" ? delta.content : "";
    if (content) {
      accumulated += content;
      if (streamText) {
        onTextChunk?.(content);
      }
    }

    if (Array.isArray(delta.annotations) && delta.annotations.length) {
      annotations.push(...delta.annotations);
    }
  }

  return {
    text: accumulated,
    webSources: dedupeWebSources(annotations),
  };
};

const executeCall2WithPolicy = async ({
  client,
  messages,
  fallbackMessages = null,
  onTextChunk = null,
  emitEvent = null,
  emitTrace = null,
  webSearchDecision,
  toolName = null,
  toolArgs = null,
} = {}) => {
  const decision = webSearchDecision || decideCall2WebSearch({ toolName, toolArgs });
  const tracePayload = {
    toolName: decision.toolName,
    reason: decision.reason,
    trigger: decision.trigger || undefined,
    destination: decision.destination || undefined,
    competitorRequested: Boolean(decision.allowCompetitorMentions),
  };

  if (decision.enabled) {
    emitTrace?.("WEB_SEARCH_ALLOWED", tracePayload);
  } else {
    emitTrace?.("WEB_SEARCH_SKIPPED", tracePayload);
  }

  const runCall2 = ({ useWebSearch, streamText = true, messagesOverride = null } = {}) =>
    streamCall2Completion({
      client,
      messages: messagesOverride || messages,
      onTextChunk,
      useWebSearch,
      streamText,
      onWebSearchStart: (data) => {
        emitEvent?.("web_searching", data);
        emitTrace?.("WEB_SEARCHING", data);
      },
      webSearchContext: {
        toolName: decision.toolName,
        destination: decision.destination || null,
        aspect: toolArgs?.aspect || null,
        reason: decision.reason,
        trigger: decision.trigger || null,
      },
    });

  if (!decision.enabled) {
    const result = await runCall2({
      useWebSearch: false,
      streamText: true,
      messagesOverride: fallbackMessages || messages,
    });
    return {
      text: result.text,
      webSources: [],
      allowCompetitorWebSources: false,
      usedWebSearch: false,
    };
  }

  const webResult = await runCall2({ useWebSearch: true, streamText: false });
  const assessedResult = assessWebSearchResult({
    text: webResult.text,
    sources: webResult.webSources,
    allowCompetitors: decision.allowCompetitorMentions,
  });

  if (!assessedResult.accepted) {
    const blockedSource = assessedResult.blockedSources[0] || null;
    const blockedDomain =
      blockedSource?.hostname ||
      blockedSource?.brand ||
      assessedResult.blockedMentions[0] ||
      null;
    emitTrace?.("WEB_SEARCH_BLOCKED_SOURCE", {
      toolName: decision.toolName,
      reason: assessedResult.reason,
      trigger: decision.trigger || undefined,
      domain: blockedDomain || undefined,
      competitorRequested: Boolean(decision.allowCompetitorMentions),
    });
    emitTrace?.("WEB_SEARCH_FALLBACK_NON_WEB", {
      toolName: decision.toolName,
      reason: assessedResult.reason,
      trigger: decision.trigger || undefined,
      domain: blockedDomain || undefined,
    });
    const fallbackResult = await runCall2({
      useWebSearch: false,
      streamText: true,
      messagesOverride: fallbackMessages || messages,
    });
    return {
      text: fallbackResult.text,
      webSources: [],
      allowCompetitorWebSources: false,
      usedWebSearch: false,
    };
  }

  if (webResult.text) {
    onTextChunk?.(webResult.text);
  }

  return {
    text: webResult.text,
    webSources: assessedResult.safeSources,
    allowCompetitorWebSources: Boolean(decision.allowCompetitorMentions),
    usedWebSearch: true,
  };
};

const detectLanguageFC = (messages, userContext) => {
  // Priority 1: explicit language preference from the app
  const userLang = userContext?.user?.language || userContext?.locale?.split("-")[0];
  if (userLang === "en" || userLang === "english") return "en";
  if (userLang === "es" || userLang === "spanish") return "es";
  if (userLang === "pt" || userLang === "portuguese") return "pt";

  // Priority 2: detect from latest user message
  const latest =
    Array.isArray(messages) &&
    [...messages].reverse().find((m) => m?.role === "user" && m?.content)?.content;
  const raw = String(latest || "").trim();
  if (/\p{Script=Arabic}/u.test(raw)) return "ar";
  if (/[áéíóúñü¿¡]/.test(raw) || /\b(hola|gracias|buscar|hotel|quiero|pileta|mostrame|cuantos|fechas|necesito|alojamiento)\b/i.test(raw)) return "es";
  if (/\b(hello|hi|please|thanks|looking|hotel|need|want|book|travel)\b/i.test(raw)) return "en";
  return "es";
};

const DEBUG_TRIP_HUB = process.env.TRIP_HUB_DEBUG === "true";
const debugTripHub = (...args) => {
  if (!DEBUG_TRIP_HUB) return;
  console.log("[tripHub.debug]", ...args);
};

const summarizeReply = (value, previewLength = 40) => {
  const text = typeof value === "string" ? value : "";
  const trimmed = text.trim();
  const invisibleMatches = text.match(/[\u200B-\u200D\uFEFF]/g);
  return {
    len: text.length,
    trimmedLen: trimmed.length,
    invisibleCount: invisibleMatches ? invisibleMatches.length : 0,
    preview: trimmed.slice(0, previewLength),
  };
};

const buildEmptyInventory = () => ({
  homes: [],
  hotels: [],
  matchTypes: { homes: "NONE", hotels: "NONE" },
  foundExact: false,
});

const MAX_LAST_SHOWN_ITEMS = 20;

const buildLastSearchParams = (plan) => {
  if (!plan || typeof plan !== "object") return null;
  const location = plan.location && typeof plan.location === "object" ? plan.location : {};
  const dates = plan.dates && typeof plan.dates === "object" ? plan.dates : {};
  const guests = plan.guests && typeof plan.guests === "object" ? plan.guests : {};
  return {
    location: {
      city: location.city ?? null,
      state: location.state ?? null,
      country: location.country ?? null,
      lat: location.lat ?? null,
      lng: location.lng ?? location.lon ?? null,
    },
    dates: {
      checkIn: dates.checkIn ?? null,
      checkOut: dates.checkOut ?? null,
      flexible: typeof dates.flexible === "boolean" ? dates.flexible : true,
    },
    guests: {
      adults: guests.adults ?? guests.total ?? null,
      children: guests.children ?? null,
    },
    filters: {
      amenities: Array.isArray(plan.preferences?.amenities) ? plan.preferences.amenities : [],
      hotelAmenityCodes: Array.isArray(plan.hotelFilters?.amenityCodes) ? plan.hotelFilters.amenityCodes : [],
      minRating: plan.hotelFilters?.minRating ?? null,
      areaPreference: Array.isArray(plan.preferences?.areaPreference) ? plan.preferences.areaPreference : [],
      sortBy: plan.sortBy ?? plan.preferences?.sortBy ?? null,
    },
  };
};

const mergeHotelAmenities = (h) => {
  const fromObj = (list) =>
    Array.isArray(list) ? list.map((a) => (typeof a === "string" ? a : a?.name ?? String(a)).trim()).filter(Boolean) : [];
  const fromLeisure = Array.isArray(h.leisure) ? h.leisure.map((x) => (typeof x === "string" ? x : x?.name ?? String(x)).trim()).filter(Boolean) : [];
  const fromBusiness = Array.isArray(h.business) ? h.business.map((x) => (typeof x === "string" ? x : x?.name ?? String(x)).trim()).filter(Boolean) : [];
  const combined = [...fromObj(h.amenities), ...fromLeisure, ...fromBusiness];
  return [...new Set(combined)];
};

const collectDescriptionSnippets = (item = {}) =>
  [
    item.shortDescription,
    item.description,
    item.description1,
    item.description2,
    item.hotelDetails?.shortDescription,
    item.hotelDetails?.description,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim())
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 4);

const buildLastShownInventorySummary = (inventory, searchId) => {
  if (!inventory || typeof inventory !== "object") return null;
  const hotels = (inventory.hotels || [])
    .slice(0, MAX_LAST_SHOWN_ITEMS)
    .map((h, index) => ({
      id: h.id != null ? String(h.id) : null,
      name: h.name ?? h.title ?? "",
      city: h.city ?? "",
      stars: h.classification?.name ?? h.stars ?? null,
      displayOrder: index + 1,
      pricePerNight: h.pricePerNight ?? h.price_per_night ?? null,
      currency: h.currency ?? "USD",
      amenities: mergeHotelAmenities(h),
      descriptions: collectDescriptionSnippets(h),
      shortReason: h.shortReason ?? h.pickReason ?? null,
    }))
    .filter((h) => h.id);
  const homes = (inventory.homes || [])
    .slice(0, MAX_LAST_SHOWN_ITEMS)
    .map((h, index) => ({
      id: h.id != null ? String(h.id) : null,
      title: h.title ?? h.name ?? "",
      city: h.city ?? "",
      displayOrder: hotels.length + index + 1,
      pricePerNight: h.pricePerNight ?? h.price_per_night ?? null,
      currency: h.currency ?? "USD",
      amenities: Array.isArray(h.amenities) ? h.amenities.map((a) => (typeof a === "string" ? a : a?.name ?? String(a))) : [],
      descriptions: collectDescriptionSnippets(h),
      shortReason: h.shortReason ?? null,
    }))
    .filter((h) => h.id);
  if (!hotels.length && !homes.length) return null;
  return {
    at: new Date().toISOString(),
    searchId: searchId ?? `search-${Date.now()}`,
    hotels,
    homes,
  };
};

const buildTripSearchContextText = (state, plan) => {
  const parts = [];
  const dest = state?.destination?.name || plan?.location?.city || plan?.location?.country || null;
  if (dest) parts.push(`Destination: ${dest}`);
  else parts.push("Destination: Not set yet");
  const checkIn = state?.dates?.checkIn || plan?.dates?.checkIn;
  const checkOut = state?.dates?.checkOut || plan?.dates?.checkOut;
  if (checkIn && checkOut) parts.push(`Dates: ${checkIn} to ${checkOut}`);
  else parts.push("Dates: Not set yet");
  const adults = state?.guests?.adults ?? plan?.guests?.adults ?? plan?.guests?.total;
  const children = state?.guests?.children ?? plan?.guests?.children;
  if (adults != null || children != null) {
    parts.push(`Guests: ${adults ?? 0} adults, ${children ?? 0} children`);
  } else parts.push("Guests: Not set yet");
  const params = state?.lastSearchParams;
  if (params?.filters?.amenities?.length) {
    parts.push(`Last filters: amenities ${params.filters.amenities.join(", ")}`);
  }
  if (params?.filters?.sortBy) parts.push(`Sort: ${params.filters.sortBy}`);
  return parts.join(". ");
};

/** When true, log per-hotel amenity match in buildLastShownResultsContextText (tag yes/no). Set AI_AMENITIES_DEBUG=true or FLOW_RATE_DEBUG_LOGS=true. */
const AI_AMENITIES_DEBUG = process.env.AI_AMENITIES_DEBUG === "true" || process.env.FLOW_RATE_DEBUG_LOGS === "true";

/** Map user phrases to regex patterns (more specific first, e.g. "indoor pool" before "pool"). */
const AMENITY_MATCH_PATTERNS = [
  { keys: ["indoor pool", "pileta indoor", "piscina interior", "pileta interior", "piscina cubierta"], pattern: /indoor pool|piscina interior|pileta interior|piscina cubierta|pileta cubierta|heated indoor|indoor swimming/i },
  { keys: ["pool", "piscina", "pileta", "swimming", "nataciÃ³n"], pattern: /pool|piscina|pileta|swimming|nataciÃ³n/i },
  { keys: ["gym", "gimnasio", "fitness"], pattern: /gym|gimnasio|fitness|fitness center|musculaciÃ³n/i },
  { keys: ["wifi", "wi-fi", "internet"], pattern: /wifi|wi-fi|wireless|internet|free wifi/i },
  { keys: ["spa"], pattern: /spa|wellness|masaje|massage/i },
  { keys: ["parking", "estacionamiento", "garage"], pattern: /parking|estacionamiento|garage|car park|free parking/i },
  { keys: ["breakfast", "desayuno"], pattern: /breakfast|desayuno|included breakfast/i },
  { keys: ["restaurant", "restaurante"], pattern: /restaurant|restaurante|dining/i },
  { keys: ["bar"], pattern: /\bbar\b|bar area|lobby bar/i },
  { keys: ["beach", "playa"], pattern: /beach|playa|private beach/i },
  { keys: ["air conditioning", "aire acondicionado", "ac"], pattern: /air conditioning|aire acondicionado|a\/c|ac\b|climate/i },
  { keys: ["airport shuttle", "traslado", "shuttle"], pattern: /airport shuttle|traslado|shuttle|transfer/i },
  { keys: ["pet", "mascota", "pets"], pattern: /pet|mascota|pets|pet-friendly|dog|perro/i },
];

/** Extract what feature/amenity the user is asking about; returns a RegExp that matches that feature in amenities text, or null. */
const getRequestedFeatureRegex = (message) => {
  if (!message || typeof message !== "string") return null;
  const text = message.trim().toLowerCase();
  const askPatterns = [
    /(?:cuÃ¡les?|cuales?|quÃ©|que)\s+(?:de\s+)?(?:esos?|estos?)?\s*(?:hoteles?|hotelws?)?\s+(?:tienen|tiene|tengan)\s+(.+?)(?:\?|$)/i,
    /(?:which|what)\s+(?:of\s+)?(?:those|these)?\s*(?:hotels?)?\s+(?:have|has|had)\s+(.+?)(?:\?|$)/i,
    /(?:alguno|alguna|do\s+any|any\s+of\s+them)\s+(?:tienen|tiene|have|has)\s+(.+?)(?:\?|$)/i,
    /(?:tienen|tiene|have|has)\s+(.+?)\s+(?:pileta|piscina|pool|gym|wifi|spa|parking|breakfast|restaurant|bar|playa|shuttle|mascota)/i,
    /(?:con|with)\s+(.+?)(?:\?|$)/i,
  ];
  let phrase = null;
  for (const re of askPatterns) {
    const m = text.match(re);
    if (m && m[1]) {
      phrase = m[1].trim().replace(/\?+$/, "").trim();
      if (phrase.length > 1 && phrase.length < 80) break;
    }
  }
  if (!phrase) return null;
  for (const { keys, pattern } of AMENITY_MATCH_PATTERNS) {
    if (keys.some((k) => phrase.includes(k) || phrase === k)) return pattern;
  }
  try {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, "i");
  } catch {
    return null;
  }
};

const buildLastShownResultsContextText = (summary, latestUserMessage = "") => {
  if (!summary || ( !summary.hotels?.length && !summary.homes?.length )) return null;
  const featureRegex = getRequestedFeatureRegex(latestUserMessage);
  const tagLabel = featureRegex ? "Matches your question" : null;
  const lines = [];
  if (summary.hotels?.length) {
    lines.push("Hotels:");
    summary.hotels.forEach((h) => {
      const am = Array.isArray(h.amenities) ? h.amenities.join(", ") : "";
      const matches = tagLabel && featureRegex ? featureRegex.test(am) : null;
      if (AI_AMENITIES_DEBUG && tagLabel) {
        console.log("[ai][amenities-debug]", { name: h.name, amenitiesCount: Array.isArray(h.amenities) ? h.amenities.length : 0, matches: matches ? "yes" : "no" });
      }
      const tag = tagLabel != null ? ` [${tagLabel}: ${matches ? "yes" : "no"}]` : "";
      const reason = h.shortReason ? ` | highlight: ${h.shortReason}` : "";
      const desc = Array.isArray(h.descriptions) && h.descriptions[0] ? ` | desc: ${h.descriptions[0]}` : "";
      lines.push(`- ${h.name}, ${h.city}, ${h.stars || ""}, price ${h.pricePerNight ?? "?"} ${h.currency}, amenities: ${am}${tag}${reason}${desc}`);
    });
  }
  if (summary.homes?.length) {
    lines.push("Homes:");
    summary.homes.forEach((h) => {
      const am = Array.isArray(h.amenities) ? h.amenities.join(", ") : "";
      const matches = tagLabel && featureRegex ? featureRegex.test(am) : null;
      const tag = tagLabel != null ? ` [${tagLabel}: ${matches ? "yes" : "no"}]` : "";
      const reason = h.shortReason ? ` | highlight: ${h.shortReason}` : "";
      const desc = Array.isArray(h.descriptions) && h.descriptions[0] ? ` | desc: ${h.descriptions[0]}` : "";
      lines.push(`- ${h.name || h.title}, ${h.city}, price ${h.pricePerNight ?? "?"} ${h.currency}, amenities: ${am}${tag}${reason}${desc}`);
    });
  }
  return lines.join("\n");
};

/** Detect if the user is asking for more info about a specific hotel/home from the last results; return its id and type or null. */
const resolveRequestedStayFromMessage = (message, lastShownSummary) => {
  if (!message || typeof message !== "string" || !lastShownSummary) return null;
  const text = message.trim().toLowerCase();
  const hotels = lastShownSummary.hotels || [];
  const homes = lastShownSummary.homes || [];
  if (hotels.length === 0 && homes.length === 0) return null;

  const askMore =
    /\b(more about|tell me more|mÃ¡s (sobre|informaciÃ³n|info)|detalles?|details?|info about|informaciÃ³n de|quÃ© tal|what about)\b/i.test(text) ||
    /\b(does (the )?(first|second|third|that one)|(el |la )?(primero|segundo|tercero)|tiene (el |la )?(primero)|that hotel|ese hotel)\b/i.test(text) ||
    /\b(how about|and the first|y el primero|cuÃ©ntame (del|de la)|dime (del|de la))\b/i.test(text) ||
    /\b(sabes (algo )?de|do you have (info|details)|tienes (info|datos)|info del|informaciÃ³n del|data on)\b/i.test(text);

  for (const h of hotels) {
    const name = (h?.name || "").trim().toLowerCase();
    if (name && text.includes(name)) return { stayId: h.id, type: "HOTEL" };
  }
  for (const h of homes) {
    const name = ((h?.name || h?.title) || "").trim().toLowerCase();
    if (name && text.includes(name)) return { stayId: h.id, type: "HOME" };
  }

  if (!askMore) return null;
  const second = /second|segundo|segunda|2nd|el segundo|la segunda/i.test(text);
  const third = /third|tercero|tercera|3rd|el tercero|la tercera/i.test(text);
  let index = 0;
  if (second) index = 1;
  else if (third) index = 2;
  if (hotels.length > index) {
    const h = hotels[index];
    if (h?.id) return { stayId: h.id, type: "HOTEL" };
  }
  if (homes.length > index) {
    const h = homes[index];
    if (h?.id) return { stayId: h.id, type: "HOME" };
  }
  if (hotels.length > 0 && hotels[0]?.id) return { stayId: hotels[0].id, type: "HOTEL" };
  if (homes.length > 0 && homes[0]?.id) return { stayId: homes[0].id, type: "HOME" };
  return null;
};

/** Build context text for the model from stay details (same data we show in UI; safe to send to OpenAI). */
const buildStayDetailsContextForPrompt = (details) => {
  if (!details?.details) return null;
  const d = details.details;
  const parts = [];
  if (details.type === "HOTEL") {
    if (d.name) parts.push(`Name: ${d.name}`);
    if (d.address) parts.push(`Address: ${d.address}`);
    if (d.contact?.checkIn) parts.push(`Check-in: ${d.contact.checkIn}`);
    if (d.contact?.checkOut) parts.push(`Check-out: ${d.contact.checkOut}`);
    if (d.contact?.phone) parts.push(`Phone: ${d.contact.phone}`);
    const am = (d.amenities || []).map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean);
    if (am.length) parts.push(`Amenities: ${am.join(", ")}`);
    if (d.leisure?.length) parts.push(`Leisure: ${d.leisure.join(", ")}`);
    if (d.business?.length) parts.push(`Business: ${d.business.join(", ")}`);
    if (d.shortDescription) parts.push(`Description: ${d.shortDescription}`);
    if (d.propertyInfo?.roomsCount != null) parts.push(`Rooms: ${d.propertyInfo.roomsCount}`);
    if (d.classification?.name) parts.push(`Classification: ${d.classification.name}`);
  } else {
    if (d.title) parts.push(`Title: ${d.title}`);
    if (d.locationText) parts.push(`Location: ${d.locationText}`);
    if (d.summaryLine) parts.push(`Summary: ${d.summaryLine}`);
    if (d.maxGuests != null) parts.push(`Max guests: ${d.maxGuests}`);
    if (d.bedrooms != null) parts.push(`Bedrooms: ${d.bedrooms}`);
    if (d.bathrooms != null) parts.push(`Bathrooms: ${d.bathrooms}`);
  }
  if (parts.length === 0) return null;
  return `[Full details from database for the property the user asked about]\n${parts.join("\n")}`;
};

const normalizeMessages = (messages = []) =>
  Array.isArray(messages)
    ? messages
      .map((message) => {
        if (!message) return null;
        const role = typeof message.role === "string" ? message.role : "user";
        const content = typeof message.content === "string" ? message.content.trim() : "";
        if (!content) return null;
        return { role, content };
      })
      .filter(Boolean)
    : [];

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const injectConfirmedSearchIntoPlan = (plan, confirmedSearch) => {
  if (!plan || !confirmedSearch || typeof confirmedSearch !== "object") return;
  if (confirmedSearch.where && String(confirmedSearch.where).trim()) {
    const whereStr = String(confirmedSearch.where).trim();
    if (!plan.location || typeof plan.location !== "object") plan.location = {};
    if (!plan.location.rawQuery) plan.location.rawQuery = whereStr;
    if (!plan.location.city && !plan.location.country && !plan.location.landmark) {
      plan.location.city = whereStr;
    }
  }
  if (confirmedSearch.placeId && String(confirmedSearch.placeId).trim()) {
    if (!plan.location || typeof plan.location !== "object") plan.location = {};
    if (!plan.location.placeId) {
      plan.location.placeId = String(confirmedSearch.placeId).trim();
    }
  }
  if (confirmedSearch.lat != null) {
    const lat = Number(confirmedSearch.lat);
    if (Number.isFinite(lat)) {
      if (!plan.location || typeof plan.location !== "object") plan.location = {};
      if (!Number.isFinite(Number(plan.location.lat))) plan.location.lat = lat;
    }
  }
  if (confirmedSearch.lng != null) {
    const lng = Number(confirmedSearch.lng);
    if (Number.isFinite(lng)) {
      if (!plan.location || typeof plan.location !== "object") plan.location = {};
      const existingLng = Number(plan.location.lng ?? plan.location.lon);
      if (!Number.isFinite(existingLng)) plan.location.lng = lng;
    }
  }
  if (confirmedSearch.when && String(confirmedSearch.when).trim()) {
    const whenStr = String(confirmedSearch.when).trim();
    const parts = whenStr.split("|").map((p) => String(p).trim()).filter(Boolean);
    const checkIn = parts[0] && YYYY_MM_DD.test(parts[0]) ? parts[0] : null;
    const checkOut = parts[1] && YYYY_MM_DD.test(parts[1]) ? parts[1] : null;
    if (checkIn) {
      if (!plan.dates || typeof plan.dates !== "object") plan.dates = {};
      plan.dates.checkIn = checkIn;
      if (checkOut) plan.dates.checkOut = checkOut;
    }
  }
  if (confirmedSearch.who && String(confirmedSearch.who).trim()) {
    const whoStr = String(confirmedSearch.who).trim();
    const adultsMatch = whoStr.match(/(\d+)\s*(?:adults?|adultos?)/i);
    const childrenMatch = whoStr.match(/(\d+)\s*(?:children?|ni[ñn]os?)/i);
    const adults = adultsMatch ? Math.max(1, parseInt(adultsMatch[1], 10)) : null;
    const children = childrenMatch ? Math.max(0, parseInt(childrenMatch[1], 10)) : 0;
    if (!plan.guests || typeof plan.guests !== "object") plan.guests = {};
    if (adults !== null) plan.guests.adults = adults;
    plan.guests.children = children;
  }
};

const applyPlanDefaults = (plan, state) => {
  const nextPlan = { ...(plan || {}) };
  if (!Array.isArray(nextPlan.listingTypes) || !nextPlan.listingTypes.length) {
    if (Array.isArray(state?.preferences?.listingTypes) && state.preferences.listingTypes.length) {
      nextPlan.listingTypes = state.preferences.listingTypes;
    }
  }
  if (!nextPlan.sortBy && state?.preferences?.sortBy) {
    nextPlan.sortBy = state.preferences.sortBy;
  }
  if (!nextPlan.assumptions || typeof nextPlan.assumptions !== "object") {
    nextPlan.assumptions = {};
  }
  if (nextPlan.assumptions.defaultGuestsApplied) {
    delete nextPlan.assumptions.defaultGuestsApplied;
  }
  return nextPlan;
};

const applyUiEventToPlan = (plan, uiEvent) => {
  const nextPlan = { ...(plan || {}) };
  if (!uiEvent) return nextPlan;
  const raw = typeof uiEvent === "string" ? uiEvent : uiEvent?.id || uiEvent?.event || "";
  const normalized = String(raw || "").trim().toUpperCase();
  if (!normalized) return nextPlan;

  if (normalized.includes("CHEAP") || normalized.includes("LOW_PRICE")) {
    nextPlan.sortBy = "PRICE_ASC";
  } else if (normalized.includes("EXPENSIVE") || normalized.includes("HIGH_PRICE")) {
    nextPlan.sortBy = "PRICE_DESC";
  } else if (normalized.includes("POPULAR")) {
    nextPlan.sortBy = "POPULARITY";
  }

  if (normalized.includes("HOTELS")) {
    nextPlan.listingTypes = ["HOTELS"];
  } else if (normalized.includes("HOMES")) {
    nextPlan.listingTypes = ["HOMES"];
  }

  return nextPlan;
};

const PLACE_CATEGORIES = [
  {
    id: "food",
    type: "restaurant",
    label: "Food",
    keywords: ["restaurant", "restaurante", "comida", "food", "cafe", "cafeteria", "brunch", "bar"],
  },
  {
    id: "attractions",
    type: "tourist_attraction",
    label: "Attractions",
    keywords: ["atraccion", "atracciones", "attraction", "tourist", "interesante", "museo", "museum", "parque", "park"],
  },
  {
    id: "shopping",
    type: "shopping_mall",
    label: "Shopping",
    keywords: ["shopping", "compras", "mall", "centro comercial", "outlet", "tiendas"],
  },
  {
    id: "clothing",
    type: "clothing_store",
    label: "Clothing",
    keywords: ["ropa", "clothing", "fashion", "boutique", "zapatos", "shoe", "moda"],
  },
  {
    id: "pharmacy",
    type: "pharmacy",
    label: "Pharmacy",
    keywords: ["farmacia", "farmacias", "pharmacy", "pharmacies", "medicina", "medicinas"],
  },
  {
    id: "grocery",
    type: "grocery_or_supermarket",
    label: "Groceries",
    keywords: ["supermercado", "super", "grocery", "groceries", "market", "mercado"],
  },
  {
    id: "hospital",
    type: "hospital",
    label: "Hospital",
    keywords: ["hospital", "clinica", "clinics", "clinic", "emergencia", "emergency"],
  },
  {
    id: "atm",
    type: "atm",
    label: "ATM",
    keywords: ["atm", "cajero", "cajeros", "cash", "dinero"],
  },
];

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const extractLatestUserMessage = (messages = []) =>
  [...messages].reverse().find((msg) => msg?.role === "user" && msg?.content)?.content || "";

const extractRadiusKm = (text) => {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*(km|kilometros|kilometers)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const normalizeTripContext = (value) => {
  if (!value || typeof value !== "object") return null;
  const raw = value.trip || value;
  if (!raw || typeof raw !== "object") return null;
  const location = raw.location || raw.destination || {};
  const lat = Number(location.lat ?? location.latitude ?? raw.lat ?? raw.latitude);
  const lng = Number(location.lng ?? location.lon ?? location.longitude ?? raw.lng ?? raw.longitude);
  const locationText =
    raw.locationText ||
    raw.address ||
    location.address ||
    [location.city, location.state, location.country].filter(Boolean).join(", ") ||
    raw.city ||
    raw.country ||
    null;
  return {
    bookingId: raw.bookingId ?? raw.booking_id ?? null,
    stayName: raw.stayName ?? raw.stay_name ?? raw.name ?? null,
    locationText: locationText || null,
    location: {
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      city: location.city ?? raw.city ?? null,
      state: location.state ?? raw.state ?? null,
      country: location.country ?? raw.country ?? null,
      address: location.address ?? raw.address ?? null,
    },
    dates: {
      checkIn: raw.dates?.checkIn ?? raw.checkIn ?? null,
      checkOut: raw.dates?.checkOut ?? raw.checkOut ?? null,
    },
    guests: raw.guests ?? null,
    radiusKm: raw.radiusKm ?? raw.radius_km ?? null,
    summary: raw.summary ?? null,
  };
};

const mergeTripContext = (base, incoming) => {
  if (!incoming) return base || null;
  if (!base) return incoming;
  return {
    ...base,
    ...incoming,
    location: { ...(base.location || {}), ...(incoming.location || {}) },
    dates: { ...(base.dates || {}), ...(incoming.dates || {}) },
  };
};

const extractTripRequest = ({ text, uiEvent, tripContext }) => {
  const normalized = normalizeText(text);
  const uiRaw = typeof uiEvent === "string" ? uiEvent : uiEvent?.id || uiEvent?.event || "";
  const normalizedUi = normalizeText(uiRaw);
  const wantsItinerary = /(itinerario|itinerary|planificar|plan|organizar|armar|schedule|dia\s+\d|day\s+\d)/i.test(
    normalized
  );
  const wantsNearby =
    /(cerca|near|nearby|lugares|places|restaurant|restaurante|comida|shopping|compras|ropa|attraction|atraccion|farmacia|pharmacy|supermercado|grocery|hospital|clinica|atm|cajero)/i.test(
      normalized
    );

  // Extract specific keyword if present (very naive, just checks existence)
  let specificKeyword = null;
  if (/(museo|museum)/i.test(normalized)) specificKeyword = "museum";
  else if (/(parque|park)/i.test(normalized)) specificKeyword = "park";
  else if (/(cafe|coffee)/i.test(normalized)) specificKeyword = "cafe";
  else if (/(bar|pub)/i.test(normalized)) specificKeyword = "bar";
  else if (/(farmacia|pharmacy)/i.test(normalized)) specificKeyword = "pharmacy";
  else if (/(supermercado|grocery|market)/i.test(normalized)) specificKeyword = "grocery store";
  else if (/(hospital|clinica|clinic|emergency)/i.test(normalized)) specificKeyword = "hospital";
  else if (/(atm|cajero|cash)/i.test(normalized)) specificKeyword = "atm";
  else if (/(sushi|pizza|burger|pasta)/i.test(normalized)) specificKeyword = normalized.match(/(sushi|pizza|burger|pasta)/i)[0];

  const keyword = /(vegano|vegan|vegetarian|veg)/i.test(normalized) ? "vegan" : specificKeyword;

  const categories = PLACE_CATEGORIES.filter((category) =>
    category.keywords.some((kw) => normalized.includes(kw))
  );

  const shouldBootstrap =
    normalizedUi.includes("trip") ||
    normalizedUi.includes("itinerary") ||
    normalizedUi.includes("plan");

  if (!wantsItinerary && !wantsNearby && !shouldBootstrap) return null;
  if (!tripContext) return null;

  const resolvedCategories = categories.length
    ? categories
    : [PLACE_CATEGORIES[1], PLACE_CATEGORIES[0], PLACE_CATEGORIES[2]].filter(Boolean);

  return {
    categories: resolvedCategories,
    keyword,
    wantsItinerary: wantsItinerary || shouldBootstrap,
    radiusKm: extractRadiusKm(text) ?? tripContext.radiusKm ?? null,
    raw: text,
  };
};

const resolveTripLocation = async (tripContext, state, plan, userContext) => {
  if (tripContext?.location?.lat != null && tripContext?.location?.lng != null) {
    return tripContext.location;
  }
  if (state?.destination?.lat != null && state?.destination?.lon != null) {
    return { lat: state.destination.lat, lng: state.destination.lon };
  }

  // Strategy 1: Specific Address
  const specificText = tripContext?.locationText || plan?.location?.address;
  if (specificText) {
    const geocoded = await geocodePlace(specificText);
    if (geocoded?.lat && geocoded?.lon) {
      return { lat: geocoded.lat, lng: geocoded.lon };
    }
  }

  // Strategy 2: Broad Location (City/Country)
  const broadText =
    tripContext?.location?.city ||
    plan?.location?.city ||
    tripContext?.location?.country ||
    plan?.location?.country ||
    userContext?.location?.city ||
    state?.destination?.name ||
    null;

  if (broadText) {
    const geocoded = await geocodePlace(broadText);
    if (geocoded?.lat && geocoded?.lon) {
      return { lat: geocoded.lat, lng: geocoded.lon };
    }
  }

  return null;
};

const buildTripSuggestions = async ({ request, location }) => {
  if (!request || !location) return [];
  const suggestions = [];
  for (const category of request.categories) {
    const useKeyword = request.keyword || null;
    const places = await getNearbyPlaces({
      location,
      radiusKm: request.radiusKm,
      type: category.type,
      keyword: useKeyword,
      limit: 5,
    });
    suggestions.push({
      id: category.id,
      label: category.label,
      type: category.type,
      places,
    });
  }
  return suggestions;
};

const extractWeatherLocationText = (text) => {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  const match =
    normalized.match(/(?:clima|tiempo|weather|temperatura|pronostico)\s*(?:en|in)\s+(.+)/i) ||
    normalized.match(/\b(?:en|in)\s+(.+)/i);
  if (!match) return "";
  const raw = match[1] || "";
  return raw.replace(/[?.!,]+$/g, "").trim();
};

const resolveWeatherLocation = async ({ text, tripContext, state, plan, userContext }) => {
  const explicit = extractWeatherLocationText(text);
  if (explicit) {
    const geocoded = await geocodePlace(explicit);
    if (geocoded?.lat && geocoded?.lon) {
      return { lat: geocoded.lat, lng: geocoded.lon, name: explicit };
    }
    return { name: explicit };
  }
  return resolveTripLocation(tripContext, state, plan, userContext);
};

const buildItinerary = ({ request, tripContext, suggestions }) => {
  if (!request?.wantsItinerary) return [];
  const start = tripContext?.dates?.checkIn ? new Date(tripContext.dates.checkIn) : null;
  const end = tripContext?.dates?.checkOut ? new Date(tripContext.dates.checkOut) : null;
  const dates = [];
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    const cursor = new Date(start);
    while (cursor <= end && dates.length < 3) {
      dates.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    dates.push(new Date());
    dates.push(new Date(Date.now() + 86400000));
  }

  const byCategory = suggestions.reduce((acc, item) => {
    acc[item.id] = Array.isArray(item.places) ? [...item.places] : [];
    return acc;
  }, {});

  const takePlace = (ids = []) => {
    for (const id of ids) {
      const list = byCategory[id] || [];
      if (list.length) return list.shift();
    }
    return null;
  };

  return dates.slice(0, 3).map((dateObj, index) => {
    const label = `Day ${index + 1}`;
    const morning = takePlace(["attractions", "shopping"]);
    const afternoon = takePlace(["shopping", "clothing", "attractions"]);
    const evening = takePlace(["food"]);
    const segments = [];
    if (morning) segments.push({ timeOfDay: "morning", place: morning });
    if (afternoon) segments.push({ timeOfDay: "afternoon", place: afternoon });
    if (evening) segments.push({ timeOfDay: "evening", place: evening });
    return {
      date: dateObj.toISOString().split("T")[0],
      label,
      segments,
    };
  });
};

const STATIC_SEARCH_RESULTS_LIMIT = 15;
const LIVE_SEARCH_RESULTS_LIMIT = 120;
const SEARCH_RESULTS_HARD_CAP = 120;

const clampResultLimit = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(SEARCH_RESULTS_HARD_CAP, Math.max(1, Math.floor(numeric)));
};

const getMissingDataQuestion = (inputType, language) => {
  const lang = language || "en";
  if (inputType === "dateRange") {
    if (lang === "es") return "¿Para qué fechas estás buscando?";
    if (lang === "pt") return "Para quais datas você está buscando?";
    return "What dates are you looking for?";
  }
  if (inputType === "guestCount") {
    if (lang === "es") return "¿Cuántos huéspedes van a ser?";
    if (lang === "pt") return "Quantos hóspedes serão?";
    return "How many guests will be staying?";
  }
  if (inputType === "nationality") {
    if (lang === "es") return "Para mostrarte precios en tiempo real necesito saber tu nacionalidad. ¿De dónde sos?";
    if (lang === "pt") return "Para mostrar preços ao vivo preciso saber sua nacionalidade. De onde você é?";
    return "To show you live rates I need your nationality. Where are you from?";
  }
  return "";
};

const hasSearchDates = (plan) =>
  Boolean(plan?.dates?.checkIn && plan?.dates?.checkOut);

const hasSearchGuests = (plan) => {
  const adults = Number(plan?.guests?.adults);
  const total = Number(plan?.guests?.total);
  return (
    (Number.isFinite(adults) && adults > 0) ||
    (Number.isFinite(total) && total > 0)
  );
};

const hasSearchDestination = (state, plan) =>
  Boolean(
    state?.destination?.name ||
    ((Number.isFinite(Number(state?.destination?.lat)) && Number.isFinite(Number(state?.destination?.lon))) ||
      (Number.isFinite(Number(plan?.location?.lat)) && Number.isFinite(Number(plan?.location?.lng ?? plan?.location?.lon)))) ||
    plan?.location?.city ||
    plan?.location?.country
  );

const LIVE_AVAILABILITY_FOLLOW_UP_PATTERN =
  /\b(disponibilidad real|precio real|precios reales|mostrarme disponibilidad|mostrame disponibilidad|mostrar disponibilidad|ver disponibilidad|ver precio real|live availability|live pricing|real availability|real prices|show availability|show me availability|show live rates)\b/i;

const MORE_OPTIONS_PATTERN =
  /\b(more options|more hotels|show more|show me more|more stays|another option|other options|otras opciones|mas opciones|mÃ¡s opciones|mÃ¡s hoteles|mas hoteles|mostrame mas|muÃ©strame mÃ¡s|mostrar mas|mostrar mÃ¡s|seguime mostrando|seguÃ­ mostrÃ¡ndome)\b/i;

const wantsExplicitLiveAvailability = (text) =>
  typeof text === "string" && LIVE_AVAILABILITY_FOLLOW_UP_PATTERN.test(text);

const wantsAdditionalSearchResults = (text) =>
  typeof text === "string" && MORE_OPTIONS_PATTERN.test(text);

/**
 * When running search with destination but missing dates/guests, fill defaults so we return results with rates.
 * Returns true if any default was applied (caller can tell user "we assumed X; you can change them").
 */
const resolveSearchLimits = ({ plan, limits }) => {
  const isLiveInventoryMode = hasSearchDates(plan) && hasSearchGuests(plan);
  const defaultMaxResults = isLiveInventoryMode
    ? LIVE_SEARCH_RESULTS_LIMIT
    : STATIC_SEARCH_RESULTS_LIMIT;
  const maxResults = clampResultLimit(limits?.maxResults, defaultMaxResults);
  return {
    isLiveInventoryMode,
    maxResults,
    limit: {
      homes: clampResultLimit(limits?.homes, maxResults),
      hotels: clampResultLimit(limits?.hotels, maxResults),
    },
  };
};

/**
 * runFunctionCallingTurn — Complete AI turn using OpenAI function calling.
 * Replaces the old regex router + extractSearchPlan with a single streaming
 * Call 1 that selects the tool, then executes search / Call 2 / direct text
 * depending on which tool was chosen.
 */
export const runFunctionCallingTurn = async ({
  sessionId,
  userId,
  message,
  messages,
  limits,
  stateOverride,
  uiEvent,
  context,
  onTextChunk = null,
  onEvent = null,
} = {}) => {
  const startedAt = Date.now();
  const emitEvent = (type, data = {}) => {
    if (typeof onEvent !== "function" || !type) return;
    try { onEvent({ type, data }); } catch (_) {}
  };
  const emitTrace = (code, data = {}) => {
    if (!code) return;
    emitEvent("trace", { code, ...data });
  };

  // Circuit breaker
  if (circuitBreaker.isOpen()) {
    const err = new Error("AI service is temporarily unavailable. Please try again in a moment.");
    err.code = "AI_CIRCUIT_OPEN";
    err.status = 503;
    throw err;
  }

  if (!AI_FLAGS.chatEnabled) {
    return {
      inventory: buildEmptyInventory(), carousels: [], reply: "AI chat is disabled.",
      followUps: [], plan: null, state: stateOverride || null,
      ui: { chips: [], cards: [], inputs: [], sections: [] },
      webSources: [],
      intent: "SMALL_TALK", nextAction: "SMALL_TALK", safeMode: false,
    };
  }

  // 1. Normalize messages
  let normalizedMessages = normalizeMessages(messages);
  if (!normalizedMessages.length && message) {
    normalizedMessages = [{ role: "user", content: String(message).trim() }];
  }
  if (normalizedMessages.length > AI_LIMITS.maxMessages) {
    normalizedMessages = normalizedMessages.slice(-AI_LIMITS.maxMessages);
  }

  // 2. Load state — always falls back to getDefaultState() so existingState is never null
  const existingState =
    stateOverride ||
    (sessionId && userId ? await loadAssistantState({ sessionId, userId }) : null) ||
    getDefaultState();

  const incomingTripContext = normalizeTripContext(context?.trip ?? context?.tripContext ?? context);
  const userContext = context && typeof context === "object" ? context : null;
  const confirmedSearch =
    userContext && typeof userContext === "object" && userContext.confirmedSearch
      ? userContext.confirmedSearch
      : null;
  const latestUserMessage = extractLatestUserMessage(normalizedMessages);

  // 3. Detect language
  const language = detectLanguageFC(normalizedMessages, userContext);

  // 3a. Cancel pending — user dismissed the data-collection card
  if (userContext?.cancelPending === true) {
    if (existingState.pendingToolCall) {
      existingState.pendingToolCall = null;
      await saveAssistantState({ sessionId, userId, state: existingState });
    }
    const cancelMsg = language === "es"
      ? "Búsqueda cancelada. Podés empezar de nuevo cuando quieras."
      : "Search cancelled. Feel free to start again whenever you'd like.";
    onTextChunk?.(cancelMsg);
    return {
      reply: cancelMsg,
      assistant: null,
      followUps: [],
      ui: { inputs: [], chips: [], cards: [], sections: [] },
      webSources: [],
      plan: null,
      inventory: buildEmptyInventory(),
      carousels: [],
      trip: null,
      state: existingState,
      intent: "SMALL_TALK",
      nextAction: "SMALL_TALK",
      safeMode: false,
    };
  }

  // 3b. Resume pending tool call — flag for later use after Call 1
  // If user explicitly abandoned the data-collection flow (skipDataCollection), clear stored state
  if (userContext?.skipDataCollection && existingState?.pendingToolCall) {
    existingState.pendingToolCall = null;
  }
  const pendingTc = existingState?.pendingToolCall;
  const incomingNationality = userContext?.passengerNationality ?? userContext?.nationality ?? null;
  const incomingWhen = userContext?.confirmedSearch?.when ?? null;
  const incomingWho = userContext?.confirmedSearch?.who ?? null;
  const hasPendingToolCallResume = Boolean(
    !userContext?.skipDataCollection &&
    pendingTc?.toolName &&
    !existingState?.locks?.bookingFlowLocked &&
    (
      (pendingTc.missingField === "nationality" && incomingNationality) ||
      (pendingTc.missingField === "dateRange" && incomingWhen) ||
      (pendingTc.missingField === "guestCount" && incomingWho)
    )
  );

  // 4. Build Call 1 system prompt
  const systemPrompt = buildSystemPrompt({ state: existingState, userContext, language });

  // 5. Thinking event
  emitEvent("thinking", {});
  emitTrace("ANALYZING_MESSAGE", { messageLength: latestUserMessage ? String(latestUserMessage).trim().length : 0 });

  // 6. Call 1 — streaming with tools
  const client = ensureFCClient();
  if (!client) {
    throw new Error("OpenAI API key not configured");
  }

  let directText = "";
  let finishReason = "stop";
  const toolCallAccum = {};

  try {
    const stream = await client.chat.completions.create({
      model: process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini",
      tools: AI_TOOLS,
      tool_choice: "auto",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...normalizedMessages,
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const reason = chunk.choices[0]?.finish_reason;
      if (reason) finishReason = reason;
      if (!delta) continue;

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallAccum[idx]) toolCallAccum[idx] = { id: "", name: "", arguments: "" };
          if (tc.id) toolCallAccum[idx].id += tc.id;
          if (tc.function?.name) toolCallAccum[idx].name += tc.function.name;
          if (tc.function?.arguments) toolCallAccum[idx].arguments += tc.function.arguments;
        }
      }

      if (delta.content) {
        directText += delta.content;
      }
    }
  } catch (callErr) {
    circuitBreaker.onFailure?.();
    throw callErr;
  }

  // Parse tool call from accumulated deltas
  let toolCall = null;
  if (finishReason === "tool_calls" && Object.keys(toolCallAccum).length > 0) {
    const tc = toolCallAccum[0];
    try {
      toolCall = { id: tc.id, name: tc.name, args: JSON.parse(tc.arguments || "{}") };
    } catch {
      toolCall = null;
    }
  }

  // 7a. Resume pending tool call — override toolCall to force the stored tool
  if (hasPendingToolCallResume) {
    toolCall = { id: "resume_pending", name: pendingTc.toolName, args: pendingTc.args || {} };
  }

  // 7b. bookingFlowLocked guard — force SMALL_TALK if locked
  if (
    existingState?.locks?.bookingFlowLocked &&
    toolCall &&
    ["search_stays", "get_stay_details"].includes(toolCall.name)
  ) {
    toolCall = null;
  }

  // 8. Handle tool cases
  let plan = null;
  let inventory = buildEmptyInventory();
  let carousels = [];
  let nextAction = "SMALL_TALK";
  let resolvedIntent = "SMALL_TALK";
  let preparedReply = null;
  let stayDetailsFromDb = null;
  let webSources = [];
  let allowCompetitorWebSources = false;

  if (toolCall?.name === "search_stays") {
    // ---- A. SEARCH ----
    // Check if we're resuming from a stored pendingToolCall (interrupted to collect missing data)
    const storedPending = existingState?.pendingToolCall || null;
    const originalToolArgs = storedPending?.args || toolCall.args;

    // Build plan: from stored args (if resuming) OR new tool args
    plan = buildPlanFromToolArgs(originalToolArgs, language);
    console.log("[DEBUG-1] plan.guests después de buildPlanFromToolArgs:", JSON.stringify(plan.guests));
    // Always inject confirmedSearch — dates/guests from UI widgets come through here on resume
    injectConfirmedSearchIntoPlan(plan, confirmedSearch);
    console.log("[DEBUG-2] plan.guests después de injectConfirmedSearchIntoPlan:", JSON.stringify(plan.guests));

    // Helper: interrupt to collect a missing field, save pendingToolCall, stream question
    const interruptForMissingData = async (inputType, nextActionValue) => {
      const questionText = getMissingDataQuestion(inputType, language);
      // Enrich stored args with data already in the plan so subsequent resumes have it
      // (plan is captured by reference — reflects its current state when called)
      const enrichedArgs = { ...originalToolArgs };
      if (plan.dates?.checkIn) {
        enrichedArgs.checkIn = plan.dates.checkIn;
        enrichedArgs.checkOut = plan.dates.checkOut || null;
      }
      if (plan.guests?.adults != null) {
        enrichedArgs.adults = plan.guests.adults;
        enrichedArgs.children = plan.guests.children ?? 0;
      }
      existingState.pendingToolCall = {
        toolName: "search_stays",
        args: enrichedArgs,
        missingField: inputType,
        savedAt: Date.now(),
      };
      await saveAssistantState({ sessionId, userId, state: existingState });
      onTextChunk?.(questionText);
      return {
        reply: questionText,
        assistant: null,
        followUps: [],
        ui: { inputs: [{ type: inputType }] },
        webSources: [],
        plan: null,
        inventory: buildEmptyInventory(),
        carousels: [],
        trip: null,
        state: existingState,
        intent: "SEARCH",
        nextAction: nextActionValue,
        safeMode: false,
      };
    };

    // 1. Recover dates/guests from existingState if the model passed nulls (e.g. follow-up
    //    question misrouted as search_stays instead of answer_from_results).
    if (!plan.dates?.checkIn && existingState?.dates?.checkIn) {
      if (!plan.dates || typeof plan.dates !== "object") plan.dates = {};
      plan.dates.checkIn  = existingState.dates.checkIn;
      plan.dates.checkOut = existingState.dates.checkOut || null;
      plan.dates.flexible = false;
    }
    if (!plan.guests?.adults && existingState?.guests?.adults) {
      if (!plan.guests || typeof plan.guests !== "object") plan.guests = {};
      plan.guests.adults   = existingState.guests.adults;
      plan.guests.children = existingState.guests.children ?? 0;
    }

    // 2. Check dates — interrupt only if still missing after state fallback
    if (!hasSearchDates(plan)) {
      return await interruptForMissingData("dateRange", "ASK_FOR_DATES");
    }

    // Apply UI event (e.g. sort chips) and defaults
    const planWithUi = applyUiEventToPlan(plan, uiEvent);
    const planWithDefaults = applyPlanDefaults(planWithUi, existingState);

    // 3. Check guests — interrupt only if still missing after state fallback
    if (!hasSearchGuests(planWithDefaults)) {
      return await interruptForMissingData("guestCount", "ASK_FOR_GUESTS");
    }

    const { plan: mergedPlan } = applyPlanToState(existingState, planWithDefaults);
    plan = mergedPlan;

    // 3. Inject nationality/residence from userContext
    const contextNationality = userContext?.passengerNationality ?? userContext?.nationality ?? null;
    const contextResidence = userContext?.passengerCountryOfResidence ?? userContext?.residence ?? null;
    if (contextNationality) plan.passengerNationality = contextNationality;
    if (contextResidence) plan.passengerCountryOfResidence = contextResidence;

    // 4. Check nationality (needed for live rates)
    if (!plan.passengerNationality) {
      return await interruptForMissingData("nationality", "ASK_FOR_NATIONALITY");
    }

    // All data present — clear pendingToolCall
    if (existingState.pendingToolCall) {
      existingState.pendingToolCall = null;
    }

    const excludeIds = toolCall.args.wantsMoreResults
      ? existingState?.lastResultsContext?.shownIds || []
      : [];

    const searchLimits = resolveSearchLimits({ plan, limits });
    const searchDestination = plan?.location?.city || existingState?.destination?.name || null;
    const expectsLive = hasSearchDates(plan) && hasSearchGuests(plan);

    emitTrace(expectsLive ? "SEARCH_STRATEGY_LIVE" : "SEARCH_STRATEGY_CATALOG", { destination: searchDestination });
    emitEvent(expectsLive ? "searching_live" : "searching_catalog", { destination: searchDestination });
    emitTrace("DESTINATION_RECOGNIZED", { destination: searchDestination });

    const _t0 = Date.now();
    inventory = await searchStays(plan, {
      limit: searchLimits.limit,
      maxResults: searchLimits.maxResults,
      excludeIds,
      traceSink: emitTrace,
    });
    console.log("[timing] searchStays:", Date.now() - _t0, "ms");

    const counts = {
      homes: inventory?.homes?.length || 0,
      hotels: inventory?.hotels?.length || 0,
    };
    emitEvent("results_final", { counts, total: counts.homes + counts.hotels });
    emitTrace("RESULTS_FOUND", { ...counts, total: counts.homes + counts.hotels });

    if (counts.homes + counts.hotels > 0) {
      try {
        const _t1 = Date.now();
        carousels = await buildInventoryCarousels({
          inventory,
          plan,
          state: existingState,
          message: latestUserMessage,
          maxCarousels: 5,
          maxItems: 8,
        });
        console.log("[timing] buildInventoryCarousels:", Date.now() - _t1, "ms");
      } catch (err) {
        console.warn("[ai] buildInventoryCarousels failed", err?.message || err);
      }
    }

    nextAction = TOOL_TO_NEXT_ACTION.search_stays;
    resolvedIntent = TOOL_TO_INTENT.search_stays;

  } else if (toolCall?.name === "answer_from_results") {
    // ---- B. ANSWER FROM RESULTS — Call 2 streaming with summary as context ----
    nextAction = TOOL_TO_NEXT_ACTION.answer_from_results;
    resolvedIntent = TOOL_TO_INTENT.answer_from_results;
    plan = { intent: resolvedIntent, language };

    if (!existingState?.lastShownInventorySummary) {
      // No results in state — deterministic fallback, no LLM needed
      const fallbackText = language === "es"
        ? "No tengo resultados previos para responder eso. ¿Querés que busque hoteles en algún destino?"
        : "I don't have previous results to answer that. Would you like me to search for hotels somewhere?";
      preparedReply = { text: fallbackText, sections: [] };
      onTextChunk?.(fallbackText);
    } else {
      // Build summary context to inject into the system prompt
      const summaryContext = buildLastShownResultsContextText(
        existingState.lastShownInventorySummary,
        latestUserMessage
      );
      const webSearchDecision = decideCall2WebSearch({
        toolName: "answer_from_results",
        latestUserMessage,
        toolArgs: toolCall.args,
        state: existingState,
        userContext,
      });
      const call2System = buildCall2SystemPrompt({
        toolName: "answer_from_results",
        toolArgs: toolCall.args,
        userContext,
        language,
        summaryContext,
        useWebSearch: webSearchDecision.enabled,
        allowCompetitorMentions: webSearchDecision.allowCompetitorMentions,
      });
      const fallbackCall2System = buildCall2SystemPrompt({
        toolName: "answer_from_results",
        toolArgs: toolCall.args,
        userContext,
        language,
        summaryContext,
        useWebSearch: false,
        allowCompetitorMentions: webSearchDecision.allowCompetitorMentions,
      });

      const call2Messages = [
        { role: "system", content: call2System },
        ...normalizedMessages,
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: toolCall.id || "call_0",
            type: "function",
            function: { name: "answer_from_results", arguments: JSON.stringify(toolCall.args) },
          }],
        },
        {
          role: "tool",
          tool_call_id: toolCall.id || "call_0",
          content: summaryContext || "No hotel data available in context. Inform the user you need them to run a new search.",
        },
      ];
      const fallbackCall2Messages = [
        { ...call2Messages[0], content: fallbackCall2System },
        ...call2Messages.slice(1),
      ];

      let accumulated = "";
      try {
        const call2Result = await executeCall2WithPolicy({
          client,
          messages: call2Messages,
          fallbackMessages: fallbackCall2Messages,
          onTextChunk,
          emitEvent,
          emitTrace,
          webSearchDecision,
          toolName: "answer_from_results",
          toolArgs: toolCall.args,
        });
        accumulated = call2Result.text;
        webSources = call2Result.webSources;
        allowCompetitorWebSources = Boolean(call2Result.allowCompetitorWebSources);
      } catch (err) {
        console.warn("[ai] answer_from_results Call 2 failed", err?.message || err);
        accumulated = language === "es"
          ? "No pude revisar esos resultados ahora. Probá de nuevo."
          : "I couldn't check those results right now. Try again.";
        onTextChunk?.(accumulated);
      }
      if (!String(accumulated || "").trim()) {
        accumulated = language === "es"
          ? "No encontré suficiente contexto para responder eso con claridad."
          : "I couldn't find enough context to answer that clearly.";
        onTextChunk?.(accumulated);
      }

      preparedReply = { text: accumulated, sections: [] };
    }

  } else if (
    toolCall?.name === "plan_trip" ||
    toolCall?.name === "get_destination_info" ||
    toolCall?.name === "get_stay_details"
  ) {
    // ---- C. PLANNING / LOCATION / DETAILS ----
    nextAction = TOOL_TO_NEXT_ACTION[toolCall.name];
    resolvedIntent = TOOL_TO_INTENT[toolCall.name];
    plan = {
      intent: resolvedIntent,
      language,
      location: { city: toolCall.args.destination || null },
    };

    if (toolCall.name === "get_stay_details") {
      try {
        const details = await getStayDetails({ stayId: toolCall.args.stayId, type: toolCall.args.type });
        if (details?.details) {
          stayDetailsFromDb = buildStayDetailsContextForPrompt(details);
        }
      } catch (err) {
        console.warn("[ai] getStayDetails failed", err?.message || err);
      }
    }

    // Call 2 — streaming text generation
    const webSearchDecision = decideCall2WebSearch({
      toolName: toolCall.name,
      latestUserMessage,
      toolArgs: toolCall.args,
      state: existingState,
      userContext,
    });
    const call2System = buildCall2SystemPrompt({
      toolName: toolCall.name,
      toolArgs: toolCall.args,
      userContext,
      language,
      useWebSearch: webSearchDecision.enabled,
      allowCompetitorMentions: webSearchDecision.allowCompetitorMentions,
    });
    const fallbackCall2System = buildCall2SystemPrompt({
      toolName: toolCall.name,
      toolArgs: toolCall.args,
      userContext,
      language,
      useWebSearch: false,
      allowCompetitorMentions: webSearchDecision.allowCompetitorMentions,
    });
    const toolResultContent = stayDetailsFromDb
      ? `Tool result: ${JSON.stringify(toolCall.args)}\n${stayDetailsFromDb}`
      : `Tool result: ${JSON.stringify(toolCall.args)}`;

    const call2Messages = [
      { role: "system", content: call2System },
      ...normalizedMessages,
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: toolCall.id || "call_0",
          type: "function",
          function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) },
        }],
      },
      {
        role: "tool",
        tool_call_id: toolCall.id || "call_0",
        content: toolResultContent,
      },
    ];
    const fallbackCall2Messages = [
      { ...call2Messages[0], content: fallbackCall2System },
      ...call2Messages.slice(1),
    ];

    let accumulated = "";
    try {
      const call2Result = await executeCall2WithPolicy({
        client,
        messages: call2Messages,
        fallbackMessages: fallbackCall2Messages,
        onTextChunk,
        emitEvent,
        emitTrace,
        webSearchDecision,
        toolName: toolCall.name,
        toolArgs: toolCall.args,
      });
      accumulated = call2Result.text;
      webSources = call2Result.webSources;
      allowCompetitorWebSources = Boolean(call2Result.allowCompetitorWebSources);
    } catch (err) {
      console.warn("[ai] Call 2 stream failed", err?.message || err);
      accumulated = language === "es"
        ? "No pude generar esa respuesta ahora. Intentá de nuevo."
        : "I couldn't generate that response right now. Try again.";
      onTextChunk?.(accumulated);
    }
    if (!String(accumulated || "").trim()) {
      accumulated = language === "es"
        ? "No pude completar esa respuesta en este momento."
        : "I couldn't complete that response right now.";
      onTextChunk?.(accumulated);
    }

    preparedReply = { text: accumulated, sections: [] };

  } else {
    // ---- D. SMALL_TALK — Call 2 with optional web search ----
    nextAction = "SMALL_TALK";
    resolvedIntent = "SMALL_TALK";
    plan = { intent: "SMALL_TALK", language };
    const webSearchDecision = decideCall2WebSearch({
      toolName: "small_talk",
      latestUserMessage,
      toolArgs: null,
      state: existingState,
      userContext,
    });

    const call2System = buildCall2SystemPrompt({
      toolName: null,
      toolArgs: null,
      userContext,
      language,
      useWebSearch: webSearchDecision.enabled,
      allowCompetitorMentions: webSearchDecision.allowCompetitorMentions,
    });
    const fallbackCall2System = buildCall2SystemPrompt({
      toolName: null,
      toolArgs: null,
      userContext,
      language,
      useWebSearch: false,
      allowCompetitorMentions: webSearchDecision.allowCompetitorMentions,
    });
    const call2Messages = [
      { role: "system", content: call2System },
      ...normalizedMessages,
    ];
    const fallbackCall2Messages = [
      { role: "system", content: fallbackCall2System },
      ...normalizedMessages,
    ];

    try {
      const call2Result = await executeCall2WithPolicy({
        client,
        messages: call2Messages,
        fallbackMessages: fallbackCall2Messages,
        onTextChunk,
        emitEvent,
        emitTrace,
        webSearchDecision,
        toolName: "small_talk",
        toolArgs: null,
      });
      directText = call2Result.text;
      webSources = call2Result.webSources;
      allowCompetitorWebSources = Boolean(call2Result.allowCompetitorWebSources);
    } catch (err) {
      console.warn("[ai] small_talk Call 2 failed", err?.message || err);
    }

    if (!String(directText || "").trim()) {
      const fallbacks = language === "es"
        ? ["Listo. Contame qué necesitás.", "Dale, ¿en qué te ayudo?", "Acá estoy. ¿En qué andás?"]
        : ["Sure, what can I help you with?", "Got it. What do you need?", "Here when you need me."];
      directText = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      onTextChunk?.(directText);
    }

    preparedReply = { text: directText, sections: [] };
  }

  // 9. Apply plan to state
  if (!plan) plan = { intent: resolvedIntent, language };

  const { state: nextState } = applyPlanToState(existingState, plan);
  if (incomingTripContext) {
    nextState.tripContext = mergeTripContext(nextState.tripContext, incomingTripContext);
  }

  // Nationality/residence from context
  const contextPassengerNationality = userContext?.passengerNationality ?? userContext?.nationality ?? null;
  const contextPassengerResidence = userContext?.passengerCountryOfResidence ?? userContext?.residence ?? null;
  if (contextPassengerNationality && !plan.passengerNationality) {
    plan.passengerNationality = contextPassengerNationality;
  }
  if (contextPassengerResidence && !plan.passengerCountryOfResidence) {
    plan.passengerCountryOfResidence = contextPassengerResidence;
  }

  const updatedState = updateStageFromAction(nextState, nextAction);

  // Update inventory summary for search
  if (nextAction === "RUN_SEARCH") {
    const previousShownIds = existingState?.lastResultsContext?.shownIds || [];
    const newShownIds = [
      ...(inventory.homes || []).map((item) => String(item.id)),
      ...(inventory.hotels || []).map((item) => String(item.id)),
    ].filter(Boolean);
    const combinedIds = Array.from(new Set([...previousShownIds, ...newShownIds]));
    updatedState.lastResultsContext = {
      lastSearchId: `search-${Date.now()}`,
      shownIds: combinedIds,
    };
    const lastShownSummary = buildLastShownInventorySummary(inventory, updatedState.lastResultsContext.lastSearchId);
    if (lastShownSummary) updatedState.lastShownInventorySummary = lastShownSummary;
    const lastSearchParams = buildLastSearchParams(plan);
    if (lastSearchParams) updatedState.lastSearchParams = lastSearchParams;
  }

  console.log("[timing] total turn:", Date.now() - startedAt, "ms");
  console.log("[ai] functionCalling.tool", {
    tool: toolCall?.name || "none",
    nextAction,
    destination: plan?.location?.city || null,
  });

  // Trip handling (post-booking assist — separate from planning/location)
  let trip = null;
  const isPlanningOrLocation = resolvedIntent === INTENTS.PLANNING || resolvedIntent === INTENTS.LOCATION;
  const tripRequest = extractTripRequest({ text: latestUserMessage, uiEvent, tripContext: nextState.tripContext });
  if (tripRequest && !isPlanningOrLocation) {
    const tripStart = Date.now();
    const location = await resolveTripLocation(nextState.tripContext, nextState, plan, userContext);
    if (location) {
      const suggestions = await buildTripSuggestions({ request: tripRequest, location });
      const itinerary = buildItinerary({ request: tripRequest, tripContext: nextState.tripContext, suggestions });
      let insights = [], preparation = [];
      const isHubInit = (uiEvent?.id || uiEvent?.event || uiEvent) === "TRIP_HUB_INIT";
      if (isHubInit) {
        const addons = await generateTripAddons({ tripContext: nextState.tripContext, location, lang: plan?.language || "en" });
        insights = addons.insights;
        preparation = addons.preparation;
      }
      trip = { request: tripRequest, location, suggestions, itinerary, insights, preparation };
      resolvedIntent = INTENTS.TRIP;
      nextAction = NEXT_ACTIONS.RUN_TRIP;
      if (plan) plan.intent = INTENTS.TRIP;
    }
    debugTripHub("tripMs", Date.now() - tripStart);
  }

  // Weather
  const wantsWeather = /(clima|tiempo|weather|temperatura|pronostico)/i.test(latestUserMessage);
  const resolvedLocation = wantsWeather
    ? await resolveWeatherLocation({ text: latestUserMessage, tripContext: nextState.tripContext, state: nextState, plan, userContext })
    : null;
  const weather = resolvedLocation
    ? await getWeatherSummary({ location: resolvedLocation, timeZone: userContext?.timeZone })
    : null;

  // Visual context
  let visualContext = null;
  const destinationName = plan?.location?.city || nextState?.destination?.name;
  const hasNoResults = !inventory.homes?.length && !inventory.hotels?.length;
  const wantsDestinationPhotos =
    nextAction === "RUN_LOCATION" || nextAction === "RUN_PLANNING" || hasNoResults;
  if (destinationName && wantsDestinationPhotos && !trip) {
    try {
      const images = await searchDestinationImages(destinationName, 3);
      if (images.length) visualContext = { type: "destination_gallery", title: destinationName, images };
    } catch (err) {
      console.warn("[ai] visual context failed", err);
    }
  }

  const tripSearchContext = buildTripSearchContextText(updatedState, plan);
  const lastShownResultsContext =
    buildLastShownResultsContextText(existingState?.lastShownInventorySummary, latestUserMessage) ?? null;
  const inventoryForReply =
    nextAction !== NEXT_ACTIONS.RUN_SEARCH && existingState?.lastShownInventorySummary
      ? existingState.lastShownInventorySummary
      : undefined;

  // 10. Render (streaming already done above; pass onTextChunk: null)
  // 10. Render (streaming already done above; pass onTextChunk: null)
  const rendered = await renderAssistantPayload({
    plan,
    messages: normalizedMessages,
    inventory,
    nextAction,
    trip,
    tripContext: nextState.tripContext,
    userContext,
    weather,
    missing: [],
    visualContext,
    tripSearchContext,
    lastShownResultsContext,
    inventoryForReply,
    stayDetailsFromDb,
    preparedReply,
    // Pass real onTextChunk for RUN_SEARCH so the renderer emits the intro via SSE.
    // For all other actions, streaming was already done above (Call 1 or Call 2).
    onTextChunk: nextAction === NEXT_ACTIONS.RUN_SEARCH ? onTextChunk : null,
  });

  circuitBreaker.onSuccess();

  logAiEvent("turn", {
    sessionId,
    userId,
    intent: resolvedIntent,
    nextAction,
    missing: [],
    homes: inventory.homes?.length || 0,
    hotels: inventory.hotels?.length || 0,
    trip: trip ? trip.suggestions?.length || 0 : 0,
    planSource: "function_calling",
  });

  // 11. Return
  return {
    reply: rendered.assistant?.text || "",
    assistant: rendered.assistant || { text: "", tone: "neutral", disclaimers: [] },
    followUps: rendered.followUps || [],
    ui: rendered.ui || { chips: [], cards: [], inputs: [], sections: [] },
    plan,
    inventory,
    carousels: Array.isArray(carousels) ? carousels : [],
    trip,
    weather,
    webSources,
    allowCompetitorWebSources,
    state: updatedState,
    intent: resolvedIntent,
    nextAction,
    safeMode: Boolean(existingState?.locks?.bookingFlowLocked),
  };
};

export const runAiTurn = async (params) => runFunctionCallingTurn(params);

