import OpenAI from "openai";
import models from "../models/index.js";
import { sendPushToUser } from "./pushNotifications.service.js";
import { getWeatherSummary } from "../modules/ai/tools/tool.weather.js";
import { getNearbyPlaces } from "../modules/ai/tools/tool.places.js";
import { getLocalNews } from "../modules/ai/tools/tool.news.js";
import { enqueueTripHubEnsure } from "./tripHubPacksQueue.service.js";

const DEFAULT_MODEL = process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini";
const apiKey = process.env.OPENAI_API_KEY;
let openaiClient = null;
const TRIP_HUB_OPENAI_TIMEOUT_MS = Number(process.env.TRIP_HUB_OPENAI_TIMEOUT_MS) || 60000;

const ensureClient = () => {
  if (!apiKey) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
};

const withTimeout = (promise, ms, label) => {
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

export const isAssistantEnabled = () => Boolean(apiKey);

const SPANISH_HINTS = [
  " hola ", " gracias", " por favor", " buenas", " buen dia", " alojamiento",
  " donde", " habitacion", " buscar", " necesito", " viaje", " familias", " personas",
  " quiero", " reservar", " fechas", " cuantos", " viajar",
];
const ENGLISH_HINTS = [" hello ", " hi ", " please ", " thanks", " looking for", " need ", " trip ", " hotel", " house ", " want ", " book ", " dates ", " guests ", " travel "];

/** Detect reply language from user message only (priority over app/profile). */
const detectLanguageFromText = (text = "", fallback = "en") => {
  const raw = String(text || "").trim();
  if (!raw) return fallback || "en";
  const normalized = raw.toLowerCase();
  const padded = ` ${normalized} `;

  // Arabic: script or common words
  if (/\p{Script=Arabic}/u.test(raw)) return "ar";
  const arabicHints = [" مرحبا", " شكرا", " من فضلك", " اريد", " فندق", " سفر"];
  if (arabicHints.some((hint) => raw.includes(hint))) return "ar";

  // Spanish: chars or hints
  const hasSpanishChars = /[\u00f1\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00a1\u00bf]/i.test(raw);
  if (hasSpanishChars || SPANISH_HINTS.some((hint) => padded.includes(hint))) return "es";

  if (ENGLISH_HINTS.some((hint) => padded.includes(hint))) return "en";
  return fallback || "en";
};

/**
 * Reply language: always match the user's message language, not app/profile.
 * Supports any language; model should reply in the same language as the last user message.
 */
const languageInstruction = (lang) => {
  const byLang = {
    es: "Responde siempre en espanol. Ajusta modismos si el usuario usa argentino, mexicano, etc.",
    en: "Reply always in English. Mirror the user's register (formal/casual) if needed.",
    ar: "Respond always in Arabic. Use the same register (formal/dialect) as the user.",
  };
  return (
    byLang[lang] ||
    `You MUST reply in the exact same language as the user's last message. If they wrote in Spanish, reply in Spanish; in Arabic, reply in Arabic; in English, reply in English; in French, reply in French; etc. Do not use app or profile language—only the language of the last user message. Current detected language code: ${lang}.`
  );
};

const buildTodayLine = (value) => {
  let now = null;
  if (value) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isFinite(parsed?.getTime?.())) {
      now = parsed;
    }
  }
  if (!now) now = new Date();
  const isoDate = Number.isFinite(now.getTime()) ? now.toISOString().slice(0, 10) : "";
  let pretty = "";
  try {
    pretty = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(now);
  } catch {
    pretty = isoDate;
  }
  if (pretty && isoDate && pretty !== isoDate) return `Today is ${pretty} (${isoDate}).`;
  if (isoDate) return `Today is ${isoDate}.`;
  return "";
};

const PLACE_SUGGESTION_CATEGORIES = [
  { id: "food", title: "Where to Eat", type: "restaurant" },
  { id: "drinks", title: "Drinks & Nightlife", type: "bar" },
  { id: "things", title: "Things to Do", type: "tourist_attraction" },
  { id: "pharmacy", title: "Pharmacies", type: "pharmacy" },
  { id: "grocery", title: "Groceries", type: "grocery_or_supermarket" },
  { id: "hospital", title: "Hospitals", type: "hospital" },
  { id: "atm", title: "ATMs", type: "atm" },
];

const buildPlaceSuggestions = async ({ location, limit = 6 } = {}) => {
  if (!location) return [];
  const groups = await Promise.all(
    PLACE_SUGGESTION_CATEGORIES.map(async (category) => {
      const items = await getNearbyPlaces({
        location,
        type: category.type,
        limit,
        hydratePhotos: true,
      });
      return {
        id: category.id,
        title: category.title,
        items,
      };
    })
  );
  return groups.filter((group) => Array.isArray(group.items) && group.items.length);
};

/** Pick localized string; for unsupported lang (e.g. ar) use English so model can still reply in user language. */
const pickLanguageText = (lang, english, spanish, arabic) => {
  if (lang === "es") return spanish;
  if (lang === "ar" && arabic) return arabic;
  return english;
};

const isDateQuestion = (text = "") => {
  const normalized = String(text || "").toLowerCase();
  return (
    /\bque\s+dia\s+es\s+hoy\b/.test(normalized) ||
    /\bque\s+dia\s+es\b/.test(normalized) ||
    /\bfecha\s+de\s+hoy\b/.test(normalized) ||
    /\bwhat\s+day\s+is\s+today\b/.test(normalized) ||
    /\bwhat\s+date\s+is\s+today\b/.test(normalized) ||
    /\bwhat\s+day\s+is\s+it\b/.test(normalized)
  );
};

const describeWeatherCode = (code, lang) => {
  const value = Number(code);
  if (!Number.isFinite(value)) return lang === "es" ? "condiciones variables" : "variable conditions";
  const map = {
    0: { en: "clear skies", es: "cielo despejado" },
    1: { en: "mostly clear", es: "mayormente despejado" },
    2: { en: "partly cloudy", es: "parcialmente nublado" },
    3: { en: "overcast", es: "nublado" },
    45: { en: "foggy", es: "con niebla" },
    48: { en: "foggy", es: "con niebla" },
    51: { en: "light drizzle", es: "llovizna ligera" },
    53: { en: "drizzle", es: "llovizna" },
    55: { en: "heavy drizzle", es: "llovizna intensa" },
    61: { en: "light rain", es: "lluvia ligera" },
    63: { en: "rain", es: "lluvia" },
    65: { en: "heavy rain", es: "lluvia intensa" },
    71: { en: "light snow", es: "nieve ligera" },
    73: { en: "snow", es: "nieve" },
    75: { en: "heavy snow", es: "nieve intensa" },
    80: { en: "rain showers", es: "chaparrones" },
    81: { en: "rain showers", es: "chaparrones" },
    82: { en: "heavy showers", es: "chaparrones fuertes" },
    95: { en: "thunderstorm", es: "tormenta" },
    96: { en: "thunderstorm with hail", es: "tormenta con granizo" },
    99: { en: "thunderstorm with hail", es: "tormenta con granizo" },
  };
  return (map[value] && map[value][lang]) || (lang === "es" ? "condiciones variables" : "variable conditions");
};

const isWeatherQuestion = (text = "") => /(clima|tiempo|weather|temperatura|pronostico)/i.test(text);

