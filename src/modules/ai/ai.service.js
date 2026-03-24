import OpenAI from "openai";
import { Op } from "sequelize";
import models from "../../models/index.js";
import { generateTripAddons } from "../../services/aiAssistant.service.js";
import { createHash } from "node:crypto";
import cache from "../../services/cache.js";
import { AI_FLAGS, AI_LIMITS } from "./ai.config.js";
import { buildInventoryCarousels } from "./ai.carousels.js";
import {
  applyPlanToState,
  INTENTS,
  NEXT_ACTIONS,
  updateStageFromAction,
} from "./ai.planner.js";
import {
  renderAssistantPayload,
  getTopInventoryPicksByCategory,
  buildDeterministicSemanticExplanationPlan,
} from "./ai.renderer.js";
import {
  AI_TOOLS,
  buildPlanFromToolArgs,
  TOOL_TO_NEXT_ACTION,
  TOOL_TO_INTENT,
} from "./ai.tools.js";
import {
  buildSystemPrompt,
  buildCall2SystemPrompt,
} from "./ai.systemPrompt.js";
import {
  buildSemanticIntentProfile,
  resolveSemanticCatalogContext,
} from "./ai.semanticCatalog.js";
import {
  buildSearchContextKey,
  shouldResetSearchContextForNewDestination,
  resetDestinationScopedSearchState,
} from "./ai.searchContext.js";
import {
  loadAssistantState,
  saveAssistantState,
  getDefaultState,
} from "./ai.stateStore.js";
import {
  assessWebSearchResult,
  decideCall2WebSearch,
} from "./ai.webSearchPolicy.js";
import {
  geocodePlace,
  getNearbyPlaces,
  resolvePlaceReference,
  getWeatherSummary,
  searchStays,
  searchDestinationImages,
  getStayDetails,
} from "./tools/index.js";
import { logAiEvent, logAiFileDebug, circuitBreaker } from "./ai.telemetry.js";

const _fcApiKey = process.env.OPENAI_API_KEY;
let _fcClient = null;
const ensureFCClient = () => {
  if (!_fcApiKey) return null;
  if (!_fcClient) _fcClient = new OpenAI({ apiKey: _fcApiKey });
  return _fcClient;
};

const AI_MODEL_CALL1 = process.env.AI_MODEL_CALL1 || "gpt-5.4";
const AI_MODEL_SEMANTIC_ENRICHMENT =
  process.env.AI_MODEL_SEMANTIC_ENRICHMENT || AI_MODEL_CALL1;
const AI_MODEL_CALL2_DEFAULT =
  process.env.AI_MODEL_CALL2_DEFAULT || "gpt-5-mini";
const AI_MODEL_CALL2_PREMIUM =
  process.env.AI_MODEL_CALL2_PREMIUM || AI_MODEL_CALL1;
const AI_MODEL_SEMANTIC_EXPLANATION =
  process.env.AI_MODEL_SEMANTIC_EXPLANATION || AI_MODEL_CALL2_PREMIUM;
const AI_MODEL_ASSISTANT_KICKOFF =
  process.env.AI_MODEL_ASSISTANT_KICKOFF ||
  process.env.AI_MODEL_SEMANTIC_ORIENTATION ||
  AI_MODEL_CALL2_DEFAULT;
const CALL2_WEB_SEARCH_MODEL =
  process.env.AI_MODEL_CALL2_WEB_SEARCH || "gpt-4o-search-preview";
const AI_SEMANTIC_EXPLANATION_TIMEOUT_MS = Math.max(
  300,
  Number(process.env.AI_SEMANTIC_EXPLANATION_TIMEOUT_MS || 1500),
);
const AI_ASSISTANT_KICKOFF_STREAM_TIMEOUT_MS = Math.max(
  800,
  Number(
    process.env.AI_ASSISTANT_KICKOFF_STREAM_TIMEOUT_MS ||
      process.env.AI_ASSISTANT_KICKOFF_TIMEOUT_MS ||
      process.env.AI_SEMANTIC_ORIENTATION_TIMEOUT_MS ||
      3500,
  ),
);
const AI_ASSISTANT_KICKOFF_FIRST_TOKEN_TIMEOUT_MS = Math.max(
  250,
  Number(
    process.env.AI_ASSISTANT_KICKOFF_FIRST_TOKEN_TIMEOUT_MS ||
      process.env.AI_ASSISTANT_KICKOFF_PRIORITY_WINDOW_MS ||
      900,
  ),
);
const AI_ASSISTANT_KICKOFF_TARGET_WORDS = Math.max(
  30,
  Number(process.env.AI_ASSISTANT_KICKOFF_TARGET_WORDS || 55),
);
const AI_ASSISTANT_KICKOFF_MIN_VISIBLE_CHARS = Math.max(
  40,
  Number(process.env.AI_ASSISTANT_KICKOFF_MIN_VISIBLE_CHARS || 80),
);
const AI_ASSISTANT_KICKOFF_MIN_VISIBLE_WORDS = Math.max(
  8,
  Number(process.env.AI_ASSISTANT_KICKOFF_MIN_VISIBLE_WORDS || 14),
);

const AI_MODEL_ASSISTANT_CLOSING =
  process.env.AI_ASSISTANT_CLOSING_MODEL ||
  process.env.AI_MODEL_ASSISTANT_KICKOFF ||
  AI_MODEL_CALL2_DEFAULT;

const AI_ASSISTANT_CLOSING_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.AI_ASSISTANT_CLOSING_TIMEOUT_MS || 4000),
);

const AI_ASSISTANT_CLOSING_MIN_VISIBLE_CHARS = Math.max(
  40,
  Number(process.env.AI_ASSISTANT_CLOSING_MIN_VISIBLE_CHARS || 60),
);

const AI_ASSISTANT_CLOSING_MIN_VISIBLE_WORDS = Math.max(
  8,
  Number(process.env.AI_ASSISTANT_CLOSING_MIN_VISIBLE_WORDS || 12),
);

const CALL2_PREMIUM_PATTERNS = [
  /\b(compare|comparison|versus|vs\.?|differences?|which is better|best one|why this|why those)\b/i,
  /\b(compar[a-záéíóú]*|diferenc[a-záéíóú]*|cu[aá]l es mejor|por qu[eé]|por que|recomend[a-záéíóú]*|explic[a-záéíóú]*)\b/i,
  /\b(view|river|waterfront|water view|sea view|good area|safe area|nice area|best area|quiet area|family-friendly|luxury|premium)\b/i,
  /\b(vista|r[ií]o|rio|agua|mar|buena zona|zona segura|zona tranquila|familiar|lujo|premium)\b/i,
];

const shouldUsePremiumCall2Model = ({
  toolName = null,
  latestUserMessage = "",
  toolArgs = null,
  useWebSearch = false,
} = {}) => {
  if (useWebSearch) return false;
  if (
    toolName === "plan_trip" ||
    toolName === "get_destination_info" ||
    toolName === "get_stay_details"
  ) {
    return true;
  }
  if (toolName !== "answer_from_results") return false;

  const haystack = [
    latestUserMessage,
    typeof toolArgs?.question === "string" ? toolArgs.question : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (!haystack.trim()) return false;
  return CALL2_PREMIUM_PATTERNS.some((pattern) => pattern.test(haystack));
};

const selectCall2Model = ({
  toolName = null,
  latestUserMessage = "",
  toolArgs = null,
  useWebSearch = false,
} = {}) =>
  shouldUsePremiumCall2Model({
    toolName,
    latestUserMessage,
    toolArgs,
    useWebSearch,
  })
    ? AI_MODEL_CALL2_PREMIUM
    : AI_MODEL_CALL2_DEFAULT;

const normalizeWebSource = (annotation) => {
  if (annotation?.type !== "url_citation") return null;
  const title =
    typeof annotation?.url_citation?.title === "string"
      ? annotation.url_citation.title.trim()
      : "";
  const url =
    typeof annotation?.url_citation?.url === "string"
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
  modelOverride = null,
  onWebSearchStart = null,
  webSearchContext = null,
  streamText = true,
} = {}) => {
  if (useWebSearch) {
    onWebSearchStart?.(webSearchContext || {});
  }
  const request = {
    model:
      modelOverride ||
      (useWebSearch ? CALL2_WEB_SEARCH_MODEL : AI_MODEL_CALL2_DEFAULT),
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
  latestUserMessage = "",
} = {}) => {
  const rawDecision =
    webSearchDecision || decideCall2WebSearch({ toolName, toolArgs });
  const decision = {
    enabled: Boolean(rawDecision?.enabled),
    toolName: rawDecision?.toolName || toolName || null,
    reason: rawDecision?.reason || null,
    trigger: rawDecision?.trigger || null,
    destination: rawDecision?.destination || null,
    allowCompetitorMentions: Boolean(rawDecision?.allowCompetitorMentions),
  };
  const selectedNonWebModel = selectCall2Model({
    toolName: decision.toolName,
    latestUserMessage,
    toolArgs,
    useWebSearch: false,
  });
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

  const runCall2 = ({
    useWebSearch,
    streamText = true,
    messagesOverride = null,
  } = {}) =>
    streamCall2Completion({
      client,
      messages: messagesOverride || messages,
      onTextChunk,
      useWebSearch,
      modelOverride: useWebSearch ? CALL2_WEB_SEARCH_MODEL : selectedNonWebModel,
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

  emitTrace?.("CALL2_MODEL_SELECTED", {
    toolName: decision.toolName,
    model: decision.enabled ? CALL2_WEB_SEARCH_MODEL : selectedNonWebModel,
    fallbackModel: decision.enabled ? selectedNonWebModel : undefined,
    premium: selectedNonWebModel === AI_MODEL_CALL2_PREMIUM,
    webSearchEnabled: Boolean(decision.enabled),
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
  const userLang =
    userContext?.user?.language || userContext?.locale?.split("-")[0];
  if (userLang === "en" || userLang === "english") return "en";
  if (userLang === "es" || userLang === "spanish") return "es";
  if (userLang === "pt" || userLang === "portuguese") return "pt";

  // Priority 2: detect from latest user message
  const latest =
    Array.isArray(messages) &&
    [...messages].reverse().find((m) => m?.role === "user" && m?.content)
      ?.content;
  const raw = String(latest || "").trim();
  if (/\p{Script=Arabic}/u.test(raw)) return "ar";
  if (
    /[áéíóúñü¿¡]/.test(raw) ||
    /\b(hola|gracias|buscar|hotel|quiero|pileta|mostrame|cuantos|fechas|necesito|alojamiento)\b/i.test(
      raw,
    )
  )
    return "es";
  if (
    /\b(hello|hi|please|thanks|looking|hotel|need|want|book|travel)\b/i.test(
      raw,
    )
  )
    return "en";
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
  searchScope: { homes: null, hotels: null },
  foundExact: false,
});

const MAX_LAST_SHOWN_ITEMS = 30; // Full inventory: picks (shown as cards) + rest (shown in See All modal)

// ---- Raw inventory cache (Option B) ----------------------------------------
// Stores the chat-visible hotel list per session so follow-up questions stay scoped to shown results.
const rawInventoryCache = new Map(); // sessionId → { hotels: NormalizedHotel[], cachedAt: number }
const RAW_INVENTORY_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const pruneRawInventoryCache = () => {
  const now = Date.now();
  for (const [key, val] of rawInventoryCache) {
    if (now - val.cachedAt > RAW_INVENTORY_TTL_MS)
      rawInventoryCache.delete(key);
  }
};

/** Build a feature label from the matched AMENITY_MATCH_PATTERNS entry for deterministic response text. */
const getFeatureLabel = (regex, lang = "es") => {
  if (!regex) return lang === "es" ? "esa característica" : "that feature";
  const src = regex.source.toLowerCase();
  if (/pool|piscina|pileta|swimming/.test(src))
    return lang === "es" ? "piscina" : "a pool";
  if (/gym|gimnasio|fitness/.test(src))
    return lang === "es" ? "gimnasio" : "a gym";
  if (/wifi|wi-fi|wireless/.test(src)) return lang === "es" ? "WiFi" : "WiFi";
  if (/spa|wellness/.test(src)) return lang === "es" ? "spa" : "a spa";
  if (/parking|estacionamiento|garage/.test(src))
    return lang === "es" ? "estacionamiento" : "parking";
  if (/breakfast|desayuno/.test(src))
    return lang === "es" ? "desayuno incluido" : "breakfast included";
  if (/restaurant|restaurante/.test(src))
    return lang === "es" ? "restaurante" : "a restaurant";
  if (/beach|playa/.test(src)) return lang === "es" ? "playa" : "beach access";
  if (/air conditioning|aire/.test(src))
    return lang === "es" ? "aire acondicionado" : "air conditioning";
  if (/shuttle|traslado|transfer/.test(src))
    return lang === "es" ? "traslado al aeropuerto" : "airport shuttle";
  if (/pet|mascota/.test(src))
    return lang === "es" ? "política pet-friendly" : "a pet-friendly policy";
  return lang === "es" ? "esa característica" : "that feature";
};
// ---------------------------------------------------------------------------

/**
 * Query WebbedsHotelAmenity table via catalog_code (same approach as filterHotelsByAmenities).
 * Step 1: find catalog codes whose name matches the feature terms.
 * Step 2: find which hotels have any of those codes.
 * Falls back to item_name search if no catalog entries found.
 * Returns a Set of matching hotel_id strings, or null on failure (use local fallback).
 */
const queryHotelAmenityFromDb = async (hotelIds, featureRegex) => {
  try {
    if (!models?.WebbedsHotelAmenity || !hotelIds.length || !featureRegex)
      return null;
    const terms = featureRegex.source
      .split("|")
      .map((t) =>
        t
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "")
          .replace(/\\b/g, ""),
      )
      .filter((t) => t.length >= 3);
    if (!terms.length) return null;

    const termConditions = terms.map((t) => ({
      name: { [Op.iLike]: `%${t}%` },
    }));

    // Step 1: catalog codes whose name matches the feature (e.g. "Swimming Pool", "Pool Bar")
    let catalogCodes = [];
    if (models.WebbedsAmenityCatalog) {
      const catalogRows = await models.WebbedsAmenityCatalog.findAll({
        where: { [Op.or]: termConditions },
        attributes: ["code"],
        raw: true,
      });
      catalogCodes = catalogRows.map((r) => r.code).filter((c) => c != null);
    }

    let amenityWhere = { hotel_id: { [Op.in]: hotelIds } };
    if (catalogCodes.length) {
      // Primary: match by catalog_code (authoritative)
      amenityWhere.catalog_code = { [Op.in]: catalogCodes };
    } else {
      // Fallback: match by item_name (less reliable but better than nothing)
      amenityWhere[Op.or] = terms.map((t) => ({
        item_name: { [Op.iLike]: `%${t}%` },
      }));
    }

    const rows = await models.WebbedsHotelAmenity.findAll({
      where: amenityWhere,
      attributes: ["hotel_id"],
      raw: true,
    });

    const matchedIds = new Set(rows.map((r) => String(r.hotel_id)));
    console.log(
      `[ai] queryHotelAmenityFromDb: terms=[${terms.join(",")}] catalogCodes=${catalogCodes.length} hotels=${hotelIds.length} matched=${matchedIds.size}`,
    );
    return matchedIds;
  } catch (err) {
    console.warn("[ai] queryHotelAmenityFromDb failed:", err?.message);
    return null;
  }
};

const SEMANTIC_SEARCH_TIMEOUT_MS = Math.max(
  1500,
  Number(process.env.AI_SEMANTIC_SEARCH_TIMEOUT_MS || 8000),
);
const SEMANTIC_SEARCH_MODEL = AI_MODEL_SEMANTIC_ENRICHMENT;

const SEMANTIC_VIEW_INTENTS = new Set([
  "RIVER_VIEW",
  "WATER_VIEW",
  "SEA_VIEW",
  "CITY_VIEW",
  "LANDMARK_VIEW",
]);
const SEMANTIC_AREA_INTENTS = new Set([
  "GOOD_AREA",
  "CITY_CENTER",
  "QUIET",
  "NIGHTLIFE",
  "BEACH_COAST",
]);
const SEMANTIC_QUALITY_INTENTS = new Set(["BUDGET", "VALUE", "LUXURY"]);
const SEMANTIC_GEO_INTENTS = new Set([
  "IN_AREA",
  "NEAR_AREA",
  "NEAR_LANDMARK",
  "WATERFRONT",
  "VIEW_TO",
]);
const SEMANTIC_AREA_TRAITS = new Set([
  "GOOD_AREA",
  "SAFE",
  "QUIET",
  "NIGHTLIFE",
  "WALKABLE",
  "FAMILY",
  "LUXURY",
]);
const SEMANTIC_PLACE_TARGET_TYPES = new Set([
  "NEIGHBORHOOD",
  "DISTRICT",
  "LANDMARK",
  "AIRPORT",
  "STATION",
  "PORT",
  "VENUE",
  "GENERIC",
  "AREA",
  "WATERFRONT",
]);
const SEMANTIC_GROUNDING_MODES = new Set([
  "EXPLICIT_GEO",
  "VIEW_PROFILE",
  "AREA_PROFILE",
  "LIFESTYLE_PROXIMITY",
  "HYBRID",
]);
const SEMANTIC_GROUNDING_STRATEGIES = new Set([
  "PLACES",
  "PLACES_THEN_WEB",
  "WEB_SEARCH",
  "POI_SEARCH",
  "RANK_ONLY",
]);
const SEMANTIC_LIFESTYLE_CATEGORIES = new Set([
  "RESTAURANT",
  "BAR",
  "CAFE",
  "NIGHTLIFE",
  "FOOD",
  "SHOPPING",
  "ATTRACTION",
]);
const SEMANTIC_LIFESTYLE_PROXIMITY_MODES = new Set([
  "NEARBY",
  "CLUSTER",
  "DENSE_AREA",
]);
const SEMANTIC_CONFIDENCE_LEVELS = new Set(["LOW", "MEDIUM", "HIGH"]);
const SEMANTIC_WEB_RESOLVER_TIMEOUT_MS = Math.max(
  1500,
  Number(process.env.AI_SEMANTIC_WEB_RESOLVER_TIMEOUT_MS || 6500),
);
const SEMANTIC_WEB_RESOLVER_CACHE_TTL_SECONDS = Math.max(
  300,
  Number(process.env.AI_SEMANTIC_WEB_RESOLVER_CACHE_TTL_SECONDS || 86400 * 30),
);
const SEMANTIC_WEB_SOURCE_POLICY = "geo_official_first";

const withSemanticTimeout = (promise, ms, label) => {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.code = "OPENAI_TIMEOUT";
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

const stripSemanticDiacritics = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

const normalizeSemanticText = (value) =>
  stripSemanticDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hashSemanticCachePayload = (value) =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex");

const escapeSemanticRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeSemanticNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const uniqueSemanticStringList = (values = [], max = 8) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, max);

const normalizeSemanticStarRatings = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 1 && value <= 5)
        .map((value) => Math.round(value)),
    ),
  ).sort((a, b) => a - b);

const normalizeSemanticEnum = (value, allowedSet) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return allowedSet.has(normalized) ? normalized : null;
};

const normalizeSemanticAreaTraits = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeSemanticEnum(value, SEMANTIC_AREA_TRAITS))
        .filter(Boolean),
    ),
  );

const defaultRadiusMetersForPlaceTarget = ({
  type = null,
  geoIntent = null,
} = {}) => {
  if (type === "AIRPORT") {
    return geoIntent === "IN_AREA" ? 3500 : 6000;
  }
  if (type === "STATION" || type === "PORT" || type === "VENUE") {
    return geoIntent === "IN_AREA" ? 1600 : 2600;
  }
  if (type === "LANDMARK") {
    return geoIntent === "IN_AREA" ? 1200 : 2200;
  }
  if (type === "WATERFRONT") {
    return 3500;
  }
  if (type === "NEIGHBORHOOD" || type === "DISTRICT") {
    return geoIntent === "IN_AREA" ? 2500 : 3200;
  }
  return geoIntent === "IN_AREA" ? 2500 : 3000;
};

const inferSemanticPlaceTargetType = (value = "") => {
  const text = normalizeSemanticText(value);
  if (!text) return "AREA";
  if (/\b(riverfront|waterfront|costanera|coast|shore|riverside)\b/.test(text)) {
    return "WATERFRONT";
  }
  if (
    /\b(airport|aeropuerto|aeroparque|ezeiza)\b/.test(text)
  ) {
    return "AIRPORT";
  }
  if (/\b(station|estacion|terminal|retiro)\b/.test(text)) {
    return "STATION";
  }
  if (/\b(port|puerto|marina|harbor)\b/.test(text)) {
    return "PORT";
  }
  if (
    /\b(obelisk|obelisco|cemetery|cementerio|museum|museo|arena|stadium|estadio|tower|torre|plaza|park|parque)\b/.test(
      text,
    )
  ) {
    return "LANDMARK";
  }
  if (/\b(barrio|district|neighborhood|zona)\b/.test(text)) {
    return "DISTRICT";
  }
  return "NEIGHBORHOOD";
};

const SEMANTIC_ABSTRACT_AREA_PATTERN =
  /\b(zona|area|district|neighborhood|barrio|region|regio?n)\b/;
const SEMANTIC_ABSTRACT_TRAIT_PATTERN =
  /\b(quiet|tranquil[oa]?|peaceful|walkable|caminable|safe|segur[oa]?|good|buena|nice|central|centric[oa]?|nightlife|familiar|family|premium|luxury|lujo|business|cultural)\b/;

const looksLikeAbstractAreaPhrase = (value = "", plan = {}) => {
  const normalized = normalizeSemanticText(value);
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const city = normalizeSemanticText(plan?.location?.city || "");
  const country = normalizeSemanticText(plan?.location?.country || "");

  if (
    SEMANTIC_ABSTRACT_AREA_PATTERN.test(normalized) &&
    SEMANTIC_ABSTRACT_TRAIT_PATTERN.test(normalized)
  ) {
    return true;
  }
  if (
    /^(?:a|an|the|un|una|unos|unas)\b/.test(normalized) &&
    SEMANTIC_ABSTRACT_AREA_PATTERN.test(normalized)
  ) {
    return true;
  }
  if (
    wordCount > 4 &&
    SEMANTIC_ABSTRACT_TRAIT_PATTERN.test(normalized) &&
    !/\bsoho|hollywood\b/.test(normalized)
  ) {
    return true;
  }
  if (
    city &&
    normalized.includes(city) &&
    (SEMANTIC_ABSTRACT_AREA_PATTERN.test(normalized) ||
      SEMANTIC_ABSTRACT_TRAIT_PATTERN.test(normalized))
  ) {
    return true;
  }
  if (
    country &&
    normalized.includes(country) &&
    SEMANTIC_ABSTRACT_TRAIT_PATTERN.test(normalized)
  ) {
    return true;
  }
  return false;
};

const cleanDetectedPlaceText = (value = "", plan = {}) => {
  let text = stripSemanticDiacritics(value)
    .replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, "")
    .replace(/\b(?:por la zona de|zona de|area of|area around)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  text = text.replace(/^(?:el|la|los|las|the)\s+/i, "").trim();

  const normalized = normalizeSemanticText(text);
  if (!normalized) return null;

  const city = normalizeSemanticText(plan?.location?.city || "");
  const country = normalizeSemanticText(plan?.location?.country || "");
  if (city && normalized === city) return null;
  if (country && normalized === country) return null;
  if (looksLikeAbstractAreaPhrase(text, plan)) return null;

  return text.length >= 2 ? text : null;
};

const sanitizeSemanticPlaceTarget = (raw = {}, options = {}) => {
  const geoIntent = normalizeSemanticEnum(
    raw?.geoIntent || options.geoIntent,
    SEMANTIC_GEO_INTENTS,
  );
  const rawText =
    typeof raw?.rawText === "string"
      ? raw.rawText.trim()
      : typeof raw === "string"
        ? raw.trim()
        : "";
  if (!rawText) return null;
  const normalizedName =
    typeof raw?.normalizedName === "string" && raw.normalizedName.trim()
      ? raw.normalizedName.trim()
      : rawText;
  const type = normalizeSemanticEnum(
    raw?.type,
    SEMANTIC_PLACE_TARGET_TYPES,
  ) || inferSemanticPlaceTargetType(rawText);
  let lat = normalizeSemanticNumber(raw?.lat);
  let lng = normalizeSemanticNumber(raw?.lng);
  if (lat === 0 && lng === 0) {
    lat = null;
    lng = null;
  }
  const radiusMeters =
    normalizeSemanticNumber(raw?.radiusMeters) ||
    defaultRadiusMetersForPlaceTarget({ type, geoIntent });
  const confidenceRaw = normalizeSemanticNumber(raw?.confidence);
  const confidence =
    confidenceRaw != null
      ? Math.max(0, Math.min(1, confidenceRaw))
      : null;
  return {
    rawText,
    normalizedName,
    type,
    city: typeof raw?.city === "string" ? raw.city.trim() || null : null,
    country:
      typeof raw?.country === "string" ? raw.country.trim() || null : null,
    aliases: uniqueSemanticStringList(raw?.aliases, 12),
    lat,
    lng,
    radiusMeters,
    polygonRef:
      typeof raw?.polygonRef === "string" ? raw.polygonRef.trim() || null : null,
    confidence,
  };
};

const uniqueSemanticPlaceTargets = (targets = [], max = 6) => {
  const seen = new Set();
  const out = [];
  (Array.isArray(targets) ? targets : []).forEach((target) => {
    const sanitized = sanitizeSemanticPlaceTarget(target);
    if (!sanitized) return;
    const dedupeKey = [
      normalizeSemanticText(sanitized.normalizedName || sanitized.rawText),
      sanitized.type || "",
      sanitized.city || "",
      sanitized.country || "",
    ].join("::");
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push(sanitized);
  });
  return out.slice(0, max);
};

const extractDeterministicPlaceTargets = (message = "", plan = {}) => {
  const source = stripSemanticDiacritics(String(message || "")).replace(
    /\s+/g,
    " ",
  );
  if (!source.trim()) return [];

  const extracted = [];
  const patterns = [
    {
      geoIntent: "NEAR_AREA",
      pattern: /\b(?:cerca de(?:l| la)?|near|around|by)\s+([^,.!?;]+)/i,
    },
    {
      geoIntent: "IN_AREA",
      pattern: /\b(?:en|in)\s+([^,.!?;]+)$/i,
    },
  ];

  patterns.forEach(({ geoIntent, pattern }) => {
    const match = source.match(pattern);
    if (!match?.[1]) return;
    const cleaned = cleanDetectedPlaceText(match[1], plan);
    if (!cleaned) return;
    const type = inferSemanticPlaceTargetType(cleaned);
    extracted.push({
      rawText: cleaned,
      normalizedName: cleaned,
      type,
      aliases: [],
      lat: null,
      lng: null,
      radiusMeters: defaultRadiusMetersForPlaceTarget({ type, geoIntent }),
      confidence: 0.65,
      geoIntent:
        geoIntent === "NEAR_AREA" && type === "LANDMARK"
          ? "NEAR_LANDMARK"
          : geoIntent,
    });
  });

  return uniqueSemanticPlaceTargets(extracted);
};

const extractExplicitStarRatings = (message = "") => {
  const text = normalizeSemanticText(message);
  if (!text) return [];
  if (
    /\b([1-5])\s*\+\s*(?:estrellas?|stars?)\b/.test(text) ||
    /\b(?:at least|minimum|minimo|minimo de)\s*([1-5])\s*(?:estrellas?|stars?)\b/.test(
      text,
    )
  ) {
    return [];
  }

  const starMatches = [];
  const pattern =
    /\b([1-5](?:\s*(?:\/|,|y|o|or|and|-)\s*[1-5])*)\s*(?:estrellas?|stars?)\b/g;
  let match = null;
  while ((match = pattern.exec(text)) !== null) {
    if (!match[1]) continue;
    const digits = match[1]
      .match(/[1-5]/g)
      ?.map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (digits?.length) starMatches.push(...digits);
  }
  return normalizeSemanticStarRatings(starMatches);
};

const detectSemanticViewIntent = (message = "") => {
  const text = normalizeSemanticText(message);
  if (!text) return null;
  if (
    /\b(river view|vista al rio|vista rio|rio view|vista al rio de la plata)\b/.test(
      text,
    ) ||
    (/\b(vista|view)\b/.test(text) && /\b(rio|river)\b/.test(text))
  ) {
    return "RIVER_VIEW";
  }
  if (
    /\b(sea view|ocean view|vista al mar|vista al oceano|oceanfront)\b/.test(
      text,
    ) ||
    (/\b(vista|view)\b/.test(text) && /\b(mar|sea|ocean)\b/.test(text))
  ) {
    return "SEA_VIEW";
  }
  if (
    /\b(water view|waterfront|vista al agua|harbor view|marina view|vista al puerto)\b/.test(
      text,
    ) ||
    (/\b(vista|view)\b/.test(text) &&
      /\b(agua|water|harbor|marina|port|puerto)\b/.test(text))
  ) {
    return "WATER_VIEW";
  }
  if (
    /\b(city view|vista a la ciudad|vista urbana|skyline view)\b/.test(text)
  ) {
    return "CITY_VIEW";
  }
  if (
    /\b(landmark view|vista a un monumento|vista a la torre|vista al monumento)\b/.test(
      text,
    )
  ) {
    return "LANDMARK_VIEW";
  }
  return null;
};

const detectSemanticAreaIntent = (message = "") => {
  const text = normalizeSemanticText(message);
  if (!text) return null;
  if (
    /\b(buena zona|buen barrio|good area|nice area|safe area|best area|good neighborhood|nice neighborhood)\b/.test(
      text,
    )
  ) {
    return "GOOD_AREA";
  }
  if (/\b(city center|downtown|centro|zona centrica|area centrica)\b/.test(text)) {
    return "CITY_CENTER";
  }
  if (/\b(quiet|tranquilo|tranquila|peaceful|silencioso|silenciosa)\b/.test(text)) {
    return "QUIET";
  }
  if (/\b(nightlife|vida nocturna|party area)\b/.test(text)) {
    return "NIGHTLIFE";
  }
  if (/\b(beach|playa|coast|costa|waterfront)\b/.test(text)) {
    return "BEACH_COAST";
  }
  return null;
};

const detectSemanticQualityIntent = (message = "") => {
  const text = normalizeSemanticText(message);
  if (!text) return null;
  if (
    /\b(barato|barata|economico|economica|cheap|budget|low cost|affordable)\b/.test(
      text,
    )
  ) {
    return "BUDGET";
  }
  if (
    /\b(relacion precio calidad|price quality|value for money|best value|good value)\b/.test(
      text,
    )
  ) {
    return "VALUE";
  }
  if (
    /\b(luxury|lujo|lujoso|premium|upscale|high end|de lujo)\b/.test(text)
  ) {
    return "LUXURY";
  }
  return null;
};

const detectSemanticGeoIntent = (message = "", placeTargets = []) => {
  const text = normalizeSemanticText(message);
  if (!text) return null;
  if (
    /\b(cerca de|cerca del|cerca de la|near|around|by)\b/.test(text) &&
    Array.isArray(placeTargets) &&
    placeTargets.length
  ) {
    return placeTargets[0]?.type === "LANDMARK"
      ? "NEAR_LANDMARK"
      : "NEAR_AREA";
  }
  if (/\b(waterfront|riverfront|costanera|riverside)\b/.test(text)) {
    return "WATERFRONT";
  }
  if (
    /\b(vista|view)\b/.test(text) &&
    /\b(obelisco|obelisk|tower|torre|monument|monumento|rio|river)\b/.test(text)
  ) {
    return "VIEW_TO";
  }
  if (/\b(en|in)\b/.test(text) && Array.isArray(placeTargets) && placeTargets.length) {
    return "IN_AREA";
  }
  return null;
};

const detectSemanticAreaTraits = (message = "") => {
  const text = normalizeSemanticText(message);
  if (!text) return [];
  const traits = [];
  const traitMatchers = [
    {
      pattern:
        /\b(buena zona|buen barrio|good area|nice area|safe area|best area|good neighborhood|nice neighborhood)\b/,
      value: "GOOD_AREA",
    },
    { pattern: /\b(safe area|zona segura|safe neighborhood)\b/, value: "SAFE" },
    {
      pattern:
        /\b(walkable|walking distance|a pie|caminable|se puede ir caminando)\b/,
      value: "WALKABLE",
    },
    {
      pattern: /\b(quiet|tranquilo|tranquila|peaceful|silencioso|silenciosa)\b/,
      value: "QUIET",
    },
    { pattern: /\b(nightlife|vida nocturna|party area)\b/, value: "NIGHTLIFE" },
    {
      pattern:
        /\b(family friendly|familiar|family hotel|for families|para familias)\b/,
      value: "FAMILY",
    },
    { pattern: /\b(luxury|lujo|lujoso|premium|upscale|high end)\b/, value: "LUXURY" },
  ];
  traitMatchers.forEach(({ pattern, value }) => {
    if (pattern.test(text)) traits.push(value);
  });
  return normalizeSemanticAreaTraits(traits);
};

const extractSemanticPreferenceNotes = (message = "") => {
  const text = normalizeSemanticText(message);
  if (!text) return [];
  const notes = [];
  const noteMatchers = [
    { pattern: /\bromantic|romantico|romantica\b/, value: "romantic" },
    {
      pattern: /\bfamily friendly|familiar|family hotel|for families|para familias\b/,
      value: "family-friendly",
    },
    { pattern: /\bquiet|tranquilo|tranquila|peaceful\b/, value: "quiet" },
    { pattern: /\bpremium|luxury|lujo|upscale\b/, value: "premium" },
    { pattern: /\bnightlife|vida nocturna\b/, value: "nightlife" },
    { pattern: /\bwaterfront|riverfront\b/, value: "waterfront" },
  ];
  noteMatchers.forEach(({ pattern, value }) => {
    if (pattern.test(text)) notes.push(value);
  });
  return uniqueSemanticStringList(notes, 6);
};

const buildDeterministicSemanticHints = (message = "", plan = {}) => {
  const placeTargets = extractDeterministicPlaceTargets(message, plan);
  return {
    starRatings: extractExplicitStarRatings(message),
    viewIntent: detectSemanticViewIntent(message),
    geoIntent: detectSemanticGeoIntent(message, placeTargets),
    placeTargets,
    areaIntent: detectSemanticAreaIntent(message),
    qualityIntent: detectSemanticQualityIntent(message),
    areaTraits: detectSemanticAreaTraits(message),
    preferenceNotes: extractSemanticPreferenceNotes(message),
  };
};

const hasExplicitSemanticGeoRequest = ({
  latestUserMessage = "",
  plan = {},
} = {}) => {
  const deterministic = buildDeterministicSemanticHints(latestUserMessage, plan);
  if (deterministic.placeTargets.length > 0) return true;
  if (
    Array.isArray(plan?.placeTargets) &&
    plan.placeTargets.some(
      (target) =>
        target &&
        typeof target === "object" &&
        (target.rawText || target.normalizedName),
    )
  ) {
    return true;
  }
  return false;
};

const stripExplicitGeoFromSemanticPayload = (payload = {}) => ({
  ...payload,
  geoIntent: null,
  placeTargets: [],
  resolvedPlaces: [],
});

const shouldRunSemanticSearchFallback = (message = "", plan = {}) => {
  const deterministic = buildDeterministicSemanticHints(message, plan);
  if (
    deterministic.viewIntent ||
    deterministic.geoIntent ||
    deterministic.placeTargets.length ||
    deterministic.areaIntent === "GOOD_AREA" ||
    deterministic.areaTraits.length ||
    deterministic.preferenceNotes.length
  ) {
    return true;
  }
  return Boolean(
    plan?.viewIntent ||
      plan?.geoIntent ||
      (Array.isArray(plan?.placeTargets) && plan.placeTargets.length) ||
      plan?.areaIntent === "GOOD_AREA" ||
      (Array.isArray(plan?.areaTraits) && plan.areaTraits.length) ||
      (Array.isArray(plan?.preferenceNotes) && plan.preferenceNotes.length),
  );
};

