import { extractSearchPlan, generateTripAddons } from "../../services/aiAssistant.service.js";
import { AI_FLAGS, AI_LIMITS } from "./ai.config.js";
import { buildInventoryCarousels } from "./ai.carousels.js";
import { buildPreparedReplyFromLastResults } from "./ai.lastResultsFacts.js";
import { applyPlanToState, buildPlanOutcome, INTENTS, NEXT_ACTIONS, updateStageFromAction } from "./ai.planner.js";
import { enforcePolicy } from "./ai.policy.js";
import { renderAssistantPayload } from "./ai.renderer.js";
import { loadAssistantState } from "./ai.stateStore.js";
import { geocodePlace, getNearbyPlaces, getWeatherSummary, searchStays, searchDestinationImages, getStayDetails } from "./tools/index.js";
import { logAiEvent } from "./ai.telemetry.js";

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
  { keys: ["pool", "piscina", "pileta", "swimming", "natación"], pattern: /pool|piscina|pileta|swimming|natación/i },
  { keys: ["gym", "gimnasio", "fitness"], pattern: /gym|gimnasio|fitness|fitness center|musculación/i },
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
    /(?:cuáles?|cuales?|qué|que)\s+(?:de\s+)?(?:esos?|estos?)?\s*(?:hoteles?|hotelws?)?\s+(?:tienen|tiene|tengan)\s+(.+?)(?:\?|$)/i,
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
      lines.push(`- ${h.name}, ${h.city}, ${h.stars || ""}, price ${h.pricePerNight ?? "?"} ${h.currency}, amenities: ${am}${tag}`);
    });
  }
  if (summary.homes?.length) {
    lines.push("Homes:");
    summary.homes.forEach((h) => {
      const am = Array.isArray(h.amenities) ? h.amenities.join(", ") : "";
      const matches = tagLabel && featureRegex ? featureRegex.test(am) : null;
      const tag = tagLabel != null ? ` [${tagLabel}: ${matches ? "yes" : "no"}]` : "";
      lines.push(`- ${h.name || h.title}, ${h.city}, price ${h.pricePerNight ?? "?"} ${h.currency}, amenities: ${am}${tag}`);
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
    /\b(more about|tell me more|más (sobre|información|info)|detalles?|details?|info about|información de|qué tal|what about)\b/i.test(text) ||
    /\b(does (the )?(first|second|third|that one)|(el |la )?(primero|segundo|tercero)|tiene (el |la )?(primero)|that hotel|ese hotel)\b/i.test(text) ||
    /\b(how about|and the first|y el primero|cuéntame (del|de la)|dime (del|de la))\b/i.test(text) ||
    /\b(sabes (algo )?de|do you have (info|details)|tienes (info|datos)|info del|información del|data on)\b/i.test(text);

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

const MONTH_NAME_TO_INDEX = {
  january: 0,
  jan: 0,
  enero: 0,
  february: 1,
  feb: 1,
  febrero: 1,
  march: 2,
  mar: 2,
  marzo: 2,
  april: 3,
  apr: 3,
  abril: 3,
  may: 4,
  mayo: 4,
  june: 5,
  jun: 5,
  junio: 5,
  july: 6,
  jul: 6,
  julio: 6,
  august: 7,
  aug: 7,
  agosto: 7,
  september: 8,
  sep: 8,
  sept: 8,
  septiembre: 8,
  october: 9,
  oct: 9,
  octubre: 9,
  november: 10,
  nov: 10,
  noviembre: 10,
  december: 11,
  dec: 11,
  diciembre: 11,
};

const toIsoDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const inferYearForMonthDay = ({ monthIndex, day, now }) => {
  const baseDate = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  let year = baseDate.getFullYear();
  const candidate = new Date(Date.UTC(year, monthIndex, day));
  const candidateMonth = candidate.getUTCMonth();
  const candidateDay = candidate.getUTCDate();
  if (candidateMonth !== monthIndex || candidateDay !== day) return null;
  const todayUtc = Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const candidateUtc = Date.UTC(year, monthIndex, day);
  if (candidateUtc < todayUtc) {
    year += 1;
  }
  const resolved = new Date(Date.UTC(year, monthIndex, day));
  if (resolved.getUTCMonth() !== monthIndex || resolved.getUTCDate() !== day) return null;
  return year;
};

const buildIsoFromMonthDay = ({ monthIndex, day, now }) => {
  const year = inferYearForMonthDay({ monthIndex, day, now });
  if (year == null) return null;
  return toIsoDate(new Date(Date.UTC(year, monthIndex, day)));
};

const inferDatesFromMessage = (text, now) => {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (/\d{4}-\d{2}-\d{2}/.test(raw)) return null;

  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const monthPattern = Object.keys(MONTH_NAME_TO_INDEX)
    .sort((left, right) => right.length - left.length)
    .join("|");

  const sameMonthRange =
    normalized.match(new RegExp(`\\b(?:del\\s+)?(\\d{1,2})\\s*(?:al|a|-|to)\\s*(\\d{1,2})\\s+de\\s+(${monthPattern})\\b`, "i")) ||
    normalized.match(new RegExp(`\\bfrom\\s+(\\d{1,2})\\s*(?:to|-|through)\\s*(\\d{1,2})\\s+(${monthPattern})\\b`, "i"));
  if (sameMonthRange) {
    const startDay = Number(sameMonthRange[1]);
    const endDay = Number(sameMonthRange[2]);
    const monthIndex = MONTH_NAME_TO_INDEX[String(sameMonthRange[3] || "").toLowerCase()];
    if (Number.isFinite(startDay) && Number.isFinite(endDay) && Number.isInteger(monthIndex)) {
      const checkIn = buildIsoFromMonthDay({ monthIndex, day: startDay, now });
      const checkOut = buildIsoFromMonthDay({ monthIndex, day: endDay, now });
      if (checkIn && checkOut && checkOut >= checkIn) {
        return { checkIn, checkOut };
      }
    }
  }

  const explicitRange =
    normalized.match(new RegExp(`\\b(?:del\\s+)?(\\d{1,2})\\s+de\\s+(${monthPattern})\\s*(?:al|a|to|-)\\s*(\\d{1,2})\\s+de\\s+(${monthPattern})\\b`, "i")) ||
    normalized.match(new RegExp(`\\bfrom\\s+(\\d{1,2})\\s+(${monthPattern})\\s*(?:to|-)\\s*(\\d{1,2})\\s+(${monthPattern})\\b`, "i"));
  if (explicitRange) {
    const startDay = Number(explicitRange[1]);
    const startMonth = MONTH_NAME_TO_INDEX[String(explicitRange[2] || "").toLowerCase()];
    const endDay = Number(explicitRange[3]);
    const endMonth = MONTH_NAME_TO_INDEX[String(explicitRange[4] || "").toLowerCase()];
    if (
      Number.isFinite(startDay) &&
      Number.isFinite(endDay) &&
      Number.isInteger(startMonth) &&
      Number.isInteger(endMonth)
    ) {
      const checkIn = buildIsoFromMonthDay({ monthIndex: startMonth, day: startDay, now });
      const checkOut = buildIsoFromMonthDay({ monthIndex: endMonth, day: endDay, now });
      if (checkIn && checkOut && checkOut >= checkIn) {
        return { checkIn, checkOut };
      }
    }
  }

  return null;
};

const applySearchTextHeuristics = (plan, latestUserMessage, now) => {
  if (!plan || typeof plan !== "object") return plan;
  const nextPlan = { ...plan };
  if (!nextPlan.dates || typeof nextPlan.dates !== "object") nextPlan.dates = {};
  const hasDatesAlready = Boolean(nextPlan.dates.checkIn && nextPlan.dates.checkOut);
  if (!hasDatesAlready) {
    const inferredDates = inferDatesFromMessage(latestUserMessage, now);
    if (inferredDates?.checkIn && inferredDates?.checkOut) {
      nextPlan.dates = {
        ...nextPlan.dates,
        checkIn: inferredDates.checkIn,
        checkOut: inferredDates.checkOut,
        flexible: false,
      };
    }
  }
  return nextPlan;
};

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
    const adultsMatch = whoStr.match(/(\d+)\s*adults?/i);
    const childrenMatch = whoStr.match(/(\d+)\s*children?/i);
    const adults = adultsMatch ? Math.max(1, parseInt(adultsMatch[1], 10)) : 1;
    const children = childrenMatch ? Math.max(0, parseInt(childrenMatch[1], 10)) : 0;
    if (!plan.guests || typeof plan.guests !== "object") plan.guests = {};
    plan.guests.adults = adults;
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
  const shouldDefaultGuests =
    hasSearchDestination(state, nextPlan) &&
    hasSearchDates(nextPlan) &&
    !hasSearchGuests(nextPlan);
  if (shouldDefaultGuests) {
    if (!nextPlan.guests || typeof nextPlan.guests !== "object") nextPlan.guests = {};
    nextPlan.guests.adults = 1;
    nextPlan.guests.children = 0;
    nextPlan.guests.total = 1;
    nextPlan.assumptions.defaultGuestsApplied = true;
  } else if (nextPlan.assumptions.defaultGuestsApplied) {
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
  /\b(more options|more hotels|show more|show me more|more stays|another option|other options|otras opciones|mas opciones|más opciones|más hoteles|mas hoteles|mostrame mas|muéstrame más|mostrar mas|mostrar más|seguime mostrando|seguí mostrándome)\b/i;

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

export const runAiTurn = async ({
  sessionId,
  userId,
  message,
  messages,
  limits,
  stateOverride,
  uiEvent,
  context,
} = {}) => {
  const startedAt = Date.now();
  const timings = {};
  if (!AI_FLAGS.chatEnabled) {
    return {
      inventory: buildEmptyInventory(),
      carousels: [],
      reply: "AI chat is disabled.",
      followUps: [],
      plan: null,
      state: stateOverride || null,
      ui: { chips: [], cards: [], inputs: [], sections: [] },
      intent: "SMALL_TALK",
      nextAction: "SMALL_TALK",
      safeMode: false,
    };
  }

  let normalizedMessages = normalizeMessages(messages);
  if (!normalizedMessages.length && message) {
    normalizedMessages = [{ role: "user", content: String(message).trim() }];
  }
  if (normalizedMessages.length > AI_LIMITS.maxMessages) {
    normalizedMessages = normalizedMessages.slice(-AI_LIMITS.maxMessages);
  }

  const existingState =
    stateOverride ||
    (sessionId && userId ? await loadAssistantState({ sessionId, userId }) : null);

  const incomingTripContext = normalizeTripContext(context?.trip ?? context?.tripContext ?? context);
  debugTripHub("incoming", {
    sessionId,
    userId,
    hasTripContext: Boolean(incomingTripContext),
    tripLocation: incomingTripContext?.locationText || incomingTripContext?.location?.city || null,
  });
  const userContext = context && typeof context === "object" ? context : null;

  const confirmedSearch = (userContext && typeof userContext === "object" && userContext.confirmedSearch)
    ? userContext.confirmedSearch
    : null;
  const hasLastResults = Boolean(
    (existingState?.lastShownInventorySummary?.hotels?.length || 0) + (existingState?.lastShownInventorySummary?.homes?.length || 0) > 0
  );
  const planStart = Date.now();
  const planCandidateRaw = await extractSearchPlan(normalizedMessages, {
    now: userContext?.now || userContext?.localDate || null,
    confirmedSearch,
    hasLastResults,
  });
  const latestUserMessage = extractLatestUserMessage(normalizedMessages);
  const planCandidate = applySearchTextHeuristics(
    planCandidateRaw,
    latestUserMessage,
    userContext?.now || userContext?.localDate || null
  );
  timings.planMs = Date.now() - planStart;
  injectConfirmedSearchIntoPlan(planCandidate, confirmedSearch);
  const { state: nextStateBase, plan: mergedPlanRaw } = applyPlanToState(existingState, planCandidate);
  const planWithUi = applyUiEventToPlan(mergedPlanRaw, uiEvent);
  const mergedPlanWithDefaults = applyPlanDefaults(planWithUi, nextStateBase);
  const { state: nextState, plan: mergedPlan } = applyPlanToState(nextStateBase, mergedPlanWithDefaults);
  const contextPassengerNationality = userContext?.passengerNationality ?? userContext?.nationality ?? null;
  const contextPassengerResidence =
    userContext?.passengerCountryOfResidence ?? userContext?.residence ?? null;
  if (contextPassengerNationality && !mergedPlan.passengerNationality) {
    mergedPlan.passengerNationality = contextPassengerNationality;
  }
  if (contextPassengerResidence && !mergedPlan.passengerCountryOfResidence) {
    mergedPlan.passengerCountryOfResidence = contextPassengerResidence;
  }
  if (incomingTripContext) {
    nextState.tripContext = mergeTripContext(nextState.tripContext, incomingTripContext);
  }
  const outcome = buildPlanOutcome({ state: nextState, plan: mergedPlan });
  const policy = enforcePolicy({
    state: nextState,
    intent: outcome.intent,
    nextAction: outcome.nextAction,
  });
  let resolvedIntent = policy.intent || outcome.intent;
  let resolvedNextAction = policy.nextAction || outcome.nextAction;
  if (
    wantsExplicitLiveAvailability(latestUserMessage) &&
    hasSearchDestination(nextState, mergedPlan) &&
    hasSearchDates(mergedPlan) &&
    hasSearchGuests(mergedPlan)
  ) {
    resolvedIntent = INTENTS.SEARCH;
    resolvedNextAction = NEXT_ACTIONS.RUN_SEARCH;
  }
  const tripRequest = extractTripRequest({
    text: latestUserMessage,
    uiEvent,
    tripContext: nextState.tripContext,
  });
  const wantsWeather = /(clima|tiempo|weather|temperatura|pronostico)/i.test(latestUserMessage);
  const resolvedLocation = wantsWeather
    ? await resolveWeatherLocation({
      text: latestUserMessage,
      tripContext: nextState.tripContext,
      state: nextState,
      plan: mergedPlan,
      userContext,
    })
    : null;
  const weather = resolvedLocation
    ? await getWeatherSummary({ location: resolvedLocation, timeZone: userContext?.timeZone })
    : null;
  const weatherFromContext =
    userContext && typeof userContext === "object" && userContext.weather ? userContext.weather : null;
  const resolvedWeather = wantsWeather ? weather || weatherFromContext : weather;
  if (mergedPlan && resolvedIntent) {
    mergedPlan.intent = resolvedIntent;
  }

  let inventory = buildEmptyInventory();
  let carousels = [];
  if (resolvedNextAction === "RUN_SEARCH") {
    const searchStart = Date.now();
    const searchLimits = resolveSearchLimits({ plan: mergedPlan, limits });

    // Check if we have previous results to exclude (for pagination/"more options")
    // Only exclude if the search plan is roughly similar (e.g. same location)
    // For simplicity, we assume if we are in the same session and doing a search, we want fresh results.
    const excludeIds = wantsAdditionalSearchResults(latestUserMessage)
      ? existingState?.lastResultsContext?.shownIds || []
      : [];

    inventory = await searchStays(mergedPlan, {
      limit: searchLimits.limit,
      maxResults: searchLimits.maxResults,
      excludeIds
    });
    timings.searchMs = Date.now() - searchStart;
    if ((inventory.homes?.length || 0) + (inventory.hotels?.length || 0) > 0) {
      try {
        carousels = await buildInventoryCarousels({
          inventory,
          plan: mergedPlan,
          state: nextState,
          message: latestUserMessage,
          maxCarousels: 5,
          maxItems: 8,
        });
      } catch (carouselErr) {
        console.warn("[ai] buildInventoryCarousels failed", carouselErr?.message || carouselErr);
      }
    }
  }

  let trip = null;
  // Trip (post-booking assist) only when not in PLANNING or LOCATION mode (pre-trip planning / destination info)
  const isPlanningOrLocation = resolvedIntent === INTENTS.PLANNING || resolvedIntent === INTENTS.LOCATION;
  if (tripRequest && !isPlanningOrLocation) {
    const tripStart = Date.now();
    const location = await resolveTripLocation(nextState.tripContext, nextState, mergedPlan, userContext);
    if (location) {
      const suggestions = await buildTripSuggestions({ request: tripRequest, location });
      const itinerary = buildItinerary({
        request: tripRequest,
        tripContext: nextState.tripContext,
        suggestions,
      });
      let insights = [];
      let preparation = [];
      const isHubInit = (uiEvent?.id || uiEvent?.event || uiEvent) === "TRIP_HUB_INIT";

      if (isHubInit) {
        const addons = await generateTripAddons({
          tripContext: nextState.tripContext,
          location,
          lang: mergedPlan?.language || "en"
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
      resolvedNextAction = NEXT_ACTIONS.RUN_TRIP;
      if (mergedPlan) {
        mergedPlan.intent = INTENTS.TRIP;
      }
    }
    timings.tripMs = Date.now() - tripStart;
  }

  const updatedState = updateStageFromAction(nextState, resolvedNextAction);
  if (resolvedNextAction === "RUN_SEARCH") {
    const previousShownIds = nextState?.lastResultsContext?.shownIds || [];
    const newShownIds = [
      ...(inventory.homes || []).map((item) => String(item.id)),
      ...(inventory.hotels || []).map((item) => String(item.id)),
    ].filter(Boolean);

    // Accumulate IDs to support deep pagination/rejection
    // Only reset if the user completely changed the destination/intent (which usually resets state anyway)
    const combinedIds = Array.from(new Set([...previousShownIds, ...newShownIds]));

    updatedState.lastResultsContext = {
      lastSearchId: `search-${Date.now()}`,
      shownIds: combinedIds,
    };

    const lastShownSummary = buildLastShownInventorySummary(inventory, updatedState.lastResultsContext.lastSearchId);
    if (lastShownSummary) {
      updatedState.lastShownInventorySummary = lastShownSummary;
    }
    const lastSearchParams = buildLastSearchParams(mergedPlan);
    if (lastSearchParams) {
      updatedState.lastSearchParams = lastSearchParams;
    }

    console.log("[ai] search complete", {
      previousCount: previousShownIds.length,
      newCount: newShownIds.length,
      totalExcludedNext: combinedIds.length
    });
  }

  // ---- Visual Context Injection ----
  let visualContext = null;
  const destinationName = mergedPlan?.location?.city || nextState?.destination?.name;

  // Only fetch visuals if we have a destination but NO search results yet (to avoid clutter)
  const hasNoResults = (!inventory.homes?.length && !inventory.hotels?.length);
  const isAskingForDetails = [NEXT_ACTIONS.ASK_FOR_DATES, NEXT_ACTIONS.ASK_FOR_GUESTS].includes(resolvedNextAction);

  const wantsDestinationPhotos =
    resolvedNextAction === "RUN_LOCATION" ||
    resolvedNextAction === "RUN_PLANNING" ||
    hasNoResults ||
    isAskingForDetails;
  if (destinationName && wantsDestinationPhotos && !trip) {
    try {
      const images = await searchDestinationImages(destinationName, 3);
      if (images.length) {
        visualContext = {
          type: "destination_gallery",
          title: destinationName,
          images: images
        };
      }
    } catch (err) {
      console.warn("[ai] visual context fetch failed", err);
    }
  }

  const tripSearchContext = buildTripSearchContextText(updatedState, mergedPlan);
  const lastShownResultsContext = buildLastShownResultsContextText(existingState?.lastShownInventorySummary, latestUserMessage) ?? null;
  const inventoryForReply =
    resolvedNextAction !== NEXT_ACTIONS.RUN_SEARCH && existingState?.lastShownInventorySummary
      ? existingState.lastShownInventorySummary
      : undefined;

  let stayDetailsFromDb = null;
  const requestedStay = resolveRequestedStayFromMessage(latestUserMessage, existingState?.lastShownInventorySummary);
  if (requestedStay) {
    try {
      const details = await getStayDetails({ stayId: requestedStay.stayId, type: requestedStay.type });
      if (details?.details) {
        stayDetailsFromDb = buildStayDetailsContextForPrompt(details);
      }
    } catch (err) {
      console.warn("[ai] getStayDetails for chat failed", requestedStay.stayId, err?.message || err);
    }
  }

  let preparedReply = null;
  if (resolvedNextAction === NEXT_ACTIONS.ANSWER_WITH_LAST_RESULTS && existingState?.lastShownInventorySummary) {
    try {
      preparedReply = await buildPreparedReplyFromLastResults({
        summary: existingState.lastShownInventorySummary,
        latestUserMessage,
        language: mergedPlan?.language || null,
      });
    } catch (preparedReplyErr) {
      console.warn("[ai] prepared reply from last results failed", preparedReplyErr?.message || preparedReplyErr);
    }
  }

  const renderStart = Date.now();
  const rendered = await renderAssistantPayload({
    plan: mergedPlan,
    messages: normalizedMessages,
    inventory,
    nextAction: resolvedNextAction,
    trip,
    tripContext: nextState.tripContext,
    userContext,
    weather: resolvedWeather,
    missing: outcome.missing,
    visualContext,
    tripSearchContext,
    lastShownResultsContext,
    inventoryForReply,
    stayDetailsFromDb,
    preparedReply,
  });
  debugTripHub("reply", {
    sessionId,
    intent: resolvedIntent,
    nextAction: resolvedNextAction,
    tripGenerated: Boolean(trip),
    reply: summarizeReply(rendered?.assistant?.text),
  });
  timings.renderMs = Date.now() - renderStart;
  timings.totalMs = Date.now() - startedAt;

  logAiEvent("turn", {
    sessionId,
    userId,
    intent: resolvedIntent,
    nextAction: resolvedNextAction,
    missing: outcome.missing,
    homes: inventory.homes?.length || 0,
    hotels: inventory.hotels?.length || 0,
    trip: trip ? trip.suggestions?.length || 0 : 0,
    timings,
  });

  return {
    reply: rendered.assistant?.text || "",
    assistant: rendered.assistant || { text: "", tone: "neutral", disclaimers: [] },
    followUps: rendered.followUps || [],
    ui: rendered.ui || { chips: [], cards: [], inputs: [], sections: [] },
    plan: mergedPlan,
    inventory,
    carousels: Array.isArray(carousels) ? carousels : [],
    trip,
    weather: resolvedWeather,
    state: updatedState,
    intent: resolvedIntent,
    nextAction: resolvedNextAction,
    safeMode: outcome.safeMode,
  };
};