const sanitizeMessages = (messages = []) =>
  messages
    .map((message) => {
      if (!message) return null;
      const role = ["user", "assistant", "system"].includes(message.role) ? message.role : "user";
      const content = typeof message.content === "string" ? message.content.trim() : "";
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);

const sanitizeContextText = (value, maxLength = 160) => {
  if (value == null) return "";
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.slice(0, maxLength);
};

const normalizeUserContext = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const user = raw.user && typeof raw.user === "object" ? raw.user : {};
  const device = raw.device && typeof raw.device === "object" ? raw.device : {};
  const history = raw.history && typeof raw.history === "object" ? raw.history : {};
  const locationSource =
    (raw.location && typeof raw.location === "object" ? raw.location : null) ||
    (user.location && typeof user.location === "object" ? user.location : null) ||
    (device.location && typeof device.location === "object" ? device.location : null) ||
    {};
  const recentChatsRaw =
    (Array.isArray(history.recentChats) && history.recentChats) ||
    (Array.isArray(raw.recentChats) && raw.recentChats) ||
    [];
  const recentChats = recentChatsRaw
    .slice(0, 5)
    .map((chat) => {
      const title = sanitizeContextText(chat?.title, 80);
      const preview = sanitizeContextText(chat?.preview, 120);
      if (!title && !preview) return null;
      return {
        title,
        preview,
        lastMessageAt: sanitizeContextText(chat?.lastMessageAt || chat?.updatedAt || "", 40),
      };
    })
    .filter(Boolean);

  return {
    now: raw.now || device.now || null,
    localDate: raw.localDate || device.localDate || null,
    localTime: raw.localTime || device.localTime || null,
    localWeekday: raw.localWeekday || device.localWeekday || null,
    timeZone: raw.timeZone || raw.timezone || device.timeZone || null,
    locale: raw.locale || device.locale || null,
    user: {
      id: user.id ?? null,
      name: user.name ?? user.full_name ?? user.first_name ?? null,
      role: user.role ?? null,
      language: user.language ?? null,
      city: user.city ?? null,
      country: user.country ?? null,
    },
    location: {
      city: locationSource.city ?? null,
      country: locationSource.country ?? null,
    },
    recentChats,
  };
};

const buildUserContextBlock = (rawContext, language) => {
  const context = normalizeUserContext(rawContext);
  if (!context) return "";
  const lines = [];
  if (context.localDate) lines.push(`Local date: ${sanitizeContextText(context.localDate, 80)}`);
  if (context.localWeekday) lines.push(`Local weekday: ${sanitizeContextText(context.localWeekday, 40)}`);
  if (context.localTime) lines.push(`Local time: ${sanitizeContextText(context.localTime, 40)}`);
  if (context.timeZone) lines.push(`Time zone: ${sanitizeContextText(context.timeZone, 60)}`);
  if (context.locale) lines.push(`Locale: ${sanitizeContextText(context.locale, 40)}`);
  if (context.location?.city || context.location?.country) {
    const parts = [context.location.city, context.location.country].filter(Boolean);
    lines.push(`Location: ${sanitizeContextText(parts.join(", "), 80)}`);
  }
  if (context.user?.name || context.user?.role || context.user?.language) {
    const parts = [
      context.user?.name ? `name=${sanitizeContextText(context.user.name, 60)}` : null,
      context.user?.role != null ? `role=${sanitizeContextText(context.user.role, 20)}` : null,
      context.user?.language ? `lang=${sanitizeContextText(context.user.language, 20)}` : null,
    ].filter(Boolean);
    if (parts.length) lines.push(`User: ${parts.join(", ")}`);
  }
  if (context.recentChats?.length) {
    const chatLines = context.recentChats.map((chat, index) => {
      const title = chat.title || "Chat";
      const preview = chat.preview ? ` - ${chat.preview}` : "";
      return `${index + 1}) ${title}${preview}`;
    });
    lines.push(`Recent chats: ${chatLines.join(" | ")}`);
  }
  if (!lines.length) return "";
  const dateInstruction =
    language === "es"
      ? "Si el usuario pregunta por la fecha, hora o dia actual, responde usando el contexto. Si falta, pide aclaracion."
      : "If the user asks for the current date/time/day, answer using this context. If missing, ask for clarification.";
  return `${lines.join("\n")}\n${dateInstruction}`;
};

const sanitizeStringList = (value, { uppercase = false } = {}) => {
  if (!Array.isArray(value) || !value.length) return [];
  const result = value
    .map((item) => {
      if (typeof item === "number") {
        item = String(item);
      }
      if (typeof item !== "string") return null;
      let normalized = item.trim();
      if (!normalized) return null;
      if (uppercase) normalized = normalized.toUpperCase();
      return normalized;
    })
    .filter(Boolean);
  return Array.from(new Set(result));
};

const normalizeAmenityKeyValue = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const expandAmenityKeys = (amenityKeys = [], { text = "" } = {}) => {
  const expanded = [];
  const seen = new Set();
  const add = (key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    expanded.push(key);
  };

  let wantsParking = false;
  let hasParkingSpecificKey = false;
  const normalizedText = String(text || "").toLowerCase();
  const freeCues = ["gratis", "gratuito", "sin cargo", "free", "no charge", "incluido"];
  const paidCues = ["pago", "pagado", "con costo", "fee", "paid", "tarifa", "cargo"];
  const parkingCues = ["parking", "cochera", "estacionamiento", "garage"];
  const wantsFree = freeCues.some((cue) => normalizedText.includes(cue));
  const wantsPaid = paidCues.some((cue) => normalizedText.includes(cue));
  const wantsParkingByText = parkingCues.some((cue) => normalizedText.includes(cue));

  amenityKeys.forEach((rawKey) => {
    const key = String(rawKey || "").trim().toUpperCase();
    if (!key) return;
    const normalized = normalizeAmenityKeyValue(key);

    if (normalized === "WIFI") {
      add("WIFI");
      return;
    }
    if (normalized === "PARKING" || normalized === "GARAGE") {
      wantsParking = true;
      return;
    }
    if (normalized.includes("FREEPARKING")) {
      hasParkingSpecificKey = true;
      add("FREE_PARKING_ON_PREMISES");
      return;
    }
    if (normalized.includes("PAIDPARKING")) {
      hasParkingSpecificKey = true;
      add("PAID_PARKING_ON_PREMISES");
      return;
    }
    add(key);
  });

  if (wantsParking || wantsParkingByText || wantsFree || wantsPaid || hasParkingSpecificKey) {
    if (wantsFree && !wantsPaid) {
      add("FREE_PARKING_ON_PREMISES");
    } else if (wantsPaid && !wantsFree) {
      add("PAID_PARKING_ON_PREMISES");
    } else {
      add("FREE_PARKING_ON_PREMISES");
      add("PAID_PARKING_ON_PREMISES");
    }
  }

  return expanded;
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const positiveIntegerOrNull = (value) => {
  const numeric = numberOrNull(value);
  if (numeric === null) return null;
  const rounded = Math.floor(numeric);
  return rounded > 0 ? rounded : null;
};

const nonNegativeNumberOrNull = (value) => {
  const numeric = numberOrNull(value);
  if (numeric === null) return null;
  return numeric >= 0 ? numeric : null;
};

const normalizeDateString = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const sanitizeListingTypes = (value) => {
  const allowed = new Set(["HOMES", "HOTELS"]);
  if (!Array.isArray(value) || !value.length) return [];
  const sanitized = value
    .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : null))
    .filter((item) => item && allowed.has(item));
  return sanitized.length ? Array.from(new Set(sanitized)) : [];
};