const buildSemanticEnrichmentMessages = ({
  latestUserMessage,
  plan,
  language,
}) => {
  const currentPlan = {
    destination: {
      city: plan?.location?.city || null,
      country: plan?.location?.country || null,
    },
    sortBy: plan?.sortBy || null,
    minRating: plan?.hotelFilters?.minRating ?? null,
    starRatings: Array.isArray(plan?.starRatings) ? plan.starRatings : [],
    amenityCodes: Array.isArray(plan?.hotelFilters?.amenityCodes)
      ? plan.hotelFilters.amenityCodes
      : [],
    geoIntent: plan?.geoIntent || null,
    placeTargets: Array.isArray(plan?.placeTargets)
      ? plan.placeTargets.map((target) => ({
          rawText: target?.rawText || null,
          normalizedName: target?.normalizedName || null,
          type: target?.type || null,
          radiusMeters: target?.radiusMeters ?? null,
          city: target?.city || null,
          country: target?.country || null,
        }))
      : [],
    nearbyInterest: plan?.preferences?.nearbyInterest || null,
    viewIntent: plan?.viewIntent || null,
    areaIntent: plan?.areaIntent || null,
    qualityIntent: plan?.qualityIntent || null,
    areaTraits: Array.isArray(plan?.areaTraits) ? plan.areaTraits : [],
    preferenceNotes: Array.isArray(plan?.preferenceNotes)
      ? plan.preferenceNotes
      : [],
    language,
  };

  return [
    {
      role: "system",
      content:
        "You enrich hotel search semantics for BookingGPT. " +
        "Do not change destination, dates, guests, or explicit amenities. " +
        "Return JSON only. " +
        "Extract exact star requirements and soft ranking intents, " +
        "and optionally suggest high-confidence hotel names or neighborhood hints for the destination. " +
        "Candidate hotel names are only hints for matching against our database; do not invent uncertain hotels. " +
        "If unsure, return empty arrays.\n\n" +
        "Rules:\n" +
        "- Use starRatings for exact star phrases like '4 estrellas' or '4 o 5 stars'.\n" +
        "- Use viewIntent for soft view preferences: RIVER_VIEW, WATER_VIEW, SEA_VIEW, CITY_VIEW, LANDMARK_VIEW.\n" +
        "- Use geoIntent for area/landmark proximity: IN_AREA, NEAR_AREA, NEAR_LANDMARK, WATERFRONT, VIEW_TO.\n" +
        "- Use placeTargets for explicit neighborhoods, districts, landmarks, or waterfront areas mentioned by the user.\n" +
        "- Use areaIntent for GOOD_AREA, CITY_CENTER, QUIET, NIGHTLIFE, BEACH_COAST.\n" +
        "- Use qualityIntent for BUDGET, VALUE, LUXURY.\n" +
        "- Use areaTraits for SAFE, QUIET, NIGHTLIFE, WALKABLE, FAMILY, LUXURY, and GOOD_AREA when explicitly requested.\n" +
        "- For abstract area requests like 'quiet and walkable', 'tranquilo y caminable', or 'good area', keep the answer trait-first: fill areaIntent/areaTraits and do not invent geoIntent/placeTargets unless the user explicitly named a place.\n" +
        "- candidateHotelNames: at most 8 real hotels commonly associated with the requested soft preference in that destination.\n" +
        "- neighborhoodHints: at most 8 neighborhood or area names tied to the requested soft preference.\n" +
        "- preferenceNotes: concise English notes for other soft preferences.\n" +
        "- Never mention competitors, OTAs, or websites.\n\n" +
        'Respond with a JSON object using this schema: {"starRatings": number[], "viewIntent": string|null, "geoIntent": string|null, "placeTargets": [{"rawText": string, "normalizedName": string|null, "type": string|null, "city": string|null, "country": string|null, "aliases": string[], "lat": number|null, "lng": number|null, "radiusMeters": number|null, "confidence": number|null}], "areaIntent": string|null, "qualityIntent": string|null, "areaTraits": string[], "preferenceNotes": string[], "candidateHotelNames": string[], "neighborhoodHints": string[]}.',
    },
    {
      role: "user",
      content:
        `Latest user message:\n${latestUserMessage || ""}\n\n` +
        `Current structured plan:\n${JSON.stringify(currentPlan, null, 2)}`,
    },
  ];
};

const sanitizeSemanticEnrichment = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  return {
    starRatings: normalizeSemanticStarRatings(raw.starRatings),
    viewIntent: normalizeSemanticEnum(raw.viewIntent, SEMANTIC_VIEW_INTENTS),
    geoIntent: normalizeSemanticEnum(raw.geoIntent, SEMANTIC_GEO_INTENTS),
    placeTargets: uniqueSemanticPlaceTargets(raw.placeTargets, 6),
    areaIntent: normalizeSemanticEnum(raw.areaIntent, SEMANTIC_AREA_INTENTS),
    qualityIntent: normalizeSemanticEnum(
      raw.qualityIntent,
      SEMANTIC_QUALITY_INTENTS,
    ),
    areaTraits: normalizeSemanticAreaTraits(raw.areaTraits),
    preferenceNotes: uniqueSemanticStringList(raw.preferenceNotes, 6),
    candidateHotelNames: uniqueSemanticStringList(raw.candidateHotelNames, 8),
    neighborhoodHints: uniqueSemanticStringList(raw.neighborhoodHints, 8),
  };
};

const normalizeSemanticConfidence = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return SEMANTIC_CONFIDENCE_LEVELS.has(normalized) ? normalized : null;
};

const normalizeLifestylePreference = (raw = {}) => {
  if (!raw || typeof raw !== "object") return null;
  const category = normalizeSemanticEnum(
    raw.category,
    SEMANTIC_LIFESTYLE_CATEGORIES,
  );
  if (!category) return null;
  const keyword =
    typeof raw.keyword === "string" && raw.keyword.trim()
      ? raw.keyword.trim()
      : null;
  const proximityMode =
    normalizeSemanticEnum(
      raw.proximityMode,
      SEMANTIC_LIFESTYLE_PROXIMITY_MODES,
    ) || "NEARBY";
  return {
    category,
    keyword,
    proximityMode,
  };
};

const normalizeSemanticGroundingResult = (raw = {}) => {
  if (!raw || typeof raw !== "object") return null;
  const semanticMode = normalizeSemanticEnum(
    raw.semanticMode,
    SEMANTIC_GROUNDING_MODES,
  );
  const groundingStrategy = normalizeSemanticEnum(
    raw.groundingStrategy,
    SEMANTIC_GROUNDING_STRATEGIES,
  );
  const candidateAnchors = uniqueSemanticPlaceTargets(
    raw.candidateAnchors,
    6,
  );
  const lifestylePreferences = Array.from(
    new Map(
      (Array.isArray(raw.lifestylePreferences) ? raw.lifestylePreferences : [])
        .map(normalizeLifestylePreference)
        .filter(Boolean)
        .map((entry) => [
          `${entry.category}|${entry.keyword || ""}|${entry.proximityMode}`,
          entry,
        ]),
    ).values(),
  ).slice(0, 6);
  const nearbyInterest =
    typeof raw.nearbyInterest === "string" && raw.nearbyInterest.trim()
      ? raw.nearbyInterest.trim()
      : null;

  return {
    semanticMode,
    groundingStrategy,
    confidence: normalizeSemanticConfidence(raw.confidence),
    shouldAskClarification: raw.shouldAskClarification === true,
    clarificationReason:
      typeof raw.clarificationReason === "string" &&
      raw.clarificationReason.trim()
        ? raw.clarificationReason.trim()
        : null,
    traceSummary:
      typeof raw.traceSummary === "string" && raw.traceSummary.trim()
        ? raw.traceSummary.trim()
        : null,
    viewIntent: normalizeSemanticEnum(raw.viewIntent, SEMANTIC_VIEW_INTENTS),
    geoIntent: normalizeSemanticEnum(raw.geoIntent, SEMANTIC_GEO_INTENTS),
    placeTargets: uniqueSemanticPlaceTargets(raw.placeTargets, 6),
    areaIntent: normalizeSemanticEnum(raw.areaIntent, SEMANTIC_AREA_INTENTS),
    qualityIntent: normalizeSemanticEnum(
      raw.qualityIntent,
      SEMANTIC_QUALITY_INTENTS,
    ),
    areaTraits: normalizeSemanticAreaTraits(raw.areaTraits),
    preferenceNotes: uniqueSemanticStringList(raw.preferenceNotes, 6),
    candidateHotelNames: uniqueSemanticStringList(raw.candidateHotelNames, 8),
    neighborhoodHints: uniqueSemanticStringList(raw.neighborhoodHints, 8),
    candidateZones: uniqueSemanticStringList(raw.candidateZones, 8),
    candidateAnchors,
    lifestylePreferences,
    nearbyInterest,
  };
};

const buildGroundingNearbyInterest = (grounding = {}) => {
  if (
    typeof grounding?.nearbyInterest === "string" &&
    grounding.nearbyInterest.trim()
  ) {
    return grounding.nearbyInterest.trim();
  }
  const firstLifestyle = Array.isArray(grounding?.lifestylePreferences)
    ? grounding.lifestylePreferences[0]
    : null;
  if (!firstLifestyle) return null;
  if (firstLifestyle.keyword) return firstLifestyle.keyword;
  if (firstLifestyle.category === "NIGHTLIFE") return "nightlife";
  if (firstLifestyle.category === "RESTAURANT") return "restaurant";
  if (firstLifestyle.category === "CAFE") return "cafe";
  if (firstLifestyle.category === "BAR") return "bar";
  if (firstLifestyle.category === "FOOD") return "food";
  return null;
};

const hasCanonicalSemanticGrounding = (plan = {}) =>
  Boolean(
    plan?.semanticSearch?.grounding &&
      typeof plan.semanticSearch.grounding === "object" &&
      plan.semanticSearch.grounding.source === "planner" &&
      plan.semanticSearch.grounding.groundingStrategy,
  );

const ensureSemanticSearchState = (plan) => {
  if (!plan || typeof plan !== "object") return null;
  if (!plan.semanticSearch || typeof plan.semanticSearch !== "object") {
    plan.semanticSearch = {};
  }
  if (
    !plan.semanticSearch.intentProfile ||
    typeof plan.semanticSearch.intentProfile !== "object"
  ) {
    plan.semanticSearch.intentProfile = null;
  }
  if (!Array.isArray(plan.semanticSearch.candidateHotelNames)) {
    plan.semanticSearch.candidateHotelNames = [];
  }
  if (!Array.isArray(plan.semanticSearch.neighborhoodHints)) {
    plan.semanticSearch.neighborhoodHints = [];
  }
  if (!Array.isArray(plan.semanticSearch.referenceHotelIds)) {
    plan.semanticSearch.referenceHotelIds = [];
  }
  if (!plan.semanticSearch.grounding || typeof plan.semanticSearch.grounding !== "object") {
    plan.semanticSearch.grounding = {
      source: null,
      semanticMode: null,
      groundingStrategy: null,
      confidence: null,
      shouldAskClarification: false,
      clarificationReason: null,
      candidateZones: [],
      candidateAnchors: [],
      lifestylePreferences: [],
      nearbyInterest: null,
      traceSummary: null,
    };
  }
  if (!plan.semanticSearch.webContext || typeof plan.semanticSearch.webContext !== "object") {
    plan.semanticSearch.webContext = {
      enrichmentRan: false,
      webResolutionUsed: false,
      candidateGenerationUsed: false,
      resolvedPlaces: [],
      candidateHotelNames: [],
      neighborhoodHints: [],
      sourcePolicy: SEMANTIC_WEB_SOURCE_POLICY,
      traceSummary: null,
    };
  }
  return plan.semanticSearch;
};

const refreshSemanticIntentProfile = (plan, latestUserMessage = "") => {
  if (!plan || typeof plan !== "object") return plan;
  const semanticState = ensureSemanticSearchState(plan);
  semanticState.intentProfile = buildSemanticIntentProfile({
    plan,
    latestUserMessage,
  });
  return plan;
};

const buildSemanticUserIntentLock = (plan, latestUserMessage = "") => {
  const planForLock =
    plan && typeof plan === "object"
      ? {
          ...plan,
          semanticSearch:
            plan.semanticSearch && typeof plan.semanticSearch === "object"
              ? { ...plan.semanticSearch, userIntentLock: null }
              : plan.semanticSearch,
        }
      : plan;
  const profile = buildSemanticIntentProfile({
    plan: planForLock,
    latestUserMessage,
  });
  return {
    userRequestedAreaTraits: Array.isArray(profile?.userRequestedAreaTraits)
      ? profile.userRequestedAreaTraits
      : [],
    userRequestedZones: Array.isArray(profile?.userRequestedZones)
      ? profile.userRequestedZones
      : [],
    userRequestedLandmarks: Array.isArray(profile?.userRequestedLandmarks)
      ? profile.userRequestedLandmarks
      : [],
    inferenceMode:
      typeof profile?.inferenceMode === "string"
        ? profile.inferenceMode.trim().toUpperCase() || "NONE"
        : "NONE",
  };
};

const lockSemanticUserIntent = ({
  plan,
  latestUserMessage = "",
  emitTrace = null,
} = {}) => {
  if (!plan || typeof plan !== "object") return plan;
  const semanticState = ensureSemanticSearchState(plan);
  const lockedIntent = buildSemanticUserIntentLock(plan, latestUserMessage);
  semanticState.userIntentLock = lockedIntent;
  emitTrace?.("SEMANTIC_USER_INTENT_LOCKED", {
    areaTraits: lockedIntent.userRequestedAreaTraits,
    zones: lockedIntent.userRequestedZones,
    landmarks: lockedIntent.userRequestedLandmarks,
    inferenceMode: lockedIntent.inferenceMode,
  });
  refreshSemanticIntentProfile(plan, latestUserMessage);
  return plan;
};

const filterSemanticEnrichmentAgainstLockedIntent = ({
  plan,
  enrichment = {},
  latestUserMessage = "",
  emitTrace = null,
} = {}) => {
  if (!enrichment || typeof enrichment !== "object") return enrichment;
  const semanticState = ensureSemanticSearchState(plan);
  const lockedIntent =
    semanticState?.userIntentLock && typeof semanticState.userIntentLock === "object"
      ? semanticState.userIntentLock
      : null;
  const explicitHints = buildDeterministicSemanticHints(latestUserMessage, plan);
  const allowedAreaTraits = new Set(
    normalizeSemanticAreaTraits([
      ...(Array.isArray(lockedIntent?.userRequestedAreaTraits)
        ? lockedIntent.userRequestedAreaTraits
        : []),
      ...(Array.isArray(explicitHints.areaTraits) ? explicitHints.areaTraits : []),
    ]),
  );
  const originalAreaTraits = normalizeSemanticAreaTraits(enrichment.areaTraits);
  const filteredAreaTraits = originalAreaTraits.filter((trait) =>
    allowedAreaTraits.has(String(trait || "").trim().toUpperCase()),
  );
  const droppedAreaTraits = originalAreaTraits.filter(
    (trait) => !filteredAreaTraits.includes(trait),
  );

  const allowedAreaIntent = explicitHints.areaIntent || plan?.areaIntent || null;
  const allowedQualityIntent =
    explicitHints.qualityIntent || plan?.qualityIntent || null;
  const allowedViewIntent = explicitHints.viewIntent || plan?.viewIntent || null;

  const sanitizedEnrichment = {
    ...enrichment,
    areaTraits: filteredAreaTraits,
    areaIntent:
      enrichment.areaIntent && enrichment.areaIntent === allowedAreaIntent
        ? enrichment.areaIntent
        : null,
    qualityIntent:
      enrichment.qualityIntent && enrichment.qualityIntent === allowedQualityIntent
        ? enrichment.qualityIntent
        : null,
    viewIntent:
      enrichment.viewIntent && enrichment.viewIntent === allowedViewIntent
        ? enrichment.viewIntent
        : null,
  };

  if (
    droppedAreaTraits.length ||
    (enrichment.areaIntent && sanitizedEnrichment.areaIntent == null) ||
    (enrichment.qualityIntent && sanitizedEnrichment.qualityIntent == null) ||
    (enrichment.viewIntent && sanitizedEnrichment.viewIntent == null)
  ) {
    emitTrace?.("SEMANTIC_TRAIT_INFLATION_DROPPED", {
      droppedAreaTraits,
      droppedAreaIntent:
        enrichment.areaIntent && sanitizedEnrichment.areaIntent == null
          ? enrichment.areaIntent
          : null,
      droppedQualityIntent:
        enrichment.qualityIntent && sanitizedEnrichment.qualityIntent == null
          ? enrichment.qualityIntent
          : null,
      droppedViewIntent:
        enrichment.viewIntent && sanitizedEnrichment.viewIntent == null
          ? enrichment.viewIntent
          : null,
      retainedAreaTraits: filteredAreaTraits,
    });
  }

  return sanitizedEnrichment;
};

const summarizeSemanticPlaceTargetForDebug = (target) => {
  if (!target || typeof target !== "object") return null;
  return {
    rawText: String(target.rawText || "").trim() || null,
    normalizedName: String(target.normalizedName || "").trim() || null,
    type: String(target.type || "").trim() || null,
    city: String(target.city || "").trim() || null,
    country: String(target.country || "").trim() || null,
    lat:
      target.lat == null || !Number.isFinite(Number(target.lat))
        ? null
        : Number(target.lat),
    lng:
      target.lng == null || !Number.isFinite(Number(target.lng))
        ? null
        : Number(target.lng),
    radiusMeters:
      target.radiusMeters == null ||
      !Number.isFinite(Number(target.radiusMeters))
        ? null
        : Number(target.radiusMeters),
    confidence: String(target.confidence || "").trim() || null,
  };
};

const summarizeSemanticIntentProfileForDebug = (plan) => {
  const profile = plan?.semanticSearch?.intentProfile;
  if (!profile || typeof profile !== "object") return null;
  return {
    version: profile.version || null,
    confidence: profile.confidence || null,
    fallbackMode: profile.fallbackMode || null,
    inferenceMode: profile.inferenceMode || null,
    userRequestedAreaTraits: Array.isArray(profile.userRequestedAreaTraits)
      ? profile.userRequestedAreaTraits
      : [],
    userRequestedZones: Array.isArray(profile.userRequestedZones)
      ? profile.userRequestedZones
      : [],
    userRequestedLandmarks: Array.isArray(profile.userRequestedLandmarks)
      ? profile.userRequestedLandmarks
      : [],
    requestedAreaTraits: Array.isArray(profile.requestedAreaTraits)
      ? profile.requestedAreaTraits
      : [],
    requestedZones: Array.isArray(profile.requestedZones)
      ? profile.requestedZones
      : [],
    requestedLandmarks: Array.isArray(profile.requestedLandmarks)
      ? profile.requestedLandmarks
      : [],
    candidateZones: Array.isArray(profile.candidateZones)
      ? profile.candidateZones
      : [],
    candidateLandmarks: Array.isArray(profile.candidateLandmarks)
      ? profile.candidateLandmarks
      : [],
    cityProfileVersion: profile.cityProfileVersion || null,
  };
};

const summarizeSemanticGroundingForDebug = (plan) => {
  const grounding = plan?.semanticSearch?.grounding;
  if (!grounding || typeof grounding !== "object") return null;
  return {
    source: grounding.source || null,
    semanticMode: grounding.semanticMode || null,
    groundingStrategy: grounding.groundingStrategy || null,
    confidence: grounding.confidence || null,
    shouldAskClarification: grounding.shouldAskClarification === true,
    clarificationReason: grounding.clarificationReason || null,
    candidateZones: Array.isArray(grounding.candidateZones)
      ? grounding.candidateZones
      : [],
    candidateAnchors: Array.isArray(grounding.candidateAnchors)
      ? grounding.candidateAnchors
          .map(summarizeSemanticPlaceTargetForDebug)
          .filter(Boolean)
      : [],
    lifestylePreferences: Array.isArray(grounding.lifestylePreferences)
      ? grounding.lifestylePreferences.map((entry) => ({
          category: entry?.category || null,
          keyword: entry?.keyword || null,
          proximityMode: entry?.proximityMode || null,
        }))
      : [],
    nearbyInterest: grounding.nearbyInterest || null,
    traceSummary: grounding.traceSummary || null,
  };
};

const summarizePlanForDebug = (plan) => {
  if (!plan || typeof plan !== "object") return null;
  return {
    intent: plan.intent || null,
    location: {
      city: plan?.location?.city || null,
      country: plan?.location?.country || null,
      area: plan?.location?.area || null,
      landmark: plan?.location?.landmark || null,
    },
    dates: {
      checkIn: plan?.dates?.checkIn || null,
      checkOut: plan?.dates?.checkOut || null,
    },
    guests: {
      adults: plan?.guests?.adults ?? null,
      children: plan?.guests?.children ?? null,
    },
    starRatings: Array.isArray(plan.starRatings) ? plan.starRatings : [],
    minStars: plan?.hotelFilters?.minRating ?? null,
    amenityCodes: Array.isArray(plan?.hotelFilters?.amenityCodes)
      ? plan.hotelFilters.amenityCodes
      : [],
    sortBy: plan?.sortBy || null,
    geoIntent: plan?.geoIntent || null,
    areaIntent: plan?.areaIntent || null,
    viewIntent: plan?.viewIntent || null,
    qualityIntent: plan?.qualityIntent || null,
    areaTraits: Array.isArray(plan?.areaTraits) ? plan.areaTraits : [],
    nearbyInterest: plan?.preferences?.nearbyInterest || null,
    preferenceNotes: Array.isArray(plan?.preferenceNotes)
      ? plan.preferenceNotes
      : [],
    placeTargets: Array.isArray(plan?.placeTargets)
      ? plan.placeTargets.map(summarizeSemanticPlaceTargetForDebug).filter(Boolean)
      : [],
    referenceHotelIds: Array.isArray(plan?.semanticSearch?.referenceHotelIds)
      ? plan.semanticSearch.referenceHotelIds
      : [],
    grounding: summarizeSemanticGroundingForDebug(plan),
    intentProfile: summarizeSemanticIntentProfileForDebug(plan),
  };
};

const summarizeToolCallForDebug = (toolCall) => {
  if (!toolCall || typeof toolCall !== "object") return null;
  return {
    id: toolCall.id || null,
    name: toolCall.name || null,
    args:
      toolCall.args && typeof toolCall.args === "object" ? toolCall.args : null,
  };
};

const summarizeSemanticCatalogContextForDebug = (catalogContext) => {
  if (!catalogContext || typeof catalogContext !== "object") return null;
  return {
    city: catalogContext?.city || null,
    hasCityCatalog: Boolean(catalogContext?.cityCatalog),
    matchedZones: Array.isArray(catalogContext?.matchedZones)
      ? catalogContext.matchedZones.map((zone) => ({
          id: zone?.id || null,
          name: zone?.name || null,
          traits: Array.isArray(zone?.traits) ? zone.traits : [],
        }))
      : [],
    matchedLandmarks: Array.isArray(catalogContext?.matchedLandmarks)
      ? catalogContext.matchedLandmarks.map((landmark) => ({
          id: landmark?.id || null,
          name: landmark?.name || null,
          kind: landmark?.kind || null,
        }))
      : [],
    candidateZones: Array.isArray(catalogContext?.candidateZones)
      ? catalogContext.candidateZones.map((zone) => ({
          id: zone?.id || null,
          name: zone?.name || null,
          traits: Array.isArray(zone?.traits) ? zone.traits : [],
        }))
      : [],
    candidateLandmarks: Array.isArray(catalogContext?.candidateLandmarks)
      ? catalogContext.candidateLandmarks.map((landmark) => ({
          id: landmark?.id || null,
          name: landmark?.name || null,
          kind: landmark?.kind || null,
        }))
      : [],
    profile: summarizeSemanticIntentProfileForDebug({
      semanticSearch: { intentProfile: catalogContext?.profile || null },
    }),
  };
};

const summarizeSemanticEvidenceForDebug = (evidence) =>
  Array.isArray(evidence)
    ? evidence.slice(0, 8).map((entry) => ({
        type: entry?.type || null,
        label: entry?.label || null,
        zoneId: entry?.zoneId || null,
        landmarkId: entry?.landmarkId || null,
        distanceMeters:
          entry?.distanceMeters == null ||
          !Number.isFinite(Number(entry.distanceMeters))
            ? null
            : Number(entry.distanceMeters),
      }))
    : [];

const summarizeHotelForDebug = (hotel, rank) => {
  if (!hotel || typeof hotel !== "object") return null;
  const semanticMatch =
    hotel.semanticMatch && typeof hotel.semanticMatch === "object"
      ? {
          score:
            hotel.semanticMatch.score == null ||
            !Number.isFinite(Number(hotel.semanticMatch.score))
              ? null
              : Number(hotel.semanticMatch.score),
          confidence: hotel.semanticMatch.confidence || null,
          matchedZoneId: hotel.semanticMatch.matchedZoneId || null,
          matchedLandmarkId: hotel.semanticMatch.matchedLandmarkId || null,
          scopeEligible: Boolean(hotel.semanticMatch.scopeEligible),
          evidence: summarizeSemanticEvidenceForDebug(hotel.semanticMatch.evidence),
        }
      : null;
  return {
    rank,
    id: hotel.id || null,
    name: hotel.name || null,
    city: hotel.city || null,
    stars: hotel.stars ?? null,
    pricePerNight: hotel.pricePerNight ?? null,
    distanceMeters:
      hotel.distanceMeters == null || !Number.isFinite(Number(hotel.distanceMeters))
        ? null
        : Number(hotel.distanceMeters),
    matchedPlaceTarget: hotel.matchedPlaceTarget || null,
    matchReasons: Array.isArray(hotel.matchReasons) ? hotel.matchReasons.slice(0, 5) : [],
    semanticMatch,
  };
};

const summarizeInventoryForDebug = (inventory) => {
  const hotels = Array.isArray(inventory?.hotels) ? inventory.hotels : [];
  return {
    counts: {
      homes: Array.isArray(inventory?.homes) ? inventory.homes.length : 0,
      hotels: hotels.length,
    },
    searchScope: inventory?.searchScope?.hotels
      ? {
          candidateHotelCount:
            inventory.searchScope.hotels.candidateHotelCount ?? null,
          strongHotelCount: inventory.searchScope.hotels.strongHotelCount ?? null,
          relevantHotelCount:
            inventory.searchScope.hotels.relevantHotelCount ?? null,
          visibleHotelCount:
            inventory.searchScope.hotels.visibleHotelCount ?? null,
          scopeMode: inventory.searchScope.hotels.scopeMode ?? null,
          scopeReason: inventory.searchScope.hotels.scopeReason ?? null,
          warningMode: inventory.searchScope.hotels.warningMode ?? null,
          scopeConfidence:
            inventory.searchScope.hotels.scopeConfidence ?? null,
          scopeExpansionReason:
            inventory.searchScope.hotels.scopeExpansionReason ?? null,
        }
      : null,
    topHotels: hotels
      .slice(0, 10)
      .map((hotel, index) => summarizeHotelForDebug(hotel, index + 1))
      .filter(Boolean),
    semanticExplanationPlan:
      inventory?.semanticExplanationPlan &&
      typeof inventory.semanticExplanationPlan === "object"
        ? {
            source: inventory.semanticExplanationPlan.source || null,
            fallbackUsed: inventory.semanticExplanationPlan.fallbackUsed === true,
            itemCount: Array.isArray(inventory.semanticExplanationPlan.items)
              ? inventory.semanticExplanationPlan.items.length
              : 0,
          }
        : null,
  };
};

const summarizeRenderedPayloadForDebug = (rendered, nextAction) => {
  const sections = Array.isArray(rendered?.ui?.sections) ? rendered.ui.sections : [];
  return {
    nextAction: nextAction || null,
    replyPreview:
      typeof rendered?.assistant?.text === "string"
        ? rendered.assistant.text.slice(0, 320)
        : null,
    sectionTypes: sections.map((section, index) => ({
      index,
      type: section?.type || null,
      name: section?.name || null,
    })),
    hotelCardCount: sections.filter((section) => section?.type === "hotelCard")
      .length,
  };
};

const normalizeSemanticExplanationText = (value = null) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[.;:,]+$/g, "")
    .trim();

const countSemanticExplanationWords = (value = "") =>
  normalizeSemanticExplanationText(value)
    .split(/\s+/)
    .filter(Boolean).length;

const normalizeSemanticPlannerLookup = (value = "") =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const resolveSemanticExplanationPriceTier = (pricePerNight) => {
  const numeric = Number(pricePerNight);
  if (!Number.isFinite(numeric) || numeric <= 0) return "UNKNOWN";
  if (numeric <= 120) return "LOW";
  if (numeric >= 280) return "HIGH";
  return "MID";
};

const buildSemanticPlannerIntentSnapshot = (plan = {}) => {
  const profile = plan?.semanticSearch?.intentProfile || {};
  return {
    destination: {
      city: plan?.location?.city || null,
      country: plan?.location?.country || null,
    },
    inferenceMode: profile?.inferenceMode || null,
    userRequestedAreaTraits: Array.isArray(profile?.userRequestedAreaTraits)
      ? profile.userRequestedAreaTraits
      : [],
    userRequestedZones: Array.isArray(profile?.userRequestedZones)
      ? profile.userRequestedZones
      : [],
    userRequestedLandmarks: Array.isArray(profile?.userRequestedLandmarks)
      ? profile.userRequestedLandmarks
      : [],
    requestedAreaTraits: Array.isArray(profile?.requestedAreaTraits)
      ? profile.requestedAreaTraits
      : [],
    requestedZones: Array.isArray(profile?.requestedZones)
      ? profile.requestedZones
      : [],
    requestedLandmarks: Array.isArray(profile?.requestedLandmarks)
      ? profile.requestedLandmarks
      : [],
    candidateZones: Array.isArray(profile?.candidateZones)
      ? profile.candidateZones
      : [],
    candidateLandmarks: Array.isArray(profile?.candidateLandmarks)
      ? profile.candidateLandmarks
      : [],
    areaIntent: plan?.areaIntent || null,
    qualityIntent: plan?.qualityIntent || null,
    viewIntent: plan?.viewIntent || null,
    geoIntent: plan?.geoIntent || null,
  };
};

const hasSemanticPlannerIntent = (plan = {}) => {
  const snapshot = buildSemanticPlannerIntentSnapshot(plan);
  return Boolean(
    snapshot.areaIntent ||
      snapshot.qualityIntent ||
      snapshot.viewIntent ||
      snapshot.geoIntent ||
      snapshot.userRequestedAreaTraits.length ||
      snapshot.userRequestedZones.length ||
      snapshot.userRequestedLandmarks.length ||
      snapshot.requestedZones.length ||
      snapshot.requestedLandmarks.length ||
      snapshot.candidateZones.length ||
      snapshot.candidateLandmarks.length,
  );
};

const buildSemanticPlannerHotelPayload = (pick = null) => {
  const item = pick?.item || null;
  if (!item?.id || !item?.name) return null;
  const explanation =
    item?.decisionExplanation && typeof item.decisionExplanation === "object"
      ? item.decisionExplanation
      : {};
  return {
    hotelId: String(item.id),
    name: item.name,
    zoneLabel:
      explanation.canMentionZone === true ? explanation.mentionedZoneLabel || null : null,
    canMentionZone: explanation.canMentionZone === true,
    allowedAngles: Array.isArray(explanation.allowedAngles)
      ? explanation.allowedAngles.slice(0, 8)
      : [],
    primaryReasonText: explanation.primaryReasonText || null,
    secondaryReasonText: explanation.secondaryReasonText || null,
    stars: item.stars ?? null,
    priceTier: resolveSemanticExplanationPriceTier(item.pricePerNight),
    confidence: explanation.confidence || item?.semanticMatch?.confidence || null,
    allowedSignals:
      explanation.signals && typeof explanation.signals === "object"
        ? { ...explanation.signals }
        : {},
    allowedClaims: Array.isArray(explanation.allowedClaims)
      ? explanation.allowedClaims.slice(0, 10)
      : [],
  };
};

const buildSemanticExplanationPlannerMessages = ({
  latestUserMessage,
  plan,
  language,
  picks = [],
} = {}) => {
  const intentSnapshot = buildSemanticPlannerIntentSnapshot(plan);
  const hotelPayload = picks
    .map((entry) => buildSemanticPlannerHotelPayload(entry))
    .filter(Boolean);
  return [
    {
      role: "system",
      content:
        "You write short concierge-style explanations for already selected hotel picks in BookingGPT. " +
        "Ranking, order, and allowed claims are fixed. Do not change hotel order or hotel IDs. " +
        "Return JSON only with this schema: " +
        '{"intro":"string","items":[{"hotelId":"string","angle":"string","sentence":"string"}]}.\n\n' +
        "Rules:\n" +
        "- Write in the requested language only.\n" +
        "- Keep the intro to one short sentence.\n" +
        "- Write exactly one sentence per hotel, 14 to 28 words.\n" +
        "- Start each hotel sentence with the exact hotel name in markdown bold.\n" +
        "- Use materially different angles across the set when possible.\n" +
        "- Only use facts and claims explicitly listed in the payload.\n" +
        "- Never invent places, distances, amenities, value claims, or hotel facts.\n" +
        "- Mention a neighborhood only when canMentionZone=true and only use the provided zoneLabel.\n" +
        "- Never use raw trait codes like QUIET, WALKABLE, SAFE, GOOD_AREA, UPSCALE_AREA.\n" +
        "- Never use phrases like 'Coincide con la preferencia de'.\n" +
        "- Avoid mixed-language wording.\n" +
        "- Do not include bullets, numbering, markdown lists, or extra keys.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          language,
          latestUserRequest: latestUserMessage || "",
          canonicalIntent: intentSnapshot,
          selectedHotelIdsInOrder: hotelPayload.map((entry) => entry.hotelId),
          hotels: hotelPayload,
        },
        null,
        2,
      ),
    },
  ];
};

const extractMentionedSemanticLabels = (sentence = "", labels = []) => {
  const haystack = normalizeSemanticPlannerLookup(sentence);
  return (Array.isArray(labels) ? labels : []).filter((label) => {
    const normalizedLabel = normalizeSemanticPlannerLookup(label);
    return normalizedLabel && haystack.includes(normalizedLabel);
  });
};

const SEMANTIC_EXPLANATION_BANNED_PATTERNS = [
  /Coincide con la preferencia de/i,
  /\bGOOD_AREA\b/i,
  /\bQUIET\b/i,
  /\bWALKABLE\b/i,
  /\bSAFE\b/i,
  /\bUPSCALE_AREA\b/i,
];

const SEMANTIC_EXPLANATION_SIGNAL_PATTERNS = {
  quiet_profile: /\b(tranquil|quiet|calm|descans|peaceful)\b/i,
  walkability: /\b(camin|walk|a pie|on foot|stroll)\b/i,
  value: /\b(valor|precio|price|value|afford|equilibr)\b/i,
  premium_profile: /\b(premium|refinad|refined|upscale|luxur|polished|elegan)\b/i,
  stars_match: /\b(estrella|star)\b/i,
  view_match: /\b(vista|view|river|rio|río|water|sea|mar)\b/i,
};

const validateSemanticExplanationSentenceSignals = ({
  sentence = "",
  allowedSignals = {},
  canMentionZone = false,
  zoneLabel = null,
  knownZoneLabels = [],
} = {}) => {
  const errors = [];
  const mentionedZones = extractMentionedSemanticLabels(sentence, knownZoneLabels);
  if (!canMentionZone && mentionedZones.length) {
    errors.push("zone_not_allowed");
  }
  if (canMentionZone && mentionedZones.some((label) => label !== zoneLabel)) {
    errors.push("wrong_zone_mentioned");
  }
  Object.entries(SEMANTIC_EXPLANATION_SIGNAL_PATTERNS).forEach(([signal, pattern]) => {
    if (pattern.test(sentence) && allowedSignals?.[signal] !== true) {
      errors.push(`signal_not_allowed:${signal}`);
    }
  });
  return errors;
};

export const validateSemanticExplanationPlanOutput = ({
  explanationPlan = null,
  picks = [],
  language = "es",
} = {}) => {
  const hotelMap = new Map(
    (Array.isArray(picks) ? picks : [])
      .map((entry) => {
        const item = entry?.item || null;
        if (!item?.id || !item?.name) return null;
        const explanation =
          item?.decisionExplanation && typeof item.decisionExplanation === "object"
            ? item.decisionExplanation
            : {};
        return [
          String(item.id),
          {
            id: String(item.id),
            name: item.name,
            zoneLabel:
              explanation.canMentionZone === true
                ? explanation.mentionedZoneLabel || null
                : null,
            canMentionZone: explanation.canMentionZone === true,
            allowedAngles: Array.isArray(explanation.allowedAngles)
              ? explanation.allowedAngles
              : [],
            allowedSignals:
              explanation.signals && typeof explanation.signals === "object"
                ? explanation.signals
                : {},
          },
        ];
      })
      .filter(Boolean),
  );
  const knownZoneLabels = Array.from(
    new Set(
      [...hotelMap.values()]
        .map((entry) => entry.zoneLabel)
        .filter((label) => typeof label === "string" && label.trim()),
    ),
  );
  const knownHotelNames = [...hotelMap.values()].map((entry) => entry.name);
  const itemErrorsByHotelId = new Map();
  const normalizedIntro =
    typeof explanationPlan?.intro === "string" ? explanationPlan.intro.trim() : "";
  const introErrors = [];
  if (!normalizedIntro) {
    introErrors.push("missing_intro");
  } else {
    if (countSemanticExplanationWords(normalizedIntro) < 8) {
      introErrors.push("intro_too_short");
    }
    if (countSemanticExplanationWords(normalizedIntro) > 36) {
      introErrors.push("intro_too_long");
    }
    if (
      language === "es" &&
      /\bquiet\b|\bwalkable\b|\bsafe area\b|\bgood area\b/i.test(normalizedIntro)
    ) {
      introErrors.push("intro_mixed_language");
    }
    if (SEMANTIC_EXPLANATION_BANNED_PATTERNS.some((pattern) => pattern.test(normalizedIntro))) {
      introErrors.push("intro_banned_phrase");
    }
  }

  const rawItems = Array.isArray(explanationPlan?.items) ? explanationPlan.items : [];
  const normalizedItems = rawItems
    .map((item) => ({
      hotelId: String(item?.hotelId || "").trim(),
      angle: String(item?.angle || "").trim(),
      sentence: normalizeSemanticExplanationText(item?.sentence),
    }))
    .filter((item) => item.hotelId || item.angle || item.sentence);

  normalizedItems.forEach((item) => {
    const errors = [];
    const hotel = hotelMap.get(item.hotelId);
    if (!hotel) {
      errors.push("unknown_hotel");
    } else {
      if (!item.angle || !hotel.allowedAngles.includes(item.angle)) {
        errors.push("angle_not_allowed");
      }
      if (!item.sentence) {
        errors.push("missing_sentence");
      } else {
        const wordCount = countSemanticExplanationWords(item.sentence);
        if (wordCount < 14) errors.push("sentence_too_short");
        if (wordCount > 28) errors.push("sentence_too_long");
        if (SEMANTIC_EXPLANATION_BANNED_PATTERNS.some((pattern) => pattern.test(item.sentence))) {
          errors.push("banned_phrase");
        }
        if (
          language === "es" &&
          /\bquiet\b|\bwalkable\b|\bsafe area\b|\bgood area\b/i.test(item.sentence)
        ) {
          errors.push("mixed_language");
        }
        knownHotelNames.forEach((name) => {
          if (!name || name === hotel.name) return;
          if (
            normalizeSemanticPlannerLookup(item.sentence).includes(
              normalizeSemanticPlannerLookup(name),
            )
          ) {
            errors.push("wrong_hotel_named");
          }
        });
        errors.push(
          ...validateSemanticExplanationSentenceSignals({
            sentence: item.sentence,
            allowedSignals: hotel.allowedSignals,
            canMentionZone: hotel.canMentionZone,
            zoneLabel: hotel.zoneLabel,
            knownZoneLabels,
          }),
        );
      }
    }
    if (errors.length) {
      itemErrorsByHotelId.set(item.hotelId, errors);
    }
  });

  const expectedHotelIds = [...hotelMap.keys()];
  const missingHotelIds = expectedHotelIds.filter(
    (hotelId) => !normalizedItems.some((item) => item.hotelId === hotelId),
  );

  return {
    valid:
      introErrors.length === 0 &&
      missingHotelIds.length === 0 &&
      itemErrorsByHotelId.size === 0 &&
      normalizedItems.length === expectedHotelIds.length,
    intro: normalizedIntro || null,
    introErrors,
    items: normalizedItems,
    itemErrorsByHotelId,
    missingHotelIds,
  };
};

const mergeSemanticExplanationPlanWithFallback = ({
  candidatePlan = null,
  fallbackPlan = null,
  picks = [],
  language = "es",
} = {}) => {
  const validation = validateSemanticExplanationPlanOutput({
    explanationPlan: candidatePlan,
    picks,
    language,
  });
  const fallbackItemsById = new Map(
    (Array.isArray(fallbackPlan?.items) ? fallbackPlan.items : [])
      .map((item) => [String(item?.hotelId || ""), item])
      .filter(([hotelId]) => hotelId),
  );
  if (validation.valid) {
    return {
      plan: {
        intro: validation.intro,
        items: validation.items,
        source: "model",
        fallbackUsed: false,
      },
      usedFallbackCount: 0,
      discardedModel: false,
      validation,
    };
  }

  const repairedItems = [];
  let replacedCount = 0;
  let irreparableCount = 0;
  const candidateItemsById = new Map(
    validation.items.map((item) => [String(item.hotelId || ""), item]),
  );
  (Array.isArray(picks) ? picks : []).forEach((pick) => {
    const hotelId = String(pick?.item?.id || "");
    const itemErrors = validation.itemErrorsByHotelId.get(hotelId) || [];
    const candidateItem = candidateItemsById.get(hotelId) || null;
    if (candidateItem && !itemErrors.length) {
      repairedItems.push(candidateItem);
      return;
    }
    const fallbackItem = fallbackItemsById.get(hotelId) || null;
    if (fallbackItem) {
      repairedItems.push(fallbackItem);
      replacedCount += 1;
    } else {
      irreparableCount += 1;
    }
  });

  const introValid = validation.introErrors.length === 0 && validation.intro;
  const shouldDiscardModel =
    !introValid ||
    validation.missingHotelIds.length > 0 ||
    replacedCount > 2 ||
    irreparableCount > 0 ||
    repairedItems.length !== picks.length;

  if (shouldDiscardModel || !fallbackPlan) {
    return {
      plan: fallbackPlan || null,
      usedFallbackCount: replacedCount,
      discardedModel: true,
      validation,
    };
  }

  return {
    plan: {
      intro: validation.intro,
      items: repairedItems,
      source: "model",
      fallbackUsed: replacedCount > 0,
    },
    usedFallbackCount: replacedCount,
    discardedModel: false,
    validation,
  };
};

const buildSemanticOrientationProfileLabel = (plan = {}, language = "es") => {
  const profile = plan?.semanticSearch?.intentProfile || {};
  const traits = new Set(
    (
      Array.isArray(profile?.userRequestedAreaTraits)
        ? profile.userRequestedAreaTraits
        : Array.isArray(profile?.requestedAreaTraits)
          ? profile.requestedAreaTraits
          : Array.isArray(plan?.areaTraits)
            ? plan.areaTraits
            : []
    )
      .map((trait) => String(trait || "").trim().toUpperCase())
      .filter(Boolean),
  );
  const areaIntent = String(plan?.areaIntent || "").trim().toUpperCase();
  if (language === "es") {
    if (
      areaIntent === "GOOD_AREA" ||
      (traits.has("SAFE") && traits.has("WALKABLE") && traits.has("UPSCALE_AREA"))
    ) {
      return "de buena zona y caminable";
    }
    if (traits.has("QUIET") && traits.has("WALKABLE")) return "tranquilo y caminable";
    if (traits.has("SAFE") && traits.has("WALKABLE")) return "seguro y caminable";
    if (traits.has("QUIET")) return "tranquilo";
    if (traits.has("WALKABLE")) return "caminable";
    if (traits.has("UPSCALE_AREA")) return "de entorno mas cuidado";
  }
  if (
    areaIntent === "GOOD_AREA" ||
    (traits.has("SAFE") && traits.has("WALKABLE") && traits.has("UPSCALE_AREA"))
  ) {
    return "in a good, walkable area";
  }
  if (traits.has("QUIET") && traits.has("WALKABLE")) return "quiet and walkable";
  if (traits.has("SAFE") && traits.has("WALKABLE")) return "comfortable and walkable";
  if (traits.has("QUIET")) return "quiet";
  if (traits.has("WALKABLE")) return "walkable";
  if (traits.has("UPSCALE_AREA")) return "with a more polished setting";
  return language === "es" ? "como el que pediste" : "like the one you asked for";
};

const joinSemanticOrientationZones = (zones = [], language = "es") => {
  const names = uniqueSemanticStringList(zones, 3);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) {
    return language === "es"
      ? `${names[0]} y ${names[1]}`
      : `${names[0]} and ${names[1]}`;
  }
  return language === "es"
    ? `${names[0]}, ${names[1]} o ${names[2]}`
    : `${names[0]}, ${names[1]}, or ${names[2]}`;
};