const normalizeSortBy = (value) => {
  if (!value || typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  const allowed = new Set(["POPULARITY", "PRICE_ASC", "PRICE_DESC", "RELEVANCE"]);
  return allowed.has(normalized) ? normalized : null;
};

const normalizeIntent = (value, fallback) => {
  const allowed = new Set(["SEARCH", "SMALL_TALK", "HELP", "TRIP"]);
  if (!value || typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
};

const normalizeLanguage = (value, fallback) => {
  if (!value || typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("es")) return "es";
  if (normalized.startsWith("en")) return "en";
  return fallback;
};

const normalizeBooleanFlag = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "si"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return fallback;
};

const buildPlannerPrompt = ({ now } = {}) => {
  const todayLine = buildTodayLine(now);
  const todayBlock = todayLine ? `TODAY CONTEXT:\n${todayLine}\n\n` : "";
  return [
    {
      role: "system",
      content:
        "You are a smart travel assistant that analyzes conversations and detects intents. " +
        "Your job is to determine if the user wants to SEARCH for accommodation, just SMALL_TALK, or needs HELP.\n\n" +
        todayBlock +
        "INTENT DETECTION RULES:\n" +
      "- SEARCH: Only when the user explicitly mentions looking for accommodation with enough information (location, type, dates, or guests). " +
      "Key verbs: 'search', 'need', 'want', 'show me', 'is there', 'available'.\n" +
      "- SMALL_TALK: Greetings, farewells, thanks, personal questions, casual conversation without search intent.\n" +
      "- HELP: Questions about functionality, assistant capabilities, or general information about accommodation types.\n\n" +

      "IMPORTANT: If the user expresses a desire to travel ('I want to go to...', 'Quiero viajar a...') or provides a destination with travel context, use SEARCH intent.\n" +
      "Use SEARCH when the user's goal is to find options or plan a trip, even if details are missing.\n\n" +

      "SPECIAL LOCATION HANDLING:\n" +
      "- If the user says 'nearby', 'Nearby', 'User's Current Location', or 'current location':\n" +
      "  1. Look at the provided location object in the context (city, lat, lng).\n" +
      "  2. Use that location as the SEARCH destination.\n" +
      "  3. Do NOT ask 'Which city?' if the context location is available. Proceed with the search using the context coordinates or city.\n" +
      "- If the user specifies a city but no country, try to infer it from the context or region.\n\n" +

      "DATE HANDLING:\n" +
      "- If the user says a date without a year (e.g., 'Jan 18'), assume the NEXT occurrence of that date relative to 'now' in the context.\n" +
      "- If 'now' is 2026-01-08 and user says 'Jan 18', assume 2026-01-18.\n" +
      "- If today is Dec 2025 and user says 'Jan 18', assume 2026-01-18.\n\n" +

      "LANGUAGE AND IDIOMS DETECTION:\n" +
      "Detect and recognize regional idioms:\n" +
      "- Argentinians: che, boludo, copado, finde, buenisimo, genial, dale, barbaro\n" +
      "- Mexicans: wey, chido, padre, que onda\n" +
      "- Chileans: po, cachai, bacan\n" +
      "- Colombians: parce, chevere, berraco\n" +
      "Note these idioms in 'notes' so the assistant can respond in the same register if needed.\n\n" +

      "EXAMPLES:\n" +
      "User: 'Hi, how are you?' -> intent: SMALL_TALK\n" +
      "User: 'What types of accommodation do you have?' -> intent: HELP\n" +
      "User: 'Looking for a house in Cordoba for 4' -> intent: SEARCH\n" +
      "User: 'Hey, do you have something cool?' -> intent: SMALL_TALK (lacks specific info)\n" +
      "User: 'I want to go to Bariloche' -> intent: SEARCH (implied search)\n" +
      "User: 'Show me hotels in CABA' -> intent: SEARCH\n" +
      "User: 'Search nearby' -> intent: SEARCH (uses context location)\n\n" +

      "FILTERING & SORTING RULES:\n" +
      "- Fill location city/state/country and lat/lng when provided. If the user requests proximity (\"1km around Movistar Arena\"), set location.radiusKm and location.landmark.\n" +
      "- If the user does NOT specify homes vs hotels, return listingTypes as an empty array (do not assume a default).\n" +
      "- Detect HOME filters: propertyTypes (HOUSE, APARTMENT, CABIN, etc.), spaceTypes (ENTIRE_PLACE, PRIVATE_ROOM, SHARED_ROOM), amenityKeys (e.g., WIFI, FREE_PARKING_ON_PREMISES), and tagKeys (BEACHFRONT, LUXURY, FAMILY). Use uppercase keys.\n" +
      "- For parking requests, set homeFilters.amenityKeys (FREE_PARKING_ON_PREMISES and/or PAID_PARKING_ON_PREMISES).\n" +
      "- Detect HOTEL filters: amenityCodes from catalog names, amenityItemIds when numeric IDs are provided, preferredOnly flag, and minRating based on star ranks.\n" +
      "- If the user mentions pool/piscina/pileta, include hotelFilters.amenityCodes with \"POOL\".\n" +
      "- PREFERENCES (preferences.areaPreference): Extract from phrases like 'quiet', 'tranquilo', 'near coast/beach', 'cerca de la playa', 'city center', 'centro', 'family-friendly', 'familia', 'luxury', 'lujo', 'budget', 'económico'. Use: QUIET, BEACH_COAST, CITY_CENTER, FAMILY_FRIENDLY, LUXURY, BUDGET. Put all that apply in preferences.areaPreference array. Optional preferences.preferenceNotes: short free text for other wishes.\n" +
      "- Map preferences to filters: BEACH_COAST -> homeFilters.tagKeys BEACHFRONT when HOMES; LUXURY -> hotelFilters.preferredOnly or homeFilters.tagKeys LUXURY; BUDGET -> sortBy PRICE_ASC or budget.max; QUIET/FAMILY_FRIENDLY -> preferenceNotes so assistant can acknowledge.\n" +
      "- Capture guest requirements (adults, children, pets) plus requested bedrooms, beds, bathrooms, or total guests for homes.\n" +
      "- If the user says cheap/budget/economico/barato/ahorrar WITHOUT an explicit numeric amount, set sortBy PRICE_ASC and DO NOT set budget.max.\n" +
      "- Only set budget.max or budget.min when the user provides an explicit numeric amount (e.g., \"menos de 100\").\n" +
      "- Detect explicit budgets and ordering like 'cheapest', 'precios altos', or 'ordenar por precio'. Map to sortBy PRICE_ASC or PRICE_DESC. Respect requested limit counts when possible.\n\n" +

      "Respond ONLY with a valid JSON object with this schema:\n" +
      `{
        "intent": "SEARCH" | "SMALL_TALK" | "HELP",
        "listingTypes": ["HOMES","HOTELS"],
        "location": {"city": string|null, "state": string|null, "country": string|null, "lat": number|null, "lng": number|null, "radiusKm": number|null, "landmark": string|null},
        "dates": {"checkIn": "YYYY-MM-DD" | null, "checkOut": "YYYY-MM-DD" | null, "flexible": boolean},
        "guests": {"adults": number|null, "children": number|null, "infants": number|null, "pets": number|null, "total": number|null},
        "preferences": {"areaPreference": string[], "preferenceNotes": string[]},
        "homeFilters": {
          "propertyTypes": string[],
          "spaceTypes": string[],
          "amenityKeys": string[],
          "tagKeys": string[],
          "maxGuests": number|null,
          "minBedrooms": number|null,
          "minBeds": number|null,
          "minBathrooms": number|null
        },
        "hotelFilters": {
          "amenityCodes": string[],
          "amenityItemIds": string[],
          "preferredOnly": boolean,
          "minRating": number|null
        },
        "budget": {"currency": string|null, "max": number|null, "min": number|null},
        "sortBy": "POPULARITY" | "PRICE_ASC" | "PRICE_DESC" | "RELEVANCE",
        "limit": number|null,
        "language": "en",
        "notes": string[]
      }`,
    },
  ];
};

const defaultPlan = {
  intent: "SMALL_TALK",
  listingTypes: [],
  location: { city: null, state: null, country: null, lat: null, lng: null, radiusKm: null, landmark: null },
  dates: { checkIn: null, checkOut: null, flexible: true },
  guests: { adults: null, children: null, infants: null, pets: null, total: null },
  preferences: { areaPreference: [], preferenceNotes: [] },
  homeFilters: {
    propertyTypes: [],
    spaceTypes: [],
    amenityKeys: [],
    tagKeys: [],
    maxGuests: null,
    minBedrooms: null,
    minBeds: null,
    minBathrooms: null,
  },
  hotelFilters: {
    amenityCodes: [],
    amenityItemIds: [],
    preferredOnly: false,
    minRating: null,
  },
  budget: { currency: null, max: null, min: null },
  sortBy: null,
  limit: null,
  language: "en",
  notes: [],
};

const mergePlan = (raw, { contextText = "" } = {}) => {
  if (!raw || typeof raw !== "object") return { ...defaultPlan };
  const locationInput = raw.location || {};
  const mergedLocation = {
    ...defaultPlan.location,
    ...locationInput,
  };
  const latValue = numberOrNull(locationInput.lat);
  if (latValue !== null) mergedLocation.lat = latValue;
  const lngValue = numberOrNull(locationInput.lng);
  if (lngValue !== null) mergedLocation.lng = lngValue;
  const radiusValue =
    nonNegativeNumberOrNull(locationInput.radiusKm ?? locationInput.radius_km ?? locationInput.radius) ??
    defaultPlan.location.radiusKm;
  mergedLocation.radiusKm = radiusValue;
  const landmarkValue =
    typeof locationInput.landmark === "string" && locationInput.landmark.trim().length
      ? locationInput.landmark.trim()
      : defaultPlan.location.landmark;
  mergedLocation.landmark = landmarkValue;

  const rawHomeFilters = raw.homeFilters || raw.home_filters || {};
  const homeFilters = {
    ...defaultPlan.homeFilters,
    ...rawHomeFilters,
    propertyTypes: sanitizeStringList(rawHomeFilters.propertyTypes ?? [], { uppercase: true }),
    spaceTypes: sanitizeStringList(rawHomeFilters.spaceTypes ?? [], { uppercase: true }),
    amenityKeys: sanitizeStringList(rawHomeFilters.amenityKeys ?? [], { uppercase: true }),
    tagKeys: sanitizeStringList(rawHomeFilters.tagKeys ?? rawHomeFilters.tags ?? [], { uppercase: true }),
  };
  const resolvedMaxGuests =
    positiveIntegerOrNull(rawHomeFilters.maxGuests ?? rawHomeFilters.guests ?? raw.guests?.total) ??
    defaultPlan.homeFilters.maxGuests;
  const resolvedBedrooms =
    positiveIntegerOrNull(rawHomeFilters.minBedrooms ?? rawHomeFilters.bedrooms ?? raw.bedrooms) ??
    defaultPlan.homeFilters.minBedrooms;
  const resolvedBeds =
    positiveIntegerOrNull(rawHomeFilters.minBeds ?? rawHomeFilters.beds ?? raw.beds) ??
    defaultPlan.homeFilters.minBeds;
  const resolvedBathrooms =
    nonNegativeNumberOrNull(rawHomeFilters.minBathrooms ?? rawHomeFilters.bathrooms ?? raw.bathrooms) ??
    defaultPlan.homeFilters.minBathrooms;
  homeFilters.maxGuests = resolvedMaxGuests;
  homeFilters.minBedrooms = resolvedBedrooms;
  homeFilters.minBeds = resolvedBeds;
  homeFilters.minBathrooms = resolvedBathrooms;
  const noteText = Array.isArray(raw?.notes) ? raw.notes.join(" ") : "";
  const combinedText = [contextText, noteText].filter(Boolean).join(" ");
  homeFilters.amenityKeys = expandAmenityKeys(homeFilters.amenityKeys, {
    text: combinedText,
  });

  const rawHotelFilters = raw.hotelFilters || raw.hotel_filters || {};
  const hotelFilters = {
    ...defaultPlan.hotelFilters,
    ...rawHotelFilters,
    amenityCodes: sanitizeStringList(rawHotelFilters.amenityCodes ?? rawHotelFilters.amenities ?? [], { uppercase: true }),
    amenityItemIds: sanitizeStringList(rawHotelFilters.amenityItemIds ?? rawHotelFilters.itemIds ?? []),
  };
  hotelFilters.preferredOnly = normalizeBooleanFlag(
    rawHotelFilters.preferredOnly ?? rawHotelFilters.preferred ?? raw.preferredOnly,
    defaultPlan.hotelFilters.preferredOnly
  );
  const resolvedMinRating =
    nonNegativeNumberOrNull(rawHotelFilters.minRating ?? rawHotelFilters.rating ?? raw.rating) ??
    defaultPlan.hotelFilters.minRating;
  hotelFilters.minRating = resolvedMinRating;

  const rawDates = raw.dates || {};
  const normalizedDates = {
    ...defaultPlan.dates,
    ...rawDates,
  };
  normalizedDates.checkIn = normalizeDateString(rawDates.checkIn ?? normalizedDates.checkIn);
  normalizedDates.checkOut = normalizeDateString(rawDates.checkOut ?? normalizedDates.checkOut);
  normalizedDates.flexible = normalizeBooleanFlag(rawDates.flexible, defaultPlan.dates.flexible);

  const { amenities, ...rawPlan } = raw;
  return {
    ...defaultPlan,
    ...rawPlan,
    intent: normalizeIntent(raw.intent, defaultPlan.intent),
    listingTypes: sanitizeListingTypes(raw.listingTypes),
    location: mergedLocation,
    dates: normalizedDates,
    guests: { ...defaultPlan.guests, ...(raw.guests || {}) },
    homeFilters,
    hotelFilters,
    budget: { ...defaultPlan.budget, ...(raw.budget || {}) },
    sortBy: normalizeSortBy(raw.sortBy),
    limit: positiveIntegerOrNull(raw.limit) ?? defaultPlan.limit,
    language: normalizeLanguage(raw.language, defaultPlan.language),
    notes: Array.isArray(raw.notes) ? raw.notes.filter(Boolean) : [],
  };
};

export const extractSearchPlan = async (messages = [], { now } = {}) => {
  const client = ensureClient();
  const normalizedMessages = sanitizeMessages(messages);
  const latestUserMessage =
    [...normalizedMessages].reverse().find((msg) => msg.role === "user")?.content ?? "";
  if (!client || !normalizedMessages.length) {
    return mergePlan(defaultPlan, { contextText: latestUserMessage });
  }
  try {
    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      response_format: { type: "json_object" },
      messages: [...buildPlannerPrompt({ now }), ...normalizedMessages],
    });
    const payload = completion.choices?.[0]?.message?.content;
    if (!payload) return mergePlan(defaultPlan, { contextText: latestUserMessage });
    const parsed = JSON.parse(payload);
    return mergePlan(parsed, { contextText: latestUserMessage });
  } catch (err) {
    console.error("[aiAssistant] extractSearchPlan failed", err?.message || err);
    return mergePlan(defaultPlan, { contextText: latestUserMessage });
  }
};