const normalizeAssistantKickoffText = (text = "") =>
  String(text || "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const countAssistantKickoffWords = (text = "") =>
  normalizeAssistantKickoffText(text)
    .split(/\s+/)
    .filter(Boolean).length;

const ASSISTANT_KICKOFF_BANNED_FRAGMENTS = [
  "voy a priorizar",
  "te traigo opciones alineadas",
  "tomo como referencia",
  "voy a tomar",
  "busco en base a eso",
  "estas opciones quedaron priorizadas",
  "estas opciones quedaron primero",
  "priorice",
  "prioricé",
  "i will prioritize",
  "use as the anchor",
  "based on that",
  "these options were prioritized",
  "these options came first",
];

const buildDeterministicAssistantKickoffReference = ({ plan = {}, language = "es" } = {}) => {
  const destination =
    plan?.location?.city ||
    plan?.location?.country ||
    (language === "es" ? "la ciudad" : "the city");
  const profile = plan?.semanticSearch?.intentProfile || {};
  const inferenceMode = String(profile?.inferenceMode || "").trim().toUpperCase();
  const confidence = String(profile?.confidence || "LOW").trim().toUpperCase();
  const viewIntent = String(plan?.viewIntent || "").trim().toUpperCase();
  const qualityIntent = String(plan?.qualityIntent || "").trim().toUpperCase();
  const areaIntent = String(plan?.areaIntent || "").trim().toUpperCase();
  const explicitReferenceLabel =
    (Array.isArray(plan?.placeTargets)
      ? plan.placeTargets.find(
          (target) =>
            target &&
            (String(target?.normalizedName || "").trim() || String(target?.rawText || "").trim()),
        )
      : null)?.normalizedName ||
    (Array.isArray(plan?.placeTargets)
      ? plan.placeTargets.find(
          (target) =>
            target &&
            (String(target?.normalizedName || "").trim() || String(target?.rawText || "").trim()),
        )
      : null)?.rawText ||
    plan?.location?.landmark ||
    null;
  const nearbyInterest = String(
    plan?.nearbyInterest || plan?.semanticSearch?.grounding?.nearbyInterest || "",
  ).trim();
  const requestedTraits = new Set(
    [
      ...(Array.isArray(plan?.areaTraits) ? plan.areaTraits : []),
      ...(Array.isArray(profile?.userRequestedAreaTraits)
        ? profile.userRequestedAreaTraits
        : []),
      ...(Array.isArray(profile?.requestedAreaTraits) ? profile.requestedAreaTraits : []),
    ]
      .map((trait) => String(trait || "").trim().toUpperCase())
      .filter(Boolean),
  );
  const nightlifeRequested =
    areaIntent === "NIGHTLIFE" || requestedTraits.has("NIGHTLIFE");
  const waterfrontRequested =
    viewIntent === "RIVER_VIEW" ||
    viewIntent === "WATER_VIEW" ||
    viewIntent === "SEA_VIEW" ||
    requestedTraits.has("WATERFRONT_AREA");
  const budgetRequested =
    qualityIntent === "BUDGET" ||
    String(plan?.areaPreference || "").trim().toUpperCase() === "BUDGET";
  const catalogContext = resolveSemanticCatalogContext({ plan });
  const explicitZones = Array.isArray(catalogContext?.matchedZones)
    ? catalogContext.matchedZones
        .map((entry) => entry?.name || entry?.entry?.name || null)
        .filter(Boolean)
    : [];
  const candidateZones = Array.isArray(catalogContext?.candidateZones)
    ? catalogContext.candidateZones
        .map((entry) => entry?.name || entry?.entry?.name || null)
        .filter(Boolean)
    : [];
  const allowedZones =
    explicitZones.length > 0 ? explicitZones : confidence === "LOW" ? [] : candidateZones;
  const profileLabel = buildSemanticOrientationProfileLabel(plan, language);
  const zonesLabel = joinSemanticOrientationZones(allowedZones, language);
  const explicitGeo =
    Array.isArray(profile?.userRequestedZones) && profile.userRequestedZones.length > 0;

  if (language === "es") {
    if (explicitReferenceLabel) {
      return {
        text: `Si el punto clave es ${explicitReferenceLabel}, tiene sentido abrir la búsqueda desde lo que mejor resuelve esa ubicación sin perder contexto de ciudad.`,
        mentionedZones: uniqueSemanticStringList(allowedZones, 3),
        confidence,
      };
    }
    if (nearbyInterest) {
      return {
        text: `Si el plan gira alrededor de ${nearbyInterest}, conviene leer la ciudad desde qué zonas quedan mejor paradas para eso y no solo desde distancia bruta.`,
        mentionedZones: uniqueSemanticStringList(allowedZones, 3),
        confidence,
      };
    }
    if (waterfrontRequested && zonesLabel) {
      return {
        text: `Para una búsqueda de este tipo en ${destination}, ${zonesLabel} es donde primero tiene sentido mirar si de verdad importa la relación con el agua.`,
        mentionedZones: uniqueSemanticStringList(allowedZones, 3),
        confidence,
      };
    }
    if (waterfrontRequested) {
      return {
        text: `Acá el criterio fuerte no es solo la ciudad sino qué parte de la ciudad tiene una chance más creíble de dar una vista al agua que no suene forzada.`,
        mentionedZones: [],
        confidence,
      };
    }
    if (nightlifeRequested && zonesLabel) {
      return {
        text: `Si el viaje va por movimiento y plan con amigos, ${zonesLabel} ya marca bastante bien por dónde conviene empezar a mirar.`,
        mentionedZones: uniqueSemanticStringList(allowedZones, 3),
        confidence,
      };
    }
    if (nightlifeRequested) {
      return {
        text: `Lo importante acá es leer la ciudad por ambiente y no solo por mapa, porque no todos los barrios rinden igual para un plan social.`,
        mentionedZones: [],
        confidence,
      };
    }
    if (budgetRequested && zonesLabel) {
      return {
        text: `Si además de encajar con la idea buscas cuidar presupuesto, ${zonesLabel} sirve como punto de partida para separar rápido lo razonable de lo inflado.`,
        mentionedZones: uniqueSemanticStringList(allowedZones, 3),
        confidence,
      };
    }
    if (budgetRequested) {
      return {
        text: `Cuando el ángulo es presupuesto en ${destination}, el valor real suele aparecer más en cómo cae cada zona que en la tarifa aislada.`,
        mentionedZones: [],
        confidence,
      };
    }
    if (explicitGeo && zonesLabel) {
      return {
        text: `Como la geografía ya está bastante marcada, ${zonesLabel} funciona como punto claro para leer las opciones sin abrir demasiado el mapa.`,
        mentionedZones: uniqueSemanticStringList(allowedZones, 3),
        confidence,
      };
    }
    if (inferenceMode === "TRAIT_PROFILE" && zonesLabel) {
      return {
        text: `Para un pedido ${profileLabel} en ${destination}, ${zonesLabel} es la lectura más natural del perfil antes de bajar a hoteles concretos.`,
        mentionedZones: uniqueSemanticStringList(allowedZones, 3),
        confidence,
      };
    }
    return {
      text: `La clave en ${destination} no es abrir todo por igual sino leer primero qué parte de la ciudad respira mejor ese perfil ${profileLabel}.`,
      mentionedZones: [],
      confidence,
    };
  }

  if (explicitReferenceLabel) {
    return {
      text: `If ${explicitReferenceLabel} is the anchor, the most useful first pass is around the parts of the city that genuinely work best for that location.`,
      mentionedZones: uniqueSemanticStringList(allowedZones, 3),
      confidence,
    };
  }
  if (nearbyInterest) {
    return {
      text: `If the plan revolves around ${nearbyInterest}, the useful angle is to read the city through which areas actually support that plan well.`,
      mentionedZones: uniqueSemanticStringList(allowedZones, 3),
      confidence,
    };
  }
  if (waterfrontRequested && zonesLabel) {
    return {
      text: `For this kind of stay in ${destination}, ${zonesLabel} is where it makes more sense to start if the water relationship really matters.`,
      mentionedZones: uniqueSemanticStringList(allowedZones, 3),
      confidence,
    };
  }
  if (waterfrontRequested) {
    return {
      text: `The key here is not the whole city equally, but which parts of ${destination} have a more believable chance of a real water view.`,
      mentionedZones: [],
      confidence,
    };
  }
  if (nightlifeRequested && zonesLabel) {
    return {
      text: `For that kind of social plan, ${zonesLabel} already gives the strongest first read on where the city is likely to fit better.`,
      mentionedZones: uniqueSemanticStringList(allowedZones, 3),
      confidence,
    };
  }
  if (nightlifeRequested) {
    return {
      text: `The useful read here is by atmosphere rather than map alone, because not every part of the city works equally well for going out.`,
      mentionedZones: [],
      confidence,
    };
  }
  if (budgetRequested && zonesLabel) {
    return {
      text: `If budget matters as much as fit, ${zonesLabel} is a good starting point to separate genuinely reasonable options from inflated ones.`,
      mentionedZones: uniqueSemanticStringList(allowedZones, 3),
      confidence,
    };
  }
  if (budgetRequested) {
    return {
      text: `With a budget angle in ${destination}, the real value usually comes more from where each option sits than from price in isolation.`,
      mentionedZones: [],
      confidence,
    };
  }
  if (explicitGeo && zonesLabel) {
    return {
      text: `Since the geography is already fairly clear, ${zonesLabel} gives a clean first frame to read the options without opening the map too wide.`,
      mentionedZones: uniqueSemanticStringList(allowedZones, 3),
      confidence,
    };
  }
  if (inferenceMode === "TRAIT_PROFILE" && zonesLabel) {
    return {
      text: `For a ${profileLabel} stay in ${destination}, ${zonesLabel} is the most natural first read of the request before dropping into specific hotels.`,
      mentionedZones: uniqueSemanticStringList(allowedZones, 3),
      confidence,
    };
  }
  return {
    text: `In ${destination}, the useful first read is not the whole city at once but which parts actually breathe that ${profileLabel} profile.`,
    mentionedZones: [],
    confidence,
  };
};

const buildAssistantKickoffMessages = ({
  latestUserMessage,
  plan,
  language,
} = {}) => {
  const kickoffReference = buildDeterministicAssistantKickoffReference({
    plan,
    language,
  });
  const destinationParts = [plan?.location?.city, plan?.location?.country].filter(Boolean);
  const explicitPlaceTargets = uniqueSemanticStringList(
    Array.isArray(plan?.placeTargets)
      ? plan.placeTargets.map((target) => target?.normalizedName || target?.rawText || null)
      : [],
    4,
  );
  const preferenceNotes = uniqueSemanticStringList(plan?.preferenceNotes, 3);
  const areaTraits = uniqueSemanticStringList(plan?.areaTraits, 4);
  const contextLines = [
    `language: ${language || "es"}`,
    latestUserMessage ? `latest user message: ${normalizeAssistantKickoffText(latestUserMessage)}` : null,
    destinationParts.length ? `destination: ${destinationParts.join(", ")}` : null,
    plan?.geoIntent ? `geo intent: ${plan.geoIntent}` : null,
    plan?.viewIntent ? `view intent: ${plan.viewIntent}` : null,
    plan?.areaIntent ? `area intent: ${plan.areaIntent}` : null,
    plan?.qualityIntent ? `quality intent: ${plan.qualityIntent}` : null,
    plan?.nearbyInterest ? `nearby interest: ${plan.nearbyInterest}` : null,
    plan?.location?.area ? `area hint: ${plan.location.area}` : null,
    explicitPlaceTargets.length ? `place targets: ${explicitPlaceTargets.join(", ")}` : null,
    areaTraits.length ? `area traits: ${areaTraits.join(", ")}` : null,
    preferenceNotes.length ? `preference notes: ${preferenceNotes.join(" | ")}` : null,
    kickoffReference?.text
      ? `reference hint for tone only, do not copy literally: ${kickoffReference.text}`
      : null,
  ].filter(Boolean);

  return [
    {
      role: "system",
      content:
        "You write the first visible BookingGPT kickoff while a hotel search is already running. " +
        "Return plain text only.\n\n" +
        "Rules:\n" +
        "- Write exactly 1 paragraph.\n" +
        `- Aim for roughly ${AI_ASSISTANT_KICKOFF_TARGET_WORDS} words when possible.\n` +
        "- Sound like a live human assistant reacting to the user, not like a status update.\n" +
        "- Interpret the request and frame the search angle in a natural way.\n" +
        "- Use only the context provided here.\n" +
        "- Mention neighborhoods only if they are already present in the provided context.\n" +
        "- Do not narrate internal steps, ranking, tools, pipelines, or hidden reasoning.\n" +
        "- Do not say you are prioritizing, taking something as a reference, searching based on that, or that options were prioritized.\n" +
        "- Do not say you already found hotels.\n" +
        "- Do not invent facts, areas, availability, or hotel details.\n" +
        "- Do not use bullets, labels, quotes, or multiple paragraphs.\n" +
        "- Write only in the requested language.",
    },
    {
      role: "user",
      content: contextLines.join("\n"),
    },
  ];
};

const buildAssistantClosingMessages = ({
  plan = {},
  inventory = null,
  language = "es",
  latestUserMessage = "",
} = {}) => {
  const topHotels = (inventory?.hotels || [])
    .slice(0, 5)
    .map((h) => ({
      name: h.name || null,
      stars: h.stars ?? null,
      distanceMeters: Number.isFinite(Number(h.distanceMeters))
        ? Number(h.distanceMeters)
        : null,
      matchReasons: Array.isArray(h.matchReasons)
        ? h.matchReasons.slice(0, 2)
        : [],
      semanticConfidence: h.semanticMatch?.confidence || null,
    }))
    .filter((h) => h.name);

  const totalFound = inventory?.hotels?.length || 0;
  const destination =
    plan?.location?.city || plan?.location?.country || null;

  const contextLines = [
    `language: ${language}`,
    latestUserMessage ? `user request: ${latestUserMessage}` : null,
    destination ? `destination: ${destination}` : null,
    `total hotels found: ${totalFound}`,
    topHotels.length
      ? `top results: ${JSON.stringify(topHotels)}`
      : null,
    plan?.geoIntent ? `geo intent: ${plan.geoIntent}` : null,
    plan?.viewIntent ? `view intent: ${plan.viewIntent}` : null,
    plan?.areaIntent ? `area intent: ${plan.areaIntent}` : null,
    plan?.qualityIntent ? `quality intent: ${plan.qualityIntent}` : null,
    Array.isArray(plan?.areaTraits) && plan.areaTraits.length
      ? `area traits: ${plan.areaTraits.join(", ")}`
      : null,
    Array.isArray(plan?.placeTargets) && plan.placeTargets.length
      ? `place targets: ${plan.placeTargets
          .map((t) => t?.normalizedName || t?.rawText)
          .filter(Boolean)
          .join(", ")}`
      : null,
    Array.isArray(plan?.preferenceNotes) && plan.preferenceNotes.length
      ? `preference notes: ${plan.preferenceNotes.join(" | ")}`
      : null,
  ].filter(Boolean);

  return [
    {
      role: "system",
      content:
        "You write a short closing message for BookingGPT after hotel search results are shown to the user. " +
        "Return plain text only.\n\n" +
        "Rules:\n" +
        "- Write exactly 1 paragraph.\n" +
        "- Aim for 30 to 50 words.\n" +
        "- Explain briefly why these results match what the user asked, in natural human language.\n" +
        "- Sound like a live human assistant, not a system message.\n" +
        "- Do not list hotels by name.\n" +
        "- Do not say 'here are the results' or anything that implies the results are coming — they are already shown.\n" +
        "- Do not use bullets, headers, or multiple paragraphs.\n" +
        "- Do not invent facts about the hotels.\n" +
        "- Do not mention competitors, OTAs, or other booking platforms.\n" +
        "- Write only in the requested language.",
    },
    {
      role: "user",
      content: contextLines.join("\n"),
    },
  ];
};

const assessAssistantKickoffText = (
  text = "",
  {
    minChars = AI_ASSISTANT_KICKOFF_MIN_VISIBLE_CHARS,
    minWords = AI_ASSISTANT_KICKOFF_MIN_VISIBLE_WORDS,
  } = {},
) => {
  const normalized = normalizeAssistantKickoffText(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!normalized) return { ok: false, reason: "empty" };
  if (
    ASSISTANT_KICKOFF_BANNED_FRAGMENTS.some((fragment) =>
      normalized.includes(fragment),
    )
  ) {
    return { ok: false, reason: "banned_fragment" };
  }
  if (normalized.length < minChars) {
    return { ok: false, reason: "too_short" };
  }
  if (countAssistantKickoffWords(normalized) < minWords) {
    return { ok: false, reason: "too_few_words" };
  }
  return {
    ok: true,
    normalizedText: normalizeAssistantKickoffText(text),
  };
};

const shouldRunAssistantKickoffPlanner = (plan = {}) =>
  Boolean(
    plan?.location?.city ||
      plan?.location?.country ||
      (Array.isArray(plan?.placeTargets) && plan.placeTargets.length),
  );

const diffAssistantKickoffText = (previous = "", next = "") => {
  const prev = String(previous || "");
  const curr = String(next || "");
  let index = 0;
  const max = Math.min(prev.length, curr.length);
  while (index < max && prev[index] === curr[index]) index += 1;
  return curr.slice(index);
};

const extractAssistantKickoffMentionedZones = (text = "", allowedZoneLabels = []) => {
  const normalizedText = normalizeSemanticText(text);
  return uniqueSemanticStringList(allowedZoneLabels, 3).filter((zone) =>
    normalizedText.includes(normalizeSemanticText(zone)),
  );
};

const nextStreamChunkWithTimeout = async (iterator, ms, label) => {
  if (!Number.isFinite(ms) || ms <= 0) {
    const err = new Error(`${label} timed out after ${ms}ms`);
    err.code = "OPENAI_TIMEOUT";
    throw err;
  }
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.code = "OPENAI_TIMEOUT";
      reject(err);
    }, ms);
  });
  return Promise.race([iterator.next(), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

const createOpenAIStreamWithTimeout = async ({
  createStream,
  ms,
  label,
  abortController = null,
} = {}) => {
  if (typeof createStream !== "function") {
    const err = new Error(`${label} missing createStream`);
    err.code = "OPENAI_INVALID_CALL";
    throw err;
  }
  if (!Number.isFinite(ms) || ms <= 0) {
    const err = new Error(`${label} timed out after ${ms}ms`);
    err.code = "OPENAI_TIMEOUT";
    throw err;
  }
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        abortController?.abort?.();
      } catch (_) {}
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.code = "OPENAI_TIMEOUT";
      reject(err);
    }, ms);
  });
  return Promise.race([createStream(), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

const emitAssistantKickoffChunks = (text = "", onKickoffChunk = null) => {
  if (typeof onKickoffChunk !== "function") return;
  const normalizedText = normalizeAssistantKickoffText(text);
  if (!normalizedText) return;
  if (normalizedText.length <= 120) {
    const midpoint = normalizedText.lastIndexOf(" ", Math.floor(normalizedText.length / 2));
    if (midpoint > 24 && midpoint < normalizedText.length - 24) {
      onKickoffChunk(normalizedText.slice(0, midpoint + 1));
      onKickoffChunk(normalizedText.slice(midpoint + 1));
      return;
    }
  }
  const targetChunkCount = 3;
  const approxChunkSize = Math.ceil(normalizedText.length / targetChunkCount);
  let cursor = 0;
  while (cursor < normalizedText.length) {
    let end = Math.min(normalizedText.length, cursor + approxChunkSize);
    if (end < normalizedText.length) {
      const boundary = normalizedText.lastIndexOf(" ", end);
      if (boundary > cursor + 16) {
        end = boundary + 1;
      }
    }
    onKickoffChunk(normalizedText.slice(cursor, end));
    cursor = end;
  }
};

const buildAssistantKickoffFallbackResult = ({
  kickoffReference = null,
  allowedZoneLabels = [],
  destinationLabel = null,
  streamStartedAt = Date.now(),
  onKickoffChunk = null,
  isBlocked = null,
  emitTrace = null,
  emitFileDebug = null,
  reason = "fallback",
} = {}) => {
  const text = normalizeAssistantKickoffText(kickoffReference?.text || "");
  if (!text) return null;
  if (typeof isBlocked === "function" && isBlocked()) {
    return null;
  }
  const mentionedZones = extractAssistantKickoffMentionedZones(text, allowedZoneLabels);
  const elapsedMs = Date.now() - streamStartedAt;
  emitTrace?.("ASSISTANT_KICKOFF_STREAM_FALLBACK", {
    destination: destinationLabel,
    reason,
    elapsedMs,
  });
  emitTrace?.("ASSISTANT_KICKOFF_STREAM_ACCEPTED", {
    destination: destinationLabel,
    elapsedMs,
    chars: text.length,
    words: countAssistantKickoffWords(text),
    source: "reference",
  });
  emitTrace?.("ASSISTANT_KICKOFF_STREAM_BUFFER_FLUSHED", {
    destination: destinationLabel,
    chars: text.length,
    words: countAssistantKickoffWords(text),
    source: "reference",
  });
  emitAssistantKickoffChunks(text, onKickoffChunk);
  const result = {
    text,
    source: "reference",
    mentionedZones,
    confidence: kickoffReference?.confidence || null,
  };
  emitTrace?.("ASSISTANT_KICKOFF_STREAM_COMPLETED", {
    destination: destinationLabel,
    source: result.source,
    elapsedMs,
    mentionedZones: result.mentionedZones,
    confidence: result.confidence,
  });
  emitFileDebug?.("assistant_kickoff", {
    ...result,
    fallback: true,
    reason,
    reference: kickoffReference,
  });
  return result;
};

const streamAssistantKickoffMessage = async ({
  client,
  plan,
  language,
  latestUserMessage,
  onKickoffChunk = null,
  isBlocked = null,
  emitTrace = null,
  emitFileDebug = null,
} = {}) => {
  if (!shouldRunAssistantKickoffPlanner(plan)) return null;
  const kickoffReference = buildDeterministicAssistantKickoffReference({
    plan,
    language,
  });
  const allowedZoneLabels = Array.isArray(kickoffReference.mentionedZones)
    ? kickoffReference.mentionedZones
    : [];
  const destinationLabel =
    plan?.location?.city || plan?.location?.country || null;
  const streamStartedAt = Date.now();

  emitTrace?.("ASSISTANT_KICKOFF_STREAM_REQUESTED", {
    destination: destinationLabel,
    confidence: kickoffReference.confidence || null,
    allowedZones: allowedZoneLabels,
  });

  if (!client) {
    emitTrace?.("ASSISTANT_KICKOFF_STREAM_ABORTED_BLOCKED", {
      reason: "missing_client",
    });
    emitFileDebug?.("assistant_kickoff", {
      skipped: true,
      reason: "missing_client",
      reference: kickoffReference,
    });
    return null;
  }

  try {
    const kickoffMessages = buildAssistantKickoffMessages({
      latestUserMessage,
      plan,
      language,
    });
    const createController =
      typeof AbortController === "function" ? new AbortController() : null;
    const stream = await createOpenAIStreamWithTimeout({
      createStream: () =>
        client.chat.completions.create(
          {
            model: AI_MODEL_ASSISTANT_KICKOFF,
            stream: true,
            messages: kickoffMessages,
          },
          createController?.signal ? { signal: createController.signal } : undefined,
        ),
      ms: AI_ASSISTANT_KICKOFF_FIRST_TOKEN_TIMEOUT_MS,
      label: "assistantKickoffCreate",
      abortController: createController,
    });
    const iterator = stream[Symbol.asyncIterator]();
    let rawText = "";
    let acceptedText = "";
    let firstTokenLogged = false;
    let accepted = false;
    let abortedReason = null;

    try {
      while (true) {
        if (typeof isBlocked === "function" && isBlocked()) {
          abortedReason = "blocked";
          break;
        }
        const elapsedMs = Date.now() - streamStartedAt;
        const remainingFirstTokenMs = AI_ASSISTANT_KICKOFF_FIRST_TOKEN_TIMEOUT_MS - elapsedMs;
        const remainingTotalMs = AI_ASSISTANT_KICKOFF_STREAM_TIMEOUT_MS - elapsedMs;
        const nextTimeoutMs = accepted
          ? remainingTotalMs
          : Math.min(remainingFirstTokenMs, remainingTotalMs);

        let nextChunk;
        try {
          nextChunk = await nextStreamChunkWithTimeout(
            iterator,
            nextTimeoutMs,
            "assistantKickoffStream",
          );
        } catch (err) {
          if (err?.code === "OPENAI_TIMEOUT") {
            abortedReason = "timeout";
            break;
          }
          throw err;
        }

        if (nextChunk?.done) break;

        const delta = nextChunk?.value?.choices?.[0]?.delta;
        const content = typeof delta?.content === "string" ? delta.content : "";
        if (!content) continue;

        rawText += content;
        const normalizedText = normalizeAssistantKickoffText(rawText);
        if (!normalizedText) continue;

        if (!firstTokenLogged) {
          firstTokenLogged = true;
          emitTrace?.("ASSISTANT_KICKOFF_STREAM_FIRST_TOKEN", {
            destination: destinationLabel,
            elapsedMs: Date.now() - streamStartedAt,
          });
        }

        const quality = assessAssistantKickoffText(normalizedText);
        if (!accepted) {
          if (!quality.ok) {
            if (quality.reason === "banned_fragment") {
              abortedReason = "generic";
              emitFileDebug?.("assistant_kickoff", {
                skipped: true,
                reason: quality.reason,
                bufferedText: normalizedText,
                reference: kickoffReference,
              });
              break;
            }
            continue;
          }

          if (typeof isBlocked === "function" && isBlocked()) {
            abortedReason = "blocked";
            break;
          }

          accepted = true;
          acceptedText = quality.normalizedText;
          emitTrace?.("ASSISTANT_KICKOFF_STREAM_ACCEPTED", {
            destination: destinationLabel,
            elapsedMs: Date.now() - streamStartedAt,
            chars: acceptedText.length,
            words: countAssistantKickoffWords(acceptedText),
          });
          emitTrace?.("ASSISTANT_KICKOFF_STREAM_BUFFER_FLUSHED", {
            destination: destinationLabel,
            chars: acceptedText.length,
            words: countAssistantKickoffWords(acceptedText),
          });
          onKickoffChunk?.(acceptedText);
          continue;
        }

        if (!quality.ok && quality.reason === "banned_fragment") {
          abortedReason = "generic";
          emitFileDebug?.("assistant_kickoff", {
            skipped: true,
            reason: quality.reason,
            bufferedText: normalizedText,
            reference: kickoffReference,
          });
          break;
        }

        const nextAcceptedText = normalizeAssistantKickoffText(rawText);
        const deltaText = diffAssistantKickoffText(acceptedText, nextAcceptedText);
        acceptedText = nextAcceptedText;
        if (deltaText) {
          onKickoffChunk?.(deltaText);
        }
      }
    } finally {
      try {
        await iterator.return?.();
      } catch (_) {}
    }

    if (abortedReason === "blocked") {
      emitTrace?.("ASSISTANT_KICKOFF_STREAM_ABORTED_BLOCKED", {
        destination: destinationLabel,
      });
      emitFileDebug?.("assistant_kickoff", {
        skipped: true,
        reason: "blocked",
        reference: kickoffReference,
        rawText: acceptedText || normalizeAssistantKickoffText(rawText) || null,
      });
      return null;
    }

    if (!accepted) {
      const fallbackText = normalizeAssistantKickoffText(rawText);
      const fallbackQuality = assessAssistantKickoffText(fallbackText);
      if (abortedReason === "timeout") {
        const fallbackResult = buildAssistantKickoffFallbackResult({
          kickoffReference,
          allowedZoneLabels,
          destinationLabel,
          streamStartedAt,
          onKickoffChunk,
          isBlocked,
          emitTrace,
          emitFileDebug,
          reason: "OPENAI_TIMEOUT",
        });
        if (fallbackResult?.text) {
          return fallbackResult;
        }
        emitTrace?.("ASSISTANT_KICKOFF_STREAM_ABORTED_TIMEOUT", {
          destination: destinationLabel,
          reason: "OPENAI_TIMEOUT",
        });
      } else {
        emitTrace?.("ASSISTANT_KICKOFF_STREAM_ABORTED_GENERIC", {
          destination: destinationLabel,
          reason: fallbackQuality?.reason || "invalid_payload",
        });
      }
      emitFileDebug?.("assistant_kickoff", {
        skipped: true,
        reason:
          abortedReason === "timeout"
            ? "OPENAI_TIMEOUT"
            : fallbackQuality?.reason || "invalid_payload",
        reference: kickoffReference,
        rawText: fallbackText || null,
      });
      return null;
    }

    const finalText = normalizeAssistantKickoffText(acceptedText || rawText);
    const result = {
      text: finalText,
      source: abortedReason === "timeout" ? "model_partial" : "model",
      mentionedZones: extractAssistantKickoffMentionedZones(finalText, allowedZoneLabels),
      confidence: kickoffReference.confidence || null,
    };
    emitTrace?.("ASSISTANT_KICKOFF_STREAM_COMPLETED", {
      destination: destinationLabel,
      source: result.source,
      elapsedMs: Date.now() - streamStartedAt,
      mentionedZones: result.mentionedZones,
      confidence: result.confidence,
    });
    emitFileDebug?.("assistant_kickoff", result);
    return result;
  } catch (err) {
    const reason =
      err?.code ||
      err?.error?.code ||
      err?.param ||
      err?.error?.param ||
      err?.message ||
      "planner_failed";
    const traceCode =
      reason === "OPENAI_TIMEOUT"
        ? "ASSISTANT_KICKOFF_STREAM_ABORTED_TIMEOUT"
        : "ASSISTANT_KICKOFF_STREAM_ABORTED_GENERIC";
    const fallbackResult = buildAssistantKickoffFallbackResult({
      kickoffReference,
      allowedZoneLabels,
      destinationLabel,
      streamStartedAt,
      onKickoffChunk,
      isBlocked,
      emitTrace,
      emitFileDebug,
      reason,
    });
    if (fallbackResult?.text) {
      return fallbackResult;
    }
    emitTrace?.(traceCode, {
      destination: destinationLabel,
      reason,
    });
    emitFileDebug?.("assistant_kickoff", {
      skipped: true,
      reference: kickoffReference,
      reason,
    });
    return null;
  }
};

const streamAssistantClosingMessage = async ({
  client,
  plan,
  inventory,
  language,
  latestUserMessage,
  onClosingChunk = null,
  emitTrace = null,
  emitFileDebug = null,
} = {}) => {
  const totalHotels = inventory?.hotels?.length || 0;
  if (!client || totalHotels === 0) return null;

  const destination =
    plan?.location?.city || plan?.location?.country || null;
  const streamStartedAt = Date.now();

  emitTrace?.("ASSISTANT_CLOSING_STREAM_REQUESTED", {
    destination,
    totalHotels,
  });

  try {
    const closingMessages = buildAssistantClosingMessages({
      plan,
      inventory,
      language,
      latestUserMessage,
    });

    const stream = await client.chat.completions.create(
      {
        model: AI_MODEL_ASSISTANT_CLOSING,
        stream: true,
        messages: closingMessages,
      },
    );

    const iterator = stream[Symbol.asyncIterator]();
    let rawText = "";
    let accepted = false;
    let acceptedText = "";

    try {
      while (true) {
        const elapsedMs = Date.now() - streamStartedAt;
        const remainingMs = AI_ASSISTANT_CLOSING_TIMEOUT_MS - elapsedMs;

        let nextChunk;
        try {
          nextChunk = await nextStreamChunkWithTimeout(
            iterator,
            remainingMs,
            "assistantClosingStream",
          );
        } catch (err) {
          if (err?.code === "OPENAI_TIMEOUT") break;
          throw err;
        }

        if (nextChunk?.done) break;

        const delta = nextChunk?.value?.choices?.[0]?.delta;
        const content =
          typeof delta?.content === "string" ? delta.content : "";
        if (!content) continue;

        rawText += content;
        const normalizedText = normalizeAssistantKickoffText(rawText);
        if (!normalizedText) continue;

        if (!accepted) {
          const chars = normalizedText.length;
          const words = countAssistantKickoffWords(normalizedText);
          if (
            chars >= AI_ASSISTANT_CLOSING_MIN_VISIBLE_CHARS &&
            words >= AI_ASSISTANT_CLOSING_MIN_VISIBLE_WORDS
          ) {
            accepted = true;
            acceptedText = normalizedText;
            emitTrace?.("ASSISTANT_CLOSING_STREAM_ACCEPTED", {
              destination,
              elapsedMs: Date.now() - streamStartedAt,
              chars,
              words,
            });
            onClosingChunk?.(acceptedText);
            continue;
          }
          continue;
        }

        const nextAcceptedText = normalizeAssistantKickoffText(rawText);
        const deltaText = diffAssistantKickoffText(
          acceptedText,
          nextAcceptedText,
        );
        acceptedText = nextAcceptedText;
        if (deltaText) {
          onClosingChunk?.(deltaText);
        }
      }
    } finally {
      try {
        await iterator.return?.();
      } catch (_) {}
    }

    if (!accepted) {
      emitTrace?.("ASSISTANT_CLOSING_STREAM_ABORTED", {
        destination,
        reason: "threshold_not_met",
        elapsedMs: Date.now() - streamStartedAt,
      });
      emitFileDebug?.("assistant_closing", {
        skipped: true,
        reason: "threshold_not_met",
        rawText: normalizeAssistantKickoffText(rawText) || null,
      });
      return null;
    }

    const finalText = normalizeAssistantKickoffText(acceptedText || rawText);
    const result = {
      text: finalText,
      source: "model",
    };
    emitTrace?.("ASSISTANT_CLOSING_STREAM_COMPLETED", {
      destination,
      elapsedMs: Date.now() - streamStartedAt,
      chars: finalText.length,
      words: countAssistantKickoffWords(finalText),
    });
    emitFileDebug?.("assistant_closing", result);
    return result;
  } catch (err) {
    emitTrace?.("ASSISTANT_CLOSING_STREAM_FAILED", {
      destination,
      reason: err?.code || err?.message || "unknown",
    });
    emitFileDebug?.("assistant_closing", {
      skipped: true,
      reason: err?.code || err?.message || "unknown",
    });
    return null;
  }
};

const createAssistantKickoffEventGate = ({
  emitEvent = null,
  emitTrace = null,
  emitFileDebug = null,
} = {}) => {
  const buffer = [];
  let released = false;
  let releaseReason = null;

  const flush = () => {
    if (typeof emitEvent !== "function" || !buffer.length) return;
    emitFileDebug?.("assistant_kickoff", {
      bufferedEvents: buffer.length,
      releaseReason: releaseReason || null,
      bufferFlushed: true,
    });
    buffer.splice(0).forEach((entry) => emitEvent(entry.type, entry.data));
  };

  const release = (reason = "released") => {
    if (released) return;
    released = true;
    releaseReason = reason;
    flush();
  };

  return {
    emit(type, data = {}) {
      if (typeof emitEvent !== "function" || !type) return;
      if (released) {
        emitEvent(type, data);
        return;
      }
      buffer.push({ type, data });
    },
    canEmitKickoff() {
      return !released;
    },
    markKickoffEmitted(payload = {}) {
      emitFileDebug?.("assistant_kickoff", {
        emitted: true,
        ...payload,
      });
      release("kickoff_completed");
    },
    markLateKickoff(payload = {}) {
      emitTrace?.("ASSISTANT_KICKOFF_DROPPED_LATE", {
        releaseReason,
        ...payload,
      });
      emitFileDebug?.("assistant_kickoff", {
        dropped: true,
        reason: "late",
        releaseReason,
        ...payload,
      });
    },
    disable(reason = "disabled") {
      release(reason);
    },
    finalize(reason = "finalized") {
      release(reason);
    },
    getReleaseReason() {
      return releaseReason;
    },
  };
};

const shouldRunSemanticExplanationPlanner = ({ plan = {}, inventory = null } = {}) => {
  const hotels = Array.isArray(inventory?.hotels) ? inventory.hotels : [];
  if (hotels.length < 2) return false;
  if (!hasSemanticPlannerIntent(plan)) return false;
  return true;
};

const planSemanticTopPickExplanations = async ({
  client,
  plan,
  inventory,
  language,
  latestUserMessage,
  emitTrace = null,
  emitFileDebug = null,
} = {}) => {
  if (
    !client ||
    !shouldRunSemanticExplanationPlanner({ plan, inventory })
  ) {
    return null;
  }

  const picks = getTopInventoryPicksByCategory(inventory, plan, language, 0).slice(0, 5);
  if (picks.length < 2) return null;

  const fallbackPlan = buildDeterministicSemanticExplanationPlan({
    inventory,
    plan,
    language,
    seed: 0,
  });
  const preparedPayload = picks
    .map((entry) => buildSemanticPlannerHotelPayload(entry))
    .filter(Boolean);
  emitTrace?.("SEMANTIC_TOP_PICKS_PREPARED", {
    hotelIds: preparedPayload.map((entry) => entry.hotelId),
    angles: preparedPayload.map((entry) => ({
      hotelId: entry.hotelId,
      allowedAngles: entry.allowedAngles,
      zoneLabel: entry.zoneLabel || null,
    })),
  });
  emitFileDebug?.("semantic_top_picks_prepared", {
    hotelIds: preparedPayload.map((entry) => entry.hotelId),
    hotels: preparedPayload,
  });
  emitTrace?.("SEMANTIC_EXPLANATION_PLANNER_REQUESTED", {
    model: AI_MODEL_SEMANTIC_EXPLANATION,
    timeoutMs: AI_SEMANTIC_EXPLANATION_TIMEOUT_MS,
    hotelCount: preparedPayload.length,
  });

  try {
    const completion = await withSemanticTimeout(
      client.chat.completions.create({
        model: AI_MODEL_SEMANTIC_EXPLANATION,
        response_format: { type: "json_object" },
        messages: buildSemanticExplanationPlannerMessages({
          latestUserMessage,
          plan,
          language,
          picks,
        }),
      }),
      AI_SEMANTIC_EXPLANATION_TIMEOUT_MS,
      "semanticExplanationPlanner",
    );
    const payload = completion?.choices?.[0]?.message?.content;
    const parsed = payload ? JSON.parse(payload) : null;
    const merged = mergeSemanticExplanationPlanWithFallback({
      candidatePlan: parsed,
      fallbackPlan,
      picks,
      language,
    });
    const finalPlan = merged.plan;
    if (!finalPlan) return null;

    emitFileDebug?.("semantic_explanation_plan", {
      source: finalPlan.source || null,
      fallbackUsed: finalPlan.fallbackUsed === true,
      intro: finalPlan.intro || null,
      items: Array.isArray(finalPlan.items)
        ? finalPlan.items.map((item) => ({
            hotelId: item.hotelId,
            angle: item.angle || null,
            sentence: item.sentence || null,
          }))
        : [],
    });

    if (merged.discardedModel) {
      emitTrace?.("SEMANTIC_EXPLANATION_PLANNER_FALLBACK", {
        reason: "validation_failed",
        replacedItems: merged.usedFallbackCount,
      });
    } else {
      emitTrace?.("SEMANTIC_EXPLANATION_PLANNER_APPLIED", {
        source: finalPlan.source || "model",
        fallbackUsed: finalPlan.fallbackUsed === true,
        replacedItems: merged.usedFallbackCount,
      });
    }
    return finalPlan;
  } catch (err) {
    emitTrace?.("SEMANTIC_EXPLANATION_PLANNER_FALLBACK", {
      reason: err?.code || err?.message || "planner_failed",
    });
    emitFileDebug?.("semantic_explanation_plan", {
      source: "deterministic",
      fallbackUsed: true,
      reason: err?.code || err?.message || "planner_failed",
      intro: fallbackPlan?.intro || null,
      items: Array.isArray(fallbackPlan?.items) ? fallbackPlan.items : [],
    });
    return fallbackPlan;
  }
};

const projectPrimarySemanticPlaceTargetToLocation = (plan) => {
  if (!plan || typeof plan !== "object") return;
  const primaryTarget = Array.isArray(plan.placeTargets) ? plan.placeTargets[0] : null;
  if (!primaryTarget) return;
  if (!plan.location || typeof plan.location !== "object") {
    plan.location = {};
  }
  if (!plan.preferences || typeof plan.preferences !== "object") {
    plan.preferences = {};
  }
  if (!plan.location.area) {
    plan.location.area = primaryTarget.normalizedName || primaryTarget.rawText;
  }
  if (!plan.location.city && primaryTarget.city) {
    plan.location.city = primaryTarget.city;
  }
  if (!plan.location.country && primaryTarget.country) {
    plan.location.country = primaryTarget.country;
  }
  if (
    primaryTarget.type === "LANDMARK" ||
    primaryTarget.type === "AIRPORT" ||
    primaryTarget.type === "STATION" ||
    primaryTarget.type === "PORT" ||
    primaryTarget.type === "VENUE"
  ) {
    plan.location.landmark = primaryTarget.normalizedName || primaryTarget.rawText;
  }
  if (
    primaryTarget.lat != null &&
    primaryTarget.lng != null &&
    (plan.location.lat == null || plan.location.lng == null)
  ) {
    plan.location.lat = primaryTarget.lat;
    plan.location.lng = primaryTarget.lng;
    plan.location.radiusKm = Math.max(
      0.5,
      Math.min(10, Number(primaryTarget.radiusMeters || 2500) / 1000),
    );
    plan.location.resolvedPoi = {
      name: primaryTarget.normalizedName || primaryTarget.rawText,
      lat: primaryTarget.lat,
      lng: primaryTarget.lng,
      type: primaryTarget.type || null,
    };
  }
  if (
    plan.geoIntent === "NEAR_LANDMARK" &&
    !plan.preferences.nearbyInterest
  ) {
    plan.preferences.nearbyInterest =
      primaryTarget.normalizedName || primaryTarget.rawText;
  }
};

const mergeSemanticEnrichmentIntoPlan = (
  plan,
  enrichment = {},
  { latestUserMessage = "" } = {},
) => {
  if (!plan || typeof plan !== "object") return plan;
  const semanticState = ensureSemanticSearchState(plan);
  const mergedStarRatings = normalizeSemanticStarRatings([
    ...(Array.isArray(plan.starRatings) ? plan.starRatings : []),
    ...(Array.isArray(enrichment.starRatings) ? enrichment.starRatings : []),
  ]);
  if (mergedStarRatings.length) {
    plan.starRatings = mergedStarRatings;
    if (!plan.hotelFilters || typeof plan.hotelFilters !== "object") {
      plan.hotelFilters = {};
    }
    plan.hotelFilters.starRatings = mergedStarRatings;
    plan.hotelFilters.minRating = null;
  }
  if (!plan.viewIntent && enrichment.viewIntent) plan.viewIntent = enrichment.viewIntent;
  if (!plan.geoIntent && enrichment.geoIntent) plan.geoIntent = enrichment.geoIntent;
  const mergedPlaceTargets = uniqueSemanticPlaceTargets([
    ...(Array.isArray(plan.placeTargets) ? plan.placeTargets : []),
    ...(Array.isArray(enrichment.placeTargets) ? enrichment.placeTargets : []),
  ]);
  if (mergedPlaceTargets.length) {
    plan.placeTargets = mergedPlaceTargets;
  }
  if (!plan.areaIntent && enrichment.areaIntent) plan.areaIntent = enrichment.areaIntent;
  if (!plan.qualityIntent && enrichment.qualityIntent) {
    plan.qualityIntent = enrichment.qualityIntent;
  }
  const mergedAreaTraits = normalizeSemanticAreaTraits([
    ...(Array.isArray(plan.areaTraits) ? plan.areaTraits : []),
    ...(Array.isArray(enrichment.areaTraits) ? enrichment.areaTraits : []),
  ]);
  if (mergedAreaTraits.length) {
    plan.areaTraits = mergedAreaTraits;
  }
  const mergedPreferenceNotes = uniqueSemanticStringList([
    ...(Array.isArray(plan.preferenceNotes) ? plan.preferenceNotes : []),
    ...(Array.isArray(enrichment.preferenceNotes)
      ? enrichment.preferenceNotes
      : []),
  ]);
  if (mergedPreferenceNotes.length) {
    plan.preferenceNotes = mergedPreferenceNotes;
    if (!plan.preferences || typeof plan.preferences !== "object") {
      plan.preferences = {};
    }
    plan.preferences.preferenceNotes = mergedPreferenceNotes;
  }
  if (!plan.areaIntent && Array.isArray(plan.areaTraits)) {
    if (plan.areaTraits.includes("GOOD_AREA")) {
      plan.areaIntent = "GOOD_AREA";
    } else if (plan.areaTraits.includes("QUIET")) {
      plan.areaIntent = "QUIET";
    } else if (plan.areaTraits.includes("NIGHTLIFE")) {
      plan.areaIntent = "NIGHTLIFE";
    }
  }
  if (!plan.qualityIntent && Array.isArray(plan.areaTraits) && plan.areaTraits.includes("LUXURY")) {
    plan.qualityIntent = "LUXURY";
  }
  if (
    Array.isArray(plan.areaTraits) &&
    plan.areaTraits.includes("FAMILY") &&
    !mergedPreferenceNotes.includes("family-friendly")
  ) {
    plan.preferenceNotes = uniqueSemanticStringList([
      ...mergedPreferenceNotes,
      "family-friendly",
    ]);
    plan.preferences.preferenceNotes = plan.preferenceNotes;
  }

  if (
    plan.areaIntent === "CITY_CENTER" ||
    enrichment.areaIntent === "CITY_CENTER"
  ) {
    if (!plan.preferences || typeof plan.preferences !== "object") {
      plan.preferences = {};
    }
    const current = Array.isArray(plan.preferences.areaPreference)
      ? plan.preferences.areaPreference
      : [];
    if (!current.includes("CITY_CENTER")) {
      plan.preferences.areaPreference = [...current, "CITY_CENTER"];
    }
  }
  if (
    plan.areaIntent === "BEACH_COAST" ||
    enrichment.areaIntent === "BEACH_COAST"
  ) {
    if (!plan.preferences || typeof plan.preferences !== "object") {
      plan.preferences = {};
    }
    const current = Array.isArray(plan.preferences.areaPreference)
      ? plan.preferences.areaPreference
      : [];
    if (!current.includes("BEACH_COAST")) {
      plan.preferences.areaPreference = [...current, "BEACH_COAST"];
    }
  }
  if (
    !plan.sortBy &&
    !plan?.budget?.max &&
    (plan.qualityIntent === "BUDGET" || enrichment.qualityIntent === "BUDGET")
  ) {
    plan.sortBy = "PRICE_ASC";
  }

  semanticState.enrichmentRan = true;
  semanticState.modelCandidateGenerationUsed = Boolean(
    (Array.isArray(enrichment.candidateHotelNames) &&
      enrichment.candidateHotelNames.length) ||
      (Array.isArray(enrichment.neighborhoodHints) &&
        enrichment.neighborhoodHints.length),
  );
  semanticState.candidateHotelNames = uniqueSemanticStringList(
    [...semanticState.candidateHotelNames, ...(enrichment.candidateHotelNames || [])],
    8,
  );
  semanticState.neighborhoodHints = uniqueSemanticStringList(
    [...semanticState.neighborhoodHints, ...(enrichment.neighborhoodHints || [])],
    8,
  );
  projectPrimarySemanticPlaceTargetToLocation(plan);
  refreshSemanticIntentProfile(plan, latestUserMessage);
  return plan;
};

const buildSemanticGroundingPlannerMessages = ({
  latestUserMessage,
  plan,
  language,
}) => {
  const currentPlan = {
    destination: {
      city: plan?.location?.city || null,
      country: plan?.location?.country || null,
    },
    geoIntent: plan?.geoIntent || null,
    placeTargets: Array.isArray(plan?.placeTargets)
      ? plan.placeTargets.map((target) => ({
          rawText: target?.rawText || null,
          normalizedName: target?.normalizedName || null,
          type: target?.type || null,
          city: target?.city || null,
          country: target?.country || null,
        }))
      : [],
    viewIntent: plan?.viewIntent || null,
    areaIntent: plan?.areaIntent || null,
    qualityIntent: plan?.qualityIntent || null,
    areaTraits: Array.isArray(plan?.areaTraits) ? plan.areaTraits : [],
    nearbyInterest: plan?.preferences?.nearbyInterest || null,
    preferenceNotes: Array.isArray(plan?.preferenceNotes)
      ? plan.preferenceNotes
      : [],
    language,
  };

  return [
    {
      role: "system",
      content:
        "You plan semantic grounding for BookingGPT hotel search. " +
        "Your job is to interpret what the user means and choose the best grounding strategy before hotel ranking runs. " +
        "Never invent hotels. Candidate hotel names are only optional hints for matching against our local database. " +
        "Return JSON only.\n\n" +
        "Definitions:\n" +
        "- semanticMode can be EXPLICIT_GEO, VIEW_PROFILE, AREA_PROFILE, LIFESTYLE_PROXIMITY, or HYBRID.\n" +
        "- groundingStrategy can be PLACES, PLACES_THEN_WEB, WEB_SEARCH, POI_SEARCH, or RANK_ONLY.\n" +
        "- Use PLACES for explicit named geography or generic transport hubs that should be resolved structurally.\n" +
        "- Use PLACES_THEN_WEB when a place should first try structured place resolution and may need web fallback.\n" +
        "- Use WEB_SEARCH for soft requests like best areas for river view, nightlife, walkability, safety, or cultural profile.\n" +
        "- Use POI_SEARCH for proximity to categories of places such as vegan restaurants, cafes, bars, nightlife, shopping, or attractions.\n" +
        "- Use RANK_ONLY when the current structured search signals are already enough and no extra grounding is required.\n" +
        "- Do not force abstract wishes into placeTargets unless the user explicitly named a place.\n" +
        "- candidateZones should contain neighborhood or area names only.\n" +
        "- candidateAnchors should contain real geographic anchors only when they help grounding.\n" +
        "- lifestylePreferences should only be used for category proximity, not explicit geography.\n" +
        "- nearbyInterest should be a concise POI keyword only when POI_SEARCH is the right strategy.\n\n" +
        'Respond with this schema: {"semanticMode": string|null, "groundingStrategy": string|null, "confidence": string|null, "shouldAskClarification": boolean, "clarificationReason": string|null, "viewIntent": string|null, "geoIntent": string|null, "placeTargets": [{"rawText": string, "normalizedName": string|null, "type": string|null, "city": string|null, "country": string|null, "aliases": string[], "lat": number|null, "lng": number|null, "radiusMeters": number|null, "confidence": number|null}], "areaIntent": string|null, "qualityIntent": string|null, "areaTraits": string[], "preferenceNotes": string[], "candidateHotelNames": string[], "neighborhoodHints": string[], "candidateZones": string[], "candidateAnchors": [{"rawText": string, "normalizedName": string|null, "type": string|null, "city": string|null, "country": string|null, "aliases": string[], "lat": number|null, "lng": number|null, "radiusMeters": number|null, "confidence": number|null}], "lifestylePreferences": [{"category": string, "keyword": string|null, "proximityMode": string|null}], "nearbyInterest": string|null, "traceSummary": string|null}.',
    },
    {
      role: "user",
      content:
        `Latest user message:\n${latestUserMessage || ""}\n\n` +
        `Current structured plan:\n${JSON.stringify(currentPlan, null, 2)}`,
    },
  ];
};

const runSemanticGroundingPlanner = async ({
  client,
  latestUserMessage,
  plan,
  language,
  emitTrace = null,
}) => {
  if (!client || !latestUserMessage || !plan) return null;
  emitTrace?.("SEMANTIC_GROUNDING_PLANNER_REQUESTED", {
    destination: plan?.location?.city || null,
    viewIntent: plan?.viewIntent || null,
    areaIntent: plan?.areaIntent || null,
    qualityIntent: plan?.qualityIntent || null,
  });
  try {
    const completion = await withSemanticTimeout(
      client.chat.completions.create({
        model: SEMANTIC_SEARCH_MODEL,
        response_format: { type: "json_object" },
        messages: buildSemanticGroundingPlannerMessages({
          latestUserMessage,
          plan,
          language,
        }),
      }),
      SEMANTIC_SEARCH_TIMEOUT_MS,
      "semanticGroundingPlanner",
    );
    const payload = completion?.choices?.[0]?.message?.content;
    if (!payload) return null;
    const parsed = JSON.parse(payload);
    const normalized = normalizeSemanticGroundingResult(parsed);
    if (!normalized?.groundingStrategy) return null;
    emitTrace?.("SEMANTIC_GROUNDING_PLANNER_APPLIED", {
      semanticMode: normalized.semanticMode || null,
      groundingStrategy: normalized.groundingStrategy || null,
      confidence: normalized.confidence || null,
      candidateZoneCount: normalized.candidateZones.length,
      candidateAnchorCount: normalized.candidateAnchors.length,
      lifestylePreferenceCount: normalized.lifestylePreferences.length,
    });
    return normalized;
  } catch (err) {
    emitTrace?.("SEMANTIC_GROUNDING_PLANNER_FAILED", {
      reason: err?.code || err?.message || "planner_failed",
    });
    return null;
  }
};

const mergeSemanticGroundingPlanIntoPlan = (
  plan,
  grounding = {},
  { latestUserMessage = "" } = {},
) => {
  if (!plan || typeof plan !== "object" || !grounding || typeof grounding !== "object") {
    return plan;
  }

  mergeSemanticEnrichmentIntoPlan(plan, grounding, { latestUserMessage });
  const semanticState = ensureSemanticSearchState(plan);
  const candidateZones = uniqueSemanticStringList([
    ...(grounding.candidateZones || []),
    ...(grounding.neighborhoodHints || []),
  ], 8);
  const candidateAnchors = uniqueSemanticPlaceTargets(
    grounding.candidateAnchors,
    6,
  );
  const lifestylePreferences = Array.from(
    new Map(
      (Array.isArray(grounding.lifestylePreferences)
        ? grounding.lifestylePreferences
        : []
      ).map((entry) => [
        `${entry.category}|${entry.keyword || ""}|${entry.proximityMode}`,
        entry,
      ]),
    ).values(),
  ).slice(0, 6);
  const nearbyInterest = buildGroundingNearbyInterest({
    ...grounding,
    lifestylePreferences,
  });

  semanticState.grounding = {
    source: "planner",
    semanticMode: grounding.semanticMode || null,
    groundingStrategy: grounding.groundingStrategy || null,
    confidence: grounding.confidence || null,
    shouldAskClarification: grounding.shouldAskClarification === true,
    clarificationReason: grounding.clarificationReason || null,
    candidateZones,
    candidateAnchors,
    lifestylePreferences,
    nearbyInterest: nearbyInterest || null,
    traceSummary: grounding.traceSummary || null,
  };
  if (candidateZones.length) {
    semanticState.neighborhoodHints = uniqueSemanticStringList(
      [...semanticState.neighborhoodHints, ...candidateZones],
      8,
    );
  }
  if (Array.isArray(grounding.candidateHotelNames) && grounding.candidateHotelNames.length) {
    semanticState.candidateHotelNames = uniqueSemanticStringList(
      [...semanticState.candidateHotelNames, ...grounding.candidateHotelNames],
      8,
    );
  }
  if (
    (grounding.groundingStrategy === "PLACES" ||
      grounding.groundingStrategy === "PLACES_THEN_WEB" ||
      grounding.semanticMode === "EXPLICIT_GEO") &&
    candidateAnchors.length
  ) {
    plan.placeTargets = uniqueSemanticPlaceTargets(
      [...candidateAnchors, ...(Array.isArray(plan.placeTargets) ? plan.placeTargets : [])],
      6,
    );
  }
  if (nearbyInterest) {
    if (!plan.preferences || typeof plan.preferences !== "object") {
      plan.preferences = {};
    }
    if (!plan.preferences.nearbyInterest) {
      plan.preferences.nearbyInterest = nearbyInterest;
    }
  }
  refreshSemanticIntentProfile(plan, latestUserMessage);
  return plan;
};

const shouldRunExplicitPlaceResolutionForPlan = (plan = {}) => {
  const grounding = plan?.semanticSearch?.grounding;
  if (!grounding || typeof grounding !== "object" || !grounding.groundingStrategy) {
    return Boolean(
      plan?.geoIntent ||
        (Array.isArray(plan?.placeTargets) && plan.placeTargets.length > 0),
    );
  }
  return (
    grounding.groundingStrategy === "PLACES" ||
    grounding.groundingStrategy === "PLACES_THEN_WEB" ||
    grounding.semanticMode === "EXPLICIT_GEO"
  );
};

const shouldRunSemanticWebResolverForPlan = ({
  latestUserMessage = "",
  plan = {},
} = {}) => {
  const grounding = plan?.semanticSearch?.grounding;
  if (!grounding || typeof grounding !== "object" || !grounding.groundingStrategy) {
    return shouldRunSemanticWebResolver(latestUserMessage, plan);
  }
  return (
    grounding.groundingStrategy === "WEB_SEARCH" ||
    grounding.groundingStrategy === "PLACES_THEN_WEB"
  );
};

const applyDeterministicSemanticHintsToPlan = (
  plan,
  latestUserMessage = "",
) => {
  if (!plan || typeof plan !== "object") return plan;
  const hints = buildDeterministicSemanticHints(latestUserMessage, plan);
  ensureSemanticSearchState(plan);
  const mergedStarRatings = normalizeSemanticStarRatings([
    ...(Array.isArray(plan.starRatings) ? plan.starRatings : []),
    ...(Array.isArray(hints.starRatings) ? hints.starRatings : []),
  ]);
  if (mergedStarRatings.length) {
    plan.starRatings = mergedStarRatings;
    if (!plan.hotelFilters || typeof plan.hotelFilters !== "object") {
      plan.hotelFilters = {};
    }
    plan.hotelFilters.starRatings = mergedStarRatings;
    plan.hotelFilters.minRating = null;
  }
  if (!plan.viewIntent && hints.viewIntent) plan.viewIntent = hints.viewIntent;
  if (!plan.geoIntent && hints.geoIntent) plan.geoIntent = hints.geoIntent;
  const mergedPlaceTargets = uniqueSemanticPlaceTargets([
    ...(Array.isArray(plan.placeTargets) ? plan.placeTargets : []),
    ...(Array.isArray(hints.placeTargets) ? hints.placeTargets : []),
  ]);
  if (mergedPlaceTargets.length) {
    plan.placeTargets = mergedPlaceTargets;
  }
  if (!plan.areaIntent && hints.areaIntent) plan.areaIntent = hints.areaIntent;
  if (!plan.qualityIntent && hints.qualityIntent) {
    plan.qualityIntent = hints.qualityIntent;
  }
  const mergedAreaTraits = normalizeSemanticAreaTraits([
    ...(Array.isArray(plan.areaTraits) ? plan.areaTraits : []),
    ...(Array.isArray(hints.areaTraits) ? hints.areaTraits : []),
  ]);
  if (mergedAreaTraits.length) {
    plan.areaTraits = mergedAreaTraits;
  }
  const mergedPreferenceNotes = uniqueSemanticStringList([
    ...(Array.isArray(plan.preferenceNotes) ? plan.preferenceNotes : []),
    ...(Array.isArray(hints.preferenceNotes) ? hints.preferenceNotes : []),
  ]);
  if (mergedPreferenceNotes.length) {
    plan.preferenceNotes = mergedPreferenceNotes;
    if (!plan.preferences || typeof plan.preferences !== "object") {
      plan.preferences = {};
    }
    plan.preferences.preferenceNotes = mergedPreferenceNotes;
  }
  if (!plan.areaIntent && Array.isArray(plan.areaTraits)) {
    if (plan.areaTraits.includes("GOOD_AREA")) {
      plan.areaIntent = "GOOD_AREA";
    } else if (plan.areaTraits.includes("QUIET")) {
      plan.areaIntent = "QUIET";
    } else if (plan.areaTraits.includes("NIGHTLIFE")) {
      plan.areaIntent = "NIGHTLIFE";
    }
  }
  if (!plan.qualityIntent && Array.isArray(plan.areaTraits) && plan.areaTraits.includes("LUXURY")) {
    plan.qualityIntent = "LUXURY";
  }
  if (plan.areaIntent === "CITY_CENTER") {
    if (!plan.preferences || typeof plan.preferences !== "object") {
      plan.preferences = {};
    }
    const current = Array.isArray(plan.preferences.areaPreference)
      ? plan.preferences.areaPreference
      : [];
    if (!current.includes("CITY_CENTER")) {
      plan.preferences.areaPreference = [...current, "CITY_CENTER"];
    }
  }
  if (plan.areaIntent === "BEACH_COAST") {
    if (!plan.preferences || typeof plan.preferences !== "object") {
      plan.preferences = {};
    }
    const current = Array.isArray(plan.preferences.areaPreference)
      ? plan.preferences.areaPreference
      : [];
    if (!current.includes("BEACH_COAST")) {
      plan.preferences.areaPreference = [...current, "BEACH_COAST"];
    }
  }
  if (!plan.sortBy && !plan?.budget?.max && plan.qualityIntent === "BUDGET") {
    plan.sortBy = "PRICE_ASC";
  }
  projectPrimarySemanticPlaceTargetToLocation(plan);
  refreshSemanticIntentProfile(plan, latestUserMessage);
  return plan;
};

const runSemanticSearchEnrichment = async ({
  client,
  latestUserMessage,
  plan,
  language,
}) => {
  if (
    !client ||
    !latestUserMessage ||
    !shouldRunSemanticSearchFallback(latestUserMessage, plan)
  ) {
    return null;
  }
  try {
    const completion = await withSemanticTimeout(
      client.chat.completions.create({
        model: SEMANTIC_SEARCH_MODEL,
        response_format: { type: "json_object" },
        messages: buildSemanticEnrichmentMessages({
          latestUserMessage,
          plan,
          language,
        }),
      }),
      SEMANTIC_SEARCH_TIMEOUT_MS,
      "semanticSearchEnrichment",
    );
    const payload = completion.choices?.[0]?.message?.content;
    if (!payload) return null;
    const parsed = JSON.parse(payload);
    return sanitizeSemanticEnrichment(parsed);
  } catch (err) {
    console.warn("[ai] semantic enrichment failed", err?.message || err);
    return null;
  }
};

const shouldRunSemanticWebResolver = (message = "", plan = {}) => {
  const deterministic = buildDeterministicSemanticHints(message, plan);
  if (
    deterministic.geoIntent ||
    deterministic.placeTargets.length ||
    deterministic.viewIntent ||
    deterministic.areaIntent === "GOOD_AREA" ||
    deterministic.areaTraits.length
  ) {
    return true;
  }
  return Boolean(
    plan?.geoIntent ||
      (Array.isArray(plan?.placeTargets) && plan.placeTargets.length) ||
      plan?.viewIntent ||
      plan?.areaIntent === "GOOD_AREA" ||
      (Array.isArray(plan?.areaTraits) && plan.areaTraits.length),
  );
};

const buildSemanticWebResolverCacheKey = ({
  latestUserMessage,
  plan,
  language,
}) =>
  `ai:semantic-web-resolver:${hashSemanticCachePayload({
    version: 1,
    message: String(latestUserMessage || "").trim(),
    language,
    city: plan?.location?.city || null,
    country: plan?.location?.country || null,
    geoIntent: plan?.geoIntent || null,
    placeTargets: Array.isArray(plan?.placeTargets)
      ? plan.placeTargets.map((target) => ({
          rawText: target?.rawText || null,
          normalizedName: target?.normalizedName || null,
          type: target?.type || null,
        }))
      : [],
    viewIntent: plan?.viewIntent || null,
    areaIntent: plan?.areaIntent || null,
    areaTraits: Array.isArray(plan?.areaTraits) ? plan.areaTraits : [],
  })}`;

const buildSemanticWebResolverMessages = ({
  latestUserMessage,
  plan,
  language,
}) => {
  const currentPlan = {
    destination: {
      city: plan?.location?.city || null,
      country: plan?.location?.country || null,
    },
    geoIntent: plan?.geoIntent || null,
    placeTargets: Array.isArray(plan?.placeTargets)
      ? plan.placeTargets.map((target) => ({
          rawText: target?.rawText || null,
          normalizedName: target?.normalizedName || null,
          type: target?.type || null,
          radiusMeters: target?.radiusMeters ?? null,
        }))
      : [],
    viewIntent: plan?.viewIntent || null,
    areaIntent: plan?.areaIntent || null,
    areaTraits: Array.isArray(plan?.areaTraits) ? plan.areaTraits : [],
    qualityIntent: plan?.qualityIntent || null,
    preferenceNotes: Array.isArray(plan?.preferenceNotes)
      ? plan.preferenceNotes
      : [],
    language,
  };

  return [
    {
      role: "system",
      content:
        "You resolve semantic place intent for BookingGPT hotel search using web search. " +
        "Use geo/official-first sources: maps, geocoding, Wikidata, OpenStreetMap, Wikipedia, tourism boards, and institutional sources. " +
        "Avoid OTAs, competitor travel brands, and generic booking sites as primary evidence. " +
        "Never use web search to produce hotel inventory or live availability. " +
        "Return JSON only. If uncertain, return conservative empty arrays.\n\n" +
        "Tasks:\n" +
        "- Resolve explicit neighborhoods, districts, landmarks, or waterfront areas into place targets with coordinates and a practical radius.\n" +
        "- If the user only asked for abstract traits like quiet, walkable, safe, or good area, keep geoIntent/resolvedPlaces empty and use neighborhoodHints instead of inventing explicit geography.\n" +
        "- Suggest up to 8 related neighborhood hints when they are strongly tied to the user's requested area or trait.\n" +
        "- Suggest up to 8 real hotel names only as candidate hints for matching against our local catalog.\n" +
        "- Preserve the destination city/country already present in the structured plan whenever possible.\n" +
        "- areaTraits may include GOOD_AREA, SAFE, QUIET, NIGHTLIFE, WALKABLE, FAMILY, UPSCALE_AREA, BUSINESS, CENTRAL, CULTURAL, WATERFRONT_AREA, LUXURY.\n" +
        "- geoIntent may be IN_AREA, NEAR_AREA, NEAR_LANDMARK, WATERFRONT, VIEW_TO.\n\n" +
        'Respond with this schema: {"geoIntent": string|null, "areaIntent": string|null, "viewIntent": string|null, "qualityIntent": string|null, "areaTraits": string[], "resolvedPlaces": [{"rawText": string, "normalizedName": string|null, "type": string|null, "city": string|null, "country": string|null, "aliases": string[], "lat": number|null, "lng": number|null, "radiusMeters": number|null, "confidence": number|null}], "candidateHotelNames": string[], "neighborhoodHints": string[], "traceSummary": string|null}.',
    },
    {
      role: "user",
      content:
        `Latest user message:\n${latestUserMessage || ""}\n\n` +
        `Current structured plan:\n${JSON.stringify(currentPlan, null, 2)}`,
    },
  ];
};

const sanitizeSemanticWebResolution = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  return {
    geoIntent: normalizeSemanticEnum(raw.geoIntent, SEMANTIC_GEO_INTENTS),
    areaIntent: normalizeSemanticEnum(raw.areaIntent, SEMANTIC_AREA_INTENTS),
    viewIntent: normalizeSemanticEnum(raw.viewIntent, SEMANTIC_VIEW_INTENTS),
    qualityIntent: normalizeSemanticEnum(
      raw.qualityIntent,
      SEMANTIC_QUALITY_INTENTS,
    ),
    areaTraits: normalizeSemanticAreaTraits(raw.areaTraits),
    resolvedPlaces: uniqueSemanticPlaceTargets(raw.resolvedPlaces, 6),
    candidateHotelNames: uniqueSemanticStringList(raw.candidateHotelNames, 8),
    neighborhoodHints: uniqueSemanticStringList(raw.neighborhoodHints, 8),
    traceSummary:
      typeof raw.traceSummary === "string" ? raw.traceSummary.trim() || null : null,
  };
};

const mergeSemanticWebResolutionIntoPlan = (plan, resolution = {}) => {
  if (!plan || typeof plan !== "object") return plan;
  const semanticState = ensureSemanticSearchState(plan);
  mergeSemanticEnrichmentIntoPlan(plan, {
    geoIntent: resolution.geoIntent,
    placeTargets: resolution.resolvedPlaces,
    areaIntent: resolution.areaIntent,
    viewIntent: resolution.viewIntent,
    qualityIntent: resolution.qualityIntent,
    areaTraits: resolution.areaTraits,
    candidateHotelNames: resolution.candidateHotelNames,
    neighborhoodHints: resolution.neighborhoodHints,
    preferenceNotes: [],
  });
  semanticState.webContext = {
    enrichmentRan: true,
    webResolutionUsed: Boolean(
      Array.isArray(resolution.resolvedPlaces) &&
        resolution.resolvedPlaces.length,
    ),
    candidateGenerationUsed: Boolean(
      (Array.isArray(resolution.candidateHotelNames) &&
        resolution.candidateHotelNames.length) ||
        (Array.isArray(resolution.neighborhoodHints) &&
          resolution.neighborhoodHints.length),
    ),
    resolvedPlaces: Array.isArray(resolution.resolvedPlaces)
      ? resolution.resolvedPlaces
      : [],
    candidateHotelNames: Array.isArray(resolution.candidateHotelNames)
      ? resolution.candidateHotelNames
      : [],
    neighborhoodHints: Array.isArray(resolution.neighborhoodHints)
      ? resolution.neighborhoodHints
      : [],
    sourcePolicy: SEMANTIC_WEB_SOURCE_POLICY,
    traceSummary: resolution.traceSummary || null,
  };
  projectPrimarySemanticPlaceTargetToLocation(plan);
  refreshSemanticIntentProfile(plan);
  return plan;
};

const runSemanticWebResolver = async ({
  client,
  latestUserMessage,
  plan,
  language,
  emitTrace = null,
}) => {
  if (
    !client ||
    !latestUserMessage ||
    !shouldRunSemanticWebResolver(latestUserMessage, plan)
  ) {
    return null;
  }

  const cacheKey = buildSemanticWebResolverCacheKey({
    latestUserMessage,
    plan,
    language,
  });
  try {
    const cached = await cache.get(cacheKey);
    if (cached?.payload) {
      emitTrace?.("SEMANTIC_PLACE_RESOLUTION_APPLIED", {
        cached: true,
        geoIntent: cached.payload.geoIntent || null,
        placeTargets: Array.isArray(cached.payload.resolvedPlaces)
          ? cached.payload.resolvedPlaces.map((place) => place.rawText)
          : [],
        sourcePolicy: SEMANTIC_WEB_SOURCE_POLICY,
      });
      return cached.payload;
    }
  } catch (cacheErr) {
    console.warn("[ai] semantic web resolver cache read failed", cacheErr?.message || cacheErr);
  }

  emitTrace?.("SEMANTIC_PLACE_RESOLUTION_REQUESTED", {
    destination: plan?.location?.city || null,
    geoIntent: plan?.geoIntent || null,
    placeTargets: Array.isArray(plan?.placeTargets)
      ? plan.placeTargets.map((place) => place.rawText)
      : [],
    viewIntent: plan?.viewIntent || null,
    areaIntent: plan?.areaIntent || null,
    sourcePolicy: SEMANTIC_WEB_SOURCE_POLICY,
  });

  try {
    const completion = await withSemanticTimeout(
      client.chat.completions.create({
        model: CALL2_WEB_SEARCH_MODEL,
        web_search_options: {},
        messages: buildSemanticWebResolverMessages({
          latestUserMessage,
          plan,
          language,
        }),
      }),
      SEMANTIC_WEB_RESOLVER_TIMEOUT_MS,
      "semanticWebResolver",
    );
    const payload = completion.choices?.[0]?.message?.content;
    if (!payload) return null;

    const rawSources = dedupeWebSources(
      completion.choices?.[0]?.message?.annotations || [],
    );
    const sourceAssessment = assessWebSearchResult({
      text: payload,
      sources: rawSources,
      allowCompetitors: false,
    });
    if (!sourceAssessment.accepted) {
      emitTrace?.("SEMANTIC_PLACE_RESOLUTION_FAILED", {
        reason: sourceAssessment.reason || "blocked_source",
        blockedSource:
          sourceAssessment.blockedSources?.[0]?.hostname ||
          sourceAssessment.blockedMentions?.[0] ||
          null,
      });
      return null;
    }

    const parsed = JSON.parse(payload);
    const sanitized = sanitizeSemanticWebResolution(parsed);
    if (!sanitized) return null;

    try {
      await cache.set(
        cacheKey,
        {
          payload: sanitized,
          cachedAt: new Date().toISOString(),
        },
        SEMANTIC_WEB_RESOLVER_CACHE_TTL_SECONDS,
      );
    } catch (cacheErr) {
      console.warn("[ai] semantic web resolver cache write failed", cacheErr?.message || cacheErr);
    }

    emitTrace?.("SEMANTIC_PLACE_RESOLUTION_APPLIED", {
      cached: false,
      geoIntent: sanitized.geoIntent || null,
      placeTargets: Array.isArray(sanitized.resolvedPlaces)
        ? sanitized.resolvedPlaces.map((place) => place.rawText)
        : [],
      sourceCount: sourceAssessment.safeSources?.length || rawSources.length || 0,
      sourcePolicy: SEMANTIC_WEB_SOURCE_POLICY,
    });
    if (
      (Array.isArray(sanitized.candidateHotelNames) &&
        sanitized.candidateHotelNames.length) ||
      (Array.isArray(sanitized.neighborhoodHints) &&
        sanitized.neighborhoodHints.length)
    ) {
      emitTrace?.("SEMANTIC_WEB_CANDIDATES_USED", {
        candidateHotelCount: sanitized.candidateHotelNames.length,
        neighborhoodHintCount: sanitized.neighborhoodHints.length,
      });
    }
    return sanitized;
  } catch (err) {
    emitTrace?.("SEMANTIC_PLACE_RESOLUTION_FAILED", {
      reason: err?.code || err?.message || "unknown_error",
    });
    console.warn("[ai] semantic web resolver failed", err?.message || err);
    return null;
  }
};

const normalizePlaceTypeHint = (value = "", query = "") => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (
    [
      "AIRPORT",
      "LANDMARK",
      "DISTRICT",
      "STATION",
      "PORT",
      "VENUE",
      "GENERIC",
    ].includes(normalized)
  ) {
    return normalized;
  }
  const inferred = inferSemanticPlaceTargetType(query);
  if (["AIRPORT", "STATION", "PORT", "VENUE"].includes(inferred)) {
    return inferred;
  }
  if (inferred === "LANDMARK" || inferred === "DISTRICT") {
    return inferred;
  }
  return "GENERIC";
};

const mapGeoIntentToPlaceIntentMode = (geoIntent = null) => {
  const normalized = String(geoIntent || "")
    .trim()
    .toUpperCase();
  if (normalized === "IN_AREA") return "IN_PLACE";
  if (normalized === "NEAR_AREA" || normalized === "NEAR_LANDMARK") {
    return "NEAR_PLACE";
  }
  return "NEAR_PLACE";
};

const hasVerifiedPlaceCoordinates = (target = {}) => {
  const lat = normalizeSemanticNumber(target?.lat);
  const lng = normalizeSemanticNumber(target?.lng);
  return lat != null && lng != null && !(lat === 0 && lng === 0);
};

const buildResolvedPlaceTarget = (place = {}, rawQuery = null) => {
  if (!place || typeof place !== "object") return null;
  const lat = normalizeSemanticNumber(place?.lat);
  const lng = normalizeSemanticNumber(place?.lng);
  if (lat == null || lng == null || (lat === 0 && lng === 0)) return null;
  const confidenceValue =
    String(place?.confidence || "").trim().toUpperCase() === "HIGH"
      ? 0.95
      : String(place?.confidence || "").trim().toUpperCase() === "MEDIUM"
        ? 0.8
        : 0.6;
  return sanitizeSemanticPlaceTarget({
    rawText:
      typeof rawQuery === "string" && rawQuery.trim()
        ? rawQuery.trim()
        : place?.normalizedName || place?.label || null,
    normalizedName: place?.normalizedName || place?.label || null,
    type: normalizePlaceTypeHint(place?.placeType, place?.normalizedName || rawQuery),
    city: place?.city || null,
    country: place?.country || null,
    aliases: Array.isArray(place?.aliases) ? place.aliases : [],
    lat,
    lng,
    radiusMeters: normalizeSemanticNumber(place?.radiusMeters),
    confidence: confidenceValue,
  });
};

const buildExplicitPlaceWebResolverMessages = ({
  latestUserMessage,
  query,
  city,
  country,
  placeTypeHint,
  intentMode,
  language,
}) => [
  {
    role: "system",
    content:
      "You resolve explicit place references for BookingGPT hotel search using web search. " +
      "Prioritize official geo sources, airport or station authorities, Wikidata, OpenStreetMap, and major encyclopedic sources. " +
      "Return JSON only. Never return hotel inventory. Never invent places or coordinates.\n\n" +
      "Rules:\n" +
      "- If the user says a generic transport hub like airport, station, or port inside a known city, identify the real candidate places that serve that city.\n" +
      "- If one place is clearly intended, return it as resolvedPlace.\n" +
      "- If multiple real candidates fit, leave resolvedPlace null and return them in candidates.\n" +
      "- Every resolvedPlace and candidate must include label, normalizedName, placeType, city, country, lat, lng, radiusMeters, aliases, and confidence.\n" +
      "- Keep candidates limited to the requested city or its directly serving transport hubs.\n\n" +
      'Schema: {"resolvedPlace":{"label":string,"normalizedName":string|null,"placeType":string|null,"city":string|null,"country":string|null,"lat":number|null,"lng":number|null,"radiusMeters":number|null,"aliases":string[],"confidence":string|null}|null,"candidates":[{"label":string,"normalizedName":string|null,"placeType":string|null,"city":string|null,"country":string|null,"lat":number|null,"lng":number|null,"radiusMeters":number|null,"aliases":string[],"confidence":string|null}],"traceSummary":string|null}.',
  },
  {
    role: "user",
    content: JSON.stringify(
      {
        latestUserMessage: latestUserMessage || "",
        query: query || "",
        destination: {
          city: city || null,
          country: country || null,
        },
        placeTypeHint: placeTypeHint || "GENERIC",
        intentMode: intentMode || "NEAR_PLACE",
        language: language || "es",
      },
      null,
      2,
    ),
  },
];

const buildPlaceResolutionCandidateId = (place = {}) =>
  [
    "web",
    normalizeSemanticText(place?.normalizedName || place?.label || place?.rawText || ""),
    normalizeSemanticText(place?.city || ""),
    normalizeSemanticText(place?.country || ""),
  ].join(":");

const buildPlaceResolutionCandidate = (
  place = {},
  rawQuery = null,
  fallbackPlaceTypeHint = "GENERIC",
) => {
  const resolvedTarget = buildResolvedPlaceTarget(
    {
      ...place,
      placeType:
        place?.placeType || place?.type || fallbackPlaceTypeHint || "GENERIC",
      confidence: place?.confidence || "MEDIUM",
    },
    rawQuery,
  );
  if (!resolvedTarget) return null;
  return {
    id: buildPlaceResolutionCandidateId({
      normalizedName: resolvedTarget.normalizedName,
      city: resolvedTarget.city,
      country: resolvedTarget.country,
    }),
    label:
      typeof place?.label === "string" && place.label.trim()
        ? place.label.trim()
        : resolvedTarget.normalizedName || resolvedTarget.rawText,
    normalizedName: resolvedTarget.normalizedName || resolvedTarget.rawText,
    subtitle:
      [resolvedTarget.city, resolvedTarget.country].filter(Boolean).join(", ") ||
      null,
    placeType:
      normalizePlaceTypeHint(
        place?.placeType || place?.type || resolvedTarget.type,
        rawQuery,
      ) || fallbackPlaceTypeHint,
    city: resolvedTarget.city || null,
    country: resolvedTarget.country || null,
    lat: resolvedTarget.lat,
    lng: resolvedTarget.lng,
    radiusMeters: resolvedTarget.radiusMeters || null,
    aliases: uniqueSemanticStringList(
      place?.aliases || resolvedTarget.aliases || [],
      12,
    ),
    confidence:
      String(place?.confidence || "MEDIUM").trim().toUpperCase() || "MEDIUM",
    source: "web_search",
  };
};

const sanitizeExplicitPlaceWebResolution = ({
  raw,
  query,
  language,
  placeTypeHint,
}) => {
  if (!raw || typeof raw !== "object") {
    return {
      status: "NOT_FOUND",
      confidence: "LOW",
      resolved_place: null,
      candidates: [],
      clarification_question: null,
      traceSummary: null,
    };
  }

  const resolvedPlace = buildPlaceResolutionCandidate(
    raw?.resolvedPlace || raw?.resolved_place || null,
    query,
    placeTypeHint,
  );

  const candidateMap = new Map();
  (Array.isArray(raw?.candidates) ? raw.candidates : []).forEach((candidate) => {
    const normalizedCandidate = buildPlaceResolutionCandidate(
      candidate,
      query,
      placeTypeHint,
    );
    if (!normalizedCandidate?.id) return;
    if (!candidateMap.has(normalizedCandidate.id)) {
      candidateMap.set(normalizedCandidate.id, normalizedCandidate);
    }
  });
  const candidates = Array.from(candidateMap.values()).slice(0, 5);

  if (resolvedPlace) {
    return {
      status: "RESOLVED",
      confidence: resolvedPlace.confidence || "MEDIUM",
      resolved_place: resolvedPlace,
      candidates: [],
      clarification_question: null,
      traceSummary:
        typeof raw?.traceSummary === "string"
          ? raw.traceSummary.trim() || null
          : null,
    };
  }

  if (candidates.length === 1) {
    return {
      status: "RESOLVED",
      confidence: candidates[0].confidence || "MEDIUM",
      resolved_place: candidates[0],
      candidates: [],
      clarification_question: null,
      traceSummary:
        typeof raw?.traceSummary === "string"
          ? raw.traceSummary.trim() || null
          : null,
    };
  }

  if (candidates.length > 1) {
    return {
      status: "AMBIGUOUS",
      confidence: "MEDIUM",
      resolved_place: null,
      candidates,
      clarification_question: getPlaceDisambiguationQuestion(
        language,
        placeTypeHint,
      ),
      traceSummary:
        typeof raw?.traceSummary === "string"
          ? raw.traceSummary.trim() || null
          : null,
    };
  }

  return {
    status: "NOT_FOUND",
    confidence: "LOW",
    resolved_place: null,
    candidates: [],
    clarification_question: null,
    traceSummary:
      typeof raw?.traceSummary === "string" ? raw.traceSummary.trim() || null : null,
  };
};

const resolvePlaceReferenceViaWebSearch = async ({
  client,
  latestUserMessage,
  query,
  city,
  country,
  placeTypeHint,
  intentMode,
  language,
  emitTrace = null,
} = {}) => {
  if (!client || !query || !city) return null;

  emitTrace?.("PLACE_REFERENCE_WEB_FALLBACK_REQUESTED", {
    query,
    city,
    country: country || null,
    placeTypeHint: placeTypeHint || null,
    intentMode: intentMode || null,
  });

  try {
    const completion = await withSemanticTimeout(
      client.chat.completions.create({
        model: CALL2_WEB_SEARCH_MODEL,
        web_search_options: {},
        messages: buildExplicitPlaceWebResolverMessages({
          latestUserMessage,
          query,
          city,
          country,
          placeTypeHint,
          intentMode,
          language,
        }),
      }),
      SEMANTIC_WEB_RESOLVER_TIMEOUT_MS,
      "explicitPlaceWebResolver",
    );
    const payload = completion?.choices?.[0]?.message?.content;
    if (!payload) return null;

    const rawSources = dedupeWebSources(
      completion?.choices?.[0]?.message?.annotations || [],
    );
    const sourceAssessment = assessWebSearchResult({
      text: payload,
      sources: rawSources,
      allowCompetitors: false,
    });
    if (!sourceAssessment.accepted) {
      emitTrace?.("PLACE_REFERENCE_WEB_FALLBACK_FAILED", {
        query,
        reason: sourceAssessment.reason || "blocked_source",
      });
      return null;
    }

    const parsed = JSON.parse(payload);
    const sanitized = sanitizeExplicitPlaceWebResolution({
      raw: parsed,
      query,
      language,
      placeTypeHint,
    });

    emitTrace?.("PLACE_REFERENCE_WEB_FALLBACK_APPLIED", {
      query,
      status: sanitized?.status || null,
      candidateCount: Array.isArray(sanitized?.candidates)
        ? sanitized.candidates.length
        : 0,
      resolvedLabel:
        sanitized?.resolved_place?.label ||
        sanitized?.resolved_place?.normalizedName ||
        null,
    });

    return sanitized;
  } catch (err) {
    emitTrace?.("PLACE_REFERENCE_WEB_FALLBACK_FAILED", {
      query,
      reason: err?.code || err?.message || "unknown_error",
    });
    return null;
  }
};

const getPlaceDisambiguationQuestion = (
  language = "es",
  placeTypeHint = "GENERIC",
) => {
  const lang = String(language || "es").toLowerCase();
  if (placeTypeHint === "AIRPORT") {
    if (lang.startsWith("en")) return "Which airport do you mean?";
    if (lang.startsWith("pt")) return "A qual aeroporto voce se refere?";
    return "A cual aeropuerto te referis?";
  }
  if (placeTypeHint === "STATION") {
    if (lang.startsWith("en")) return "Which station do you mean?";
    if (lang.startsWith("pt")) return "A qual estacao voce se refere?";
    return "A que estacion te referis?";
  }
  if (placeTypeHint === "PORT") {
    if (lang.startsWith("en")) return "Which port do you mean?";
    if (lang.startsWith("pt")) return "A qual porto voce se refere?";
    return "A que puerto te referis?";
  }
  if (lang.startsWith("en")) return "Which place do you mean exactly?";
  if (lang.startsWith("pt")) return "A qual lugar voce se refere exatamente?";
  return "A que lugar te referis exactamente?";
};

const buildPlaceDisambiguationUiInput = (resolution = {}) => ({
  type: "placeDisambiguation",
  id: "PLACE_DISAMBIGUATION",
  required: true,
  question:
    resolution?.clarification_question ||
    getPlaceDisambiguationQuestion("es", resolution?.placeTypeHint),
  options: (Array.isArray(resolution?.candidates) ? resolution.candidates : [])
    .map((candidate) => ({
      id: candidate?.id || null,
      label: candidate?.label || candidate?.normalizedName || null,
      subtitle: candidate?.subtitle || [candidate?.city, candidate?.country].filter(Boolean).join(", ") || null,
      placeType: candidate?.placeType || "GENERIC",
      city: candidate?.city || null,
      country: candidate?.country || null,
    }))
    .filter((option) => option.id && option.label),
});

const applyPlaceSelectionToToolArgs = ({
  args = {},
  pendingToolCall = null,
  selectionId = null,
} = {}) => {
  const selectedId = String(selectionId || "").trim();
  if (!selectedId || !pendingToolCall) return args;
  const options = Array.isArray(pendingToolCall?.clarificationOptions)
    ? pendingToolCall.clarificationOptions
    : [];
  const selectedCandidate =
    options.find((candidate) => String(candidate?.id || "").trim() === selectedId) ||
    null;
  if (!selectedCandidate) return args;
  const selectedTarget = buildResolvedPlaceTarget(
    selectedCandidate,
    pendingToolCall?.placeResolutionRequest?.query ||
      selectedCandidate?.normalizedName ||
      selectedCandidate?.label ||
      null,
  );
  if (!selectedTarget) return args;
  return {
    ...args,
    city: args?.city || selectedCandidate?.city || null,
    country: args?.country || selectedCandidate?.country || null,
    placeTargets: [selectedTarget],
    nearbyInterest:
      selectedCandidate?.normalizedName || selectedCandidate?.label || args?.nearbyInterest || null,
  };
};

const resolveExplicitPlaceReferenceForPlan = async ({
  client,
  plan,
  originalToolArgs = {},
  latestUserMessage,
  language,
  emitTrace = null,
} = {}) => {
  if (!plan || typeof plan !== "object") return null;
  const explicitGeoRequested =
    Boolean(plan?.geoIntent) ||
    (Array.isArray(plan?.placeTargets) && plan.placeTargets.length > 0);
  if (!explicitGeoRequested) return null;

  const originalTargets = uniqueSemanticPlaceTargets(
    Array.isArray(originalToolArgs?.placeTargets) ? originalToolArgs.placeTargets : [],
    6,
  );
  const currentTargets = uniqueSemanticPlaceTargets(
    Array.isArray(plan?.placeTargets) ? plan.placeTargets : [],
    6,
  );
  const primaryTarget = originalTargets[0] || currentTargets[0] || null;
  const rawQuery =
    primaryTarget?.rawText ||
    primaryTarget?.normalizedName ||
    plan?.preferences?.nearbyInterest ||
    null;
  if (!rawQuery) return null;

  if (hasVerifiedPlaceCoordinates(primaryTarget)) {
    return {
      status: "RESOLVED",
      confidence: "HIGH",
      resolved_place: {
        id: "existing_plan_target",
        label: primaryTarget?.normalizedName || primaryTarget?.rawText,
        normalizedName: primaryTarget?.normalizedName || primaryTarget?.rawText,
        subtitle: [primaryTarget?.city, primaryTarget?.country].filter(Boolean).join(", ") || null,
        placeType: normalizePlaceTypeHint(primaryTarget?.type, rawQuery),
        city: primaryTarget?.city || null,
        country: primaryTarget?.country || null,
        lat: primaryTarget?.lat,
        lng: primaryTarget?.lng,
        radiusMeters: primaryTarget?.radiusMeters || null,
        source: "existing_plan",
        aliases: Array.isArray(primaryTarget?.aliases) ? primaryTarget.aliases : [],
      },
      candidates: [],
      clarification_question: null,
      rawQuery,
    };
  }

  const placeTypeHint = normalizePlaceTypeHint(primaryTarget?.type, rawQuery);
  const shouldForceStructuredPlaceResolution =
    ["AIRPORT", "STATION", "PORT", "VENUE", "GENERIC"].includes(
      placeTypeHint,
    ) ||
    /\b(airport|aeropuerto|aeroparque|ezeiza|station|estacion|terminal|port|puerto|harbor|marina)\b/i.test(
      rawQuery,
    );
  if (!shouldForceStructuredPlaceResolution) {
    return null;
  }
  emitTrace?.("PLACE_REFERENCE_RESOLUTION_REQUESTED", {
    query: rawQuery,
    city: plan?.location?.city || null,
    country: plan?.location?.country || null,
    placeTypeHint,
    geoIntent: plan?.geoIntent || null,
  });
  const resolution = await resolvePlaceReference({
    query: rawQuery,
    city: plan?.location?.city || null,
    country: plan?.location?.country || null,
    place_type_hint: placeTypeHint,
    intent_mode: mapGeoIntentToPlaceIntentMode(plan?.geoIntent),
    language,
    max_candidates: 5,
  });
  const resolvedViaWebSearch =
    resolution?.status === "NOT_FOUND"
      ? await resolvePlaceReferenceViaWebSearch({
          client,
          latestUserMessage,
          query: rawQuery,
          city: plan?.location?.city || null,
          country: plan?.location?.country || null,
          placeTypeHint,
          intentMode: mapGeoIntentToPlaceIntentMode(plan?.geoIntent),
          language,
          emitTrace,
        })
      : null;
  const finalResolution =
    resolvedViaWebSearch && resolvedViaWebSearch.status !== "NOT_FOUND"
      ? resolvedViaWebSearch
      : resolution;
  emitTrace?.(
    finalResolution?.status === "RESOLVED"
      ? "PLACE_REFERENCE_RESOLUTION_APPLIED"
      : finalResolution?.status === "AMBIGUOUS"
        ? "PLACE_REFERENCE_RESOLUTION_AMBIGUOUS"
        : "PLACE_REFERENCE_RESOLUTION_FAILED_CLOSED",
    {
      query: rawQuery,
      status: finalResolution?.status || null,
      confidence: finalResolution?.confidence || null,
      candidateCount: Array.isArray(finalResolution?.candidates)
        ? finalResolution.candidates.length
        : 0,
      resolvedLabel:
        finalResolution?.resolved_place?.label ||
        finalResolution?.resolved_place?.normalizedName ||
        null,
    },
  );
  return {
    ...finalResolution,
    rawQuery,
    placeTypeHint,
  };
};

const applyResolvedPlaceReferenceToPlan = ({
  plan,
  resolution,
  latestUserMessage = "",
} = {}) => {
  if (!plan || !resolution?.resolved_place) return plan;
  const semanticState = ensureSemanticSearchState(plan);
  const resolvedTarget = buildResolvedPlaceTarget(
    resolution.resolved_place,
    resolution.rawQuery,
  );
  if (!resolvedTarget) return plan;
  plan.placeTargets = uniqueSemanticPlaceTargets(
    [resolvedTarget, ...(Array.isArray(plan.placeTargets) ? plan.placeTargets : [])],
    6,
  );
  if (!plan.preferences || typeof plan.preferences !== "object") {
    plan.preferences = {};
  }
  if (!plan.preferences.nearbyInterest && resolvedTarget.normalizedName) {
    plan.preferences.nearbyInterest = resolvedTarget.normalizedName;
  }
  semanticState.placeResolution = {
    status: "RESOLVED",
    source: resolution?.resolved_place?.source || "catalog",
    confidence: resolution?.confidence || null,
    clarified: false,
  };
  projectPrimarySemanticPlaceTargetToLocation(plan);
  refreshSemanticIntentProfile(plan, latestUserMessage);
  return plan;
};

const buildLastSearchParams = (plan) => {
  if (!plan || typeof plan !== "object") return null;
  const location =
    plan.location && typeof plan.location === "object" ? plan.location : {};
  const dates = plan.dates && typeof plan.dates === "object" ? plan.dates : {};
  const guests =
    plan.guests && typeof plan.guests === "object" ? plan.guests : {};
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
    geo: {
      geoIntent: plan.geoIntent ?? null,
      placeTargets: Array.isArray(plan.placeTargets)
        ? plan.placeTargets.map((target) => ({
            rawText: target?.rawText ?? null,
            normalizedName: target?.normalizedName ?? null,
            type: target?.type ?? null,
            city: target?.city ?? null,
            country: target?.country ?? null,
            aliases: Array.isArray(target?.aliases) ? target.aliases : [],
            lat: target?.lat ?? null,
            lng: target?.lng ?? null,
            radiusMeters: target?.radiusMeters ?? null,
            confidence: target?.confidence ?? null,
          }))
        : [],
      areaTraits: Array.isArray(plan.areaTraits) ? plan.areaTraits : [],
    },
    filters: {
      amenities: Array.isArray(plan.preferences?.amenities)
        ? plan.preferences.amenities
        : [],
      hotelAmenityCodes: Array.isArray(plan.hotelFilters?.amenityCodes)
        ? plan.hotelFilters.amenityCodes
        : [],
      minRating: plan.hotelFilters?.minRating ?? null,
      starRatings: Array.isArray(plan.starRatings) ? plan.starRatings : [],
      areaPreference: Array.isArray(plan.preferences?.areaPreference)
        ? plan.preferences.areaPreference
        : [],
      areaIntent: plan.areaIntent ?? null,
      viewIntent: plan.viewIntent ?? null,
      qualityIntent: plan.qualityIntent ?? null,
      preferenceNotes: Array.isArray(plan.preferenceNotes)
        ? plan.preferenceNotes
        : [],
      sortBy: plan.sortBy ?? plan.preferences?.sortBy ?? null,
    },
    semanticSearch: {
      referenceHotelIds: Array.isArray(plan.semanticSearch?.referenceHotelIds)
        ? plan.semanticSearch.referenceHotelIds
        : [],
      intentProfile:
        plan.semanticSearch?.intentProfile &&
        typeof plan.semanticSearch.intentProfile === "object"
          ? {
              version: plan.semanticSearch.intentProfile.version ?? null,
              userRequestedAreaTraits: Array.isArray(
                plan.semanticSearch.intentProfile.userRequestedAreaTraits,
              )
                ? plan.semanticSearch.intentProfile.userRequestedAreaTraits
                : [],
              userRequestedZones: Array.isArray(
                plan.semanticSearch.intentProfile.userRequestedZones,
              )
                ? plan.semanticSearch.intentProfile.userRequestedZones
                : [],
              userRequestedLandmarks: Array.isArray(
                plan.semanticSearch.intentProfile.userRequestedLandmarks,
              )
                ? plan.semanticSearch.intentProfile.userRequestedLandmarks
                : [],
              requestedAreaTraits: Array.isArray(
                plan.semanticSearch.intentProfile.requestedAreaTraits,
              )
                ? plan.semanticSearch.intentProfile.requestedAreaTraits
                : [],
              requestedZones: Array.isArray(
                plan.semanticSearch.intentProfile.requestedZones,
              )
                ? plan.semanticSearch.intentProfile.requestedZones
                : [],
              requestedLandmarks: Array.isArray(
                plan.semanticSearch.intentProfile.requestedLandmarks,
              )
                ? plan.semanticSearch.intentProfile.requestedLandmarks
                : [],
              candidateZones: Array.isArray(
                plan.semanticSearch.intentProfile.candidateZones,
              )
                ? plan.semanticSearch.intentProfile.candidateZones
                : [],
              candidateLandmarks: Array.isArray(
                plan.semanticSearch.intentProfile.candidateLandmarks,
              )
                ? plan.semanticSearch.intentProfile.candidateLandmarks
                : [],
              inferenceMode:
                plan.semanticSearch.intentProfile.inferenceMode ?? null,
              confidence:
                plan.semanticSearch.intentProfile.confidence ?? null,
              fallbackMode:
                plan.semanticSearch.intentProfile.fallbackMode ?? null,
              cityProfileVersion:
                plan.semanticSearch.intentProfile.cityProfileVersion ?? null,
            }
          : null,
      webContext:
        plan.semanticSearch?.webContext &&
        typeof plan.semanticSearch.webContext === "object"
          ? {
              enrichmentRan:
                plan.semanticSearch.webContext.enrichmentRan === true,
              webResolutionUsed:
                plan.semanticSearch.webContext.webResolutionUsed === true,
              candidateGenerationUsed:
                plan.semanticSearch.webContext.candidateGenerationUsed === true,
              resolvedPlaces: Array.isArray(
                plan.semanticSearch.webContext.resolvedPlaces,
              )
                ? plan.semanticSearch.webContext.resolvedPlaces
                : [],
              candidateHotelNames: Array.isArray(
                plan.semanticSearch.webContext.candidateHotelNames,
              )
                ? plan.semanticSearch.webContext.candidateHotelNames
                : [],
              neighborhoodHints: Array.isArray(
                plan.semanticSearch.webContext.neighborhoodHints,
              )
                ? plan.semanticSearch.webContext.neighborhoodHints
                : [],
              sourcePolicy:
                plan.semanticSearch.webContext.sourcePolicy ?? null,
              traceSummary:
                plan.semanticSearch.webContext.traceSummary ?? null,
            }
          : null,
    },
  };
};

const mergeHotelAmenities = (h) => {
  const fromObj = (list) =>
    Array.isArray(list)
      ? list
          .map((a) =>
            (typeof a === "string" ? a : (a?.name ?? String(a))).trim(),
          )
          .filter(Boolean)
      : [];
  const fromLeisure = Array.isArray(h.leisure)
    ? h.leisure
        .map((x) => (typeof x === "string" ? x : (x?.name ?? String(x))).trim())
        .filter(Boolean)
    : [];
  const fromBusiness = Array.isArray(h.business)
    ? h.business
        .map((x) => (typeof x === "string" ? x : (x?.name ?? String(x))).trim())
        .filter(Boolean)
    : [];
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

const normalizeReferencedHotelIds = (value) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    ),
  );

const buildReferencedHotelIdsFromState = (state = {}) => {
  const explicitIds = normalizeReferencedHotelIds(state?.lastReferencedHotelIds);
  if (explicitIds.length) return explicitIds;

  const summaryHotels = Array.isArray(state?.lastShownInventorySummary?.hotels)
    ? state.lastShownInventorySummary.hotels
    : [];
  const pickIds = normalizeReferencedHotelIds(
    summaryHotels.filter((hotel) => hotel?.isPick).map((hotel) => hotel?.id),
  );
  if (pickIds.length) return pickIds;

  return normalizeReferencedHotelIds(summaryHotels.map((hotel) => hotel?.id));
};