/**
 * Generates smart insights and preparation items for a trip hub.
 */
export const generateTripAddons = async ({ tripContext, location, lang = "en" }) => {
  const client = ensureClient();
  const TRIP_HUB_DEBUG = process.env.TRIP_HUB_DEBUG === "true";
  const debugTripHub = (...args) => {
    if (TRIP_HUB_DEBUG) console.log("[tripHub.debug]", ...args);
  };
  if (!client) {
    debugTripHub("addons.missing_client", { hasTripContext: Boolean(tripContext) });
    return {
      insights: [],
      preparation: [],
      timeContext: null,
      localPulse: [],
      localLingo: null,
      suggestions: [],
      itinerary: [],
      __aiStatus: null,
      __aiErrorCode: null,
    };
  }

  const city = location?.city || tripContext?.location?.city || "your destination";
  const stay = tripContext?.stayName || "your stay";
  const amenities = tripContext?.amenities || [];
  const rules = tripContext?.houseRules || "";
  const type = tripContext?.inventoryType || "stay";


  // FETCH REAL NEWS
  let newsHeadlines = [];
  try {
    const newsItems = await getLocalNews({ query: city, locale: lang === "es" ? "es-419" : "en-US" });
    newsHeadlines = newsItems.map(i => `- ${i.title} (${i.publishedAt || 'Recent'})`);
  } catch (newsErr) {
    console.warn("[ai] News fetch warning:", newsErr);
  }

  const systemMessage =
    "You are a premium travel concierge. Generate smart insights and a preparation hub for a user's trip.\n" +
    "### DEEP INTELLIGENCE INSTRUCTIONS:\n" +
    "1. FOCUS ON THE DESTINATION FIRST: Provide cultural insights, hidden local gems, or 'live like a local' tips for ${city}.\n" +
    "2. WEATHER SMART TIPS: If weather data is available, offer specific advice (e.g., 'Windy city, bring a jacket').\n" +
    "3. STAY HIGHLIGHTS: Mention unique features of ${stay}. If a critical amenity is missing (e.g., no breakfast), offer a *specific* high-rated local alternative nearby.\n" +
    "4. HOUSE RULES: Only mention rules if they are unusual or critical for avoiding fines.\n" +
    "5. DIVERSITY: Mix cultural facts, practical tips, and fun local knowledge. Do not just list what is missing.\n" +
    "6. TIME CONTEXT: Generate specific advice for Morning, Afternoon, and Evening.\n" +
    "7. LOCAL PULSE: Use the provided REAL NEWS HEADLINES to generate 2-3 Pulse items. Summarize the event/news. If no headlines are provided, return an empty localPulse array. Do NOT invent news.\n" +
    "8. LOCAL LINGO: Provide one interesting local phrase/slang with translation and context.\n" +
    "9. SMART ITINERARY: Generate a 3-day simplified itinerary (Day 1, Day 2, Day 3). For each day, provide a title (e.g., 'Cultural Immersion') and 3 key items (Morning, Afternoon, Evening). Each item needs a time (e.g., '10:00 AM'), activity name, and a valid Ionicon name.\n" +
    "10. icons MUST be valid Ionicons names.\n\n" +
    "Return JSON with shape:\n" +
    "{\n" +
    "  \"insights\": [{ \"title\": string, \"icon\": string, \"description\": string, \"details\": string, \"type\": \"TIP\"|\"FUN_FACT\"|\"WARNING\" }],\n" +
    "  \"preparation\": [{ \"id\": string, \"title\": string, \"value\": string, \"details\": string, \"icon\": string }],\n" +
    "  \"timeContext\": {\n" +
    "    \"morning\": { \"action\": string, \"tip\": string, \"icon\": string },\n" +
    "    \"afternoon\": { \"action\": string, \"tip\": string, \"icon\": string },\n" +
    "    \"evening\": { \"action\": string, \"tip\": string, \"icon\": string }\n" +
    "  },\n" +
    "  \"localPulse\": [{ \"headline\": string, \"subtext\": string, \"category\": \"event\"|\"news\"|\"culture\" }],\n" +
    "  \"localLingo\": { \"phrase\": string, \"translation\": string, \"pronunciation\": string, \"context\": string },\n" +
    "  \"suggestions\": [{ \"title\": string, \"items\": [{ \"name\": string, \"category\": string, \"rating\": number, \"distanceKm\": number, \"description\": string }] }],\n" +
    "  \"itinerary\": [{ \"day\": string, \"title\": string, \"items\": [{ \"time\": string, \"activity\": string, \"icon\": string }] }]\n" +
    "}\n" +
    "For 'suggestions', generate 3 categories: 'Where to Eat', 'Drinks & Nightlife', and 'Things to Do'. Provide 3-4 top-tier recommendations for each.\n" +
    "For 'details', provide a deeper explanation (2-3 sentences) that expands on the insight/prep item so key info is read-ready.\n" +
    `Language: ${lang === "es" ? "Spanish" : "English"}.\n` +
    `Destination: ${city}. Stay: ${stay} (Type: ${type}).\n` +
    `Amenities: ${JSON.stringify(amenities)}.\n` +
    `House Rules: ${rules}.\n`;

  try {
    debugTripHub("addons.request", {
      city,
      stay,
      lang,
      hasAmenities: Array.isArray(amenities) && amenities.length > 0,
      hasRules: Boolean(rules),
      hasNews: newsHeadlines.length > 0,
    });
    const requestStartedAt = Date.now();
    debugTripHub("addons.request.start", {
      model: DEFAULT_MODEL,
      timeoutMs: TRIP_HUB_OPENAI_TIMEOUT_MS,
    });
    const userPrompt = `Provide deep intelligence for my ${type} at ${stay} in ${city}. Include time-specific advice, local events (pulse), a local phrase (lingo), curated local suggestions (Food, Drinks, Activities), and a smart 3-day itinerary. Focus on unique local experiences. \n` +
      (amenities.length ? `Amenities available: ${amenities.join(", ")}. ` : "") +
      (rules ? `House rules: ${rules}.` : "") +
      (newsHeadlines.length ? `\nREAL NEWS HEADLINES (Use these for Local Pulse):\n${newsHeadlines.join("\n")}` : "");

    const completion = await withTimeout(
      client.chat.completions.create({
        model: DEFAULT_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userPrompt },
        ],
      }),
      TRIP_HUB_OPENAI_TIMEOUT_MS,
      "TripHub OpenAI"
    );
    debugTripHub("addons.request.done", { durationMs: Date.now() - requestStartedAt });

    const payload = completion.choices?.[0]?.message?.content;
    if (!payload) return { insights: [], preparation: [] };
    const parsed = JSON.parse(payload);

    const resolvedLocalPulse =
      newsHeadlines.length && Array.isArray(parsed.localPulse) ? parsed.localPulse : [];

    const result = {
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      preparation: Array.isArray(parsed.preparation) ? parsed.preparation : [],
      timeContext: parsed.timeContext || null,
      localPulse: resolvedLocalPulse,
      localLingo: parsed.localLingo || null,
      suggestions: parsed.suggestions || [],
      itinerary: Array.isArray(parsed.itinerary) ? parsed.itinerary : [],
    };
    debugTripHub("addons.response", {
      insights: result.insights.length,
      preparation: result.preparation.length,
      hasTimeContext: Boolean(result.timeContext),
      localPulse: result.localPulse.length,
      hasLocalLingo: Boolean(result.localLingo),
      suggestions: Array.isArray(result.suggestions) ? result.suggestions.length : 0,
      itinerary: result.itinerary.length,
    });
    return result;
  } catch (err) {
    console.error("[aiAssistant] generateTripAddons failed", err);
    if (process.env.TRIP_HUB_DEBUG === "true") {
      console.error("[tripHub.debug] addons.error", {
        message: err?.message || String(err),
        code: err?.code || null,
      });
    }
    const errorCode = err?.code || null;
    return {
      insights: [],
      preparation: [],
      timeContext: null,
      localPulse: [],
      localLingo: null,
      suggestions: [],
      itinerary: [],
      __aiStatus: errorCode === "OPENAI_TIMEOUT" ? "failed" : null,
      __aiErrorCode: errorCode === "OPENAI_TIMEOUT" ? "OPENAI_TIMEOUT" : null,
    };
  }
};