const buildLastShownInventorySummary = (
  inventory,
  searchId,
  picksIds = new Set(),
) => {
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
      shortReason:
        h.shortReason ??
        h.pickReason ??
        (Array.isArray(h.matchReasons) && h.matchReasons[0]) ??
        null,
      matchReasons: Array.isArray(h.matchReasons) ? h.matchReasons.slice(0, 5) : [],
      semanticEvidence: Array.isArray(h.semanticEvidence)
        ? h.semanticEvidence.slice(0, 5)
        : [],
      distanceMeters:
        Number.isFinite(Number(h.distanceMeters)) && Number(h.distanceMeters) >= 0
          ? Number(h.distanceMeters)
          : null,
      matchedPlaceTarget:
        h.matchedPlaceTarget && typeof h.matchedPlaceTarget === "object"
          ? {
              rawText: h.matchedPlaceTarget.rawText ?? null,
              normalizedName: h.matchedPlaceTarget.normalizedName ?? null,
              type: h.matchedPlaceTarget.type ?? null,
            }
          : null,
      semanticMatch:
        h.semanticMatch && typeof h.semanticMatch === "object"
          ? {
              score:
                Number.isFinite(Number(h.semanticMatch.score))
                  ? Number(h.semanticMatch.score)
                  : null,
              confidence: h.semanticMatch.confidence ?? null,
              matchedZoneId: h.semanticMatch.matchedZoneId ?? null,
              matchedLandmarkId: h.semanticMatch.matchedLandmarkId ?? null,
              scopeEligible: h.semanticMatch.scopeEligible === true,
              evidence: Array.isArray(h.semanticMatch.evidence)
                ? h.semanticMatch.evidence.slice(0, 6)
                : [],
            }
          : null,
      isPick: picksIds.size > 0 ? picksIds.has(String(h.id)) : false,
      images: Array.isArray(h.images)
        ? h.images
            .slice(0, 2)
            .map((img) => (typeof img === "string" ? img : (img?.url ?? null)))
            .filter(Boolean)
        : h.coverImage
          ? [h.coverImage]
          : [],
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
      amenities: Array.isArray(h.amenities)
        ? h.amenities.map((a) =>
            typeof a === "string" ? a : (a?.name ?? String(a)),
          )
        : [],
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

/** Normalize raw inventory hotels into the same shape used by the summary/pre-filter, preserving full amenity data. */
const normalizeRawInventoryHotels = (inventory, picksIds = new Set()) =>
  (inventory?.hotels || [])
    .map((h) => ({
      id: h.id != null ? String(h.id) : null,
      name: h.name ?? h.title ?? "",
      city: h.city ?? "",
      stars: h.classification?.name ?? h.stars ?? null,
      pricePerNight: h.pricePerNight ?? h.price_per_night ?? null,
      currency: h.currency ?? "USD",
      amenities: mergeHotelAmenities(h),
      descriptions: collectDescriptionSnippets(h),
      shortReason:
        h.shortReason ??
        h.pickReason ??
        (Array.isArray(h.matchReasons) && h.matchReasons[0]) ??
        null,
      matchReasons: Array.isArray(h.matchReasons) ? h.matchReasons.slice(0, 5) : [],
      semanticEvidence: Array.isArray(h.semanticEvidence)
        ? h.semanticEvidence.slice(0, 5)
        : [],
      distanceMeters:
        Number.isFinite(Number(h.distanceMeters)) && Number(h.distanceMeters) >= 0
          ? Number(h.distanceMeters)
          : null,
      matchedPlaceTarget:
        h.matchedPlaceTarget && typeof h.matchedPlaceTarget === "object"
          ? {
              rawText: h.matchedPlaceTarget.rawText ?? null,
              normalizedName: h.matchedPlaceTarget.normalizedName ?? null,
              type: h.matchedPlaceTarget.type ?? null,
            }
          : null,
      semanticMatch:
        h.semanticMatch && typeof h.semanticMatch === "object"
          ? {
              score:
                Number.isFinite(Number(h.semanticMatch.score))
                  ? Number(h.semanticMatch.score)
                  : null,
              confidence: h.semanticMatch.confidence ?? null,
              matchedZoneId: h.semanticMatch.matchedZoneId ?? null,
              matchedLandmarkId: h.semanticMatch.matchedLandmarkId ?? null,
              scopeEligible: h.semanticMatch.scopeEligible === true,
              evidence: Array.isArray(h.semanticMatch.evidence)
                ? h.semanticMatch.evidence.slice(0, 6)
                : [],
            }
          : null,
      isPick: picksIds.has(String(h.id)),
      images: Array.isArray(h.images)
        ? h.images
            .slice(0, 3)
            .map((img) => (typeof img === "string" ? img : (img?.url ?? null)))
            .filter(Boolean)
        : h.coverImage
          ? [h.coverImage]
          : [],
    }))
    .filter((h) => h.id);

const buildTripSearchContextText = (state, plan) => {
  const parts = [];
  const dest =
    state?.destination?.name ||
    plan?.location?.city ||
    plan?.location?.country ||
    null;
  if (dest) parts.push(`Destination: ${dest}`);
  else parts.push("Destination: Not set yet");
  const checkIn = state?.dates?.checkIn || plan?.dates?.checkIn;
  const checkOut = state?.dates?.checkOut || plan?.dates?.checkOut;
  if (checkIn && checkOut) parts.push(`Dates: ${checkIn} to ${checkOut}`);
  else parts.push("Dates: Not set yet");
  const adults =
    state?.guests?.adults ?? plan?.guests?.adults ?? plan?.guests?.total;
  const children = state?.guests?.children ?? plan?.guests?.children;
  if (adults != null || children != null) {
    parts.push(`Guests: ${adults ?? 0} adults, ${children ?? 0} children`);
  } else parts.push("Guests: Not set yet");
  const params = state?.lastSearchParams;
  if (params?.filters?.amenities?.length) {
    parts.push(
      `Last filters: amenities ${params.filters.amenities.join(", ")}`,
    );
  }
  if (params?.filters?.sortBy) parts.push(`Sort: ${params.filters.sortBy}`);
  return parts.join(". ");
};

/** When true, log per-hotel amenity match in buildLastShownResultsContextText (tag yes/no). Set AI_AMENITIES_DEBUG=true or FLOW_RATE_DEBUG_LOGS=true. */
const AI_AMENITIES_DEBUG =
  process.env.AI_AMENITIES_DEBUG === "true" ||
  process.env.FLOW_RATE_DEBUG_LOGS === "true";

/** Map user phrases to regex patterns (more specific first, e.g. "indoor pool" before "pool"). */
const AMENITY_MATCH_PATTERNS = [
  {
    keys: [
      "indoor pool",
      "pileta indoor",
      "piscina interior",
      "pileta interior",
      "piscina cubierta",
    ],
    pattern:
      /indoor pool|piscina interior|pileta interior|piscina cubierta|pileta cubierta|heated indoor|indoor swimming/i,
  },
  {
    keys: ["pool", "piscina", "pileta", "swimming", "nataciÃ³n"],
    pattern: /pool|piscina|pileta|swimming|nataciÃ³n/i,
  },
  {
    keys: ["gym", "gimnasio", "fitness"],
    pattern: /gym|gimnasio|fitness|fitness center|musculaciÃ³n/i,
  },
  {
    keys: ["wifi", "wi-fi", "internet"],
    pattern: /wifi|wi-fi|wireless|internet|free wifi/i,
  },
  { keys: ["spa"], pattern: /spa|wellness|masaje|massage/i },
  {
    keys: ["parking", "estacionamiento", "garage"],
    pattern: /parking|estacionamiento|garage|car park|free parking/i,
  },
  {
    keys: ["breakfast", "desayuno"],
    pattern: /breakfast|desayuno|included breakfast/i,
  },
  {
    keys: ["restaurant", "restaurante"],
    pattern: /restaurant|restaurante|dining/i,
  },
  { keys: ["bar"], pattern: /\bbar\b|bar area|lobby bar/i },
  { keys: ["beach", "playa"], pattern: /beach|playa|private beach/i },
  {
    keys: ["air conditioning", "aire acondicionado", "ac"],
    pattern: /air conditioning|aire acondicionado|a\/c|ac\b|climate/i,
  },
  {
    keys: ["airport shuttle", "traslado", "shuttle"],
    pattern: /airport shuttle|traslado|shuttle|transfer/i,
  },
  {
    keys: ["pet", "mascota", "pets"],
    pattern: /pet|mascota|pets|pet-friendly|dog|perro/i,
  },
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
  if (!summary || (!summary.hotels?.length && !summary.homes?.length))
    return null;
  const featureRegex = getRequestedFeatureRegex(latestUserMessage);
  const tagLabel = featureRegex ? "Matches" : null;

  const formatHotel = (h, prefix = "") => {
    const am = Array.isArray(h.amenities) ? h.amenities.join(", ") : "";
    const matches = tagLabel && featureRegex ? featureRegex.test(am) : null;
    if (AI_AMENITIES_DEBUG && tagLabel) {
      console.log("[ai][amenities-debug]", {
        name: h.name,
        matches: matches ? "yes" : "no",
      });
    }
    const tag =
      tagLabel != null ? ` [${tagLabel}: ${matches ? "yes" : "no"}]` : "";
    const reason = h.shortReason ? ` | highlight: ${h.shortReason}` : "";
    const reasons =
      Array.isArray(h.matchReasons) && h.matchReasons.length
        ? ` | reasons: ${h.matchReasons.slice(0, 3).join("; ")}`
        : "";
    const evidence =
      Array.isArray(h.semanticEvidence) && h.semanticEvidence.length
        ? ` | semantic: ${h.semanticEvidence
            .slice(0, 3)
            .map((entry) =>
              typeof entry === "string"
                ? entry
                : `${entry.type || "signal"}:${entry.label || entry.value || ""}`,
            )
            .join(", ")}`
        : "";
    const desc =
      Array.isArray(h.descriptions) && h.descriptions[0]
        ? ` | desc: ${h.descriptions[0]}`
        : "";
    return `${prefix}- [ID:${h.id}] ${h.name}, ${h.city}, ${h.stars || ""}, price ${h.pricePerNight ?? "?"} ${h.currency}, amenities: ${am}${tag}${reason}${reasons}${evidence}${desc}`;
  };

  const lines = [];

  if (summary.hotels?.length) {
    const picks = summary.hotels.filter((h) => h.isPick);
    const seeAll = summary.hotels.filter((h) => !h.isPick);

    if (picks.length) {
      lines.push(
        `Hotels shown as cards (${picks.length} — user saw these prominently):`,
      );
      picks.forEach((h) => lines.push(formatHotel(h)));
    }
    if (seeAll.length) {
      lines.push(
        `Hotels in "See All" modal (${seeAll.length} — user can browse these):`,
      );
      seeAll.forEach((h) => lines.push(formatHotel(h)));
    }
    if (!picks.length && !seeAll.length) {
      lines.push("Hotels:");
      summary.hotels.forEach((h) => lines.push(formatHotel(h)));
    }
  }

  if (summary.homes?.length) {
    lines.push("Homes:");
    summary.homes.forEach((h) => {
      const am = Array.isArray(h.amenities) ? h.amenities.join(", ") : "";
      const matches = tagLabel && featureRegex ? featureRegex.test(am) : null;
      const tag =
        tagLabel != null ? ` [Matches: ${matches ? "yes" : "no"}]` : "";
      const reason = h.shortReason ? ` | highlight: ${h.shortReason}` : "";
      lines.push(
        `- [ID:${h.id || h.title}] ${h.name || h.title}, ${h.city}, price ${h.pricePerNight ?? "?"} ${h.currency}, amenities: ${am}${tag}${reason}`,
      );
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
    /\b(more about|tell me more|mÃ¡s (sobre|informaciÃ³n|info)|detalles?|details?|info about|informaciÃ³n de|quÃ© tal|what about)\b/i.test(
      text,
    ) ||
    /\b(does (the )?(first|second|third|that one)|(el |la )?(primero|segundo|tercero)|tiene (el |la )?(primero)|that hotel|ese hotel)\b/i.test(
      text,
    ) ||
    /\b(how about|and the first|y el primero|cuÃ©ntame (del|de la)|dime (del|de la))\b/i.test(
      text,
    ) ||
    /\b(sabes (algo )?de|do you have (info|details)|tienes (info|datos)|info del|informaciÃ³n del|data on)\b/i.test(
      text,
    );

  for (const h of hotels) {
    const name = (h?.name || "").trim().toLowerCase();
    if (name && text.includes(name)) return { stayId: h.id, type: "HOTEL" };
  }
  for (const h of homes) {
    const name = (h?.name || h?.title || "").trim().toLowerCase();
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
  if (hotels.length > 0 && hotels[0]?.id)
    return { stayId: hotels[0].id, type: "HOTEL" };
  if (homes.length > 0 && homes[0]?.id)
    return { stayId: homes[0].id, type: "HOME" };
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
    const am = (d.amenities || [])
      .map((a) => (typeof a === "string" ? a : a?.name))
      .filter(Boolean);
    if (am.length) parts.push(`Amenities: ${am.join(", ")}`);
    if (d.leisure?.length) parts.push(`Leisure: ${d.leisure.join(", ")}`);
    if (d.business?.length) parts.push(`Business: ${d.business.join(", ")}`);
    if (d.shortDescription) parts.push(`Description: ${d.shortDescription}`);
    if (d.propertyInfo?.roomsCount != null)
      parts.push(`Rooms: ${d.propertyInfo.roomsCount}`);
    if (d.classification?.name)
      parts.push(`Classification: ${d.classification.name}`);
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
          const content =
            typeof message.content === "string" ? message.content.trim() : "";
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
    if (
      !plan.location.city &&
      !plan.location.country &&
      !plan.location.landmark
    ) {
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
      if (!plan.location || typeof plan.location !== "object")
        plan.location = {};
      if (!Number.isFinite(Number(plan.location.lat))) plan.location.lat = lat;
    }
  }
  if (confirmedSearch.lng != null) {
    const lng = Number(confirmedSearch.lng);
    if (Number.isFinite(lng)) {
      if (!plan.location || typeof plan.location !== "object")
        plan.location = {};
      const existingLng = Number(plan.location.lng ?? plan.location.lon);
      if (!Number.isFinite(existingLng)) plan.location.lng = lng;
    }
  }
  if (confirmedSearch.when && String(confirmedSearch.when).trim()) {
    const whenStr = String(confirmedSearch.when).trim();
    const parts = whenStr
      .split("|")
      .map((p) => String(p).trim())
      .filter(Boolean);
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
    const adults = adultsMatch
      ? Math.max(1, parseInt(adultsMatch[1], 10))
      : null;
    const children = childrenMatch
      ? Math.max(0, parseInt(childrenMatch[1], 10))
      : 0;
    if (!plan.guests || typeof plan.guests !== "object") plan.guests = {};
    if (adults !== null) plan.guests.adults = adults;
    plan.guests.children = children;
  }
};

const applyPlanDefaults = (plan, state) => {
  const nextPlan = { ...(plan || {}) };
  if (!Array.isArray(nextPlan.listingTypes) || !nextPlan.listingTypes.length) {
    if (
      Array.isArray(state?.preferences?.listingTypes) &&
      state.preferences.listingTypes.length
    ) {
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

const SEARCH_EXECUTION_MODES = Object.freeze({
  CATALOG_DISCOVERY: "CATALOG_DISCOVERY",
  LIVE_AVAILABILITY: "LIVE_AVAILABILITY",
});

const SEARCH_UI_EVENTS = Object.freeze({
  PLACE_DISAMBIGUATION_SUBMIT: "PLACE_DISAMBIGUATION_SUBMIT",
  DATE_RANGE_SUBMIT: "DATE_RANGE_SUBMIT",
  GUEST_COUNT_SUBMIT: "GUEST_COUNT_SUBMIT",
  NATIONALITY_SUBMIT: "NATIONALITY_SUBMIT",
  PENDING_CANCEL: "PENDING_CANCEL",
  LIVE_AVAILABILITY_ENABLE: "LIVE_AVAILABILITY_ENABLE",
});

const normalizeUiEventId = (uiEvent) =>
  String(
    typeof uiEvent === "string" ? uiEvent : uiEvent?.id || uiEvent?.event || "",
  )
    .trim()
    .toUpperCase();

const getUiEventPayload = (uiEvent) => {
  if (!uiEvent || typeof uiEvent !== "object" || Array.isArray(uiEvent)) {
    return null;
  }
  const payload = uiEvent?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload;
};

const getConfirmedWhenFromUiEvent = (uiEvent) => {
  const payload = getUiEventPayload(uiEvent);
  const checkIn = String(payload?.checkIn || "").trim();
  const checkOut = String(payload?.checkOut || "").trim();
  if (!checkIn || !checkOut) return null;
  return `${checkIn}|${checkOut}`;
};

const getConfirmedWhoFromUiEvent = (uiEvent) => {
  const payload = getUiEventPayload(uiEvent);
  const adults = Number(payload?.adults);
  const children = Number(payload?.children);
  if (!Number.isFinite(adults) || adults < 1) return null;
  const normalizedAdults = Math.max(1, Math.floor(adults));
  const normalizedChildren =
    Number.isFinite(children) && children > 0 ? Math.floor(children) : 0;
  return `${normalizedAdults} adults${
    normalizedChildren ? ` ${normalizedChildren} children` : ""
  }`;
};

const getNationalityCodeFromUiEvent = (uiEvent) => {
  const payload = getUiEventPayload(uiEvent);
  const code = String(
    payload?.code ?? payload?.nationality ?? payload?.countryCode ?? "",
  ).trim();
  return code || null;
};

const getPlaceSelectionIdFromUiEvent = (uiEvent) => {
  const payload = getUiEventPayload(uiEvent);
  const selectionId = String(
    payload?.optionId ?? payload?.placeSelectionId ?? payload?.selectionId ?? "",
  ).trim();
  return selectionId || null;
};

const normalizeSearchExecutionMode = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === SEARCH_EXECUTION_MODES.LIVE_AVAILABILITY) {
    return SEARCH_EXECUTION_MODES.LIVE_AVAILABILITY;
  }
  return SEARCH_EXECUTION_MODES.CATALOG_DISCOVERY;
};

const isAvailabilityPendingField = (value) =>
  new Set(["dateRange", "guestCount", "nationality"]).has(
    String(value || "").trim(),
  );

const normalizePlaceSelectionText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const resolvePlaceSelectionIdFromFreeText = ({
  pendingToolCall = null,
  latestUserMessage = "",
} = {}) => {
  if (pendingToolCall?.missingField !== "placeDisambiguation") return null;
  const text = normalizePlaceSelectionText(latestUserMessage);
  if (!text) return null;
  const options = Array.isArray(pendingToolCall?.clarificationOptions)
    ? pendingToolCall.clarificationOptions
    : [];
  const scored = options
    .map((candidate) => {
      const fields = [
        candidate?.label,
        candidate?.normalizedName,
        candidate?.subtitle,
        candidate?.city,
        candidate?.country,
        ...(Array.isArray(candidate?.aliases) ? candidate.aliases : []),
      ]
        .map(normalizePlaceSelectionText)
        .filter(Boolean);
      let score = 0;
      for (const field of fields) {
        if (field === text) score = Math.max(score, 100);
        else if (field.includes(text) || text.includes(field)) {
          score = Math.max(score, Math.min(field.length, text.length));
        }
      }
      return { id: String(candidate?.id || "").trim(), score };
    })
    .filter((entry) => entry.id && entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.id || null;
};

const getResumeOnlyFrom = (inputType) => {
  if (inputType === "placeDisambiguation") {
    return [SEARCH_UI_EVENTS.PLACE_DISAMBIGUATION_SUBMIT];
  }
  if (inputType === "dateRange") {
    return [SEARCH_UI_EVENTS.DATE_RANGE_SUBMIT];
  }
  if (inputType === "guestCount") {
    return [SEARCH_UI_EVENTS.GUEST_COUNT_SUBMIT];
  }
  if (inputType === "nationality") {
    return [SEARCH_UI_EVENTS.NATIONALITY_SUBMIT];
  }
  return [];
};

const applyUiEventToPlan = (plan, uiEvent) => {
  const nextPlan = { ...(plan || {}) };
  if (!uiEvent) return nextPlan;
  const normalized = normalizeUiEventId(uiEvent);
  const payload = getUiEventPayload(uiEvent);
  if (!normalized) return nextPlan;

  if (normalized.includes("CHEAP") || normalized.includes("LOW_PRICE")) {
    nextPlan.sortBy = "PRICE_ASC";
  } else if (
    normalized.includes("EXPENSIVE") ||
    normalized.includes("HIGH_PRICE")
  ) {
    nextPlan.sortBy = "PRICE_DESC";
  } else if (normalized.includes("POPULAR")) {
    nextPlan.sortBy = "POPULARITY";
  }

  if (normalized.includes("HOTELS")) {
    nextPlan.listingTypes = ["HOTELS"];
  } else if (normalized.includes("HOMES")) {
    nextPlan.listingTypes = ["HOMES"];
  }

  if (normalized === SEARCH_UI_EVENTS.LIVE_AVAILABILITY_ENABLE) {
    nextPlan.searchExecutionMode = SEARCH_EXECUTION_MODES.LIVE_AVAILABILITY;
  }

  if (normalized === SEARCH_UI_EVENTS.DATE_RANGE_SUBMIT) {
    const checkIn = String(payload?.checkIn || "").trim();
    const checkOut = String(payload?.checkOut || "").trim();
    if (checkIn && checkOut) {
      if (!nextPlan.dates || typeof nextPlan.dates !== "object") {
        nextPlan.dates = {};
      }
      nextPlan.dates.checkIn = checkIn;
      nextPlan.dates.checkOut = checkOut;
      nextPlan.dates.flexible = false;
    }
  }

  if (normalized === SEARCH_UI_EVENTS.GUEST_COUNT_SUBMIT) {
    const adults = Number(payload?.adults);
    const children = Number(payload?.children);
    if (Number.isFinite(adults) && adults >= 1) {
      if (!nextPlan.guests || typeof nextPlan.guests !== "object") {
        nextPlan.guests = {};
      }
      nextPlan.guests.adults = Math.max(1, Math.floor(adults));
      nextPlan.guests.children =
        Number.isFinite(children) && children > 0 ? Math.floor(children) : 0;
    }
  }

  if (normalized === SEARCH_UI_EVENTS.NATIONALITY_SUBMIT) {
    const nationalityCode = getNationalityCodeFromUiEvent(uiEvent);
    if (nationalityCode) {
      nextPlan.passengerNationality = nationalityCode;
      if (!nextPlan.passengerCountryOfResidence) {
        nextPlan.passengerCountryOfResidence = nationalityCode;
      }
    }
  }

  return nextPlan;
};

const PLACE_CATEGORIES = [
  {
    id: "food",
    type: "restaurant",
    label: "Food",
    keywords: [
      "restaurant",
      "restaurante",
      "comida",
      "food",
      "cafe",
      "cafeteria",
      "brunch",
      "bar",
    ],
  },
  {
    id: "attractions",
    type: "tourist_attraction",
    label: "Attractions",
    keywords: [
      "atraccion",
      "atracciones",
      "attraction",
      "tourist",
      "interesante",
      "museo",
      "museum",
      "parque",
      "park",
    ],
  },
  {
    id: "shopping",
    type: "shopping_mall",
    label: "Shopping",
    keywords: [
      "shopping",
      "compras",
      "mall",
      "centro comercial",
      "outlet",
      "tiendas",
    ],
  },
  {
    id: "clothing",
    type: "clothing_store",
    label: "Clothing",
    keywords: [
      "ropa",
      "clothing",
      "fashion",
      "boutique",
      "zapatos",
      "shoe",
      "moda",
    ],
  },
  {
    id: "pharmacy",
    type: "pharmacy",
    label: "Pharmacy",
    keywords: [
      "farmacia",
      "farmacias",
      "pharmacy",
      "pharmacies",
      "medicina",
      "medicinas",
    ],
  },
  {
    id: "grocery",
    type: "grocery_or_supermarket",
    label: "Groceries",
    keywords: [
      "supermercado",
      "super",
      "grocery",
      "groceries",
      "market",
      "mercado",
    ],
  },
  {
    id: "hospital",
    type: "hospital",
    label: "Hospital",
    keywords: [
      "hospital",
      "clinica",
      "clinics",
      "clinic",
      "emergencia",
      "emergency",
    ],
  },
  {
    id: "atm",
    type: "atm",
    label: "ATM",
    keywords: ["atm", "cajero", "cajeros", "cash", "dinero"],
  },
];

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const HOTEL_SEARCH_INTENT_PATTERN =
  /\b(hotel(?:es)?|hospedaje|alojamiento|stay|stays|accommodation|room(?:s)?|habitaci(?:o|ó)n(?:es)?|resort|hostel|motel|suite(?:s)?)\b/i;
const HOTEL_SEARCH_FILTER_PATTERN =
  /\b(\d+\s*(?:star|stars|estrellas?)|pileta|piscina|pool|spa|gym|wifi|parking|desayuno|breakfast|barato|barata|cheap|budget|low cost|luxury|lujo|premium|buena zona|good area|safe area|nightlife|vista|view|river|r[ií]o)\b/i;
const EXPLICIT_NEARBY_PLACES_PATTERN =
  /\b(lugares|places|restaurant(?:e)?s?|comida|shopping|compras|ropa|attraction(?:es)?|atraccion(?:es)?|farmacia|pharmacy|supermercado|grocery|market|hospital|clinica|clinic|atm|cajero|cash|museo|museum|parque|park|cafe|coffee|bar|pub|what(?:'s| is)? nearby|what(?:'s| is)? near|anything nearby|anything near|que hay cerca|qué hay cerca|que puedo hacer cerca|qué puedo hacer cerca|what to do nearby|what to do near)\b/i;

const extractLatestUserMessage = (messages = []) =>
  [...messages].reverse().find((msg) => msg?.role === "user" && msg?.content)
    ?.content || "";

const extractRadiusKm = (text) => {
  const match = String(text || "").match(
    /(\d+(?:\.\d+)?)\s*(km|kilometros|kilometers)/i,
  );
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const normalizeTripContext = (value) => {
  if (!value || typeof value !== "object") return null;
  const raw = value.trip || value;
  if (!raw || typeof raw !== "object") return null;
  const location = raw.location || raw.destination || {};
  const lat = Number(
    location.lat ?? location.latitude ?? raw.lat ?? raw.latitude,
  );
  const lng = Number(
    location.lng ??
      location.lon ??
      location.longitude ??
      raw.lng ??
      raw.longitude,
  );
  const locationText =
    raw.locationText ||
    raw.address ||
    location.address ||
    [location.city, location.state, location.country]
      .filter(Boolean)
      .join(", ") ||
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

export const hasAuthoritativeSearchTurn = ({
  toolName = null,
  nextAction = null,
  plan = null,
  inventory = null,
  latestUserMessage = "",
} = {}) => {
  if (toolName === "search_stays") return true;
  if (nextAction === NEXT_ACTIONS.RUN_SEARCH) return true;
  if (plan?.intent === INTENTS.SEARCH || plan?.intent === "SEARCH") return true;

  const inventoryCount =
    (inventory?.hotels?.length || 0) + (inventory?.homes?.length || 0);
  if (inventoryCount > 0) return true;

  const hasStructuredSearchSignals = Boolean(
    Array.isArray(plan?.starRatings) && plan.starRatings.length,
  ) ||
    Boolean(plan?.viewIntent) ||
    Boolean(plan?.geoIntent) ||
    (Array.isArray(plan?.placeTargets) && plan.placeTargets.length > 0) ||
    Boolean(plan?.areaIntent) ||
    Boolean(plan?.qualityIntent) ||
    (Array.isArray(plan?.areaTraits) && plan.areaTraits.length > 0) ||
    (Array.isArray(plan?.preferenceNotes) && plan.preferenceNotes.length > 0) ||
    Boolean(plan?.sortBy) ||
    (Array.isArray(plan?.hotelFilters?.amenityCodes) &&
      plan.hotelFilters.amenityCodes.length > 0) ||
    plan?.hotelFilters?.minRating != null ||
    (Array.isArray(plan?.semanticSearch?.referenceHotelIds) &&
      plan.semanticSearch.referenceHotelIds.length > 0) ||
    Boolean(plan?.preferences?.nearbyInterest) ||
    Boolean(plan?.preferences?.areaPreference?.length);
  if (hasStructuredSearchSignals) return true;

  const text = normalizeText(latestUserMessage);
  if (!text) return false;
  return (
    HOTEL_SEARCH_INTENT_PATTERN.test(text) ||
    HOTEL_SEARCH_FILTER_PATTERN.test(text)
  );
};

export const extractTripRequest = ({ text, uiEvent, tripContext }) => {
  const normalized = normalizeText(text);
  const uiRaw =
    typeof uiEvent === "string" ? uiEvent : uiEvent?.id || uiEvent?.event || "";
  const normalizedUi = normalizeText(uiRaw);
  const wantsItinerary =
    /(itinerario|itinerary|planificar|plan|organizar|armar|schedule|dia\s+\d|day\s+\d)/i.test(
      normalized,
    );
  const hasHotelSearchIntent =
    HOTEL_SEARCH_INTENT_PATTERN.test(normalized) ||
    HOTEL_SEARCH_FILTER_PATTERN.test(normalized);

  // Extract specific keyword if present (very naive, just checks existence)
  let specificKeyword = null;
  if (/(museo|museum)/i.test(normalized)) specificKeyword = "museum";
  else if (/(parque|park)/i.test(normalized)) specificKeyword = "park";
  else if (/(cafe|coffee)/i.test(normalized)) specificKeyword = "cafe";
  else if (/\b(bar|pub)\b/i.test(normalized)) specificKeyword = "bar";
  else if (/(farmacia|pharmacy)/i.test(normalized))
    specificKeyword = "pharmacy";
  else if (/(supermercado|grocery|market)/i.test(normalized))
    specificKeyword = "grocery store";
  else if (/(hospital|clinica|clinic|emergency)/i.test(normalized))
    specificKeyword = "hospital";
  else if (/(atm|cajero|cash)/i.test(normalized)) specificKeyword = "atm";
  else if (/(sushi|pizza|burger|pasta)/i.test(normalized))
    specificKeyword = normalized.match(/(sushi|pizza|burger|pasta)/i)[0];

  const keyword = /(vegano|vegan|vegetarian|veg)/i.test(normalized)
    ? "vegan"
    : specificKeyword;

  const categories = PLACE_CATEGORIES.filter((category) =>
    category.keywords.some((kw) => normalized.includes(kw)),
  );
  const wantsNearby =
    EXPLICIT_NEARBY_PLACES_PATTERN.test(normalized) ||
    categories.length > 0 ||
    Boolean(specificKeyword);

  const shouldBootstrap =
    normalizedUi.includes("trip") ||
    normalizedUi.includes("itinerary") ||
    normalizedUi.includes("plan");

  if (!wantsItinerary && !wantsNearby && !shouldBootstrap) return null;
  if (!tripContext) return null;
  if (hasHotelSearchIntent && !wantsItinerary && !shouldBootstrap) return null;

  const resolvedCategories = categories.length
    ? categories
    : [PLACE_CATEGORIES[1], PLACE_CATEGORIES[0], PLACE_CATEGORIES[2]].filter(
        Boolean,
      );

  return {
    categories: resolvedCategories,
    keyword,
    wantsItinerary: wantsItinerary || shouldBootstrap,
    radiusKm: extractRadiusKm(text) ?? tripContext.radiusKm ?? null,
    raw: text,
  };
};

const resolveTripLocation = async (tripContext, state, plan, userContext) => {
  if (
    tripContext?.location?.lat != null &&
    tripContext?.location?.lng != null
  ) {
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
    normalized.match(
      /(?:clima|tiempo|weather|temperatura|pronostico)\s*(?:en|in)\s+(.+)/i,
    ) || normalized.match(/\b(?:en|in)\s+(.+)/i);
  if (!match) return "";
  const raw = match[1] || "";
  return raw.replace(/[?.!,]+$/g, "").trim();
};

const resolveWeatherLocation = async ({
  text,
  tripContext,
  state,
  plan,
  userContext,
}) => {
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
  const start = tripContext?.dates?.checkIn
    ? new Date(tripContext.dates.checkIn)
    : null;
  const end = tripContext?.dates?.checkOut
    ? new Date(tripContext.dates.checkOut)
    : null;
  const dates = [];
  if (
    start &&
    end &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime())
  ) {
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

const SEARCH_RESULTS_HARD_CAP = 120;
const STATIC_SEARCH_RESULTS_LIMIT = SEARCH_RESULTS_HARD_CAP;
const LIVE_SEARCH_RESULTS_LIMIT = SEARCH_RESULTS_HARD_CAP;

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
    if (lang === "es")
      return "Para mostrarte precios en tiempo real necesito saber tu nacionalidad. ¿De dónde sos?";
    if (lang === "pt")
      return "Para mostrar preços ao vivo preciso saber sua nacionalidade. De onde você é?";
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
    (Number.isFinite(Number(state?.destination?.lat)) &&
      Number.isFinite(Number(state?.destination?.lon))) ||
    (Number.isFinite(Number(plan?.location?.lat)) &&
      Number.isFinite(Number(plan?.location?.lng ?? plan?.location?.lon))) ||
    plan?.location?.city ||
    plan?.location?.country,
  );

const LIVE_AVAILABILITY_FOLLOW_UP_PATTERN =
  /\b(disponibilidad real|precio real|precios reales|mostrarme disponibilidad|mostrame disponibilidad|mostrar disponibilidad|ver disponibilidad|ver precio real|live availability|live pricing|real availability|real prices|show availability|show me availability|show live rates)\b/i;

const MORE_OPTIONS_PATTERN =
  /\b(more options|more hotels|show more|show me more|more stays|another option|other options|otras opciones|mas opciones|mÃ¡s opciones|mÃ¡s hoteles|mas hoteles|mostrame mas|muÃ©strame mÃ¡s|mostrar mas|mostrar mÃ¡s|seguime mostrando|seguÃ­ mostrÃ¡ndome)\b/i;

const wantsExplicitLiveAvailability = (text) =>
  typeof text === "string" && LIVE_AVAILABILITY_FOLLOW_UP_PATTERN.test(text);

const referencesShownHotels = (text) =>
  typeof text === "string" &&
  /\b(esos hoteles|estos hoteles|de esos|de estos|alguno de esos|alguna de esas|those hotels|these hotels|of those|of these|any of them|those ones)\b/i.test(
    text,
  );

const wantsAdditionalSearchResults = (text) =>
  typeof text === "string" && MORE_OPTIONS_PATTERN.test(text);

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
  onKickoffChunk = null,
  onEvent = null,
} = {}) => {
  const startedAt = Date.now();
  let latestUserMessage = "";
  let debugCurrentToolName = null;
  let debugCurrentNextAction = null;
  const emitEvent = (type, data = {}) => {
    if (typeof onEvent !== "function" || !type) return;
    try {
      onEvent({ type, data });
    } catch (_) {}
  };
  const emitFileDebug = (stage, payload = {}, meta = {}) => {
    logAiFileDebug(stage, payload, {
      sessionId: sessionId || null,
      userId: userId || null,
      userMessage: latestUserMessage || null,
      toolName: debugCurrentToolName || null,
      nextAction: debugCurrentNextAction || null,
      ...meta,
    });
  };
  const emitTrace = (code, data = {}) => {
    if (!code) return;
    emitEvent("trace", { code, ...data });
    emitFileDebug("trace", data, { code });
  };

  // Circuit breaker
  if (circuitBreaker.isOpen()) {
    const err = new Error(
      "AI service is temporarily unavailable. Please try again in a moment.",
    );
    err.code = "AI_CIRCUIT_OPEN";
    err.status = 503;
    throw err;
  }

  if (!AI_FLAGS.chatEnabled) {
    return {
      inventory: buildEmptyInventory(),
      carousels: [],
      reply: "AI chat is disabled.",
      followUps: [],
      plan: null,
      state: stateOverride || null,
      ui: { chips: [], cards: [], inputs: [], sections: [] },
      webSources: [],
      intent: "SMALL_TALK",
      nextAction: "SMALL_TALK",
      safeMode: false,
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
    (sessionId && userId
      ? await loadAssistantState({ sessionId, userId })
      : null) ||
    getDefaultState();

  const incomingTripContext = normalizeTripContext(
    context?.trip ?? context?.tripContext ?? context,
  );
  const userContext = context && typeof context === "object" ? context : null;
  const uiEventId = normalizeUiEventId(uiEvent);
  const confirmedSearch =
    userContext &&
    typeof userContext === "object" &&
    userContext.confirmedSearch
      ? userContext.confirmedSearch
      : null;
  latestUserMessage = extractLatestUserMessage(normalizedMessages);

  // 3. Detect language
  const language = detectLanguageFC(normalizedMessages, userContext);

  // 3a. Cancel pending — user dismissed the data-collection card
  if (
    userContext?.cancelPending === true ||
    uiEventId === SEARCH_UI_EVENTS.PENDING_CANCEL
  ) {
    if (existingState.pendingToolCall) {
      existingState.pendingToolCall = null;
      await saveAssistantState({ sessionId, userId, state: existingState });
    }
    const cancelMsg =
      language === "es"
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
  const incomingNationality =
    userContext?.passengerNationality ??
    userContext?.nationality ??
    getNationalityCodeFromUiEvent(uiEvent) ??
    null;
  const incomingWhen =
    userContext?.confirmedSearch?.when ?? getConfirmedWhenFromUiEvent(uiEvent);
  const incomingWho =
    userContext?.confirmedSearch?.who ?? getConfirmedWhoFromUiEvent(uiEvent);
  const incomingPlaceSelectionId =
    userContext?.confirmedSearch?.placeSelectionId ??
    userContext?.placeSelectionId ??
    getPlaceSelectionIdFromUiEvent(uiEvent) ??
    null;
  const textMatchedPlaceSelectionId =
    incomingPlaceSelectionId ||
    resolvePlaceSelectionIdFromFreeText({
      pendingToolCall: pendingTc,
      latestUserMessage,
    });
  const allowFreeTextPlaceDisambiguationResume = Boolean(
    pendingTc?.missingField === "placeDisambiguation" &&
      !uiEventId &&
      textMatchedPlaceSelectionId,
  );
  const resumeOnlyFrom = Array.isArray(pendingTc?.resumeOnlyFrom)
    ? pendingTc.resumeOnlyFrom.map((entry) => String(entry || "").trim().toUpperCase())
    : [];
  const uiEventMatchesPending =
    !resumeOnlyFrom.length ||
    (uiEventId && resumeOnlyFrom.includes(uiEventId)) ||
    allowFreeTextPlaceDisambiguationResume;
  const hasMatchingPlaceSelection = Boolean(
    pendingTc?.missingField === "placeDisambiguation" &&
      textMatchedPlaceSelectionId &&
      Array.isArray(pendingTc?.clarificationOptions) &&
      pendingTc.clarificationOptions.some(
        (candidate) =>
          String(candidate?.id || "").trim() ===
          String(textMatchedPlaceSelectionId || "").trim(),
      ),
  );
  const hasPendingToolCallResume = Boolean(
    !userContext?.skipDataCollection &&
    pendingTc?.toolName &&
    !existingState?.locks?.bookingFlowLocked &&
    uiEventMatchesPending &&
    ((pendingTc.missingField === "nationality" && incomingNationality) ||
      (pendingTc.missingField === "dateRange" && incomingWhen) ||
      (pendingTc.missingField === "guestCount" && incomingWho) ||
      hasMatchingPlaceSelection),
  );

  if (
    pendingTc?.missingField === "placeDisambiguation" &&
    !hasPendingToolCallResume &&
    !userContext?.skipDataCollection &&
    latestUserMessage &&
    !incomingPlaceSelectionId &&
    !uiEventId
  ) {
    const placeQuestionText =
      pendingTc?.clarificationQuestion ||
      getPlaceDisambiguationQuestion(
        language,
        pendingTc?.placeResolutionRequest?.placeTypeHint,
      );
    const uiInput = {
      type: "placeDisambiguation",
      id: "PLACE_DISAMBIGUATION",
      required: true,
      question: placeQuestionText,
      options: (Array.isArray(pendingTc?.clarificationOptions)
        ? pendingTc.clarificationOptions
        : []
      )
        .map((candidate) => ({
          id: candidate?.id || null,
          label: candidate?.label || candidate?.normalizedName || null,
          subtitle:
            candidate?.subtitle ||
            [candidate?.city, candidate?.country].filter(Boolean).join(", ") ||
            null,
          placeType: candidate?.placeType || "GENERIC",
          city: candidate?.city || null,
          country: candidate?.country || null,
        }))
        .filter((option) => option.id && option.label),
    };
    onTextChunk?.(placeQuestionText);
    return {
      reply: placeQuestionText,
      assistant: null,
      followUps: [],
      ui: { inputs: [uiInput], chips: [], cards: [], sections: [] },
      webSources: [],
      plan: null,
      inventory: buildEmptyInventory(),
      carousels: [],
      trip: null,
      state: existingState,
      intent: "SEARCH",
      nextAction: "ASK_FOR_PLACE_DISAMBIGUATION",
      safeMode: false,
    };
  }

  // 4. Build Call 1 system prompt
  const systemPrompt = buildSystemPrompt({
    state: existingState,
    userContext,
    language,
  });

  // 5. Thinking event
  emitEvent("thinking", {});
  emitTrace("ANALYZING_MESSAGE", {
    messageLength: latestUserMessage
      ? String(latestUserMessage).trim().length
      : 0,
  });

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
      model: AI_MODEL_CALL1,
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
          if (!toolCallAccum[idx])
            toolCallAccum[idx] = { id: "", name: "", arguments: "" };
          if (tc.id) toolCallAccum[idx].id += tc.id;
          if (tc.function?.name) toolCallAccum[idx].name += tc.function.name;
          if (tc.function?.arguments)
            toolCallAccum[idx].arguments += tc.function.arguments;
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
      toolCall = {
        id: tc.id,
        name: tc.name,
        args: JSON.parse(tc.arguments || "{}"),
      };
    } catch {
      toolCall = null;
    }
  }

  // 7a. Resume pending tool call — override toolCall to force the stored tool
  if (hasPendingToolCallResume) {
    const resumedArgs =
      pendingTc?.missingField === "placeDisambiguation"
        ? applyPlaceSelectionToToolArgs({
            args: pendingTc.args || {},
            pendingToolCall: pendingTc,
            selectionId: textMatchedPlaceSelectionId,
          })
        : pendingTc.args || {};
    toolCall = {
      id: "resume_pending",
      name: pendingTc.toolName,
      args: resumedArgs,
    };
  }

  const shouldForceLiveAvailabilitySearch =
    (userContext?.forceLiveAvailability === true ||
      uiEventId === SEARCH_UI_EVENTS.LIVE_AVAILABILITY_ENABLE) &&
    !hasPendingToolCallResume &&
    !existingState?.locks?.bookingFlowLocked &&
    Boolean(existingState?.destination?.name);

  if (shouldForceLiveAvailabilitySearch) {
    toolCall = {
      id: "force_live_availability",
      name: "search_stays",
      args: {
        city: existingState?.destination?.name || null,
        checkIn: existingState?.dates?.checkIn || null,
        checkOut: existingState?.dates?.checkOut || null,
        adults: existingState?.guests?.adults ?? null,
        children: existingState?.guests?.children ?? null,
        wantsMoreResults: false,
      },
    };
  }

  const referencedHotelIdsForLiveFollowUp =
    buildReferencedHotelIdsFromState(existingState);
  const shouldForceAvailabilityForShownHotels =
    !hasPendingToolCallResume &&
    !existingState?.locks?.bookingFlowLocked &&
    wantsExplicitLiveAvailability(latestUserMessage) &&
    referencesShownHotels(latestUserMessage) &&
    referencedHotelIdsForLiveFollowUp.length > 0;

  if (shouldForceAvailabilityForShownHotels) {
    const baseSearchPlan =
      existingState?.searchPlan && typeof existingState.searchPlan === "object"
        ? existingState.searchPlan
        : {};
    const forcedArgs = {
      city:
        toolCall?.args?.city ||
        baseSearchPlan?.location?.city ||
        existingState?.destination?.name ||
        null,
      country:
        toolCall?.args?.country || baseSearchPlan?.location?.country || null,
      checkIn: toolCall?.args?.checkIn || existingState?.dates?.checkIn || null,
      checkOut:
        toolCall?.args?.checkOut || existingState?.dates?.checkOut || null,
      adults: toolCall?.args?.adults ?? existingState?.guests?.adults ?? null,
      children:
        toolCall?.args?.children ?? existingState?.guests?.children ?? null,
      sortBy: toolCall?.args?.sortBy ?? baseSearchPlan?.sortBy ?? null,
      amenityCodes: Array.isArray(toolCall?.args?.amenityCodes)
        ? toolCall.args.amenityCodes
        : Array.isArray(baseSearchPlan?.hotelFilters?.amenityCodes)
          ? baseSearchPlan.hotelFilters.amenityCodes
          : [],
      minStars:
        toolCall?.args?.minStars ?? baseSearchPlan?.hotelFilters?.minRating ?? null,
      starRatings: Array.isArray(toolCall?.args?.starRatings)
        ? toolCall.args.starRatings
        : Array.isArray(baseSearchPlan?.starRatings)
          ? baseSearchPlan.starRatings
          : [],
      viewIntent: toolCall?.args?.viewIntent ?? baseSearchPlan?.viewIntent ?? null,
      geoIntent: toolCall?.args?.geoIntent ?? baseSearchPlan?.geoIntent ?? null,
      placeTargets: Array.isArray(toolCall?.args?.placeTargets)
        ? toolCall.args.placeTargets
        : Array.isArray(baseSearchPlan?.placeTargets)
          ? baseSearchPlan.placeTargets
          : [],
      areaIntent: toolCall?.args?.areaIntent ?? baseSearchPlan?.areaIntent ?? null,
      qualityIntent:
        toolCall?.args?.qualityIntent ?? baseSearchPlan?.qualityIntent ?? null,
      areaTraits: Array.isArray(toolCall?.args?.areaTraits)
        ? toolCall.args.areaTraits
        : Array.isArray(baseSearchPlan?.areaTraits)
          ? baseSearchPlan.areaTraits
          : [],
      preferenceNotes: Array.isArray(toolCall?.args?.preferenceNotes)
        ? toolCall.args.preferenceNotes
        : Array.isArray(baseSearchPlan?.preferenceNotes)
          ? baseSearchPlan.preferenceNotes
          : [],
      areaPreference: Array.isArray(baseSearchPlan?.preferences?.areaPreference)
        ? baseSearchPlan.preferences.areaPreference[0] ?? null
        : null,
      nearbyInterest:
        toolCall?.args?.nearbyInterest ??
        baseSearchPlan?.preferences?.nearbyInterest ??
        null,
      wantsMoreResults: false,
      referenceHotelIds: referencedHotelIdsForLiveFollowUp,
    };
    toolCall = {
      id:
        toolCall?.name === "search_stays"
          ? toolCall.id || "availability_for_shown_hotels"
          : "availability_for_shown_hotels",
      name: "search_stays",
      args: forcedArgs,
    };
    emitTrace("AVAILABILITY_FOR_SHOWN_HOTELS_TRIGGERED", {
      referencedHotelIds: referencedHotelIdsForLiveFollowUp,
      destination:
        baseSearchPlan?.location?.city ||
        existingState?.destination?.name ||
        null,
    });
  }

  // 7b. bookingFlowLocked guard — force SMALL_TALK if locked
  if (
    existingState?.locks?.bookingFlowLocked &&
    toolCall &&
    ["search_stays", "get_stay_details"].includes(toolCall.name)
  ) {
    toolCall = null;
  }
  debugCurrentToolName = toolCall?.name || null;
  emitFileDebug("tool_call_resolved", {
    finishReason,
    directTextPreview: directText ? directText.slice(0, 240) : null,
    resumedPendingToolCall: hasPendingToolCallResume,
    forcedLiveAvailabilitySearch: shouldForceLiveAvailabilitySearch,
    forcedAvailabilityForShownHotels: shouldForceAvailabilityForShownHotels,
    toolCall: summarizeToolCallForDebug(toolCall),
  });

  // 8. Handle tool cases
  let plan = null;
  let inventory = buildEmptyInventory();
  let carousels = [];
  let nextAction = "SMALL_TALK";
  debugCurrentNextAction = nextAction;
  let resolvedIntent = "SMALL_TALK";
  let preparedReply = null;
  let stayDetailsFromDb = null;
  let webSources = [];
  let allowCompetitorWebSources = false;

  if (toolCall?.name === "search_stays") {
    // ---- A. SEARCH ----
    // Check if we're resuming from a stored pendingToolCall (interrupted to collect missing data)
    const storedPending = existingState?.pendingToolCall || null;
    const originalToolArgs = hasPendingToolCallResume
      ? toolCall.args
      : storedPending?.args || toolCall.args;
    const explicitLiveAvailabilityRequest =
      wantsExplicitLiveAvailability(latestUserMessage) ||
      uiEventId === SEARCH_UI_EVENTS.LIVE_AVAILABILITY_ENABLE;
    const forcedLiveAvailabilityRequest =
      userContext?.forceLiveAvailability === true ||
      uiEventId === SEARCH_UI_EVENTS.LIVE_AVAILABILITY_ENABLE;
    const hasExplicitAvailabilityInputs = Boolean(
      originalToolArgs?.checkIn ||
        originalToolArgs?.checkOut ||
        originalToolArgs?.adults != null ||
        userContext?.confirmedSearch?.when ||
        userContext?.confirmedSearch?.who,
    );
    const searchExecutionMode =
      explicitLiveAvailabilityRequest ||
      forcedLiveAvailabilityRequest ||
      hasExplicitAvailabilityInputs
        ? SEARCH_EXECUTION_MODES.LIVE_AVAILABILITY
        : normalizeSearchExecutionMode(storedPending?.blockingMode);
    const shouldRequireBlockingSearchInputs =
      searchExecutionMode === SEARCH_EXECUTION_MODES.LIVE_AVAILABILITY &&
      (isAvailabilityPendingField(storedPending?.missingField) ||
        explicitLiveAvailabilityRequest ||
        forcedLiveAvailabilityRequest);

    // Build plan: from stored args (if resuming) OR new tool args
    plan = buildPlanFromToolArgs(originalToolArgs, language);
    plan.searchExecutionMode = searchExecutionMode;
    ensureSemanticSearchState(plan);
    if (Array.isArray(toolCall.args?.referenceHotelIds)) {
      plan.semanticSearch.referenceHotelIds = normalizeReferencedHotelIds(
        toolCall.args.referenceHotelIds,
      );
    } else if (Array.isArray(originalToolArgs?.referenceHotelIds)) {
      plan.semanticSearch.referenceHotelIds = normalizeReferencedHotelIds(
        originalToolArgs.referenceHotelIds,
      );
    }
    console.log(
      "[DEBUG-1] plan.guests después de buildPlanFromToolArgs:",
      JSON.stringify(plan.guests),
    );
    // Always inject confirmedSearch — dates/guests from UI widgets come through here on resume
    injectConfirmedSearchIntoPlan(plan, confirmedSearch);
    console.log(
      "[DEBUG-2] plan.guests después de injectConfirmedSearchIntoPlan:",
      JSON.stringify(plan.guests),
    );
    emitFileDebug("plan_after_tool", {
      plan: summarizePlanForDebug(plan),
    });

    // Helper: interrupt to collect a missing field, save pendingToolCall, stream question
    const interruptForStructuredInput = async ({
      inputType,
      nextActionValue,
      questionText = "",
      uiInput = null,
      pendingExtras = {},
    } = {}) => {
      const normalizedQuestion =
        typeof questionText === "string" && questionText.trim()
          ? questionText.trim()
          : getMissingDataQuestion(inputType, language);
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
      if (Array.isArray(plan?.semanticSearch?.referenceHotelIds)) {
        enrichedArgs.referenceHotelIds = plan.semanticSearch.referenceHotelIds;
      }
      existingState.pendingToolCall = {
        toolName: "search_stays",
        args: enrichedArgs,
        missingField: inputType,
        blockingMode: searchExecutionMode,
        resumeOnlyFrom: getResumeOnlyFrom(inputType),
        savedAt: Date.now(),
        ...pendingExtras,
      };
      await saveAssistantState({ sessionId, userId, state: existingState });
      onTextChunk?.(normalizedQuestion);
      return {
        reply: normalizedQuestion,
        assistant: null,
        followUps: [],
        ui: {
          inputs: [
            uiInput && typeof uiInput === "object"
              ? uiInput
              : { type: inputType },
          ],
        },
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
    const interruptForMissingData = async (inputType, nextActionValue) =>
      interruptForStructuredInput({
        inputType,
        nextActionValue,
      });

    // 1. Recover dates/guests from existingState only for live-availability turns.
    if (
      searchExecutionMode === SEARCH_EXECUTION_MODES.LIVE_AVAILABILITY &&
      storedPending?.missingField !== "placeDisambiguation" &&
      !plan.dates?.checkIn &&
      existingState?.dates?.checkIn
    ) {
      if (!plan.dates || typeof plan.dates !== "object") plan.dates = {};
      plan.dates.checkIn = existingState.dates.checkIn;
      plan.dates.checkOut = existingState.dates.checkOut || null;
      plan.dates.flexible = false;
    }
    if (
      searchExecutionMode === SEARCH_EXECUTION_MODES.LIVE_AVAILABILITY &&
      storedPending?.missingField !== "placeDisambiguation" &&
      !plan.guests?.adults &&
      existingState?.guests?.adults
    ) {
      if (!plan.guests || typeof plan.guests !== "object") plan.guests = {};
      plan.guests.adults = existingState.guests.adults;
      plan.guests.children = existingState.guests.children ?? 0;
    }

    // Apply UI event (e.g. sort chips) and defaults
    const planWithUi = applyUiEventToPlan(plan, uiEvent);
    let planWithDefaults = applyPlanDefaults(planWithUi, existingState);
    planWithDefaults.searchExecutionMode = searchExecutionMode;
    let assistantKickoff = null;
    let assistantKickoffDeliveredSeparately = false;
    let assistantKickoffBlocked = false;
    const nextKickoffProgressType =
      searchExecutionMode === SEARCH_EXECUTION_MODES.LIVE_AVAILABILITY &&
      hasSearchDates(planWithDefaults) &&
      hasSearchGuests(planWithDefaults)
        ? "searching_live"
        : "searching_catalog";
    const shouldAttemptAssistantKickoff =
      !shouldRequireBlockingSearchInputs &&
      shouldRunAssistantKickoffPlanner(planWithDefaults);
    const assistantKickoffGate = createAssistantKickoffEventGate({
      emitEvent,
      emitTrace: emitSearchTrace,
      emitFileDebug,
    });
    function emitSearchEvent(type, data = {}) {
      assistantKickoffGate.emit(type, data);
    }
    function emitSearchTrace(code, data = {}) {
      if (!code) return;
      emitSearchEvent("trace", { code, ...data });
      emitFileDebug("trace", data, { code });
    }
    const blockAssistantKickoff = (reason = "blocked") => {
      assistantKickoffBlocked = true;
      assistantKickoffGate.disable(reason);
    };
    const isAssistantKickoffBlocked = () =>
      assistantKickoffBlocked || !assistantKickoffGate.canEmitKickoff();
    const applyAssistantKickoffToPlanTarget = (targetPlan, kickoffResult) => {
      if (!targetPlan || typeof targetPlan !== "object" || !kickoffResult?.text) return;
      if (!targetPlan.assumptions || typeof targetPlan.assumptions !== "object") {
        targetPlan.assumptions = {};
      }
      if (!targetPlan.semanticSearch || typeof targetPlan.semanticSearch !== "object") {
        targetPlan.semanticSearch = {};
      }
      targetPlan.assumptions.separateSemanticOrientationMessage = true;
      targetPlan.semanticSearch.orientation = kickoffResult;
    };
    const finalizeAssistantKickoffDelivery = (kickoffResult) => {
      if (!kickoffResult?.text || assistantKickoffDeliveredSeparately) {
        return kickoffResult;
      }
      if (!assistantKickoffGate.canEmitKickoff()) {
        assistantKickoffGate.markLateKickoff({
          text: kickoffResult.text,
          destination:
            planWithDefaults?.location?.city ||
            planWithDefaults?.location?.country ||
            null,
        });
        return kickoffResult;
      }
      assistantKickoffDeliveredSeparately = true;
      assistantKickoff = kickoffResult;
      applyAssistantKickoffToPlanTarget(planWithDefaults, kickoffResult);
      applyAssistantKickoffToPlanTarget(plan, kickoffResult);
      preparedReply = {
        text: kickoffResult.text,
        sections: [],
        mode: "separate_message",
        stage: "kickoff",
      };
      emitEvent("assistant_message", {
        stage: "kickoff",
        text: kickoffResult.text,
        destination:
          planWithDefaults?.location?.city || planWithDefaults?.location?.country || null,
        nextProgressType: nextKickoffProgressType,
      });
      assistantKickoffGate.markKickoffEmitted({
        destination:
          planWithDefaults?.location?.city ||
          planWithDefaults?.location?.country ||
          null,
        text: kickoffResult.text,
      });
      return kickoffResult;
    };
    if (!shouldAttemptAssistantKickoff) {
      blockAssistantKickoff("not_applicable");
    }
    const assistantKickoffPromise = shouldAttemptAssistantKickoff
      ? streamAssistantKickoffMessage({
          client,
          plan: planWithDefaults,
          language,
          latestUserMessage,
          onKickoffChunk: (chunk) => {
            if (!chunk || isAssistantKickoffBlocked()) return;
            onKickoffChunk?.(chunk);
          },
          isBlocked: isAssistantKickoffBlocked,
          emitTrace: emitSearchTrace,
          emitFileDebug,
        })
          .then((result) => {
            assistantKickoff = result?.text ? result : null;
            if (!assistantKickoff?.text) {
              assistantKickoffGate.disable("kickoff_unavailable");
              return null;
            }
            return finalizeAssistantKickoffDelivery(assistantKickoff);
          })
          .catch(() => {
            assistantKickoffGate.disable("kickoff_unavailable");
            return null;
          })
      : Promise.resolve(null);
    void assistantKickoffPromise;
    const semanticGroundingPlan = await runSemanticGroundingPlanner({
      client,
      latestUserMessage,
      plan: planWithDefaults,
      language,
      emitTrace: emitSearchTrace,
    });
    if (semanticGroundingPlan) {
      planWithDefaults = mergeSemanticGroundingPlanIntoPlan(
        planWithDefaults,
        semanticGroundingPlan,
        { latestUserMessage },
      );
      emitFileDebug("plan_after_grounding_planner", {
        plan: summarizePlanForDebug(planWithDefaults),
      });
    } else {
      emitFileDebug("plan_after_grounding_planner", {
        skipped: true,
        reason: "planner_failed_or_empty",
        plan: summarizePlanForDebug(planWithDefaults),
      });
    }

    if (!hasCanonicalSemanticGrounding(planWithDefaults)) {
      planWithDefaults = applyDeterministicSemanticHintsToPlan(
        planWithDefaults,
        latestUserMessage,
      );
      emitSearchTrace("SEMANTIC_LEGACY_FALLBACK_APPLIED", {
        reason: "missing_canonical_grounding",
        destination: planWithDefaults?.location?.city || null,
      });
    } else {
      emitSearchTrace("SEMANTIC_LEGACY_FALLBACK_SKIPPED", {
        reason: "canonical_grounding_present",
        destination: planWithDefaults?.location?.city || null,
        groundingStrategy:
          planWithDefaults?.semanticSearch?.grounding?.groundingStrategy || null,
      });
    }
    planWithDefaults = lockSemanticUserIntent({
      plan: planWithDefaults,
      latestUserMessage,
      emitTrace: emitSearchTrace,
    });
    const explicitPlaceResolution = shouldRunExplicitPlaceResolutionForPlan(
      planWithDefaults,
    )
      ? await resolveExplicitPlaceReferenceForPlan({
          client,
          plan: planWithDefaults,
          originalToolArgs,
          latestUserMessage,
          language,
          emitTrace: emitSearchTrace,
        })
      : null;
    if (explicitPlaceResolution?.status === "RESOLVED") {
      planWithDefaults = applyResolvedPlaceReferenceToPlan({
        plan: planWithDefaults,
        resolution: explicitPlaceResolution,
        latestUserMessage,
      });
    } else if (
      explicitPlaceResolution?.status === "AMBIGUOUS" &&
      Array.isArray(explicitPlaceResolution?.candidates) &&
      explicitPlaceResolution.candidates.length
    ) {
      const placeQuestionText = getPlaceDisambiguationQuestion(
        language,
        explicitPlaceResolution?.placeTypeHint,
      );
      const uiInput = {
        ...buildPlaceDisambiguationUiInput(explicitPlaceResolution),
        question: placeQuestionText,
      };
      blockAssistantKickoff("place_disambiguation");
      return await interruptForStructuredInput({
        inputType: "placeDisambiguation",
        nextActionValue: "ASK_FOR_PLACE_DISAMBIGUATION",
        questionText: placeQuestionText,
        uiInput,
        pendingExtras: {
          clarificationQuestion: placeQuestionText,
          clarificationOptions: explicitPlaceResolution.candidates,
          placeResolutionRequest: {
            query: explicitPlaceResolution.rawQuery || null,
            city: planWithDefaults?.location?.city || null,
            country: planWithDefaults?.location?.country || null,
            placeTypeHint: explicitPlaceResolution.placeTypeHint || null,
          },
        },
      });
    } else if (explicitPlaceResolution?.status === "NOT_FOUND") {
      const notFoundQuestion =
        explicitPlaceResolution?.clarification_question ||
        (language === "es"
          ? "No pude ubicar ese lugar con claridad. ¿Podés decirme cuál es exactamente?"
          : "I couldn't identify that place clearly. Can you tell me exactly which place you mean?");
      blockAssistantKickoff("place_not_found");
      onTextChunk?.(notFoundQuestion);
      return {
        reply: notFoundQuestion,
        assistant: null,
        followUps: [],
        ui: { inputs: [], chips: [], cards: [], sections: [] },
        webSources: [],
        plan: null,
        inventory: buildEmptyInventory(),
        carousels: [],
        trip: null,
        state: existingState,
        intent: "SEARCH",
        nextAction: "SMALL_TALK",
        safeMode: false,
      };
    }

    // Live availability only blocks after the place is fully resolved.
    if (shouldRequireBlockingSearchInputs && !hasSearchDates(planWithDefaults)) {
      blockAssistantKickoff("missing_dates");
      return await interruptForMissingData("dateRange", "ASK_FOR_DATES");
    }
    emitFileDebug("plan_after_deterministic_hints", {
      plan: summarizePlanForDebug(planWithDefaults),
    });

    if (
      !hasCanonicalSemanticGrounding(planWithDefaults) &&
      shouldRunSemanticSearchFallback(latestUserMessage, planWithDefaults)
    ) {
      emitSearchTrace("SEMANTIC_ENRICHMENT_REQUESTED", {
        destination: planWithDefaults?.location?.city || null,
        viewIntent: planWithDefaults?.viewIntent || null,
        areaIntent: planWithDefaults?.areaIntent || null,
        qualityIntent: planWithDefaults?.qualityIntent || null,
      });
      const semanticEnrichment = await runSemanticSearchEnrichment({
        client,
        latestUserMessage,
        plan: planWithDefaults,
        language,
      });
      if (semanticEnrichment) {
        const explicitGeoRequested = hasExplicitSemanticGeoRequest({
          latestUserMessage,
          plan: planWithDefaults,
        });
        const sanitizedSemanticEnrichment = explicitGeoRequested
          ? semanticEnrichment
          : stripExplicitGeoFromSemanticPayload(semanticEnrichment);
        if (
          !explicitGeoRequested &&
          (semanticEnrichment.geoIntent ||
            (Array.isArray(semanticEnrichment.placeTargets) &&
              semanticEnrichment.placeTargets.length))
        ) {
          emitSearchTrace("SEMANTIC_ABSTRACT_TRAITS_NON_GEO", {
            destination: planWithDefaults?.location?.city || null,
            strippedGeoIntent: semanticEnrichment.geoIntent || null,
            strippedPlaceTargets: Array.isArray(semanticEnrichment.placeTargets)
              ? semanticEnrichment.placeTargets.map(
                  (target) => target?.normalizedName || target?.rawText,
                )
              : [],
          });
        }
        const canonicalSemanticEnrichment =
          filterSemanticEnrichmentAgainstLockedIntent({
            plan: planWithDefaults,
            enrichment: sanitizedSemanticEnrichment,
            latestUserMessage,
            emitTrace: emitSearchTrace,
          });
        planWithDefaults = mergeSemanticEnrichmentIntoPlan(
          planWithDefaults,
          canonicalSemanticEnrichment,
          { latestUserMessage },
        );
        emitSearchTrace("SEMANTIC_ENRICHMENT_APPLIED", {
          destination: planWithDefaults?.location?.city || null,
          viewIntent: planWithDefaults?.viewIntent || null,
          areaIntent: planWithDefaults?.areaIntent || null,
          qualityIntent: planWithDefaults?.qualityIntent || null,
          modelCandidateGenerationUsed: Boolean(
            planWithDefaults?.semanticSearch?.modelCandidateGenerationUsed,
          ),
        });
        emitFileDebug("plan_after_semantic_enrichment", {
          plan: summarizePlanForDebug(planWithDefaults),
        });
      } else {
        emitSearchTrace("SEMANTIC_ENRICHMENT_SKIPPED", {
          reason: "fallback_failed_or_empty",
          destination: planWithDefaults?.location?.city || null,
        });
        emitFileDebug("plan_after_semantic_enrichment", {
          skipped: true,
          reason: "fallback_failed_or_empty",
          plan: summarizePlanForDebug(planWithDefaults),
        });
      }
    } else {
      emitSearchTrace("SEMANTIC_ENRICHMENT_SKIPPED", {
        reason: hasCanonicalSemanticGrounding(planWithDefaults)
          ? "canonical_grounding_present"
          : "no_soft_semantic_cue",
        destination: planWithDefaults?.location?.city || null,
      });
      emitFileDebug("plan_after_semantic_enrichment", {
        skipped: true,
        reason: hasCanonicalSemanticGrounding(planWithDefaults)
          ? "canonical_grounding_present"
          : "no_soft_semantic_cue",
        plan: summarizePlanForDebug(planWithDefaults),
      });
    }

    const explicitPlaceAlreadyResolved =
      planWithDefaults?.semanticSearch?.placeResolution?.status === "RESOLVED";
    const semanticWebResolution =
      explicitPlaceAlreadyResolved ||
      !shouldRunSemanticWebResolverForPlan({
        latestUserMessage,
        plan: planWithDefaults,
      })
      ? null
      : await runSemanticWebResolver({
          client,
          latestUserMessage,
          plan: planWithDefaults,
          language,
          emitTrace: emitSearchTrace,
        });
    if (semanticWebResolution) {
      const explicitGeoRequested = hasExplicitSemanticGeoRequest({
        latestUserMessage,
        plan: planWithDefaults,
      });
      const sanitizedSemanticWebResolution = explicitGeoRequested
        ? semanticWebResolution
        : stripExplicitGeoFromSemanticPayload(semanticWebResolution);
      if (
        !explicitGeoRequested &&
        (semanticWebResolution.geoIntent ||
          (Array.isArray(semanticWebResolution.resolvedPlaces) &&
            semanticWebResolution.resolvedPlaces.length))
      ) {
        emitSearchTrace("SEMANTIC_ABSTRACT_TRAITS_NON_GEO", {
          destination: planWithDefaults?.location?.city || null,
          strippedGeoIntent: semanticWebResolution.geoIntent || null,
          strippedPlaceTargets: Array.isArray(semanticWebResolution.resolvedPlaces)
            ? semanticWebResolution.resolvedPlaces.map(
                (target) => target?.normalizedName || target?.rawText,
              )
            : [],
        });
      }
      planWithDefaults = mergeSemanticWebResolutionIntoPlan(
        planWithDefaults,
        sanitizedSemanticWebResolution,
      );
    }
    emitFileDebug("plan_after_web_resolution", {
      webResolutionApplied: Boolean(semanticWebResolution),
      plan: summarizePlanForDebug(planWithDefaults),
    });

    if (
      shouldRequireBlockingSearchInputs &&
      !hasSearchGuests(planWithDefaults)
    ) {
      blockAssistantKickoff("missing_guests");
      return await interruptForMissingData("guestCount", "ASK_FOR_GUESTS");
    }

    const shouldResetSearchContext = shouldResetSearchContextForNewDestination({
      state: existingState,
      nextPlan: planWithDefaults,
    });
    const baseStateForApply = shouldResetSearchContext
      ? resetDestinationScopedSearchState(existingState)
      : existingState;
    if (shouldResetSearchContext) {
      emitSearchTrace("SEARCH_CONTEXT_RESET_APPLIED", {
        fromDestination:
          existingState?.destination?.name ||
          existingState?.searchPlan?.location?.city ||
          null,
        toDestination:
          planWithDefaults?.location?.city ||
          planWithDefaults?.location?.country ||
          null,
      });
      emitFileDebug("search_context_reset", {
        fromDestination:
          existingState?.destination?.name ||
          existingState?.searchPlan?.location?.city ||
          null,
        toDestination:
          planWithDefaults?.location?.city ||
          planWithDefaults?.location?.country ||
          null,
      });
      if (sessionId) {
        rawInventoryCache.delete(sessionId);
      }
    }

    const { state: nextStateFromPlan, plan: mergedPlan } = applyPlanToState(
      baseStateForApply,
      planWithDefaults,
    );
    if (Array.isArray(mergedPlan?.semanticSearch?.intentProfile?.candidateZones)) {
      emitSearchTrace("SEMANTIC_CANDIDATE_ZONES_INFERRED", {
        destination: mergedPlan?.location?.city || null,
        candidateZones: mergedPlan.semanticSearch.intentProfile.candidateZones,
        inferenceMode:
          mergedPlan?.semanticSearch?.intentProfile?.inferenceMode || null,
      });
    }
    plan = mergedPlan;
    refreshSemanticIntentProfile(plan, latestUserMessage);
    emitFileDebug("semantic_intent_profile", {
      intentProfile: summarizeSemanticIntentProfileForDebug(plan),
    });
    emitFileDebug("semantic_catalog_context", {
      context: summarizeSemanticCatalogContextForDebug(
        resolveSemanticCatalogContext({ plan }),
      ),
    });

    // 3. Inject nationality/residence from userContext
    const uiEventNationality = getNationalityCodeFromUiEvent(uiEvent);
    const contextNationality =
      userContext?.passengerNationality ??
      userContext?.nationality ??
      uiEventNationality ??
      null;
    const contextResidence =
      userContext?.passengerCountryOfResidence ??
      userContext?.residence ??
      uiEventNationality ??
      null;
    if (contextNationality) plan.passengerNationality = contextNationality;
    if (contextResidence) plan.passengerCountryOfResidence = contextResidence;

    if (shouldRequireBlockingSearchInputs && !plan.passengerNationality) {
      blockAssistantKickoff("missing_nationality");
      return await interruptForMissingData(
        "nationality",
        "ASK_FOR_NATIONALITY",
      );
    }

    // Clear pendingToolCall once the search is ready to run.
    if (existingState.pendingToolCall) {
      existingState.pendingToolCall = null;
    }

    const activeSearchState = nextStateFromPlan || existingState;
    const excludeIds = toolCall.args.wantsMoreResults
      ? activeSearchState?.lastResultsContext?.shownIds || []
      : [];

    const searchLimits = resolveSearchLimits({ plan, limits });
    const searchDestination =
      plan?.location?.city || existingState?.destination?.name || null;
    const expectsLive =
      plan?.searchExecutionMode === SEARCH_EXECUTION_MODES.LIVE_AVAILABILITY &&
      hasSearchDates(plan) &&
      hasSearchGuests(plan);

    emitSearchTrace(
      expectsLive ? "SEARCH_STRATEGY_LIVE" : "SEARCH_STRATEGY_CATALOG",
      { destination: searchDestination },
    );
    emitSearchEvent(expectsLive ? "searching_live" : "searching_catalog", {
      destination: searchDestination,
    });
    emitSearchTrace("DESTINATION_RECOGNIZED", { destination: searchDestination });

    const _t0 = Date.now();
    inventory = await searchStays(plan, {
      limit: searchLimits.limit,
      maxResults: searchLimits.maxResults,
      excludeIds,
      traceSink: emitSearchTrace,
    });
    console.log("[timing] searchStays:", Date.now() - _t0, "ms");
    emitFileDebug("search_inventory_summary", summarizeInventoryForDebug(inventory));

    const counts = {
      homes: inventory?.homes?.length || 0,
      hotels: inventory?.hotels?.length || 0,
    };
    if (
      counts.hotels > 0 &&
      ((Array.isArray(plan?.semanticSearch?.intentProfile?.userRequestedAreaTraits) &&
        plan.semanticSearch.intentProfile.userRequestedAreaTraits.length > 0) ||
        (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedZones) &&
          plan.semanticSearch.intentProfile.requestedZones.length > 0) ||
        (Array.isArray(plan?.semanticSearch?.intentProfile?.candidateZones) &&
          plan.semanticSearch.intentProfile.candidateZones.length > 0))
    ) {
      const previewPicks = getTopInventoryPicksByCategory(
        inventory,
        plan,
        language,
        0,
      )
        .slice(0, 5)
        .map((entry) => ({
          id: String(entry?.item?.id || ""),
          name: entry?.item?.name || null,
          primaryReasonType:
            entry?.item?.decisionExplanation?.primaryReasonType || null,
          secondaryReasonType:
            entry?.item?.decisionExplanation?.secondaryReasonType || null,
          comparisonAngle:
            entry?.item?.decisionExplanation?.comparisonAngle || null,
          mentionedZoneLabel:
            entry?.item?.decisionExplanation?.mentionedZoneLabel || null,
        }));
      if (previewPicks.length) {
        emitSearchTrace("SEMANTIC_EXPLANATION_PROFILE_BUILT", {
          picks: previewPicks,
        });
      }
    }
    emitSearchEvent("results_final", { counts, total: counts.homes + counts.hotels });
    emitSearchTrace("RESULTS_FOUND", {
      ...counts,
      total: counts.homes + counts.hotels,
    });

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
        console.log(
          "[timing] buildInventoryCarousels:",
          Date.now() - _t1,
          "ms",
        );
      } catch (err) {
        console.warn(
          "[ai] buildInventoryCarousels failed",
          err?.message || err,
        );
      }
    }
    await Promise.race([
      assistantKickoffPromise ?? Promise.resolve(),
      new Promise((r) => setTimeout(r, AI_ASSISTANT_KICKOFF_STREAM_TIMEOUT_MS)),
    ]);
    assistantKickoffGate.finalize("response_ready");

    nextAction = TOOL_TO_NEXT_ACTION.search_stays;
    debugCurrentNextAction = nextAction;
    resolvedIntent = TOOL_TO_INTENT.search_stays;
  } else if (toolCall?.name === "answer_from_results") {
    // ---- B. ANSWER FROM RESULTS — Call 2 streaming with summary as context ----
    nextAction = TOOL_TO_NEXT_ACTION.answer_from_results;
    debugCurrentNextAction = nextAction;
    resolvedIntent = TOOL_TO_INTENT.answer_from_results;
    plan = { intent: resolvedIntent, language };

    if (!existingState?.lastShownInventorySummary) {
      // No results in state — deterministic fallback, no LLM needed
      const fallbackText =
        language === "es"
          ? "No tengo resultados previos para responder eso. ¿Querés que busque hoteles en algún destino?"
          : "I don't have previous results to answer that. Would you like me to search for hotels somewhere?";
      preparedReply = { text: fallbackText, sections: [] };
      onTextChunk?.(fallbackText);
    } else {
      // --- Raw inventory cache (Option B) ---
      // Use full normalized hotel list from cache; fall back to summary if cache miss.
      const cachedRaw = sessionId ? rawInventoryCache.get(sessionId) : null;
      const hotelsPool = cachedRaw?.hotels?.length
        ? cachedRaw.hotels
        : existingState.lastShownInventorySummary?.hotels || [];

      console.log(
        `[ai] answer_from_results: hotelsPool=${hotelsPool.length} (${cachedRaw ? "rawCache" : "summary"})`,
      );

      const compactHotelCardPickReason = (value) => {
        const text = String(value || "")
          .replace(/\s+/g, " ")
          .replace(/[.!]+$/g, "")
          .trim();
        if (!text) return null;
        const truncate = (input) =>
          input.length <= 24 ? input : `${input.slice(0, 23).trimEnd()}…`;

        let match =
          text.match(/^te deja bien parado para moverte cerca de (.+)$/i) ||
          text.match(/^cerca de (.+)$/i);
        if (match?.[1]) return truncate(`Cerca de ${String(match[1]).trim()}`);

        match =
          text.match(/^queda bien ubicado para moverte por (.+)$/i) ||
          text.match(/^bien ubicado en (.+)$/i);
        if (match?.[1]) return truncate(`Bien ubicado en ${String(match[1]).trim()}`);

        match =
          text.match(/^la zona de (.+?) suele funcionar bien si buscas algo .+$/i) ||
          text.match(/^la zona de (.+?) le da mejor encaje que a otras alternativas cercanas$/i);
        if (match?.[1]) return truncate(`Buen fit en ${String(match[1]).trim()}`);

        if (/^encaja mejor con un plan /i.test(text)) return "Buen fit";
        if (/moverte a pie|caminable/i.test(text)) return "Caminable";
        if (/tranquilo|descansar/i.test(text)) return "Mas tranquilo";
        if (/refinado|premium|mas cuidado/i.test(text)) return "Mas premium";
        if (/precio/i.test(text)) return "Buen precio";
        if (/valor|equilib|balance/i.test(text)) return "Buen balance";
        if (/vista/i.test(text)) return "Buena vista";
        return truncate(text);
      };

      const makeHotelCard = (h, rank) => {
        const starsNum =
          typeof h.stars === "number"
            ? h.stars
            : typeof h.stars === "string"
              ? parseInt(h.stars, 10) || null
              : null;
        return {
          type: "hotelCard",
          id: String(h.id),
          rank,
          name: h.name || "",
          location: h.city || "",
          stars: Number.isFinite(starsNum) ? starsNum : null,
          amenities: Array.isArray(h.amenities) ? h.amenities.slice(0, 3) : [],
          images: Array.isArray(h.images) ? h.images : [],
          priceFrom:
            Number.isFinite(Number(h.pricePerNight)) &&
            Number(h.pricePerNight) > 0
              ? Number(h.pricePerNight)
              : null,
          currency: h.currency || "USD",
          pickReason: compactHotelCardPickReason(
            h.shortReason || (Array.isArray(h.matchReasons) && h.matchReasons[0]) || null,
          ),
        };
      };

      /**
       * Build interleaved sections: intro → [paragraph + card + divider] × N.
       * If the LLM wrote one paragraph per hotel (separated by blank lines), we pair
       * each paragraph with its corresponding card. Falls back to text-then-cards.
       */
      const buildSections = (text, hotels) => {
        const cards = hotels
          .map((h, i) => makeHotelCard(h, i + 1))
          .filter((c) => c.name);
        if (!text || !cards.length) {
          const sections = [];
          if (text) sections.push({ type: "textBlock", text });
          cards.forEach((card, i) => {
            if (i > 0) sections.push({ type: "sectionDivider" });
            sections.push(card);
          });
          return sections;
        }

        // Split by blank lines to get individual paragraphs
        const paragraphs = text
          .split(/\n\n+/)
          .map((p) => p.trim())
          .filter(Boolean);

        // Case A: intro paragraph + N hotel paragraphs
        if (paragraphs.length === cards.length + 1) {
          const sections = [{ type: "textBlock", text: paragraphs[0] }];
          cards.forEach((card, i) => {
            sections.push({ type: "sectionDivider" });
            sections.push({ type: "textBlock", text: paragraphs[i + 1] });
            sections.push(card);
          });
          return sections;
        }

        // Case B: exactly N paragraphs = N cards (no separate intro)
        if (paragraphs.length === cards.length && cards.length > 1) {
          const sections = [];
          cards.forEach((card, i) => {
            if (i > 0) sections.push({ type: "sectionDivider" });
            sections.push({ type: "textBlock", text: paragraphs[i] });
            sections.push(card);
          });
          return sections;
        }

        // Fallback: full text block then all cards
        const sections = [{ type: "textBlock", text }];
        cards.forEach((card, i) => {
          if (i > 0) sections.push({ type: "sectionDivider" });
          sections.push(card);
        });
        return sections;
      };

      const buildLocalAnswerFromResultsFallback = ({
        hotels = [],
        webSearchRequested = false,
      } = {}) => {
        const pool = Array.isArray(hotels) ? hotels.filter(Boolean) : [];
        if (!pool.length) {
          return language === "es"
            ? "No encontré suficiente contexto para responder eso con claridad."
            : "I couldn't find enough context to answer that clearly.";
        }
        const scored = [...pool].sort((a, b) => {
          const pickA = a?.isPick ? 1 : 0;
          const pickB = b?.isPick ? 1 : 0;
          if (pickB !== pickA) return pickB - pickA;
          const starsA = Number(a?.stars || 0);
          const starsB = Number(b?.stars || 0);
          if (starsB !== starsA) return starsB - starsA;
          const priceA = Number.isFinite(Number(a?.pricePerNight))
            ? Number(a.pricePerNight)
            : Number.MAX_SAFE_INTEGER;
          const priceB = Number.isFinite(Number(b?.pricePerNight))
            ? Number(b.pricePerNight)
            : Number.MAX_SAFE_INTEGER;
          if (priceA !== priceB) return priceA - priceB;
          return String(a?.name || "").localeCompare(String(b?.name || ""));
        });
        const best = scored[0] || null;
        const runnerUp = scored[1] || null;
        if (!best?.name) {
          return language === "es"
            ? "No encontré suficiente contexto para responder eso con claridad."
            : "I couldn't find enough context to answer that clearly.";
        }
        if (language === "es") {
          if (runnerUp?.name) {
            return webSearchRequested
              ? `No pude verificar reseñas web ahora. Con lo que ya tengo en contexto, **${best.name}** me parece la opción más sólida, seguida por **${runnerUp.name}**.`
              : `Con lo que ya tengo en contexto, **${best.name}** me parece la opción más sólida, seguida por **${runnerUp.name}**.`;
          }
          return webSearchRequested
            ? `No pude verificar reseñas web ahora. Con lo que ya tengo en contexto, **${best.name}** es la mejor opción de las que te mostré.`
            : `Con lo que ya tengo en contexto, **${best.name}** es la mejor opción de las que te mostré.`;
        }
        if (runnerUp?.name) {
          return webSearchRequested
            ? `I couldn't verify web reviews right now. Based on the context I already have, **${best.name}** looks like the strongest option, followed by **${runnerUp.name}**.`
            : `Based on the context I already have, **${best.name}** looks like the strongest option, followed by **${runnerUp.name}**.`;
        }
        return webSearchRequested
          ? `I couldn't verify web reviews right now. Based on the context I already have, **${best.name}** is the strongest option from the ones I showed you.`
          : `Based on the context I already have, **${best.name}** is the strongest option from the ones I showed you.`;
      };

      const featureRegex = getRequestedFeatureRegex(latestUserMessage);

      if (featureRegex) {
        // ---- FEATURE FILTER PATH: DB match (primary) + local match (fallback) ----
        const hotelIds = hotelsPool.map((h) => h.id).filter(Boolean);
        const dbMatchIds = await queryHotelAmenityFromDb(
          hotelIds,
          featureRegex,
        );

        let matchedHotels;
        if (dbMatchIds !== null) {
          // DB match: covers ALL hotels in the pool, most reliable
          matchedHotels = hotelsPool.filter((h) =>
            dbMatchIds.has(String(h.id)),
          );
        } else {
          // Local fallback: check amenity strings + descriptions in cache
          matchedHotels = hotelsPool.filter((h) => {
            const am = Array.isArray(h.amenities) ? h.amenities.join(" ") : "";
            const desc = Array.isArray(h.descriptions)
              ? h.descriptions.join(" ")
              : "";
            return featureRegex.test(am) || featureRegex.test(desc);
          });
        }

        // Picks shown as cards first, then See All hotels — no cap
        const preMatchedHotels = [
          ...matchedHotels.filter((h) => h.isPick),
          ...matchedHotels.filter((h) => !h.isPick),
        ];
        existingState.lastReferencedHotelIds = normalizeReferencedHotelIds(
          preMatchedHotels.map((hotel) => hotel?.id),
        );

        console.log(
          `[ai] answer_from_results featureFilter: matched ${preMatchedHotels.length}/${hotelsPool.length} (${dbMatchIds !== null ? "dbQuery" : "localCache"})`,
        );

        if (preMatchedHotels.length === 0) {
          // Fast path — zero matches, no LLM needed
          const featureLabel = getFeatureLabel(featureRegex, language);
          const accumulated =
            language === "es"
              ? `Ninguno de los ${hotelsPool.length} hoteles tiene ${featureLabel}. ¿Querés que haga una nueva búsqueda con ese filtro?`
              : `None of the ${hotelsPool.length} hotels have ${featureLabel}. Would you like a new search with that filter?`;
          onTextChunk?.(accumulated);
          preparedReply = { text: accumulated, sections: [] };
        } else {
          // LLM adds insights for each matched hotel (intro + 1 sentence per hotel)
          const summaryContext = buildLastShownResultsContextText(
            {
              ...existingState.lastShownInventorySummary,
              hotels: preMatchedHotels,
            },
            latestUserMessage,
          );
          const call2System = buildCall2SystemPrompt({
            toolName: "answer_from_results",
            toolArgs: toolCall.args,
            userContext,
            language,
            summaryContext,
            useWebSearch: false,
            allowCompetitorMentions: false,
            preFiltered: true,
          });

          const call2Messages = [
            { role: "system", content: call2System },
            ...normalizedMessages,
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: toolCall.id || "call_0",
                  type: "function",
                  function: {
                    name: "answer_from_results",
                    arguments: JSON.stringify(toolCall.args),
                  },
                },
              ],
            },
            {
              role: "tool",
              tool_call_id: toolCall.id || "call_0",
              content: summaryContext || "No hotel data available.",
            },
          ];

          let accumulated = "";
          try {
            const call2Result = await executeCall2WithPolicy({
              client,
              messages: call2Messages,
              fallbackMessages: call2Messages,
              onTextChunk,
              emitEvent,
              emitTrace,
              webSearchDecision: { enabled: false },
              toolName: "answer_from_results",
              toolArgs: toolCall.args,
              latestUserMessage,
            });
            accumulated = call2Result.text;
            webSources = call2Result.webSources;
            allowCompetitorWebSources = Boolean(
              call2Result.allowCompetitorWebSources,
            );
          } catch (err) {
            console.warn(
              "[ai] answer_from_results featureFilter LLM failed",
              err?.message || err,
            );
            // Fallback to deterministic text
            const featureLabel = getFeatureLabel(featureRegex, language);
            const n = preMatchedHotels.length;
            accumulated =
              language === "es"
                ? `${n === 1 ? "1 hotel tiene" : `${n} hoteles tienen`} ${featureLabel}:`
                : `${n === 1 ? "1 hotel has" : `${n} hotels have`} ${featureLabel}:`;
            onTextChunk?.(accumulated);
          }
          if (!String(accumulated || "").trim()) {
            const featureLabel = getFeatureLabel(featureRegex, language);
            const n = preMatchedHotels.length;
            accumulated =
              language === "es"
                ? `${n === 1 ? "1 hotel tiene" : `${n} hoteles tienen`} ${featureLabel}:`
                : `${n === 1 ? "1 hotel has" : `${n} hotels have`} ${featureLabel}:`;
            onTextChunk?.(accumulated);
          }
          // Strip |||IDS: if model accidentally added it
          const IDS_SEPARATOR = "|||IDS:";
          const sepIdx = accumulated.indexOf(IDS_SEPARATOR);
          if (sepIdx !== -1)
            accumulated = accumulated.slice(0, sepIdx).trimEnd();

          preparedReply = {
            text: accumulated,
            sections: buildSections(accumulated, preMatchedHotels),
          };
        }
      } else {
        // ---- OPEN QUESTION PATH: LLM selects hotels via |||IDS: ----
        const summaryHotels =
          existingState.lastShownInventorySummary?.hotels || [];
        const contextHotels = summaryHotels.filter((h) => h.isPick);
        const summaryContext = buildLastShownResultsContextText(
          { ...existingState.lastShownInventorySummary, hotels: contextHotels },
          latestUserMessage,
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
          preFiltered: false,
        });
        const fallbackCall2System = buildCall2SystemPrompt({
          toolName: "answer_from_results",
          toolArgs: toolCall.args,
          userContext,
          language,
          summaryContext,
          useWebSearch: false,
          allowCompetitorMentions: webSearchDecision.allowCompetitorMentions,
          preFiltered: false,
        });

        const call2Messages = [
          { role: "system", content: call2System },
          ...normalizedMessages,
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: toolCall.id || "call_0",
                type: "function",
                function: {
                  name: "answer_from_results",
                  arguments: JSON.stringify(toolCall.args),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: toolCall.id || "call_0",
            content:
              summaryContext ||
              "No hotel data available in context. Inform the user you need them to run a new search.",
          },
        ];
        const fallbackCall2Messages = [
          { ...call2Messages[0], content: fallbackCall2System },
          ...call2Messages.slice(1),
        ];

        // Rolling buffer to hide |||IDS: suffix from the SSE stream
        const IDS_SEPARATOR = "|||IDS:";
        const SUFFIX_HOLD = 100;
        let holdBuffer = "";
        const onTextChunkBuffered = onTextChunk
          ? (chunk) => {
              holdBuffer += chunk;
              if (holdBuffer.length > SUFFIX_HOLD) {
                const toEmit = holdBuffer.slice(
                  0,
                  holdBuffer.length - SUFFIX_HOLD,
                );
                onTextChunk(toEmit);
                holdBuffer = holdBuffer.slice(holdBuffer.length - SUFFIX_HOLD);
              }
            }
          : null;

        let accumulated = "";
        try {
          const call2Result = await executeCall2WithPolicy({
            client,
            messages: call2Messages,
            fallbackMessages: fallbackCall2Messages,
            onTextChunk: onTextChunkBuffered,
            emitEvent,
            emitTrace,
            webSearchDecision,
            toolName: "answer_from_results",
            toolArgs: toolCall.args,
            latestUserMessage,
          });
          accumulated = call2Result.text;
          webSources = call2Result.webSources;
          allowCompetitorWebSources = Boolean(
            call2Result.allowCompetitorWebSources,
          );
        } catch (err) {
          console.warn(
            "[ai] answer_from_results Call 2 failed",
            err?.message || err,
          );
          accumulated = buildLocalAnswerFromResultsFallback({
            hotels: summaryHotels,
            webSearchRequested: webSearchDecision.enabled,
          });
          onTextChunk?.(accumulated);
        }
        if (!String(accumulated || "").trim()) {
          accumulated = buildLocalAnswerFromResultsFallback({
            hotels: summaryHotels,
            webSearchRequested: webSearchDecision.enabled,
          });
          onTextChunk?.(accumulated);
        }

        // Parse |||IDS: to select which hotels to show as cards
        const pickHotels = summaryHotels.filter((h) => h.isPick);
        let hotelsToShow = pickHotels.length
          ? pickHotels.slice(0, 3)
          : summaryHotels.slice(0, 3);
        const sepIdx = accumulated.indexOf(IDS_SEPARATOR);
        if (sepIdx !== -1) {
          const idsRaw = accumulated
            .slice(sepIdx + IDS_SEPARATOR.length)
            .trim();
          accumulated = accumulated.slice(0, sepIdx).trimEnd();
          if (idsRaw) {
            const ids = new Set(
              idsRaw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            );
            const matched = hotelsPool.filter((h) => ids.has(String(h.id)));
            if (matched.length >= 1) hotelsToShow = matched.slice(0, 3);
          }
        }
        existingState.lastReferencedHotelIds = normalizeReferencedHotelIds(
          hotelsToShow.map((hotel) => hotel?.id),
        );

        // Flush remaining hold buffer
        if (onTextChunk && holdBuffer) {
          const bufSepIdx = holdBuffer.indexOf(IDS_SEPARATOR);
          const cleanBuf =
            bufSepIdx !== -1
              ? holdBuffer.slice(0, bufSepIdx).trimEnd()
              : holdBuffer;
          if (cleanBuf) onTextChunk(cleanBuf);
        }

        preparedReply = {
          text: accumulated,
          sections: buildSections(accumulated, hotelsToShow),
        };
      } // closes open question else
    } // closes outer else (has lastShownInventorySummary)
  } else if (
    toolCall?.name === "plan_trip" ||
    toolCall?.name === "get_destination_info" ||
    toolCall?.name === "get_stay_details"
  ) {
    // ---- C. PLANNING / LOCATION / DETAILS ----
    nextAction = TOOL_TO_NEXT_ACTION[toolCall.name];
    debugCurrentNextAction = nextAction;
    resolvedIntent = TOOL_TO_INTENT[toolCall.name];
    plan = {
      intent: resolvedIntent,
      language,
      location: { city: toolCall.args.destination || null },
    };

    if (toolCall.name === "get_stay_details") {
      try {
        const details = await getStayDetails({
          stayId: toolCall.args.stayId,
          type: toolCall.args.type,
        });
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
        tool_calls: [
          {
            id: toolCall.id || "call_0",
            type: "function",
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.args),
            },
          },
        ],
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
        latestUserMessage,
      });
      accumulated = call2Result.text;
      webSources = call2Result.webSources;
      allowCompetitorWebSources = Boolean(
        call2Result.allowCompetitorWebSources,
      );
    } catch (err) {
      console.warn("[ai] Call 2 stream failed", err?.message || err);
      accumulated =
        language === "es"
          ? "No pude generar esa respuesta ahora. Intentá de nuevo."
          : "I couldn't generate that response right now. Try again.";
      onTextChunk?.(accumulated);
    }
    if (!String(accumulated || "").trim()) {
      accumulated =
        language === "es"
          ? "No pude completar esa respuesta en este momento."
          : "I couldn't complete that response right now.";
      onTextChunk?.(accumulated);
    }

    preparedReply = { text: accumulated, sections: [] };
  } else {
    // ---- D. SMALL_TALK — Call 2 with optional web search ----
    nextAction = "SMALL_TALK";
    debugCurrentNextAction = nextAction;
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
        latestUserMessage,
      });
      directText = call2Result.text;
      webSources = call2Result.webSources;
      allowCompetitorWebSources = Boolean(
        call2Result.allowCompetitorWebSources,
      );
    } catch (err) {
      console.warn("[ai] small_talk Call 2 failed", err?.message || err);
    }

    if (!String(directText || "").trim()) {
      const fallbacks =
        language === "es"
          ? [
              "Listo. Contame qué necesitás.",
              "Dale, ¿en qué te ayudo?",
              "Acá estoy. ¿En qué andás?",
            ]
          : [
              "Sure, what can I help you with?",
              "Got it. What do you need?",
              "Here when you need me.",
            ];
      directText = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      onTextChunk?.(directText);
    }

    preparedReply = { text: directText, sections: [] };
  }

  // 9. Apply plan to state
  if (!plan) plan = { intent: resolvedIntent, language };

  const { state: nextState } = applyPlanToState(existingState, plan);
  if (incomingTripContext) {
    nextState.tripContext = mergeTripContext(
      nextState.tripContext,
      incomingTripContext,
    );
  }

  // Nationality/residence from context
  const contextPassengerNationality =
    userContext?.passengerNationality ?? userContext?.nationality ?? null;
  const contextPassengerResidence =
    userContext?.passengerCountryOfResidence ?? userContext?.residence ?? null;
  if (contextPassengerNationality && !plan.passengerNationality) {
    plan.passengerNationality = contextPassengerNationality;
  }
  if (contextPassengerResidence && !plan.passengerCountryOfResidence) {
    plan.passengerCountryOfResidence = contextPassengerResidence;
  }

  // Trip handling (post-booking assist — separate from planning/location)
  let trip = null;
  const isPlanningOrLocation =
    resolvedIntent === INTENTS.PLANNING || resolvedIntent === INTENTS.LOCATION;
  const nextActionBeforePostProcessing = nextAction;
  const searchTurnActive = hasAuthoritativeSearchTurn({
    toolName: toolCall?.name || null,
    nextAction,
    plan,
    inventory,
    latestUserMessage,
  });
  const tripRequest = extractTripRequest({
    text: latestUserMessage,
    uiEvent,
    tripContext: nextState.tripContext,
  });
  let tripOverrideApplied = false;
  if (tripRequest && searchTurnActive) {
    emitTrace("TRIP_OVERRIDE_BLOCKED_FOR_SEARCH", {
      tool: toolCall?.name || "none",
      nextAction,
      destination: plan?.location?.city || null,
      geoIntent: plan?.geoIntent || null,
      placeTargets: Array.isArray(plan?.placeTargets)
        ? plan.placeTargets.map((target) => target?.normalizedName || target?.rawText)
        : [],
    });
  }
  if (tripRequest && !isPlanningOrLocation && !searchTurnActive) {
    const tripStart = Date.now();
    const location = await resolveTripLocation(
      nextState.tripContext,
      nextState,
      plan,
      userContext,
    );
    if (location) {
      const suggestions = await buildTripSuggestions({
        request: tripRequest,
        location,
      });
      const itinerary = buildItinerary({
        request: tripRequest,
        tripContext: nextState.tripContext,
        suggestions,
      });
      let insights = [],
        preparation = [];
      const isHubInit =
        (uiEvent?.id || uiEvent?.event || uiEvent) === "TRIP_HUB_INIT";
      if (isHubInit) {
        const addons = await generateTripAddons({
          tripContext: nextState.tripContext,
          location,
          lang: plan?.language || "en",
        });
        insights = addons.insights;
        preparation = addons.preparation;
      }
      trip = {
        request: tripRequest,
        location,
        suggestions,
        itinerary,
        insights,
        preparation,
      };
      resolvedIntent = INTENTS.TRIP;
      nextAction = NEXT_ACTIONS.RUN_TRIP;
      debugCurrentNextAction = nextAction;
      if (plan) plan.intent = INTENTS.TRIP;
      tripOverrideApplied = true;
      emitTrace("TRIP_OVERRIDE_APPLIED", {
        tool: toolCall?.name || "none",
        destination: plan?.location?.city || null,
        categories: Array.isArray(tripRequest?.categories)
          ? tripRequest.categories.map((category) => category?.id || category?.type)
          : [],
        wantsItinerary: Boolean(tripRequest?.wantsItinerary),
      });
    }
    debugTripHub("tripMs", Date.now() - tripStart);
  }

  debugCurrentNextAction = nextAction;
  const updatedState = updateStageFromAction(nextState, nextAction);

  // Update inventory summary for finalized search turns only
  if (nextAction === NEXT_ACTIONS.RUN_SEARCH) {
    const activeSearchContextKey = buildSearchContextKey(plan);
    const previousShownIds =
      existingState?.lastResultsContext?.searchContextKey ===
      activeSearchContextKey
        ? existingState?.lastResultsContext?.shownIds || []
        : [];
    const newShownIds = [
      ...(inventory.homes || []).map((item) => String(item.id)),
      ...(inventory.hotels || []).map((item) => String(item.id)),
    ].filter(Boolean);
    const combinedIds = Array.from(
      new Set([...previousShownIds, ...newShownIds]),
    );
    updatedState.lastResultsContext = {
      lastSearchId: `search-${Date.now()}`,
      shownIds: combinedIds,
      searchContextKey: activeSearchContextKey,
    };
    const shownPicks = getTopInventoryPicksByCategory(
      inventory,
      plan,
      language,
      0,
    );
    const picksIds = new Set(
      shownPicks.map((p) => String((p.item || p)?.id ?? "")),
    );
    updatedState.lastReferencedHotelIds = Array.from(picksIds).filter(Boolean);
    const lastShownSummary = buildLastShownInventorySummary(
      inventory,
      updatedState.lastResultsContext.lastSearchId,
      picksIds,
    );
    if (lastShownSummary) {
      updatedState.lastShownInventorySummary = lastShownSummary;
    }
    if (sessionId) {
      const normalizedHotels = normalizeRawInventoryHotels(inventory, picksIds);
      rawInventoryCache.set(sessionId, {
        hotels: normalizedHotels,
        cachedAt: Date.now(),
      });
      if (rawInventoryCache.size > 500) pruneRawInventoryCache();
      console.log(
        `[ai] rawInventoryCache: stored ${normalizedHotels.length} hotels for session ${sessionId}`,
      );
    }
    const lastSearchParams = buildLastSearchParams(plan);
    if (lastSearchParams) updatedState.lastSearchParams = lastSearchParams;
    updatedState.currentSearchContextKey = activeSearchContextKey;
  }

  // Weather
  const wantsWeather = /(clima|tiempo|weather|temperatura|pronostico)/i.test(
    latestUserMessage,
  );
  const resolvedLocation = wantsWeather
    ? await resolveWeatherLocation({
        text: latestUserMessage,
        tripContext: nextState.tripContext,
        state: nextState,
        plan,
        userContext,
      })
    : null;
  const weather = resolvedLocation
    ? await getWeatherSummary({
        location: resolvedLocation,
        timeZone: userContext?.timeZone,
      })
    : null;

  // Visual context
  let visualContext = null;
  const destinationName = plan?.location?.city || nextState?.destination?.name;
  const hasNoResults = !inventory.homes?.length && !inventory.hotels?.length;
  const wantsDestinationPhotos =
    nextAction === "RUN_LOCATION" ||
    nextAction === "RUN_PLANNING" ||
    hasNoResults;
  if (destinationName && wantsDestinationPhotos && !trip) {
    try {
      const images = await searchDestinationImages(destinationName, 3);
      if (images.length)
        visualContext = {
          type: "destination_gallery",
          title: destinationName,
          images,
        };
    } catch (err) {
      console.warn("[ai] visual context failed", err);
    }
  }

  const tripSearchContext = buildTripSearchContextText(updatedState, plan);
  const lastShownResultsContext =
    buildLastShownResultsContextText(
      existingState?.lastShownInventorySummary,
      latestUserMessage,
    ) ?? null;
  const inventoryForReply =
    nextAction !== NEXT_ACTIONS.RUN_SEARCH &&
    existingState?.lastShownInventorySummary
      ? existingState.lastShownInventorySummary
      : undefined;

  // 10. Render (streaming already done above; pass onTextChunk: null)
  // 10. Render (streaming already done above; pass onTextChunk: null)
  const renderMissing = [];
  if (nextAction === NEXT_ACTIONS.RUN_SEARCH) {
    if (!hasSearchDestination(updatedState, plan)) {
      renderMissing.push("DESTINATION");
    }
    if (!hasSearchDates(plan)) {
      renderMissing.push("DATES");
    }
    if (!hasSearchGuests(plan)) {
      renderMissing.push("GUESTS");
    }
  }

  const rendered = await renderAssistantPayload({
    plan,
    messages: normalizedMessages,
    inventory,
    nextAction,
    trip,
    tripContext: nextState.tripContext,
    userContext,
    weather,
    missing: renderMissing,
    visualContext,
    tripSearchContext,
    lastShownResultsContext,
    inventoryForReply,
    stayDetailsFromDb,
    preparedReply,
    // Search turns now reserve visible text streaming for the kickoff phase.
    // The final search reply stays neutral and lands with the final payload.
    onTextChunk: nextAction === NEXT_ACTIONS.RUN_SEARCH ? null : onTextChunk,
  });
  emitFileDebug(
    "renderer_final_payload",
    summarizeRenderedPayloadForDebug(rendered, nextAction),
  );

  const renderedSections = Array.isArray(rendered?.ui?.sections)
    ? rendered.ui.sections
    : [];
  const renderedHotelCardCount = renderedSections.filter(
    (section) => section?.type === "hotelCard",
  ).length;
  const renderedTextBlockCount = renderedSections.filter(
    (section) => section?.type === "textBlock",
  ).length;
  const semanticRenderActive = Boolean(
    plan?.geoIntent ||
      plan?.viewIntent ||
      plan?.areaIntent ||
      plan?.qualityIntent ||
      (Array.isArray(plan?.areaTraits) && plan.areaTraits.length) ||
      (Array.isArray(plan?.placeTargets) && plan.placeTargets.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.userRequestedAreaTraits) &&
        plan.semanticSearch.intentProfile.userRequestedAreaTraits.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedAreaTraits) &&
        plan.semanticSearch.intentProfile.requestedAreaTraits.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedZones) &&
        plan.semanticSearch.intentProfile.requestedZones.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.candidateZones) &&
        plan.semanticSearch.intentProfile.candidateZones.length),
  );
  if (
    nextAction === NEXT_ACTIONS.RUN_SEARCH &&
    renderedHotelCardCount > 0 &&
    renderedTextBlockCount > 0 &&
    semanticRenderActive
  ) {
    emitTrace("SEMANTIC_EXPLAINED_TOP_PICKS_BUILT", {
      hotelCardCount: renderedHotelCardCount,
      textBlockCount: renderedTextBlockCount,
      searchContextKey: buildSearchContextKey(plan),
      explanationSource: inventory?.semanticExplanationPlan?.source || null,
      explanationFallbackUsed:
        inventory?.semanticExplanationPlan?.fallbackUsed === true,
    });
  }
  const hotelSearchScope = inventory?.searchScope?.hotels || null;

  circuitBreaker.onSuccess();

  console.log("[timing] total turn:", Date.now() - startedAt, "ms");
  console.log("[ai] functionCalling.final", {
    tool: toolCall?.name || "none",
    nextActionBeforePostProcessing,
    tripRequestDetected: Boolean(tripRequest),
    tripOverrideApplied,
    finalNextAction: nextAction,
    destination: plan?.location?.city || null,
    inventoryCounts: {
      homes: inventory.homes?.length || 0,
      hotels: inventory.hotels?.length || 0,
    },
    hotelSearchScope: hotelSearchScope
      ? {
          candidateHotelCount: hotelSearchScope.candidateHotelCount ?? null,
          strongHotelCount: hotelSearchScope.strongHotelCount ?? null,
          relevantHotelCount: hotelSearchScope.relevantHotelCount ?? null,
          visibleHotelCount: hotelSearchScope.visibleHotelCount ?? null,
          scopeMode: hotelSearchScope.scopeMode ?? null,
          scopeReason: hotelSearchScope.scopeReason ?? null,
          warningMode: hotelSearchScope.warningMode ?? null,
          scopeConfidence: hotelSearchScope.scopeConfidence ?? null,
          scopeExpansionReason:
            hotelSearchScope.scopeExpansionReason ?? null,
        }
      : null,
    sectionsCount: renderedSections.length,
    hotelCardCount: renderedHotelCardCount,
  });
  emitFileDebug("turn_final_summary", {
    tool: toolCall?.name || "none",
    nextActionBeforePostProcessing,
    tripRequestDetected: Boolean(tripRequest),
    tripOverrideApplied,
    finalNextAction: nextAction,
    destination: plan?.location?.city || null,
    inventoryCounts: {
      homes: inventory.homes?.length || 0,
      hotels: inventory.hotels?.length || 0,
    },
    hotelSearchScope: hotelSearchScope
      ? {
          candidateHotelCount: hotelSearchScope.candidateHotelCount ?? null,
          strongHotelCount: hotelSearchScope.strongHotelCount ?? null,
          relevantHotelCount: hotelSearchScope.relevantHotelCount ?? null,
          visibleHotelCount: hotelSearchScope.visibleHotelCount ?? null,
          scopeMode: hotelSearchScope.scopeMode ?? null,
          scopeReason: hotelSearchScope.scopeReason ?? null,
          warningMode: hotelSearchScope.warningMode ?? null,
          scopeConfidence: hotelSearchScope.scopeConfidence ?? null,
          scopeExpansionReason:
            hotelSearchScope.scopeExpansionReason ?? null,
        }
      : null,
    sectionsCount: renderedSections.length,
    hotelCardCount: renderedHotelCardCount,
    durationMs: Date.now() - startedAt,
  });

  logAiEvent("turn", {
    sessionId,
    userId,
    intent: resolvedIntent,
    nextAction,
    missing: renderMissing,
    homes: inventory.homes?.length || 0,
    hotels: inventory.hotels?.length || 0,
    trip: trip ? trip.suggestions?.length || 0 : 0,
    planSource: "function_calling",
  });

  // Closing — sequential, after render, only when there are search results
  let closingResult = null;
  if (
    nextAction === NEXT_ACTIONS.RUN_SEARCH &&
    (inventory?.hotels?.length || 0) > 0
  ) {
    closingResult = await streamAssistantClosingMessage({
      client,
      plan,
      inventory,
      language,
      latestUserMessage,
      onClosingChunk: (chunk) => {
        emitEvent("closing_delta", { content: chunk });
      },
      emitTrace,
      emitFileDebug,
    });

    if (closingResult?.text) {
      emitEvent("assistant_closing", {
        text: closingResult.text,
        destination:
          plan?.location?.city ||
          plan?.location?.country ||
          null,
      });
    }
  }

  // 11. Return
  return {
    reply: rendered.assistant?.text || "",
    assistant: rendered.assistant || {
      text: "",
      tone: "neutral",
      disclaimers: [],
    },
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
    orientationMessage:
      plan?.assumptions?.separateSemanticOrientationMessage === true &&
      typeof plan?.semanticSearch?.orientation?.text === "string" &&
      plan.semanticSearch.orientation.text.trim()
        ? plan.semanticSearch.orientation.text.trim()
        : null,
    closingMessage: closingResult?.text || null,
  };
};

export const runAiTurn = async (params) => runFunctionCallingTurn(params);