/**
 * Proactively generates and saves trip intelligence in the background.
 */
export const generateAndSaveTripIntelligence = async ({ stayId, tripContext, lang = "en" }) => {
  const startedAt = Date.now();
  const TRIP_HUB_DEBUG = process.env.TRIP_HUB_DEBUG === "true";
  const debugTripHub = (...args) => {
    if (TRIP_HUB_DEBUG) console.log("[tripHub.debug]", ...args);
  };
  try {
    const { StayIntelligence, Stay } = models;
    const nowIso = new Date().toISOString();
    const cooldownUntilIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const location = tripContext?.location || {};
    const tripContextSnapshot = tripContext
      ? {
          stayName: tripContext.stayName ?? null,
          locationText: tripContext.locationText ?? null,
          location: tripContext.location ?? null,
          dates: tripContext.dates ?? null,
          inventoryType: tripContext.inventoryType ?? null,
        }
      : null;

    // Load record early so we can persist AI attempt state
    let record = await StayIntelligence.findOne({ where: { stayId } });
    const prevMetadata = record?.metadata || {};
    const aiAttempts = (Number(prevMetadata.aiAttempts) || 0) + 1;

    // 1. Generate core addons
    const addons = await generateTripAddons({
      tripContext,
      location,
      lang
    });
    const placeSuggestions = await buildPlaceSuggestions({ location });
    debugTripHub("intelligence.addons", {
      stayId,
      insights: addons.insights?.length || 0,
      preparation: addons.preparation?.length || 0,
      suggestions: Array.isArray(addons.suggestions) ? addons.suggestions.length : 0,
      placeSuggestions: Array.isArray(placeSuggestions) ? placeSuggestions.length : 0,
      itinerary: addons.itinerary?.length || 0,
    });

    // 2. Fetch Weather
    let weather = null;
    try {
      const startDate = tripContext?.dates?.checkIn || null;
      const endDate = tripContext?.dates?.checkOut || null;
      weather = await getWeatherSummary({ location, startDate, endDate });
    } catch (wErr) {
      console.warn("[aiAssistant] background weather fetch failed", wErr?.message);
    }
    debugTripHub("intelligence.weather", { stayId, hasWeather: Boolean(weather) });

    // 3. Upsert intelligence record (Manual check to avoid ON CONFLICT errors if constraint missing)
    const isNewRecord = !record;
    const timedOut = addons?.__aiStatus === "failed" && addons?.__aiErrorCode === "OPENAI_TIMEOUT";
    // __aiStatus/__aiErrorCode are internal-only; never persist or return them. Only write failure fields on timeout.
    const baseMetadata = {
      ...(prevMetadata || {}),
      weather,
      timeContext: addons.timeContext,
      localPulse: addons.localPulse,
      localLingo: addons.localLingo,
      suggestions: placeSuggestions.length ? placeSuggestions : addons.suggestions,
      itinerary: addons.itinerary,
      tripContext: tripContextSnapshot,
      aiLastAttemptAt: nowIso,
      aiAttempts,
      ...(timedOut
        ? {
            aiStatus: "failed",
            aiErrorCode: "OPENAI_TIMEOUT",
            aiFailedAt: nowIso,
            aiCooldownUntil: cooldownUntilIso,
          }
        : {}),
    };
    const alreadyNotified = Boolean(
      baseMetadata.tripHubReadyNotifiedAt || baseMetadata.tripHubReadyNotified
    );

    if (record) {
      await record.update({
        insights: addons.insights || [],
        preparation: addons.preparation || [],
        metadata: baseMetadata,
        lastGeneratedAt: new Date(),
      });
    } else {
      record = await StayIntelligence.create({
        stayId,
        insights: addons.insights || [],
        preparation: addons.preparation || [],
        metadata: baseMetadata,
        lastGeneratedAt: new Date(),
      });
    }
    debugTripHub("intelligence.saved", { stayId, isNewRecord });

    if (!alreadyNotified) {
      try {
        const stay = await Stay.findByPk(stayId, { attributes: ["id", "user_id"] });
        const userId = stay?.user_id ?? null;
        if (userId) {
          const tokenCount = await models.PushToken.count({ where: { user_id: userId } });
          if (tokenCount > 0) {
            const stayName = tripContext?.stayName || "your trip";
            await sendPushToUser({
              userId,
              title: "Trip Hub ready",
              body: `Your Trip Hub is ready for ${stayName}.`,
              data: { type: "TRIP_HUB_READY", stayId },
            });
            await record.update({
              metadata: { ...baseMetadata, tripHubReadyNotifiedAt: new Date().toISOString() },
            });
          }
        }
      } catch (pushErr) {
        console.warn("[aiAssistant] Trip hub push failed:", pushErr?.message || pushErr);
      }
    }

    try {
      await enqueueTripHubEnsure({
        tripContext: tripContextSnapshot || tripContext,
        timeZone: weather?.timeZone || null,
      });
    } catch (packErr) {
      console.warn("[aiAssistant] trip hub packs enqueue failed:", packErr?.message || packErr);
    }

    console.log("[perf] tripHub.generate", {
      stayId,
      durationMs: Date.now() - startedAt,
      generated: isNewRecord,
    });
    return record;
  } catch (err) {
    console.error(`[aiAssistant] generateAndSaveTripIntelligence failed for stay ${stayId}`, err);
    return null;
  }
};

export const generateAssistantReply = async ({
  plan,
  messages = [],
  inventory = {},
  trip = null,
  tripContext = null,
  userContext = null,
  weather = null,
} = {}) => {
  const client = ensureClient();
  const normalized = sanitizeMessages(messages);
  const latestUserMessage = [...normalized].reverse().find((msg) => msg.role === "user")?.content ?? "";
  const intent = plan?.intent || "SMALL_TALK";
  const modismos = Array.isArray(plan?.notes) ? plan.notes.join(", ") : "";
  const planLanguage = typeof plan?.language === "string" ? plan.language : null;
  const targetLanguage = detectLanguageFromText(latestUserMessage, planLanguage || "en");
  const contextBlock = buildUserContextBlock(userContext, targetLanguage);
  const languageGuard =
    "DETECT the language of the user's last message. ALWAYS reply in that same language. Do not mix languages.";
  const todayLine = buildTodayLine(userContext?.now || userContext?.localDate);
  const todayBlock = todayLine ? `${todayLine}\n` : "";

  let finalContextBlock = contextBlock;
  if (tripContext?.summary) {
    const tripInfo = targetLanguage === "es"
      ? `CONTEXTO DEL VIAJE ACTIVO: ${tripContext.summary}`
      : `ACTIVE TRIP CONTEXT: ${tripContext.summary}`;
    finalContextBlock = finalContextBlock ? `${finalContextBlock}\n${tripInfo}` : tripInfo;
  }

  if (plan && typeof plan === "object") {
    plan.language = targetLanguage;
  }
  if (isDateQuestion(latestUserMessage)) {
    const context = normalizeUserContext(userContext);
    const dateParts = [];
    if (context?.localWeekday) dateParts.push(context.localWeekday);
    if (context?.localDate) dateParts.push(context.localDate);
    if (context?.localTime) dateParts.push(context.localTime);
    if (dateParts.length) {
      const reply = targetLanguage === "es"
        ? `Hoy es ${dateParts.join(", ")}.`
        : `Today is ${dateParts.join(", ")}.`;
      return {
        reply,
        followUps:
          targetLanguage === "es"
            ? ["Buscar alojamiento", "Necesito un hotel", "Busco una casa"]
            : ["Search accommodation", "Need a hotel", "Looking for a home"],
      };
    }
  }
  if (isWeatherQuestion(latestUserMessage) && weather?.current) {
    const temp = weather.current.temperatureC;
    const feels = weather.current.apparentC;
    const wind = weather.current.windKph;
    const description = describeWeatherCode(weather.current.weatherCode, targetLanguage);
    const parts = [];
    if (Number.isFinite(temp)) {
      parts.push(targetLanguage === "es" ? `temperatura ${temp}C` : `temperature ${temp}C`);
    }
    if (Number.isFinite(feels)) {
      parts.push(targetLanguage === "es" ? `sensacion ${feels}C` : `feels like ${feels}C`);
    }
    if (Number.isFinite(wind)) {
      parts.push(targetLanguage === "es" ? `viento ${wind} km/h` : `wind ${wind} km/h`);
    }
    const summary = parts.length ? parts.join(", ") : "";
    const reply =
      targetLanguage === "es"
        ? `El clima actual es ${description}${summary ? `, ${summary}` : ""}.`
        : `Current weather is ${description}${summary ? `, ${summary}` : ""}.`;
    return {
      reply,
      followUps:
        targetLanguage === "es"
          ? ["Buscar alojamiento", "Necesito un hotel", "Busco una casa"]
          : ["Search accommodation", "Need a hotel", "Looking for a home"],
    };
  }
  const matchTypes = inventory?.matchTypes ?? {};
  const matchTypeValues = Object.values(matchTypes);
  const hasExactMatches = matchTypeValues.includes("EXACT");
  const hasSimilarMatches = matchTypeValues.includes("SIMILAR");
  const isSimilarOnly = hasSimilarMatches && !hasExactMatches;

  const summary = {
    location: plan?.location ?? null,
    guests: plan?.guests ?? null,
    dates: plan?.dates ?? null,
    matchTypes,
    foundExact: Boolean(inventory?.foundExact),
    weather: weather
      ? {
        current: weather.current || null,
        timeZone: weather.timeZone || null,
        updatedAt: weather.updatedAt || null,
      }
      : null,
    homes: (inventory.homes || []).slice(0, 5).map((home) => ({
      id: home.id,
      title: home.title,
      city: home.city,
      pricePerNight: home.pricePerNight,
      currency: home.currency,
    })),
    hotels: (inventory.hotels || []).slice(0, 5).map((hotel) => ({
      id: hotel.id,
      name: hotel.name,
      city: hotel.city,
      preferred: hotel.preferred,
    })),
  };
  const tripSummary = trip
    ? {
      location: trip.location ?? null,
      stayName: tripContext?.stayName ?? null,
      dates: tripContext?.dates ?? null,
      suggestions: (trip.suggestions || []).map((category) => ({
        id: category.id,
        label: category.label,
        places: (category.places || []).slice(0, 4).map((place) => ({
          id: place.id,
          name: place.name,
          rating: place.rating,
          distanceKm: place.distanceKm,
          priceLevel: place.priceLevel,
          address: place.address,
        })),
      })),
      itinerary: Array.isArray(trip.itinerary) ? trip.itinerary : [],
    }
    : null;

  if (!client) {
    // Fallback without OpenAI
    if (intent === "TRIP") {
      const hasSuggestions = tripSummary?.suggestions?.length;
      const hasItinerary = tripSummary?.itinerary?.length;
      const reply = hasSuggestions
        ? hasItinerary
          ? pickLanguageText(
            targetLanguage,
            "I pulled nearby options and drafted a short itinerary. Want me to adjust the plan or focus on a specific category?",
            "Encontre opciones cercanas y arme un itinerario corto. Queres que ajuste el plan o que me enfoque en alguna categoria?"
          )
          : pickLanguageText(
            targetLanguage,
            "I found nearby options based on your stay. Want a day-by-day itinerary too?",
            "Encontre opciones cercanas segun tu estadia. Queres que arme un itinerario dia por dia?"
          )
        : pickLanguageText(
          targetLanguage,
          "Tell me what kind of places you want nearby and I will build suggestions.",
          "Decime que tipo de lugares queres cerca y te armo sugerencias."
        );
      return {
        reply,
        followUps:
          targetLanguage === "es"
            ? ["Ver restaurantes cercanos", "Armar itinerario", "Lugares interesantes"]
            : ["Nearby restaurants", "Build itinerary", "Interesting places"],
      };
    } else if (intent === "SEARCH") {
      const reply =
        inventory.homes?.length || inventory.hotels?.length
          ? isSimilarOnly
            ? pickLanguageText(
              targetLanguage,
              "I couldn't find exact matches, but I found similar options for you. Check the results below and tell me if you want to adjust dates or budget.",
              "No encontre coincidencias exactas, pero tengo opciones similares para vos. Revisa los resultados y decime si queres ajustar fechas o presupuesto."
            )
            : pickLanguageText(
              targetLanguage,
              "Here are the best options for you.",
              "Estas son las mejores opciones para vos."
            )
          : pickLanguageText(
            targetLanguage,
            "I couldn't find matches yet. Try changing city, dates, or guest count.",
            "Todavia no encontre coincidencias. Proba cambiando ciudad, fechas o cantidad de personas."
          );
      return {
        reply,
        followUps:
          targetLanguage === "es"
            ? ["Buscar otra ciudad", "Cambiar fechas", "Agregar presupuesto maximo"]
            : ["Search another city", "Adjust dates", "Add budget limit"],
      };
    } else if (intent === "HELP") {
      return {
        reply: pickLanguageText(
          targetLanguage,
          "I can help you look for homes (houses, apartments, cabins) and hotels. What are you looking for?",
          "Puedo ayudarte a buscar casas, departamentos, cabanas y hoteles. Que estas buscando?"
        ),
        followUps:
          targetLanguage === "es"
            ? ["Buscar una casa", "Necesito un hotel", "Que comodidades hay?"]
            : ["Looking for a house", "Need a hotel", "What amenities are available?"],
      };
    } else {
      return {
        reply: pickLanguageText(
          targetLanguage,
          "Hello! I am your travel assistant. How can I help you today?",
          "Hola! Soy tu asistente de viajes. En que puedo ayudarte hoy?"
        ),
        followUps:
          targetLanguage === "es"
            ? ["Buscar alojamiento", "Que puedes hacer?", "Ver opciones disponibles"]
            : ["Search accommodation", "What can you do?", "See available options"],
      };
    }
  }

  try {
    let systemPrompt = "";
    const langLine = languageInstruction(targetLanguage);

    const contextInstruction = tripContext?.summary
      ? "IMPORTANT: You HAVE access to the user's active booking/trip in the 'USER CONTEXT' section below. If the user asks about their booking, reservation, or trip details, USE that information to answer."
      : "";

    if (intent === "TRIP") {
      systemPrompt =
        "You are a travel planner helping a guest who already booked a stay.\n" +
        `${langLine}\n` +
        `${languageGuard}\n` +
        `${todayBlock}` +
        "Always return JSON with shape {\"reply\": string, \"followUps\": string[]}.\n" +
        "- Vary your wording: e.g. 'Here are some nearby spots.', 'I put together a few options around you.', 'These are solid picks for your stay.' (or equivalent in the user's language). Avoid repeating the same opener.\n" +
        "- Use the provided trip context and suggestions to summarize nearby options.\n" +
        "- If an itinerary is provided, mention that a day-by-day plan is ready.\n" +
        "- Keep the reply concise and helpful, highlighting top-rated or closest options.\n" +
        "- followUps: Ask what category or day to refine. Vary phrasing.\n" +
        (modismos ? `- The user uses idioms: ${modismos}. Respond in the same register.\n` : "");
    } else if (intent === "SEARCH") {
      systemPrompt =
        "You are a friendly and professional travel assistant. The user is looking for accommodation.\n" +
        `${langLine}\n` +
        `${languageGuard}\n` +
        `${todayBlock}` +
        "Always return JSON with shape {\"reply\": string, \"followUps\": string[]}.\n" +
        `${contextInstruction}\n` +
        "- Vary your wording naturally. Avoid repeating the same phrase every time (e.g. do not always start with 'Here are the best options'). Use different openings and tones: e.g. 'I found some great options for you.', 'These picks match what you’re looking for.', 'Take a look at these.', Or in Spanish: 'Encontré buenas opciones.', 'Estas son algunas opciones que encajan.', 'Mirá estas opciones.'\n" +
        "- If there are results: Return the 'reply' as a single, VERY concise sentence. You may add the location briefly. Vary phrasing across conversations.\n" +
        "- If results are marked as SIMILAR (matchTypes): say there were no exact matches and mention you found similar options.\n" +
        "- If NO results: Suggest concrete adjustments (change city, dates, budget). Vary suggestions (e.g. 'Try different dates', 'Broaden the area', 'Adjust your budget').\n" +
        "- followUps: 3-4 relevant follow-up suggestions. Vary the wording of follow-ups; avoid always using the same labels.\n" +
        (modismos ? `- The user uses idioms: ${modismos}. Respond in the same register.\n` : "");
    } else if (intent === "HELP") {
      systemPrompt =
        "You are a friendly travel assistant. The user needs help or information.\n" +
        `${langLine}\n` +
        `${languageGuard}\n` +
        `${todayBlock}` +
        "Always return JSON with shape {\"reply\": string, \"followUps\": string[]}.\n" +
        `${contextInstruction}\n` +
        "- Vary your tone: sometimes more direct ('You can search by destination and dates'), sometimes warmer ('I can help you find a place — just tell me where and when'). Avoid robotic or repeated phrasing.\n" +
        "- Explain what you can do: search for homes and hotels, filter by amenities, dates, budget.\n" +
        "- If the user asks about their booking, CONFIRM you see it using the context below.\n" +
        "- followUps: Suggestions on how to start searching. Vary wording (e.g. 'Search for a stay', 'Pick dates and guests', 'Tell me your destination').\n" +
        (modismos ? `- The user uses idioms: ${modismos}. Respond in the same register.\n` : "");
    } else {
      // SMALL_TALK
      systemPrompt =
        "You are a friendly and conversational travel assistant. The user is chatting casually.\n" +
        `${langLine}\n` +
        `${languageGuard}\n` +
        `${todayBlock}` +
        "Always return JSON with shape {\"reply\": string, \"followUps\": string[]}.\n" +
        `${contextInstruction}\n` +
        "- Reply naturally and in a friendly way. Vary your replies: avoid always saying 'How can I help?' or 'What would you like to know?' Use alternatives like 'What are you in the mood for?', 'Tell me what you have in mind.', 'I’m here to help — what do you need?' (or equivalent in the user's language).\n" +
        "- If they mention destinations without asking for a search, ask for more details before searching.\n" +
        "- DO NOT assume they want to search unless explicitly requested.\n" +
        "- followUps: Natural questions to continue the conversation or guide them towards search. Vary the phrasing.\n" +
        (modismos ? `- The user uses idioms: ${modismos}. Respond in the same register.\n` : "");
    }

    if (finalContextBlock) {
      systemPrompt += `\nUSER CONTEXT:\n${finalContextBlock}\n`;
    }

    const userContent =
      intent === "SEARCH"
        ? JSON.stringify({ latestUserMessage, plan, inventory: summary })
        : intent === "TRIP"
          ? JSON.stringify({
            latestUserMessage,
            tripContext,
            trip: tripSummary,
          })
          : JSON.stringify({
            latestUserMessage,
            conversationHistory: normalized.slice(-4),
            weather: summary.weather,
          });

    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const payload = completion.choices?.[0]?.message?.content;
    if (!payload) {
      throw new Error("empty response");
    }
    const parsed = JSON.parse(payload);
    return {
      reply: parsed.reply ?? "",
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps.filter(Boolean).slice(0, 4) : [],
    };
  } catch (err) {
    console.error("[aiAssistant] generate reply failed", err?.message || err);

    // Fallback based on intent
    if (intent === "TRIP") {
      const reply = pickLanguageText(
        targetLanguage,
        "I can recommend nearby places and build a short itinerary. Tell me what you want to focus on.",
        "Puedo recomendar lugares cercanos y armar un itinerario corto. Decime en que queres enfocarte."
      );
      return {
        reply,
        followUps:
          targetLanguage === "es"
            ? ["Restaurantes cercanos", "Armar itinerario", "Compras cerca"]
            : ["Nearby restaurants", "Build itinerary", "Shopping nearby"],
      };
    } else if (intent === "SEARCH") {
      const reply =
        inventory.homes?.length || inventory.hotels?.length
          ? isSimilarOnly
            ? pickLanguageText(
              targetLanguage,
              "I couldn't find exact matches, but I found similar options for you. Check the results below and tell me if you want to adjust dates or budget.",
              "No encontre coincidencias exactas, pero tengo opciones similares para vos. Revisa los resultados y decime si queres ajustar fechas o presupuesto."
            )
            : pickLanguageText(
              targetLanguage,
              "Here are the best options for you.",
              "Estas son las mejores opciones para vos."
            )
          : pickLanguageText(
            targetLanguage,
            "I couldn't find matches yet. Try changing city, dates, or guest count.",
            "Todavia no encontre coincidencias. Proba cambiando ciudad, fechas o cantidad de personas."
          );
      return {
        reply,
        followUps:
          targetLanguage === "es"
            ? ["Buscar otra ciudad", "Cambiar fechas", "Agregar presupuesto maximo"]
            : ["Search another city", "Adjust dates", "Add budget limit"],
      };
    } else if (intent === "HELP") {
      return {
        reply: pickLanguageText(
          targetLanguage,
          "I can help you find homes and hotels. Tell me what you need and I'll show you options.",
          "Puedo ayudarte a encontrar casas y hoteles. Contame que necesitas y te muestro opciones."
        ),
        followUps: [],
      };
    } else {
      return {
        reply: pickLanguageText(
          targetLanguage,
          "Hello! How can I help you today?",
          "Hola, en que puedo ayudarte hoy?"
        ),
        followUps: [],
      };
    }
  }
};
