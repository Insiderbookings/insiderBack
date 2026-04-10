import { createHash } from "node:crypto";
import dayjs from "dayjs";
import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
import { WebbedsProvider } from "../providers/webbeds/provider.js";
import { buildSearchHotelsPayload } from "../providers/webbeds/searchHotels.js";
import cache from "./cache.js";
import { mapHomeToCard } from "../utils/homeMapper.js";
import { formatStaticHotel } from "../utils/webbedsMapper.js";
import {
  WEBBEDS_CLASSIFICATION_CODE_TO_STARS,
  resolveWebbedsHotelStars,
} from "../utils/webbedsStars.js";
import {
  decorateHotelPricingForDisplay,
  resolveHotelStayNights,
} from "../utils/hotelPricing.js";
import { getCaseInsensitiveLikeOp } from "../utils/sequelizeHelpers.js";
import { resolvePoiToCoordinates, getNearbyPlaces, computeDistanceKm } from "../modules/ai/tools/tool.places.js";
import { resolveSemanticCatalogContext } from "../modules/ai/ai.semanticCatalog.js";
import { resolveWebbedsCityMatch } from "./webbedsCityResolver.service.js";

const ASSISTANT_SEARCH_MAX_LIMIT = Math.max(
  20,
  Math.min(120, Number(process.env.AI_SEARCH_MAX_LIMIT || 120))
);
const CHAT_VISIBLE_SEMANTIC_LIMIT = Math.max(
  5,
  Math.min(30, Number(process.env.AI_CHAT_VISIBLE_HOTEL_LIMIT || 30))
);
const DEBUG_ASSISTANT_SEARCH =
  String(process.env.AI_DEBUG_LOGS || "").trim().toLowerCase() === "true";
const LIVE_HOTEL_SEARCH_CACHE_TTL_SECONDS = Math.max(
  0,
  Number(process.env.AI_LIVE_SEARCH_CACHE_TTL_SECONDS || 300)
);

const debugSearchLog = (...args) => {
  if (!DEBUG_ASSISTANT_SEARCH) return;
  console.log(...args);
};

const emitSearchTrace = (traceSink, code, data = {}) => {
  if (typeof traceSink !== "function" || !code) return;
  try {
    traceSink(code, data);
  } catch (_) {}
};

const hashCachePayload = (value) =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex");

const serializeCoordinateFilterForCache = (filter) => {
  if (!filter) return null;
  const latBounds = Array.isArray(filter.latitude?.[Op.between])
    ? filter.latitude[Op.between].map((value) => toNumberOrNull(value))
    : null;
  const lngBounds = Array.isArray(filter.longitude?.[Op.between])
    ? filter.longitude[Op.between].map((value) => toNumberOrNull(value))
    : null;
  return {
    latBounds,
    lngBounds,
  };
};

const serializeProximityAnchorForCache = (proximityAnchor) => {
  if (!proximityAnchor || typeof proximityAnchor !== "object") return null;
  if (proximityAnchor.type === "CITY_CENTER") {
    return {
      type: "CITY_CENTER",
      anchor: {
        lat: toNumberOrNull(proximityAnchor.anchor?.lat),
        lng: toNumberOrNull(proximityAnchor.anchor?.lng),
      },
    };
  }
  if (proximityAnchor.type === "NEARBY_INTEREST") {
    return {
      type: "NEARBY_INTEREST",
      places: (Array.isArray(proximityAnchor.places) ? proximityAnchor.places : [])
        .slice(0, 8)
        .map((place) => ({
          id: String(place?.id || place?.placeId || place?.name || "").trim() || null,
          lat: toNumberOrNull(place?.location?.lat),
          lng: toNumberOrNull(place?.location?.lng),
        })),
    };
  }
  if (proximityAnchor.type === "PLACE_TARGET") {
    return {
      type: "PLACE_TARGET",
      target: {
        name: String(proximityAnchor.target?.name || "").trim() || null,
        lat: toNumberOrNull(proximityAnchor.target?.lat),
        lng: toNumberOrNull(proximityAnchor.target?.lng),
        radiusMeters: toNumberOrNull(proximityAnchor.target?.radiusMeters),
      },
    };
  }
  return { type: String(proximityAnchor.type || "").trim().toUpperCase() || null };
};

const buildLiveHotelSearchCacheKey = ({
  plan,
  limit,
  pricingRole,
  hotelFilters,
  coordinateFilter,
  proximityAnchor,
  resolvedLocationCodes,
  candidateHotelIds,
}) => {
  if (!LIVE_HOTEL_SEARCH_CACHE_TTL_SECONDS) return null;
  const payload = {
    version: 2,
    locationCodes: {
      cityCode: String(resolvedLocationCodes?.cityCode || "").trim() || null,
      countryCode: String(resolvedLocationCodes?.countryCode || "").trim() || null,
    },
    dates: {
      checkIn: plan?.dates?.checkIn || null,
      checkOut: plan?.dates?.checkOut || null,
    },
    occupancies: parseHotelOccupanciesForCache(plan).map((occ) => ({
      adults: toNumberOrNull(occ?.adults),
      children: (Array.isArray(occ?.children) ? occ.children : []).map((age) => toNumberOrNull(age)),
    })),
    nationality: String(plan?.passengerNationality ?? plan?.nationality ?? "").trim() || null,
    residence: String(plan?.passengerCountryOfResidence ?? plan?.residence ?? "").trim() || null,
    pricingRole: toNumberOrNull(pricingRole) ?? 20,
    limit: clampLimit(limit),
    sortBy: String(plan?.sortBy || "PRICE_ASC").trim().toUpperCase(),
    budgetMax: resolveBudgetMax(plan),
    hotelFilters: {
      amenityCodes: normalizeKeyList(hotelFilters?.amenityCodes),
      amenityItemIds: normalizeIdList(hotelFilters?.amenityItemIds),
      preferredOnly: normalizeBooleanFlag(hotelFilters?.preferredOnly),
      minRating: toNumberOrNull(hotelFilters?.minRating),
    },
    coordinateFilter: serializeCoordinateFilterForCache(coordinateFilter),
    proximityAnchor: serializeProximityAnchorForCache(proximityAnchor),
    candidateHotelIdsCount: Array.isArray(candidateHotelIds) ? candidateHotelIds.length : 0,
    candidateHotelIdsHash:
      Array.isArray(candidateHotelIds) && candidateHotelIds.length
        ? hashCachePayload(candidateHotelIds.map((id) => String(id)))
        : null,
  };
  return `ai:live-hotels:${hashCachePayload(payload)}`;
};

const clampLimit = (value, fallback = 6) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(ASSISTANT_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(numeric)));
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeCoordinatePair = (latValue, lngValue) => {
  const lat = toNumberOrNull(latValue);
  const lng = toNumberOrNull(lngValue);
  if (lat === 0 && lng === 0) {
    return { lat: null, lng: null };
  }
  return { lat, lng };
};

const DEFAULT_COORDINATE_RADIUS_KM = 25;
const NEARBY_GEO_FALLBACK_RADII_METERS = [5000, 15000, 35000];
const BLOCKED_CALENDAR_STATUSES = new Set(["RESERVED", "BLOCKED"]);
const iLikeOp = getCaseInsensitiveLikeOp();

const normalizeKeyList = (value) => {
  if (!Array.isArray(value) || !value.length) return [];
  const normalized = value
    .map((item) => {
      if (typeof item === "number") return String(item);
      if (typeof item !== "string") return null;
      const trimmed = item.trim();
      return trimmed ? trimmed.toUpperCase() : null;
    })
    .filter(Boolean);
  return Array.from(new Set(normalized));
};

const normalizeAmenityKeyValue = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const normalizeBooleanFlag = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "si", "sí"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeIdList = (value) => {
  if (!Array.isArray(value) || !value.length) return [];
  const normalized = value
    .map((item) => {
      if (typeof item === "number") return String(item);
      if (typeof item !== "string") return null;
      const trimmed = item.trim();
      return trimmed || null;
    })
    .filter(Boolean);
  return Array.from(new Set(normalized));
};

// Maps AI amenity names (English or Spanish) to search terms that match webbeds_amenity_catalog.name.
// Each key resolves to an OR of LIKE searches — pick terms that cover the catalog entries.
// Verified against live webbeds_amenity_catalog table.
const AMENITY_NAME_SYNONYMS = {
  // Pool variants
  POOL:            ["POOL", "SWIMMING POOL"],
  PISCINA:         ["POOL", "SWIMMING POOL"],
  PILETA:          ["POOL", "SWIMMING POOL"],
  "SWIMMING POOL": ["POOL", "SWIMMING POOL"],
  "OUTDOOR POOL":  ["SWIMMING POOL", "OUTDOOR"],
  "INDOOR POOL":   ["SWIMMING POOL", "INDOOR"],

  // Gym / Fitness — catalog has: Fitness (98455), Gymnasium (47935), Health And Fitness Facility (1978)
  GYM:             ["GYM", "GYMNASIUM", "FITNESS", "HEALTH AND FITNESS"],
  GIMNASIO:        ["GYM", "GYMNASIUM", "FITNESS", "HEALTH AND FITNESS"],
  FITNESS:         ["FITNESS", "GYM", "GYMNASIUM", "HEALTH AND FITNESS"],
  "FITNESS CENTER":["FITNESS", "GYM", "GYMNASIUM"],

  // Spa
  SPA:             ["SPA"],
  MASAJE:          ["MASSAGE", "SPA"],
  MASSAGE:         ["MASSAGE", "SPA"],

  // WiFi / Internet — catalog: Complimentary WiFi access (48325), Free Wifi (98445), High Speed Internet (3664)
  WIFI:            ["WIFI", "WI-FI", "INTERNET"],
  "WI-FI":         ["WIFI", "WI-FI", "INTERNET"],
  INTERNET:        ["INTERNET", "WIFI", "WI-FI"],

  // Parking — catalog: Car Parking - Onsite Free/Paid, Valet Parking, Self-parking
  PARKING:         ["PARKING"],
  COCHERA:         ["PARKING"],
  ESTACIONAMIENTO: ["PARKING"],
  "FREE PARKING":  ["PARKING - ONSITE FREE", "SELF-PARKING - FREE"],
  "VALET PARKING": ["VALET PARKING"],

  // Jacuzzi / Hot Tub — catalog: Jacuzzi (3891), Bath/Hot spring (100055)
  JACUZZI:         ["JACUZZI", "HOT SPRING", "HOT TUB"],
  "HOT TUB":       ["JACUZZI", "HOT SPRING", "HOT TUB"],
  "HOT SPRING":    ["HOT SPRING", "JACUZZI"],

  // Sauna — catalog: Sauna (650)
  SAUNA:           ["SAUNA"],

  // Beach — catalog: On-Site Beach (3724), Beach sun loungers, Beach umbrellas
  BEACH:           ["BEACH"],
  PLAYA:           ["BEACH"],

  // Pets — catalog: Pets Allowed (606)
  PET:             ["PET"],
  PETS:            ["PET"],
  "PET FRIENDLY":  ["PET"],
  MASCOTA:         ["PET"],
  MASCOTAS:        ["PET"],

  // Kids / Family — catalog: Kids Club (1981), Kids Facilities (101105), Kids Play Ground (3294), Family Rooms (101035)
  KIDS:            ["KIDS", "FAMILY"],
  "KIDS CLUB":     ["KIDS CLUB"],
  FAMILY:          ["FAMILY", "KIDS"],

  // Restaurant / Bar — catalog: Restaurant (641), Bar (3134)
  RESTAURANT:      ["RESTAURANT"],
  RESTAURANTE:     ["RESTAURANT"],
  BAR:             ["BAR"],   // LIKE '%BAR%' also matches Barbecue/Barber — acceptable false-positive

  // Casino — catalog: Casino (3164)
  CASINO:          ["CASINO"],

  // Tennis / Golf — catalog: Tennis Courts (618), Golf Course (1684)
  TENNIS:          ["TENNIS"],
  GOLF:            ["GOLF"],

  // Airport shuttle — catalog: Airport Shuttle - Free (3674), Airport shuttle available (665)
  "AIRPORT SHUTTLE": ["AIRPORT SHUTTLE"],
  TRANSFER:          ["AIRPORT SHUTTLE"],
};

const expandAmenityNameCandidates = (candidates = []) => {
  const expanded = new Set();
  candidates.forEach((raw) => {
    if (raw == null) return;
    const value = String(raw).trim();
    if (!value) return;
    expanded.add(value);
    const key = value.toUpperCase();
    const synonyms = AMENITY_NAME_SYNONYMS[key];
    if (Array.isArray(synonyms)) {
      synonyms.forEach((synonym) => {
        const cleaned = String(synonym || "").trim();
        if (cleaned) expanded.add(cleaned);
      });
    }
  });
  return Array.from(expanded);
};

const combineCapacities = (...values) => {
  const numeric = values
    .map((value) => toNumberOrNull(value))
    .filter((value) => value != null);
  if (!numeric.length) return null;
  return Math.max(...numeric);
};

const buildCalendarRange = (plan = {}) => {
  const checkInRaw = plan?.dates?.checkIn;
  const checkOutRaw = plan?.dates?.checkOut;
  if (!checkInRaw || !checkOutRaw) return null;
  const checkIn = dayjs(checkInRaw);
  const checkOut = dayjs(checkOutRaw);
  if (!checkIn.isValid() || !checkOut.isValid() || !checkOut.isAfter(checkIn)) return null;
  return {
    startDate: checkIn.format("YYYY-MM-DD"),
    endDate: checkOut.subtract(1, "day").format("YYYY-MM-DD"),
  };
};

const hasCalendarConflicts = (home) => {
  if (!home || !Array.isArray(home.calendar) || !home.calendar.length) return false;
  return home.calendar.some((entry) => entry && BLOCKED_CALENDAR_STATUSES.has(entry.status));
};

const hasRequiredTagKeys = (home, requiredKeys = []) => {
  if (!requiredKeys.length) return true;
  if (!home?.tags) return false;
  const available = new Set(
    home.tags
      .map((link) => link?.tag?.tag_key)
      .filter(Boolean)
      .map((tag) => tag.trim().toUpperCase())
  );
  return requiredKeys.every((key) => available.has(key));
};

const hasRequiredAmenityKeys = (home, requiredKeys = []) => {
  if (!requiredKeys.length) return true;
  if (!home?.amenities) return false;
  const available = new Set(
    home.amenities
      .map((link) => normalizeAmenityKeyValue(link?.amenity?.amenity_key))
      .filter(Boolean)
  );
  const normalizedRequired = requiredKeys.map(normalizeAmenityKeyValue).filter(Boolean);
  const parkingKeys = normalizedRequired.filter((key) => key.includes("PARKING"));
  const otherKeys = normalizedRequired.filter((key) => !key.includes("PARKING"));
  const hasOtherKeys = otherKeys.every((key) => available.has(key));
  const hasParkingKey = !parkingKeys.length || parkingKeys.some((key) => available.has(key));
  return hasOtherKeys && hasParkingKey;
};

const buildCoordinateFilterUsingRadius = (location = {}) => {
  if (isSelfReferentialLandmark(location)) return null;
  const lat = toNumberOrNull(location.lat);
  const lng = toNumberOrNull(location.lng);
  if (lat == null || lng == null) return null;
  const radiusKm = location.radiusKm != null ? Math.max(0.5, Number(location.radiusKm)) : DEFAULT_COORDINATE_RADIUS_KM;
  const latDelta = radiusKm / 111;
  const lonScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.01) * 111;
  const lngDelta = radiusKm / lonScale;
  return {
    latitude: { [Op.between]: [lat - latDelta, lat + latDelta] },
    longitude: { [Op.between]: [lng - lngDelta, lng + lngDelta] },
  };
};

const matchesCoordinateFilter = (geoPoint, filter) => {
  if (!filter || !geoPoint) return true;
  const latBounds = filter.latitude?.[Op.between];
  const lngBounds = filter.longitude?.[Op.between];
  const lat = toNumberOrNull(geoPoint.lat ?? geoPoint.latitude);
  const lng = toNumberOrNull(geoPoint.lng ?? geoPoint.longitude);
  if (latBounds && (lat == null || lat < latBounds[0] || lat > latBounds[1])) {
    return false;
  }
  if (lngBounds && (lng == null || lng < lngBounds[0] || lng > lngBounds[1])) {
    return false;
  }
  return true;
};

let liveHotelProvider = null;
let liveHotelProviderFailed = false;

const getLiveHotelProvider = () => {
  if (liveHotelProviderFailed) return null;
  if (liveHotelProvider) return liveHotelProvider;
  try {
    liveHotelProvider = new WebbedsProvider();
    return liveHotelProvider;
  } catch (error) {
    liveHotelProviderFailed = true;
    console.warn("[assistant] live hotel provider unavailable:", error?.message || error);
    return null;
  }
};

const resolveDialect = () =>
  typeof sequelize.getDialect === "function" ? sequelize.getDialect() : "mysql";

// Returns the list of classification_code BIGINTs for hotels with >= minStars.
const resolveClassificationCodesForMinRating = (minStars) => {
  return Object.entries(WEBBEDS_CLASSIFICATION_CODE_TO_STARS)
    .filter(([, stars]) => stars >= minStars)
    .map(([code]) => Number(code));
};

// Resolves a hotel's star count from its formatted card (classification.code is a BIGINT code).
const resolveHotelStars = (hotel) => resolveWebbedsHotelStars(hotel);

// Strip diacritics so "Dubái" matches "Dubai", "Río" matches "Rio", etc.
// WebBeds data is in English (no accents), so normalizing search terms is always safe.
const stripDiacritics = (str) =>
  str.normalize("NFD").replace(/\p{Diacritic}/gu, "");

const normalizeLocationIdentityText = (value = "") =>
  stripDiacritics(String(value || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isSelfReferentialLandmark = (location = {}) => {
  if (!location || typeof location !== "object") return false;
  const rawLandmark =
    typeof location.landmark === "string" ? location.landmark.trim() : "";
  if (!rawLandmark) return false;

  const landmark = normalizeLocationIdentityText(rawLandmark);
  const rawCity = typeof location.city === "string" ? location.city.trim() : "";
  const rawCountry =
    typeof location.country === "string" ? location.country.trim() : "";
  const city = normalizeLocationIdentityText(rawCity);
  const country = normalizeLocationIdentityText(rawCountry);
  const cityPrimarySegment = normalizeLocationIdentityText(
    rawCity.split(",")[0] || "",
  );

  return Boolean(
    landmark &&
      (landmark === city ||
        landmark === country ||
        (cityPrimarySegment && landmark === cityPrimarySegment)),
  );
};

// Spanish→English country name aliases for when the AI returns Spanish country names.
// Keys are lowercase normalized (no diacritics).
const COUNTRY_NAME_ALIASES_EN = {
  "emiratos arabes unidos": "United Arab Emirates",
  "espana": "Spain",
  "alemania": "Germany",
  "francia": "France",
  "italia": "Italy",
  "grecia": "Greece",
  "turquia": "Turkey",
  "tailandia": "Thailand",
  "reino unido": "United Kingdom",
  "estados unidos": "United States",
  "paises bajos": "Netherlands",
  "belgica": "Belgium",
  "suiza": "Switzerland",
  "austria": "Austria",
  "japon": "Japan",
  "corea del sur": "South Korea",
  "india": "India",
  "china": "China",
  "singapur": "Singapore",
  "malasia": "Malaysia",
  "indonesia": "Indonesia",
  "vietnam": "Vietnam",
  "marruecos": "Morocco",
  "egipto": "Egypt",
  "sudafrica": "South Africa",
  "brasil": "Brazil",
  "mexico": "Mexico",
  "peru": "Peru",
  "colombia": "Colombia",
  "chile": "Chile",
  "argentina": "Argentina",
  "republica dominicana": "Dominican Republic",
  "cuba": "Cuba",
  "portugal": "Portugal",
  "croacia": "Croatia",
  "hungria": "Hungary",
  "republica checa": "Czech Republic",
  "rumania": "Romania",
  "polonia": "Poland",
  "noruega": "Norway",
  "suecia": "Sweden",
  "dinamarca": "Denmark",
  "finlandia": "Finland",
  "irlanda": "Ireland",
  "canada": "Canada",
  "australia": "Australia",
  "nueva zelanda": "New Zealand",
  "israel": "Israel",
  "jordania": "Jordan",
  "arabia saudi": "Saudi Arabia",
  "bahrein": "Bahrain",
  "catar": "Qatar",
  "kuwait": "Kuwait",
  "oman": "Oman",
};

// Resolve a possibly-Spanish, possibly-accented country name to its English DB equivalent.
const resolveCountryName = (name) => {
  if (!name || typeof name !== "string") return name;
  const key = stripDiacritics(name.trim().toLowerCase());
  return COUNTRY_NAME_ALIASES_EN[key] || stripDiacritics(name.trim());
};

const resolveSemanticLanguage = (plan = {}) => {
  const raw = String(plan?.language || "es").trim().toLowerCase();
  if (raw.startsWith("en")) return "en";
  if (raw.startsWith("pt")) return "pt";
  return "es";
};

const pickSemanticCopy = (language, values = {}) =>
  values?.[language] || values?.en || values?.es || "";

const normalizeSemanticKey = (value) =>
  stripDiacritics(String(value || "").toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeHotelNameForMatch = (value) =>
  normalizeSemanticKey(value)
    .replace(
      /\b(hotel|resort|suite|suites|inn|spa|by|the|and|apartments?|apart-hotel|apart hotel)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

const tokenizeSemanticName = (value) =>
  normalizeHotelNameForMatch(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

const normalizeExactStarRatings = (value) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry) && entry >= 1 && entry <= 5)
        .map((entry) => Math.round(entry)),
    ),
  ).sort((a, b) => a - b);

const resolveClassificationCodesForExactRatings = (starRatings = []) => {
  const allowed = new Set(normalizeExactStarRatings(starRatings));
  if (!allowed.size) return [];
  return Object.entries(WEBBEDS_CLASSIFICATION_CODE_TO_STARS)
    .filter(([, stars]) => allowed.has(stars))
    .map(([code]) => Number(code));
};

const computeHotelNameSimilarity = (left, right) => {
  const a = normalizeHotelNameForMatch(left);
  const b = normalizeHotelNameForMatch(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.94;
  const tokensA = tokenizeSemanticName(a);
  const tokensB = tokenizeSemanticName(b);
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const overlap = tokensA.filter((token) => setB.has(token)).length;
  const coverageA = overlap / setA.size;
  const coverageB = overlap / setB.size;
  const firstTokenBonus =
    tokensA[0] && tokensA[0] === tokensB[0] ? 0.08 : 0;
  return Math.min(0.99, (coverageA + coverageB) / 2 + firstTokenBonus);
};

const GOOD_AREA_HINTS_BY_CITY = {
  "buenos aires": [
    "palermo",
    "recoleta",
    "puerto madero",
    "belgrano",
    "san telmo",
  ],
};

const WATERFRONT_HINTS_BY_CITY = {
  "buenos aires": [
    "puerto madero",
    "costanera",
    "rio de la plata",
    "waterfront",
    "riverfront",
  ],
};

const collectStringLeaves = (value, acc = []) => {
  if (!value) return acc;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) acc.push(trimmed);
    return acc;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectStringLeaves(entry, acc));
    return acc;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((entry) => collectStringLeaves(entry, acc));
  }
  return acc;
};

const flattenHotelDescriptionTexts = (hotel = {}) => {
  const snippets = [
    hotel.shortDescription,
    hotel.description,
    ...(hotel.descriptions ? collectStringLeaves(hotel.descriptions, []) : []),
  ]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  return Array.from(new Set(snippets));
};

const buildHotelSemanticTextParts = (hotel = {}) => {
  const parts = [
    hotel.name,
    hotel.address,
    hotel.city,
    hotel.country,
    hotel.region,
    ...(Array.isArray(hotel.locations) ? hotel.locations : []),
    ...(Array.isArray(hotel.geoLocations)
      ? hotel.geoLocations.map((entry) => entry?.name).filter(Boolean)
      : []),
    ...flattenHotelDescriptionTexts(hotel),
  ];
  return parts
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
};

const buildHotelSemanticTextBlob = (hotel = {}) =>
  normalizeSemanticKey(buildHotelSemanticTextParts(hotel).join(" "));

const buildSemanticPriceContext = (cards = []) => {
  const prices = cards
    .map((card) => toNumberOrNull(card?.pricePerNight))
    .filter((value) => value != null)
    .sort((a, b) => a - b);
  if (!prices.length) {
    return { q1: null, median: null, q3: null };
  }
  const pickQuantile = (ratio) => prices[Math.min(prices.length - 1, Math.floor((prices.length - 1) * ratio))];
  return {
    q1: pickQuantile(0.25),
    median: pickQuantile(0.5),
    q3: pickQuantile(0.75),
  };
};

const resolvePlanCityKey = (plan = {}) =>
  normalizeSemanticKey(plan?.location?.city || plan?.location?.rawQuery || "");

const collectSemanticPlaceTargets = (plan = {}) => {
  const combined = [
    ...(Array.isArray(plan?.placeTargets) ? plan.placeTargets : []),
    ...(Array.isArray(plan?.semanticSearch?.webContext?.resolvedPlaces)
      ? plan.semanticSearch.webContext.resolvedPlaces
      : []),
  ];
  const deduped = [];
  const seen = new Set();
  for (const target of combined) {
    if (!target || typeof target !== "object") continue;
    const rawText =
      typeof target.rawText === "string" && target.rawText.trim()
        ? target.rawText.trim()
        : typeof target.normalizedName === "string" && target.normalizedName.trim()
          ? target.normalizedName.trim()
          : "";
    if (!rawText) continue;
    const normalizedName =
      typeof target.normalizedName === "string" && target.normalizedName.trim()
        ? target.normalizedName.trim()
        : rawText;
    const key = normalizeSemanticKey(
      `${normalizedName}|${target.type || ""}|${target.city || ""}|${target.country || ""}`,
    );
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const coordinates = normalizeCoordinatePair(target.lat, target.lng);
    deduped.push({
      rawText,
      normalizedName,
      type: typeof target.type === "string" ? target.type : null,
      city: typeof target.city === "string" ? target.city : null,
      country: typeof target.country === "string" ? target.country : null,
      aliases: Array.isArray(target.aliases)
        ? Array.from(
            new Set(
              target.aliases
                .map((entry) =>
                  typeof entry === "string" && entry.trim()
                    ? entry.trim()
                    : null,
                )
                .filter(Boolean),
            ),
          )
        : [],
      lat: coordinates.lat,
      lng: coordinates.lng,
      radiusMeters:
        toNumberOrNull(target.radiusMeters) != null
          ? Math.max(300, Number(target.radiusMeters))
          : null,
      confidence: toNumberOrNull(target.confidence),
    });
  }
  return deduped;
};

const collectSemanticPlaceTokens = (plan = {}) => {
  const tokens = [];
  for (const target of collectSemanticPlaceTargets(plan)) {
    const rawEntries = [
      target.rawText,
      target.normalizedName,
      ...(Array.isArray(target.aliases) ? target.aliases : []),
    ];
    rawEntries.forEach((entry) => {
      const token = normalizeSemanticKey(entry);
      if (!token || token.length < 3) return;
      tokens.push({ token, target });
    });
  }
  const deduped = [];
  const seen = new Set();
  tokens.forEach((entry) => {
    const key = `${entry.token}|${entry.target?.normalizedName || entry.target?.rawText || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(entry);
  });
  return deduped;
};

const formatSemanticPlaceLabel = (place = {}) =>
  place?.normalizedName || place?.rawText || null;

const findMatchedSemanticPlaceToken = (blob, placeTokens = []) => {
  if (!blob || !Array.isArray(placeTokens) || !placeTokens.length) return null;
  return (
    placeTokens.find((entry) => entry?.token && blob.includes(entry.token)) ||
    null
  );
};

const computeDistanceMetersToPlaceTarget = (hotel = {}, target = {}) => {
  if (!hotel?.geoPoint || target?.lat == null || target?.lng == null) return null;
  const distanceKm = computeDistanceKm(hotel.geoPoint, {
    lat: target.lat,
    lng: target.lng,
  });
  if (distanceKm == null) return null;
  return Math.max(0, Math.round(distanceKm * 1000));
};

const resolveAreaTraitLabel = (language, trait) => {
  const normalizedTrait = String(trait || "").trim().toUpperCase();
  const labels = {
    GOOD_AREA: {
      es: "buena zona",
      en: "a strong area",
      pt: "boa região",
    },
    SAFE: {
      es: "zona segura",
      en: "a safer area",
      pt: "área segura",
    },
    QUIET: {
      es: "zona tranquila",
      en: "a quieter area",
      pt: "área tranquila",
    },
    NIGHTLIFE: {
      es: "vida nocturna",
      en: "nightlife",
      pt: "vida noturna",
    },
    WALKABLE: {
      es: "zona caminable",
      en: "a walkable area",
      pt: "área caminhável",
    },
    UPSCALE_AREA: {
      es: "zona premium",
      en: "an upscale area",
      pt: "área premium",
    },
    FAMILY: {
      es: "perfil familiar",
      en: "a family-friendly profile",
      pt: "perfil familiar",
    },
    LUXURY: {
      es: "perfil premium",
      en: "a premium profile",
      pt: "perfil premium",
    },
    BUSINESS: {
      es: "zona de negocios",
      en: "a business-friendly area",
      pt: "área de negócios",
    },
    CENTRAL: {
      es: "zona céntrica",
      en: "a central area",
      pt: "área central",
    },
    CULTURAL: {
      es: "zona cultural",
      en: "a cultural area",
      pt: "área cultural",
    },
    WATERFRONT_AREA: {
      es: "zona ribereña",
      en: "a waterfront area",
      pt: "área à beira d'água",
    },
  };
  const picked = labels[normalizedTrait];
  return picked ? pickSemanticCopy(language, picked) : null;
};

const buildCatalogEntityTokens = (entry = {}) =>
  [entry?.name, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])]
    .map((value) => normalizeSemanticKey(value))
    .filter(Boolean);

const buildCatalogEntityLabel = (entry = {}) => entry?.name || null;

const buildCatalogEntityMatch = ({ hotel, blob, entry, type = "ZONE" } = {}) => {
  if (!entry || typeof entry !== "object") return null;
  const tokens = buildCatalogEntityTokens(entry);
  if (!tokens.length) return null;
  const textMatched = tokens.some((token) => blob.includes(token));
  const radiusMeters =
    Math.max(
      300,
      Number(
        toNumberOrNull(entry?.radiusMeters) ??
          (type === "LANDMARK" ? 1600 : 2600),
      ),
    ) || (type === "LANDMARK" ? 1600 : 2600);
  const distanceMeters =
    hotel?.geoPoint &&
    toNumberOrNull(entry?.lat) != null &&
    toNumberOrNull(entry?.lng) != null
      ? Math.max(
          0,
          Math.round(
            (computeDistanceKm(hotel.geoPoint, {
              lat: Number(entry.lat),
              lng: Number(entry.lng),
            }) || 0) * 1000,
          ),
        )
      : null;
  const insideRadius =
    distanceMeters != null && distanceMeters <= radiusMeters;
  const nearbyRadius =
    distanceMeters != null &&
    distanceMeters <= Math.max(600, Math.round(radiusMeters * 1.35));
  const score =
    (textMatched ? (type === "LANDMARK" ? 62 : 54) : 0) +
    (insideRadius ? (type === "LANDMARK" ? 72 : 64) : nearbyRadius ? 24 : 0);
  if (!score) return null;
  return {
    entry,
    type,
    textMatched,
    insideRadius,
    nearbyRadius,
    distanceMeters,
    radiusMeters,
    score,
  };
};

const resolveBestCatalogEntityMatch = ({
  hotel,
  blob,
  entries = [],
  type = "ZONE",
} = {}) =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => buildCatalogEntityMatch({ hotel, blob, entry, type }))
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.textMatched !== right.textMatched) {
        return left.textMatched ? -1 : 1;
      }
      if (left.insideRadius !== right.insideRadius) {
        return left.insideRadius ? -1 : 1;
      }
      return (left.distanceMeters ?? Number.MAX_SAFE_INTEGER) -
        (right.distanceMeters ?? Number.MAX_SAFE_INTEGER);
    })[0] || null;

const countCatalogTraitOverlap = (requestedTraits = [], entry = {}) =>
  (Array.isArray(requestedTraits) ? requestedTraits : []).filter((trait) =>
    Array.isArray(entry?.traits)
      ? entry.traits.includes(String(trait || "").trim().toUpperCase())
      : false,
  );

const resolveSemanticInferenceMode = (plan = {}) =>
  String(plan?.semanticSearch?.intentProfile?.inferenceMode || "")
    .trim()
    .toUpperCase();

const isExplicitSemanticGeoSearch = (plan = {}) =>
  resolveSemanticInferenceMode(plan) === "EXPLICIT_GEO" ||
  Boolean(plan?.geoIntent) ||
  collectSemanticPlaceTargets(plan).length > 0;

const isTraitProfileSemanticSearch = (plan = {}) =>
  resolveSemanticInferenceMode(plan) === "TRAIT_PROFILE";

const resolveSemanticMatchConfidence = ({
  score = 0,
  semanticEvidence = [],
  matchedZone = null,
  matchedLandmark = null,
  plan = {},
} = {}) => {
  const strongEvidence = Array.isArray(semanticEvidence)
    ? semanticEvidence.some((entry) =>
        STRONG_SEMANTIC_CHAT_EVIDENCE_TYPES.has(entry?.type),
      )
    : false;
  const traitProfileMode = isTraitProfileSemanticSearch(plan);
  if (
    !traitProfileMode &&
    (strongEvidence ||
      matchedLandmark?.insideRadius ||
      matchedLandmark?.textMatched ||
      matchedZone?.insideRadius ||
      matchedZone?.textMatched)
  ) {
    return "HIGH";
  }
  if (traitProfileMode && (strongEvidence || score >= 30)) {
    return "MEDIUM";
  }
  if (score >= 30 || matchedZone?.nearbyRadius || matchedLandmark?.nearbyRadius) {
    return "MEDIUM";
  }
  return "LOW";
};

const resolveSemanticScopeEligibility = ({
  plan = {},
  semanticEvidence = [],
  semanticScore = 0,
  matchedZone = null,
  matchedLandmark = null,
  modelNameMatch = null,
  zoneTraitOverlapCount = 0,
} = {}) => {
  const strongEvidence = Array.isArray(semanticEvidence)
    ? semanticEvidence.some((entry) =>
        STRONG_SEMANTIC_CHAT_EVIDENCE_TYPES.has(entry?.type),
      )
    : false;
  const hasExplicitGeoIntent = isExplicitSemanticGeoSearch(plan);
  const traitProfileMode = isTraitProfileSemanticSearch(plan);
  const hasAreaIntent =
    Boolean(plan?.areaIntent) ||
    (Array.isArray(plan?.areaTraits) && plan.areaTraits.length) ||
    (Array.isArray(plan?.semanticSearch?.intentProfile?.userRequestedAreaTraits) &&
      plan.semanticSearch.intentProfile.userRequestedAreaTraits.length) ||
    (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedAreaTraits) &&
      plan.semanticSearch.intentProfile.requestedAreaTraits.length);

  if (hasExplicitGeoIntent) {
    return Boolean(
      strongEvidence ||
        matchedZone?.textMatched ||
        matchedZone?.insideRadius ||
        matchedLandmark?.textMatched ||
        matchedLandmark?.insideRadius,
    );
  }
  if (traitProfileMode) {
    const traitProfileSupportSignals = Array.isArray(semanticEvidence)
      ? new Set(
          semanticEvidence
            .map((entry) => String(entry?.label || "").trim())
            .filter(
              (label) =>
                label === "catalog_zone_trait_overlap" ||
                label === "candidate_landmark_profile_match" ||
                label === "exact_star_match" ||
                label === "budget_rank" ||
                label === "value_rank" ||
                label === "luxury_profile" ||
                /^area_trait_/.test(label) ||
                /_description$/.test(label),
            ),
        ).size
      : 0;
    return Boolean(
      strongEvidence ||
        zoneTraitOverlapCount > 0 ||
        traitProfileSupportSignals > 0 ||
        matchedZone?.textMatched ||
        matchedLandmark?.textMatched,
    );
  }
  if (plan?.viewIntent) {
    return Boolean(strongEvidence || modelNameMatch || semanticScore >= 24);
  }
  if (hasAreaIntent) {
    return Boolean(strongEvidence || matchedZone || semanticScore >= 18);
  }
  if (plan?.qualityIntent) {
    return semanticScore >= 12;
  }
  return semanticScore > 0 || strongEvidence;
};

const collectSemanticNeighborhoodHints = (plan = {}, catalogContext = null) => {
  const cityKey = resolvePlanCityKey(plan);
  const resolvedCatalogContext =
    catalogContext && typeof catalogContext === "object"
      ? catalogContext
      : resolveSemanticCatalogContext({ plan });
  const cityCatalog = resolvedCatalogContext?.cityCatalog || null;
  const hints = new Set(
    (Array.isArray(plan?.semanticSearch?.neighborhoodHints)
      ? plan.semanticSearch.neighborhoodHints
    : []
    ).map((entry) => normalizeSemanticKey(entry)).filter(Boolean),
  );

  collectSemanticPlaceTargets(plan).forEach((target) => {
    [target.rawText, target.normalizedName, ...(target.aliases || [])]
      .map((entry) => normalizeSemanticKey(entry))
      .filter(Boolean)
      .forEach((entry) => hints.add(entry));
  });

  const addCatalogEntryHints = (entry = {}) => {
    [entry?.name, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])]
      .map((value) => normalizeSemanticKey(value))
      .filter(Boolean)
      .forEach((value) => hints.add(value));
  };

  (Array.isArray(resolvedCatalogContext?.explicitZones)
    ? resolvedCatalogContext.explicitZones
    : []
  ).forEach(addCatalogEntryHints);
  (Array.isArray(resolvedCatalogContext?.candidateZones)
    ? resolvedCatalogContext.candidateZones
    : []
  ).forEach(addCatalogEntryHints);
  (Array.isArray(resolvedCatalogContext?.explicitLandmarks)
    ? resolvedCatalogContext.explicitLandmarks
    : []
  ).forEach((landmark) => {
    addCatalogEntryHints(landmark);
    const zoneIds = Array.isArray(landmark?.zoneIds) ? landmark.zoneIds : [];
    zoneIds.forEach((zoneId) => {
      const zone = Array.isArray(cityCatalog?.zones)
        ? cityCatalog.zones.find((entry) => entry?.id === zoneId)
        : null;
      if (zone) addCatalogEntryHints(zone);
    });
  });

  if (plan?.areaIntent === "GOOD_AREA" && !cityCatalog) {
    (GOOD_AREA_HINTS_BY_CITY[cityKey] || []).forEach((entry) =>
      hints.add(normalizeSemanticKey(entry)),
    );
  }
  if (
    (plan?.viewIntent === "RIVER_VIEW" || plan?.viewIntent === "WATER_VIEW") &&
    !cityCatalog
  ) {
    (WATERFRONT_HINTS_BY_CITY[cityKey] || []).forEach((entry) =>
      hints.add(normalizeSemanticKey(entry)),
    );
  }
  if (plan?.areaIntent === "CITY_CENTER") {
    ["city center", "downtown", "centro", "microcentro"].forEach((entry) =>
      hints.add(normalizeSemanticKey(entry)),
    );
  }
  return Array.from(hints).filter(Boolean);
};

const resolveMatchedNeighborhood = (blob, hints = []) => {
  for (const hint of hints) {
    if (hint && blob.includes(hint)) return hint;
  }
  return null;
};

const resolveBestModelCandidateMatch = (hotelName, candidateNames = []) => {
  if (!hotelName || !Array.isArray(candidateNames) || !candidateNames.length) {
    return null;
  }
  const ranked = candidateNames
    .map((candidate) => ({
      candidate,
      score: computeHotelNameSimilarity(hotelName, candidate),
    }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < 0.82) return null;
  if (ranked[1] && ranked[0].score - ranked[1].score < 0.08) return null;
  return ranked[0];
};

const buildLocalizedHotelReason = (language, kind, payload = {}) => {
  switch (kind) {
    case "exact_stars":
      return pickSemanticCopy(language, {
        es: `Cumple con ${payload.stars} estrellas`,
        en: `Matches the requested ${payload.stars}-star level`,
        pt: `Cumpre o pedido de ${payload.stars} estrelas`,
      });
    case "budget":
      return pickSemanticCopy(language, {
        es: "Está entre las opciones más económicas",
        en: "It is among the more affordable options",
        pt: "Está entre as opções mais econômicas",
      });
    case "value":
      return pickSemanticCopy(language, {
        es: "Buena relación precio-calidad",
        en: "Good value for money",
        pt: "Boa relação custo-benefício",
      });
    case "luxury":
      return pickSemanticCopy(language, {
        es: "Tiene un perfil más premium",
        en: "It has a more premium profile",
        pt: "Tem um perfil mais premium",
      });
    case "river_view_text":
      return pickSemanticCopy(language, {
        es: "La descripción menciona vista al río",
        en: "The description mentions river views",
        pt: "A descrição menciona vista para o rio",
      });
    case "water_view_text":
      return pickSemanticCopy(language, {
        es: "La descripción menciona vista al agua",
        en: "The description mentions water views",
        pt: "A descrição menciona vista para a água",
      });
    case "sea_view_text":
      return pickSemanticCopy(language, {
        es: "La descripción menciona vista al mar",
        en: "The description mentions sea views",
        pt: "A descrição menciona vista para o mar",
      });
    case "area_match":
      return pickSemanticCopy(language, {
        es: `Ubicado en ${payload.area}`,
        en: `Located in ${payload.area}`,
        pt: `Localizado em ${payload.area}`,
      });
    case "inside_area":
      return pickSemanticCopy(language, {
        es: `Dentro del área de ${payload.area}`,
        en: `Within the ${payload.area} area`,
        pt: `Dentro da área de ${payload.area}`,
      });
    case "near_place":
      return pickSemanticCopy(language, {
        es: `Cerca de ${payload.place}`,
        en: `Near ${payload.place}`,
        pt: `Perto de ${payload.place}`,
      });
    case "area_trait":
      return pickSemanticCopy(language, {
        es: `Coincide con la preferencia de ${payload.trait}`,
        en: `Matches the preference for ${payload.trait}`,
        pt: `Combina com a preferência por ${payload.trait}`,
      });
    case "center_hint":
      return pickSemanticCopy(language, {
        es: "Cerca del centro",
        en: "Close to the center",
        pt: "Perto do centro",
      });
    default:
      return null;
  }
};

const uniqueReasonList = (reasons = [], max = 6) =>
  Array.from(
    new Set(
      reasons
        .map((reason) => String(reason || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, max);

const hasVerifiedGeoEvidenceForCard = (card = {}) => {
  const evidence = [
    ...(Array.isArray(card?.semanticEvidence) ? card.semanticEvidence : []),
    ...(Array.isArray(card?.semanticMatch?.evidence) ? card.semanticMatch.evidence : []),
  ];
  return evidence.some((entry) => entry?.type === "verified_geo");
};

const isGeoReasonText = (reason = "", matchedPlaceName = null) => {
  const normalizedReason = String(reason || "").trim().toLowerCase();
  if (!normalizedReason) return false;
  if (
    /^(cerca de|near |within the |inside the |dentro del area de|dentro del área de)/.test(
      normalizedReason,
    )
  ) {
    return true;
  }
  if (matchedPlaceName) {
    return normalizedReason.includes(String(matchedPlaceName).trim().toLowerCase());
  }
  return false;
};

const sanitizeVisibleGeoReasons = (hotel = {}, reasons = [], max = 6) => {
  const list = Array.isArray(reasons) ? reasons : [];
  if (!list.length) return [];
  if (hasVerifiedGeoEvidenceForCard(hotel)) {
    return uniqueReasonList(list, max);
  }
  const matchedPlaceName =
    hotel?.matchedPlaceTarget?.normalizedName ||
    hotel?.matchedPlaceTarget?.rawText ||
    null;
  return uniqueReasonList(
    list.filter((reason) => !isGeoReasonText(reason, matchedPlaceName)),
    max,
  );
};

const uniqueOrderedStringList = (values = [], max = 12) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, max);

const buildRequestedTraitNarrative = (language, requestedAreaTraits = []) => {
  const traits = new Set(
    (Array.isArray(requestedAreaTraits) ? requestedAreaTraits : []).map((trait) =>
      String(trait || "").trim().toUpperCase(),
    ),
  );

  if (traits.has("QUIET") && traits.has("WALKABLE")) {
    return pickSemanticCopy(language, {
      es: "mas tranquilo para descansar y comodo para moverte a pie",
      en: "quieter to unwind and easy to explore on foot",
      pt: "mais tranquilo para descansar e confortavel para caminhar",
    });
  }
  if (traits.has("SAFE") && traits.has("WALKABLE")) {
    return pickSemanticCopy(language, {
      es: "mas cuidada y facil de recorrer caminando",
      en: "more comfortable and easy to explore on foot",
      pt: "mais cuidadosa e facil de percorrer a pe",
    });
  }
  if (traits.has("UPSCALE_AREA") && traits.has("WALKABLE")) {
    return pickSemanticCopy(language, {
      es: "mas refinado y facil de recorrer caminando",
      en: "more refined and easy to explore on foot",
      pt: "mais refinado e facil de percorrer a pe",
    });
  }
  if (traits.has("QUIET")) {
    return pickSemanticCopy(language, {
      es: "mas tranquilo para descansar",
      en: "quieter to unwind",
      pt: "mais tranquilo para descansar",
    });
  }
  if (traits.has("WALKABLE")) {
    return pickSemanticCopy(language, {
      es: "comodo para moverte a pie",
      en: "easy to explore on foot",
      pt: "confortavel para caminhar",
    });
  }
  if (traits.has("SAFE")) {
    return pickSemanticCopy(language, {
      es: "en una zona mas cuidada",
      en: "in a more comfortable area",
      pt: "em uma area mais cuidada",
    });
  }
  if (traits.has("UPSCALE_AREA")) {
    return pickSemanticCopy(language, {
      es: "con un entorno mas refinado",
      en: "with a more refined setting",
      pt: "com um entorno mais refinado",
    });
  }
  if (traits.has("FAMILY")) {
    return pickSemanticCopy(language, {
      es: "comodo para viajar en familia",
      en: "comfortable for a family stay",
      pt: "confortavel para viajar em familia",
    });
  }
  return null;
};

const buildDecisionExplanationSignals = (reasonFamilies = []) => {
  const reasonTypes = new Set(
    (Array.isArray(reasonFamilies) ? reasonFamilies : [])
      .map((entry) => String(entry?.type || "").trim())
      .filter(Boolean),
  );
  return {
    zone_fit: reasonTypes.has("zone_fit"),
    walkability: reasonTypes.has("walkability"),
    quiet_profile: reasonTypes.has("quiet_profile"),
    value: reasonTypes.has("value"),
    premium_profile: reasonTypes.has("premium_profile"),
    stars_match: reasonTypes.has("stars_match"),
    view_match: reasonTypes.has("view_match"),
    landmark_proximity: reasonTypes.has("landmark_proximity"),
  };
};

const buildDecisionExplanationAngleTexts = (reasonFamilies = []) =>
  (Array.isArray(reasonFamilies) ? reasonFamilies : []).reduce((acc, entry) => {
    const angle = String(entry?.comparisonAngle || "").trim();
    const text = String(entry?.text || "").trim();
    if (!angle || !text || acc[angle]) return acc;
    acc[angle] = text;
    return acc;
  }, {});

const hasSemanticEvidenceLabel = (semanticEvidence = [], predicate = null) =>
  Array.isArray(semanticEvidence)
    ? semanticEvidence.some((entry) => {
        const label = String(entry?.label || "").trim();
        if (!label) return false;
        if (typeof predicate === "function") return predicate(label, entry);
        return label === predicate;
      })
    : false;

const resolvePriceTierForHotel = (nightlyPrice, priceContext = {}) => {
  if (nightlyPrice == null) return "UNKNOWN";
  if (priceContext?.q1 != null && nightlyPrice <= priceContext.q1) return "LOW";
  if (priceContext?.q3 != null && nightlyPrice >= priceContext.q3) return "HIGH";
  return "MID";
};

const buildDecisionExplanation = ({
  language,
  plan,
  requestedAreaTraits = [],
  matchedZone = null,
  matchedLandmark = null,
  zoneTraitOverlap = [],
  semanticEvidence = [],
  hotelStars = null,
  nightlyPrice = null,
  priceContext = {},
  confidence = "LOW",
} = {}) => {
  const explicitGeoMode = isExplicitSemanticGeoSearch(plan);
  const traitProfileMode = isTraitProfileSemanticSearch(plan);
  const zoneLabel = buildCatalogEntityLabel(matchedZone?.entry) || null;
  const landmarkLabel = buildCatalogEntityLabel(matchedLandmark?.entry) || null;
  const profileNarrative = buildRequestedTraitNarrative(language, requestedAreaTraits);
  const reasonFamilies = [];
  const addReasonFamily = (type, strength, text, comparisonAngle) => {
    if (!text || !String(text).trim()) return;
    reasonFamilies.push({
      type,
      strength,
      text: String(text).trim(),
      comparisonAngle: comparisonAngle || type,
    });
  };

  const canMentionZone = Boolean(
    zoneLabel &&
      (explicitGeoMode ||
        (traitProfileMode &&
          (matchedZone?.textMatched ||
            matchedZone?.insideRadius ||
            zoneTraitOverlap.length > 0))),
  );

  if (explicitGeoMode && zoneLabel && (matchedZone?.textMatched || matchedZone?.insideRadius)) {
    addReasonFamily(
      "zone_fit",
      94,
      pickSemanticCopy(language, {
        es: `queda bien ubicado para moverte por ${zoneLabel}`,
        en: `it is well placed for staying around ${zoneLabel}`,
        pt: `fica bem localizado para se mover por ${zoneLabel}`,
      }),
      "zone_fit",
    );
  } else if (traitProfileMode && canMentionZone && profileNarrative) {
    addReasonFamily(
      "zone_fit",
      84,
      pickSemanticCopy(language, {
        es: `la zona de ${zoneLabel} suele funcionar bien si buscas algo ${profileNarrative}`,
        en: `${zoneLabel} usually fits well if you want something ${profileNarrative}`,
        pt: `${zoneLabel} costuma funcionar bem se voce quer algo ${profileNarrative}`,
      }),
      "zone_fit",
    );
  } else if (traitProfileMode && profileNarrative) {
    addReasonFamily(
      "zone_fit",
      68,
      pickSemanticCopy(language, {
        es: `encaja mejor con un plan ${profileNarrative}`,
        en: `it fits better if you want something ${profileNarrative}`,
        pt: `combina melhor com um plano ${profileNarrative}`,
      }),
      "profile_fit",
    );
  }

  if (
    landmarkLabel &&
    explicitGeoMode &&
    (matchedLandmark?.textMatched || matchedLandmark?.insideRadius)
  ) {
    addReasonFamily(
      "landmark_proximity",
      88,
      pickSemanticCopy(language, {
        es: `te deja bien parado para moverte cerca de ${landmarkLabel}`,
        en: `it keeps you well placed near ${landmarkLabel}`,
        pt: `deixa voce bem posicionado perto de ${landmarkLabel}`,
      }),
      "landmark_proximity",
    );
  }

  if (
    requestedAreaTraits.includes("QUIET") &&
    (hasSemanticEvidenceLabel(semanticEvidence, "area_trait_quiet") ||
      matchedZone?.entry?.traits?.includes("QUIET"))
  ) {
    addReasonFamily(
      "quiet_profile",
      80,
      pickSemanticCopy(language, {
        es: "se siente mas tranquilo para descansar",
        en: "it feels quieter to unwind",
        pt: "parece mais tranquilo para descansar",
      }),
      "quiet_profile",
    );
  }

  if (
    requestedAreaTraits.includes("WALKABLE") &&
    (hasSemanticEvidenceLabel(semanticEvidence, "area_trait_walkable") ||
      matchedZone?.entry?.traits?.includes("WALKABLE"))
  ) {
    addReasonFamily(
      "walkability",
      78,
      pickSemanticCopy(language, {
        es: "te deja moverte a pie con mas comodidad",
        en: "it is easier to explore on foot",
        pt: "facilita se mover a pe",
      }),
      "walkability",
    );
  }

  if (
    (requestedAreaTraits.includes("UPSCALE_AREA") || plan?.qualityIntent === "LUXURY") &&
    (matchedZone?.entry?.traits?.includes("UPSCALE_AREA") ||
      hotelStars >= 5 ||
      hasSemanticEvidenceLabel(semanticEvidence, "luxury_profile"))
  ) {
    addReasonFamily(
      "premium_profile",
      70,
      pickSemanticCopy(language, {
        es: "suma un entorno mas refinado que otras alternativas de este grupo",
        en: "it brings a more refined setting than similar alternatives",
        pt: "traz um entorno mais refinado do que alternativas parecidas",
      }),
      "premium_profile",
    );
  } else if (hotelStars >= 5) {
    addReasonFamily(
      "premium_profile",
      62,
      pickSemanticCopy(language, {
        es: "dentro de este grupo se siente mas cuidado que otras alternativas parecidas",
        en: "within this group it feels more polished than similar alternatives",
        pt: "dentro deste grupo parece mais cuidado do que alternativas parecidas",
      }),
      "premium_profile",
    );
  }

  if (hasSemanticEvidenceLabel(semanticEvidence, "exact_star_match") && hotelStars != null) {
    addReasonFamily(
      "stars_match",
      76,
      pickSemanticCopy(language, {
        es: `cumple exacto con las ${hotelStars} estrellas que pediste`,
        en: `it matches the ${hotelStars}-star level you asked for`,
        pt: `cumpre exatamente as ${hotelStars} estrelas pedidas`,
      }),
      "stars_match",
    );
  }

  if (hasSemanticEvidenceLabel(semanticEvidence, "budget_rank")) {
    addReasonFamily(
      "value",
      74,
      pickSemanticCopy(language, {
        es: "queda bien parado por precio dentro de las opciones comparables",
        en: "it stays well positioned on price among comparable options",
        pt: "fica bem posicionado em preco entre opcoes parecidas",
      }),
      "value",
    );
  } else if (hasSemanticEvidenceLabel(semanticEvidence, "value_rank")) {
    addReasonFamily(
      "value",
      72,
      pickSemanticCopy(language, {
        es: "equilibra mejor ubicacion y valor que otras opciones parecidas",
        en: "it balances location and value better than similar options",
        pt: "equilibra localizacao e valor melhor do que opcoes parecidas",
      }),
      "value",
    );
  } else if (nightlyPrice != null && hotelStars != null && hotelStars <= 3) {
    addReasonFamily(
      "value",
      58,
      pickSemanticCopy(language, {
        es: "entra como una alternativa mas simple para priorizar ubicacion",
        en: "it works as a simpler option if you want to prioritize location",
        pt: "entra como uma alternativa mais simples para priorizar localizacao",
      }),
      "value",
    );
  } else if (nightlyPrice != null && hotelStars != null && hotelStars === 4) {
    addReasonFamily(
      "value",
      60,
      pickSemanticCopy(language, {
        es: "mantiene un equilibrio mas redondo entre zona y nivel de hotel",
        en: "it keeps a more rounded balance between area and hotel level",
        pt: "mantem um equilibrio mais redondo entre area e nivel do hotel",
      }),
      "balance",
    );
  }

  if (
    hasSemanticEvidenceLabel(
      semanticEvidence,
      (label) =>
        label === "river_view_description" ||
        label === "water_view_description" ||
        label === "sea_view_description",
    )
  ) {
    addReasonFamily(
      "view_match",
      82,
      pickSemanticCopy(language, {
        es: "la vista aparece respaldada por la descripcion del hotel",
        en: "the view is supported by the hotel description",
        pt: "a vista esta respaldada pela descricao do hotel",
      }),
      "view_match",
    );
  }

  if (!reasonFamilies.length && canMentionZone && zoneLabel) {
    addReasonFamily(
      "zone_fit",
      56,
      pickSemanticCopy(language, {
        es: `la zona de ${zoneLabel} le da mejor encaje que a otras alternativas cercanas`,
        en: `${zoneLabel} gives it a better fit than nearby alternatives`,
        pt: `${zoneLabel} da um encaixe melhor do que alternativas proximas`,
      }),
      "zone_fit",
    );
  }

  if (!reasonFamilies.length) {
    const priceTier = resolvePriceTierForHotel(nightlyPrice, priceContext);
    addReasonFamily(
      priceTier === "LOW" || priceTier === "MID" ? "value" : "zone_fit",
      40,
      pickSemanticCopy(language, {
        es:
          priceTier === "LOW" || priceTier === "MID"
            ? "entra bien como opcion equilibrada dentro de esta busqueda"
            : "queda bien parado dentro del grupo que mejor encaja con esta busqueda",
        en:
          priceTier === "LOW" || priceTier === "MID"
            ? "it lands well as a balanced option for this search"
            : "it sits well within the group that best fits this search",
        pt:
          priceTier === "LOW" || priceTier === "MID"
            ? "entra bem como uma opcao equilibrada para esta busca"
            : "fica bem posicionado dentro do grupo que melhor encaixa nesta busca",
      }),
      priceTier === "LOW" || priceTier === "MID" ? "value" : "overall_fit",
    );
  }

  reasonFamilies.sort((left, right) => right.strength - left.strength);
  const primaryReason = reasonFamilies[0] || null;
  const secondaryReason =
    reasonFamilies.find((entry) => entry.type !== primaryReason?.type) || null;
  const allowedAngles = uniqueOrderedStringList(
    reasonFamilies.map((entry) => entry.comparisonAngle || entry.type),
    8,
  );
  const signals = buildDecisionExplanationSignals(reasonFamilies);
  const angleTexts = buildDecisionExplanationAngleTexts(reasonFamilies);

  return {
    primaryReasonType: primaryReason?.type || null,
    primaryReasonText: primaryReason?.text || null,
    secondaryReasonType: secondaryReason?.type || null,
    secondaryReasonText: secondaryReason?.text || null,
    comparisonAngle:
      secondaryReason?.comparisonAngle ||
      primaryReason?.comparisonAngle ||
      "overall_fit",
    canMentionZone,
    mentionedZoneLabel: canMentionZone ? zoneLabel : null,
    confidence,
    allowedAngles,
    angleTexts,
    signals,
    allowedClaims: uniqueOrderedStringList(
      [
        primaryReason?.text || null,
        secondaryReason?.text || null,
        ...Object.values(angleTexts),
        canMentionZone ? zoneLabel : null,
        landmarkLabel,
      ],
      12,
    ),
  };
};

const hasSemanticSearchIntent = (plan = {}) =>
  Boolean(
    (Array.isArray(plan?.starRatings) && plan.starRatings.length) ||
      plan?.geoIntent ||
      (Array.isArray(plan?.placeTargets) && plan.placeTargets.length) ||
      plan?.viewIntent ||
      plan?.areaIntent ||
      plan?.qualityIntent ||
      (Array.isArray(plan?.areaTraits) && plan.areaTraits.length) ||
      (Array.isArray(plan?.preferenceNotes) && plan.preferenceNotes.length) ||
      (Array.isArray(plan?.semanticSearch?.candidateHotelNames) &&
        plan.semanticSearch.candidateHotelNames.length) ||
      (Array.isArray(plan?.semanticSearch?.neighborhoodHints) &&
        plan.semanticSearch.neighborhoodHints.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedAreaTraits) &&
        plan.semanticSearch.intentProfile.requestedAreaTraits.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.userRequestedAreaTraits) &&
        plan.semanticSearch.intentProfile.userRequestedAreaTraits.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedZones) &&
        plan.semanticSearch.intentProfile.requestedZones.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedLandmarks) &&
        plan.semanticSearch.intentProfile.requestedLandmarks.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.candidateZones) &&
        plan.semanticSearch.intentProfile.candidateZones.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.candidateLandmarks) &&
        plan.semanticSearch.intentProfile.candidateLandmarks.length) ||
      (Array.isArray(plan?.semanticSearch?.webContext?.resolvedPlaces) &&
        plan.semanticSearch.webContext.resolvedPlaces.length),
  );

const STRONG_SEMANTIC_CHAT_EVIDENCE_TYPES = new Set([
  "verified_geo",
  "verified_text",
  "verified_structured",
  "web_candidate_matched",
]);

const resolveSemanticTargetRadiusMeters = (target = {}) => {
  const explicitRadius = toNumberOrNull(target?.radiusMeters);
  if (explicitRadius != null) return Math.max(300, Number(explicitRadius));
  if (target?.type === "LANDMARK") return 1600;
  if (target?.type === "NEIGHBORHOOD" || target?.type === "DISTRICT") {
    return 2800;
  }
  if (target?.type === "WATERFRONT") return 3500;
  return 2200;
};

const hasSemanticChatScopeIntent = (plan = {}) =>
  Boolean(
    plan?.geoIntent ||
      collectSemanticPlaceTargets(plan).length ||
      plan?.viewIntent ||
      plan?.areaIntent ||
      plan?.qualityIntent ||
      (Array.isArray(plan?.areaTraits) && plan.areaTraits.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedAreaTraits) &&
        plan.semanticSearch.intentProfile.requestedAreaTraits.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.userRequestedAreaTraits) &&
        plan.semanticSearch.intentProfile.userRequestedAreaTraits.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedZones) &&
        plan.semanticSearch.intentProfile.requestedZones.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedLandmarks) &&
        plan.semanticSearch.intentProfile.requestedLandmarks.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.candidateZones) &&
        plan.semanticSearch.intentProfile.candidateZones.length) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.candidateLandmarks) &&
        plan.semanticSearch.intentProfile.candidateLandmarks.length) ||
      (Array.isArray(plan?.preferenceNotes) && plan.preferenceNotes.length) ||
      (Array.isArray(plan?.semanticSearch?.candidateHotelNames) &&
        plan.semanticSearch.candidateHotelNames.length) ||
      (Array.isArray(plan?.semanticSearch?.neighborhoodHints) &&
        plan.semanticSearch.neighborhoodHints.length) ||
      Boolean(plan?.preferences?.nearbyInterest) ||
      normalizeIdList(
        plan?.referenceHotelIds ?? plan?.semanticSearch?.referenceHotelIds,
      ).length,
  );

const resolveSemanticChatScopeReason = (plan = {}) => {
  const referenceHotelIds = normalizeIdList(
    plan?.referenceHotelIds ?? plan?.semanticSearch?.referenceHotelIds,
  );
  if (referenceHotelIds.length) return "REFERENCE_SET";
  if (isExplicitSemanticGeoSearch(plan)) {
    return "SEMANTIC_GEO";
  }
  if (
    (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedZones) &&
      plan.semanticSearch.intentProfile.requestedZones.length) ||
    (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedLandmarks) &&
      plan.semanticSearch.intentProfile.requestedLandmarks.length)
  ) {
    return "SEMANTIC_GEO";
  }
  if (isTraitProfileSemanticSearch(plan)) {
    return "SEMANTIC_TRAITS";
  }
  if (plan?.viewIntent) return "VIEW";
  if (
    plan?.areaIntent ||
    (Array.isArray(plan?.areaTraits) && plan.areaTraits.length) ||
    (Array.isArray(plan?.semanticSearch?.neighborhoodHints) &&
      plan.semanticSearch.neighborhoodHints.length)
  ) {
    return "AREA";
  }
  if (plan?.qualityIntent) return "QUALITY";
  return hasSemanticChatScopeIntent(plan) ? "SEMANTIC_CONTEXT" : null;
};

const resolveSemanticChatScopeThreshold = (plan = {}) => {
  if (isExplicitSemanticGeoSearch(plan) || plan?.viewIntent) {
    return 24;
  }
  if (isTraitProfileSemanticSearch(plan)) {
    return 18;
  }
  if (
    plan?.areaIntent ||
    (Array.isArray(plan?.areaTraits) && plan.areaTraits.length) ||
    (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedAreaTraits) &&
      plan.semanticSearch.intentProfile.requestedAreaTraits.length) ||
    Boolean(plan?.preferences?.nearbyInterest)
  ) {
    return 18;
  }
  if (plan?.qualityIntent) return 16;
  return 12;
};

const hasStrongSemanticEvidence = (card = {}) =>
  Array.isArray(card?.semanticEvidence)
    ? card.semanticEvidence.some((entry) =>
        STRONG_SEMANTIC_CHAT_EVIDENCE_TYPES.has(entry?.type),
      )
    : false;

const resolveSemanticMatchConfidenceRank = (confidence = null) => {
  const normalized = String(confidence || "").trim().toUpperCase();
  if (normalized === "HIGH") return 3;
  if (normalized === "MEDIUM") return 2;
  if (normalized === "LOW") return 1;
  return 0;
};

const hasScopeEligibleSemanticMatch = (card = {}) =>
  card?.semanticMatch?.scopeEligible === true;

const resolveSemanticScopeConfidence = (cards = []) => {
  const normalizedCards = Array.isArray(cards) ? cards : [];
  const ranks = normalizedCards
    .map((card) =>
      resolveSemanticMatchConfidenceRank(card?.semanticMatch?.confidence),
    )
    .filter((rank) => rank > 0);
  if (!ranks.length) {
    if (
      normalizedCards.some(
        (card) =>
          hasStrongSemanticEvidence(card) ||
          (toNumberOrNull(card?.semanticScore) ?? 0) >= 24,
      )
    ) {
      return "MEDIUM";
    }
    return "LOW";
  }
  if (ranks.every((rank) => rank >= 3)) return "HIGH";
  if (ranks.some((rank) => rank >= 2)) return "MEDIUM";
  return "LOW";
};

const clampSemanticScopeConfidence = (scopeConfidence = null, plan = {}) => {
  const normalized = String(scopeConfidence || "").trim().toUpperCase();
  if (!normalized) return null;
  if (isTraitProfileSemanticSearch(plan) && normalized === "HIGH") {
    return "MEDIUM";
  }
  return normalized;
};

const countTraitProfileSupportSignals = (card = {}) =>
  Array.isArray(card?.semanticEvidence)
    ? new Set(
        card.semanticEvidence
          .map((entry) => String(entry?.label || "").trim())
          .filter(
            (label) =>
              label === "catalog_zone_trait_overlap" ||
              label === "candidate_landmark_profile_match" ||
              label === "exact_star_match" ||
              label === "budget_rank" ||
              label === "value_rank" ||
              label === "luxury_profile" ||
              /^area_trait_/.test(label) ||
              /_description$/.test(label),
          ),
      ).size
    : 0;

const isWithinUsefulSemanticScopeRadius = (card = {}, plan = {}) => {
  const primaryPlaceTarget = collectSemanticPlaceTargets(plan)[0] || null;
  const distanceMeters = toNumberOrNull(card?.distanceMeters);
  if (!primaryPlaceTarget || distanceMeters == null) return false;
  const radiusMeters = resolveSemanticTargetRadiusMeters(primaryPlaceTarget);
  return distanceMeters <= Math.max(400, Math.round(radiusMeters * 1.25));
};

const resolveThreadPickDiversityAngle = (card = {}) =>
  String(card?.decisionExplanation?.comparisonAngle || "overall_fit")
    .trim()
    .toLowerCase();

const resolveThreadPickZoneKey = (card = {}) =>
  String(card?.semanticMatch?.matchedZoneId || "").trim().toLowerCase();

const resolveThreadPickPriceTier = (card = {}) => {
  const price = toNumberOrNull(card?.pricePerNight);
  if (price == null) return "unknown";
  if (price <= 120) return "low";
  if (price >= 280) return "high";
  return "mid";
};

const selectSemanticThreadTopPicks = ({ cards = [], plan = {}, limit = 5 } = {}) => {
  const normalizedCards = Array.isArray(cards) ? cards.filter(Boolean) : [];
  const cappedLimit = Math.max(1, Math.min(limit, 5));
  if (!normalizedCards.length) return [];
  if (!hasSemanticSearchIntent(plan) || normalizedCards.length <= cappedLimit) {
    return normalizedCards.slice(0, cappedLimit);
  }

  const traitProfileMode = isTraitProfileSemanticSearch(plan);
  const pool = normalizedCards.slice(
    0,
    traitProfileMode ? Math.min(20, normalizedCards.length) : normalizedCards.length,
  );
  const topScore = toNumberOrNull(pool[0]?.semanticScore) ?? 0;
  const scoreBandFloor = topScore - 18;
  const poolZoneKeys = uniqueOrderedStringList(
    pool.map((card) => resolveThreadPickZoneKey(card)).filter(Boolean),
    8,
  );
  const bandZoneKeys = uniqueOrderedStringList(
    pool
      .filter((card) => (toNumberOrNull(card?.semanticScore) ?? 0) >= scoreBandFloor)
      .map((card) => resolveThreadPickZoneKey(card))
      .filter(Boolean),
    8,
  );
  const targetDistinctZones = traitProfileMode
    ? Math.min(Math.max(1, bandZoneKeys.length || poolZoneKeys.length), 3, cappedLimit)
    : 0;
  const selected = [];
  const selectedIds = new Set();
  const usedZones = new Set();
  const usedAngles = new Set();
  const usedStars = new Set();
  const usedPriceTiers = new Set();
  const usedZoneAngles = new Set();
  const zoneCounts = new Map();

  const markSelected = (card) => {
    selected.push(card);
    const zoneKey = resolveThreadPickZoneKey(card);
    if (zoneKey) {
      usedZones.add(zoneKey);
      zoneCounts.set(zoneKey, (zoneCounts.get(zoneKey) || 0) + 1);
    }
    const angleKey = resolveThreadPickDiversityAngle(card);
    usedAngles.add(angleKey);
    if (zoneKey) {
      usedZoneAngles.add(`${zoneKey}::${angleKey}`);
    }
    usedStars.add(String(resolveHotelStars(card) || "unknown"));
    usedPriceTiers.add(resolveThreadPickPriceTier(card));
    selectedIds.add(String(card?.id || ""));
  };

  markSelected(pool[0]);

  const computeAdjustedScore = (card) => {
    const score = toNumberOrNull(card?.semanticScore) ?? 0;
    const zoneKey = resolveThreadPickZoneKey(card);
    const angleKey = resolveThreadPickDiversityAngle(card);
    const starsKey = String(resolveHotelStars(card) || "unknown");
    const priceTierKey = resolveThreadPickPriceTier(card);
    const zoneCount = zoneKey ? zoneCounts.get(zoneKey) || 0 : 0;
    const sameZoneSameAngle = zoneKey
      ? usedZoneAngles.has(`${zoneKey}::${angleKey}`)
      : false;
    const withinCompetitiveBand = score >= scoreBandFloor;
    let adjustedScore = score;

    if (traitProfileMode) {
      if (zoneKey) {
        adjustedScore += usedZones.has(zoneKey) ? -(10 + zoneCount * 8) : 20;
        if (
          zoneCount >= 2 &&
          withinCompetitiveBand &&
          usedZones.size < targetDistinctZones
        ) {
          adjustedScore -= 36;
        }
        if (!usedZones.has(zoneKey) && usedZones.size < targetDistinctZones) {
          adjustedScore += 12;
        }
      }
      adjustedScore += sameZoneSameAngle ? -16 : 0;
      adjustedScore += usedAngles.has(angleKey) ? -6 : 10;
      adjustedScore += usedStars.has(starsKey) ? -2 : 4;
      adjustedScore += usedPriceTiers.has(priceTierKey) ? -1 : 3;
    } else {
      if (zoneKey && !usedZones.has(zoneKey)) adjustedScore += 8;
      if (!usedAngles.has(angleKey)) adjustedScore += 4;
      if (!usedStars.has(starsKey)) adjustedScore += 2;
    }
    return adjustedScore;
  };

  while (selected.length < cappedLimit) {
    const remainingPool = pool.filter(
      (card) => !selectedIds.has(String(card?.id || "")),
    );
    if (!remainingPool.length) break;
    const nextCard = remainingPool.sort((left, right) => {
      const adjustedLeft = computeAdjustedScore(left);
      const adjustedRight = computeAdjustedScore(right);
      if (adjustedRight !== adjustedLeft) {
        return adjustedRight - adjustedLeft;
      }
      const scoreLeft = toNumberOrNull(left?.semanticScore) ?? 0;
      const scoreRight = toNumberOrNull(right?.semanticScore) ?? 0;
      if (scoreRight !== scoreLeft) return scoreRight - scoreLeft;
      return 0;
    })[0];
    if (!nextCard) break;
    markSelected(nextCard);
  }

  normalizedCards.forEach((card) => {
    if (
      selected.length < cappedLimit &&
      !selectedIds.has(String(card?.id || ""))
    ) {
      markSelected(card);
    }
  });

  return selected.slice(0, cappedLimit);
};

export const scopeChatRelevantHotelCards = ({
  cards = [],
  plan = {},
  limit = ASSISTANT_SEARCH_MAX_LIMIT,
  traceSink = null,
} = {}) => {
  const normalizedCards = Array.isArray(cards) ? cards.filter(Boolean) : [];
  const requestedLimit = clampLimit(limit, ASSISTANT_SEARCH_MAX_LIMIT);
  const scopeReason = resolveSemanticChatScopeReason(plan);
  const scopeEnabled = Boolean(scopeReason);
  const visibleLimit = scopeEnabled
    ? Math.min(requestedLimit, CHAT_VISIBLE_SEMANTIC_LIMIT)
    : requestedLimit;
  const baseScope = {
    candidateHotelCount: normalizedCards.length,
    strongHotelCount: normalizedCards.length,
    relevantHotelCount: normalizedCards.length,
    visibleHotelCount: Math.min(normalizedCards.length, visibleLimit),
    scopeMode: "NONE",
    scopeReason,
    warningMode: null,
    scopeConfidence: null,
    scopeExpansionReason: null,
  };

  if (!scopeEnabled) {
    return {
      cards: normalizedCards.slice(0, visibleLimit),
      searchScope: baseScope,
    };
  }

  // Fix A — Guard: skip SEMANTIC_CONTEXT filtering when there is no actionable signal.
  // preferenceNotes are explanatory text, not filter predicates.
  // inferenceMode NONE / RANK_ONLY explicitly means "do not filter".
  if (scopeReason === "SEMANTIC_CONTEXT") {
    const inferenceMode = resolveSemanticInferenceMode(plan);
    const hasActionableSemanticSignal =
      (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedZones) &&
        plan.semanticSearch.intentProfile.requestedZones.length > 0) ||
      (Array.isArray(plan?.semanticSearch?.intentProfile?.requestedLandmarks) &&
        plan.semanticSearch.intentProfile.requestedLandmarks.length > 0) ||
      collectSemanticPlaceTargets(plan).some(
        (t) => Number.isFinite(t?.lat) && Number.isFinite(t?.lng),
      ) ||
      (inferenceMode &&
        inferenceMode !== "NONE" &&
        inferenceMode !== "RANK_ONLY");
    if (!hasActionableSemanticSignal) {
      emitSearchTrace(traceSink, "SEMANTIC_CHAT_SCOPE_SKIPPED", {
        label: "SEMANTIC_CONTEXT scope skipped — no actionable semantic signal",
        debugLabel:
          `inferenceMode=${inferenceMode || "NONE"}, no requestedZones/Landmarks or geocoded placeTargets`,
        scopeReason,
        candidateHotelCount: normalizedCards.length,
      });
      return {
        cards: normalizedCards.slice(0, visibleLimit),
        searchScope: {
          ...baseScope,
          scopeMode: "CATALOG_MATCH",
          scopeReason: "no_actionable_signal",
          visibleHotelCount: Math.min(normalizedCards.length, visibleLimit),
        },
      };
    }
  }

  const threshold = resolveSemanticChatScopeThreshold(plan);
  const positiveRelevant = normalizedCards.filter(
    (card) => toNumberOrNull(card?.semanticScore) != null && Number(card.semanticScore) > 0,
  );
  const strongRelevant = normalizedCards.filter((card) => {
    const semanticScore = toNumberOrNull(card?.semanticScore) ?? 0;
    const traitProfileMode = isTraitProfileSemanticSearch(plan);
    return (
      hasScopeEligibleSemanticMatch(card) ||
      hasStrongSemanticEvidence(card) ||
      isWithinUsefulSemanticScopeRadius(card, plan) ||
      (!traitProfileMode && semanticScore >= threshold) ||
      (traitProfileMode &&
        semanticScore >= threshold &&
        countTraitProfileSupportSignals(card) >= 2)
    );
  });

  let relevantCards = [];
  let scopeMode = "STRICT";
  let scopeExpansionReason = null;

  if (scopeReason === "REFERENCE_SET") {
    relevantCards = normalizedCards;
  } else if (strongRelevant.length >= 5) {
    relevantCards = strongRelevant;
  } else if (strongRelevant.length >= 1) {
    const usedIds = new Set(
      strongRelevant.map((card) => String(card?.id || "")).filter(Boolean),
    );
    const filler = positiveRelevant.filter((card) => {
      const id = String(card?.id || "");
      return !id || !usedIds.has(id);
    });
    relevantCards = [...strongRelevant, ...filler.slice(0, 5 - strongRelevant.length)];
    scopeMode = "RELAXED";
    scopeExpansionReason = "INSUFFICIENT_STRONG_MATCHES";
  } else if (positiveRelevant.length) {
    relevantCards = positiveRelevant;
    scopeMode = "RELAXED";
    scopeExpansionReason = "ONLY_MEDIUM_MATCHES_AVAILABLE";
  }

  const visibleCards = relevantCards.slice(0, visibleLimit);
  const scopeConfidence = clampSemanticScopeConfidence(
    resolveSemanticScopeConfidence(visibleCards),
    plan,
  );
  const warningMode =
    scopeMode === "RELAXED"
      ? "EXPANDED_WITH_NOTICE"
      : scopeConfidence === "LOW"
        ? "APPROXIMATE_WITH_NOTICE"
        : null;
  const searchScope = {
    candidateHotelCount: normalizedCards.length,
    strongHotelCount: strongRelevant.length,
    relevantHotelCount: relevantCards.length,
    visibleHotelCount: visibleCards.length,
    scopeMode: visibleCards.length ? scopeMode : "STRICT",
    scopeReason,
    warningMode,
    scopeConfidence: visibleCards.length ? scopeConfidence : "LOW",
    scopeExpansionReason:
      visibleCards.length && scopeMode === "RELAXED"
        ? scopeExpansionReason
        : visibleCards.length
          ? null
          : "NO_RELEVANT_MATCHES",
  };

  const threadTopPickIds = selectSemanticThreadTopPicks({
    cards: visibleCards,
    plan,
    limit: Math.min(5, visibleCards.length),
  }).map((card) => String(card?.id || "")).filter(Boolean);
  if (threadTopPickIds.length) {
    searchScope.threadTopPickIds = threadTopPickIds;
  }

  if (!visibleCards.length) {
    emitSearchTrace(traceSink, "SEMANTIC_CHAT_SCOPE_EMPTY", {
      label: "No catalog hotels stayed relevant after semantic scoping",
      debugLabel:
        `Semantic scope ${scopeReason} kept 0 of ${normalizedCards.length} candidate hotel(s)`,
      ...searchScope,
      threshold,
    });

    // Fix B — Safety net: never return 0 visible hotels when candidates exist.
    // Expand to full candidate list and mark as approximate so the UI can notice.
    if (normalizedCards.length > 0) {
      const fallbackCards = normalizedCards.slice(0, visibleLimit);
      const fallbackScope = {
        ...searchScope,
        visibleHotelCount: fallbackCards.length,
        scopeMode: "EXPAND_FALLBACK",
        warningMode: "APPROXIMATE_WITH_NOTICE",
        scopeExpansionReason: "zero_results_safety_net",
      };
      emitSearchTrace(traceSink, "SEMANTIC_CHAT_SCOPE_FALLBACK_EXPANDED", {
        label: "Zero-result safety net: showing all catalog candidates",
        debugLabel:
          `Expanded from 0 to ${fallbackCards.length} hotel(s) after semantic scope produced no matches`,
        ...fallbackScope,
      });
      return { cards: fallbackCards, searchScope: fallbackScope };
    }

    return { cards: [], searchScope };
  }

  emitSearchTrace(
    traceSink,
    scopeMode === "RELAXED"
      ? "SEMANTIC_CHAT_SCOPE_RELAXED"
      : "SEMANTIC_CHAT_SCOPE_APPLIED",
    {
      label:
        scopeMode === "RELAXED"
          ? "Showing the closest semantic matches available with scope expansion"
          : "Scoped chat results to the hotels that match this request",
      debugLabel:
        `Semantic scope ${scopeReason} kept ${visibleCards.length}/${normalizedCards.length} visible hotel(s)` +
        ` (${relevantCards.length} relevant before cap, mode=${scopeMode}, confidence=${scopeConfidence})`,
      ...searchScope,
      threshold,
    },
  );

  const defaultThreadPickIds = visibleCards
    .slice(0, Math.min(5, visibleCards.length))
    .map((card) => String(card?.id || ""))
    .filter(Boolean);
  if (
    threadTopPickIds.length &&
    JSON.stringify(threadTopPickIds) !== JSON.stringify(defaultThreadPickIds)
  ) {
    emitSearchTrace(traceSink, "SEMANTIC_TOP_PICKS_DIVERSIFIED", {
      beforeIds: defaultThreadPickIds,
      afterIds: threadTopPickIds,
      visibleHotelCount: visibleCards.length,
      scopeReason,
    });
  }

  return { cards: visibleCards, searchScope };
};

const finalizeScopedHotelSearchResult = ({
  cards = [],
  plan = {},
  limit = ASSISTANT_SEARCH_MAX_LIMIT,
  traceSink = null,
  matchType = "EXACT",
  metadata = {},
} = {}) => {
  const searchScopePatch =
    metadata?.searchScopePatch && typeof metadata.searchScopePatch === "object"
      ? metadata.searchScopePatch
      : null;
  const { searchScopePatch: _searchScopePatch, ...restMetadata } =
    metadata && typeof metadata === "object" ? metadata : {};
  const scoped = scopeChatRelevantHotelCards({
    cards,
    plan,
    limit,
    traceSink,
  });
  return {
    items: scoped.cards,
    matchType,
    searchScope: searchScopePatch
      ? {
          ...scoped.searchScope,
          ...searchScopePatch,
        }
      : scoped.searchScope,
    ...restMetadata,
  };
};

const buildSemanticSignalsForHotel = ({
  plan,
  hotel,
  neighborhoodHints = [],
  priceContext = {},
  candidateHotelNames = [],
  catalogContext = null,
}) => {
  const language = resolveSemanticLanguage(plan);
  const blob = buildHotelSemanticTextBlob(hotel);
  const descriptionBlob = normalizeSemanticKey(
    flattenHotelDescriptionTexts(hotel).join(" "),
  );
  const resolvedCatalogContext =
    catalogContext && typeof catalogContext === "object"
      ? catalogContext
      : resolveSemanticCatalogContext({ plan });
  const intentProfile =
    resolvedCatalogContext?.profile &&
    typeof resolvedCatalogContext.profile === "object"
      ? resolvedCatalogContext.profile
      : {};
  const requestedAreaTraits = Array.isArray(intentProfile?.userRequestedAreaTraits)
    ? intentProfile.userRequestedAreaTraits
    : Array.isArray(intentProfile?.requestedAreaTraits)
      ? intentProfile.requestedAreaTraits
      : [];
  const explicitGeoMode = isExplicitSemanticGeoSearch(plan);
  const traitProfileMode = isTraitProfileSemanticSearch(plan);
  const exactStarRatings = normalizeExactStarRatings(
    plan?.starRatings || plan?.hotelFilters?.starRatings,
  );
  const hotelStars = resolveHotelStars(hotel);
  const nightlyPrice = toNumberOrNull(hotel?.pricePerNight);
  const placeTokens = explicitGeoMode ? collectSemanticPlaceTokens(plan) : [];
  const semanticPlaceTargets = explicitGeoMode ? collectSemanticPlaceTargets(plan) : [];
  const matchedPlaceToken = explicitGeoMode
    ? findMatchedSemanticPlaceToken(blob, placeTokens)
    : null;
  const primaryPlaceTarget = explicitGeoMode ? semanticPlaceTargets[0] || null : null;
  const matchedPlaceTargetFromPlan =
    explicitGeoMode ? matchedPlaceToken?.target || primaryPlaceTarget : null;
  const targetRadiusMeters =
    toNumberOrNull(matchedPlaceTargetFromPlan?.radiusMeters) ??
    (matchedPlaceTargetFromPlan?.type === "LANDMARK"
      ? 1600
      : matchedPlaceTargetFromPlan?.type === "NEIGHBORHOOD" ||
          matchedPlaceTargetFromPlan?.type === "DISTRICT"
        ? 2800
        : matchedPlaceTargetFromPlan?.type === "WATERFRONT"
          ? 3500
          : 2200);
  const placeDistanceMeters = matchedPlaceTargetFromPlan
    ? computeDistanceMetersToPlaceTarget(hotel, matchedPlaceTargetFromPlan)
    : null;
  const explicitZoneMatch = resolveBestCatalogEntityMatch({
    hotel,
    blob,
    entries: resolvedCatalogContext?.explicitZones,
    type: "ZONE",
  });
  const candidateZoneMatch = resolveBestCatalogEntityMatch({
    hotel,
    blob,
    entries: resolvedCatalogContext?.candidateZones,
    type: "ZONE",
  });
  const matchedZone = explicitZoneMatch || candidateZoneMatch;
  const explicitLandmarkMatch = resolveBestCatalogEntityMatch({
    hotel,
    blob,
    entries: resolvedCatalogContext?.explicitLandmarks,
    type: "LANDMARK",
  });
  const candidateLandmarkMatch = resolveBestCatalogEntityMatch({
    hotel,
    blob,
    entries: resolvedCatalogContext?.candidateLandmarks,
    type: "LANDMARK",
  });
  const matchedLandmark = explicitGeoMode
    ? explicitLandmarkMatch || candidateLandmarkMatch
    : explicitLandmarkMatch;
  const zoneTraitOverlap = countCatalogTraitOverlap(
    requestedAreaTraits,
    matchedZone?.entry,
  );
  const reasons = [];
  const semanticEvidence = [];
  let score = 0;

  if (exactStarRatings.length && hotelStars != null && exactStarRatings.includes(hotelStars)) {
    score += 70;
    reasons.push(
      buildLocalizedHotelReason(language, "exact_stars", { stars: hotelStars }),
    );
    semanticEvidence.push({
      type: "verified_structured",
      label: "exact_star_match",
      value: String(hotelStars),
    });
  }

  const matchedNeighborhood =
    buildCatalogEntityLabel(matchedZone?.entry) ||
    resolveMatchedNeighborhood(blob, neighborhoodHints);
  const modelNameMatch = resolveBestModelCandidateMatch(
    hotel?.name,
    candidateHotelNames,
  );

  if (explicitGeoMode && matchedPlaceTargetFromPlan) {
    const placeLabel = formatSemanticPlaceLabel(matchedPlaceTargetFromPlan);
    const hasExactPlaceTextMatch = Boolean(matchedPlaceToken?.token);
    const hasGeoMatch =
      placeDistanceMeters != null &&
      placeDistanceMeters <= Math.max(400, Math.round(targetRadiusMeters * 1.25));

    if (hasExactPlaceTextMatch) {
      score += plan?.geoIntent === "IN_AREA" ? 58 : 46;
      reasons.push(
        buildLocalizedHotelReason(
          language,
          plan?.geoIntent === "IN_AREA" ? "inside_area" : "near_place",
          { area: placeLabel, place: placeLabel },
        ),
      );
      semanticEvidence.push({
        type: "verified_text",
        label: "place_text_match",
        value: placeLabel,
      });
    }

    if (hasGeoMatch) {
      score +=
        placeDistanceMeters <= targetRadiusMeters
          ? plan?.geoIntent === "IN_AREA"
            ? 72
            : 64
          : 38;
      reasons.push(
        buildLocalizedHotelReason(
          language,
          placeDistanceMeters <= targetRadiusMeters &&
            plan?.geoIntent === "IN_AREA"
            ? "inside_area"
            : "near_place",
          { area: placeLabel, place: placeLabel },
        ),
      );
      semanticEvidence.push({
        type: "verified_geo",
        label: "place_distance_match",
        value: placeLabel,
      });
      } else if (
      placeDistanceMeters != null &&
      placeDistanceMeters <= Math.max(8000, targetRadiusMeters * 3)
    ) {
      score += 16;
      semanticEvidence.push({
        type: "weak_hint",
        label: "place_distance_hint",
        value: placeLabel,
      });
    }
  }

  if (matchedLandmark) {
    const landmarkLabel = buildCatalogEntityLabel(matchedLandmark.entry);
    if (matchedLandmark.textMatched) {
      score += explicitGeoMode ? 54 : 28;
      if (explicitGeoMode) {
        reasons.push(
          buildLocalizedHotelReason(language, "near_place", {
            place: landmarkLabel,
          }),
        );
      }
      semanticEvidence.push({
        type: explicitGeoMode ? "verified_text" : "verified_structured",
        label: explicitGeoMode
          ? "catalog_landmark_text_match"
          : "candidate_landmark_profile_match",
        value: landmarkLabel,
      });
    }
    if (matchedLandmark.insideRadius) {
      score += explicitGeoMode ? 68 : 22;
      if (explicitGeoMode) {
        reasons.push(
          buildLocalizedHotelReason(language, "near_place", {
            place: landmarkLabel,
          }),
        );
      }
      semanticEvidence.push({
        type: explicitGeoMode ? "verified_geo" : "weak_hint",
        label: explicitGeoMode
          ? "catalog_landmark_distance_match"
          : "candidate_landmark_distance_hint",
        value: landmarkLabel,
      });
    } else if (matchedLandmark.nearbyRadius) {
      score += 20;
      semanticEvidence.push({
        type: "weak_hint",
        label: "catalog_landmark_distance_hint",
        value: landmarkLabel,
      });
    }
  }

  if (matchedZone) {
    const zoneLabel = buildCatalogEntityLabel(matchedZone.entry);
    if (matchedZone.textMatched) {
      score += matchedZone === explicitZoneMatch ? 52 : traitProfileMode ? 26 : 40;
      reasons.push(
        buildLocalizedHotelReason(
          language,
          explicitGeoMode
            ? plan?.geoIntent === "IN_AREA"
              ? "inside_area"
              : "area_match"
            : "area_match",
          { area: zoneLabel, place: zoneLabel },
        ),
      );
      semanticEvidence.push({
        type: explicitGeoMode ? "verified_text" : "verified_structured",
        label: explicitGeoMode
          ? "catalog_zone_text_match"
          : "candidate_zone_profile_match",
        value: zoneLabel,
      });
    }
    if (matchedZone.insideRadius) {
      score += matchedZone === explicitZoneMatch ? 62 : traitProfileMode ? 20 : 48;
      if (explicitGeoMode) {
        reasons.push(
          buildLocalizedHotelReason(
            language,
            plan?.geoIntent === "IN_AREA" ? "inside_area" : "area_match",
            { area: zoneLabel, place: zoneLabel },
          ),
        );
      }
      semanticEvidence.push({
        type: explicitGeoMode ? "verified_geo" : "weak_hint",
        label: explicitGeoMode
          ? "catalog_zone_distance_match"
          : "candidate_zone_distance_hint",
        value: zoneLabel,
      });
    } else if (matchedZone.nearbyRadius) {
      score += 18;
      semanticEvidence.push({
        type: "weak_hint",
        label: "catalog_zone_distance_hint",
        value: zoneLabel,
      });
    }
    if (zoneTraitOverlap.length) {
      score += Math.min(40, zoneTraitOverlap.length * 14);
      zoneTraitOverlap.slice(0, 2).forEach((trait) => {
        const label = resolveAreaTraitLabel(language, trait);
        if (!label) return;
        reasons.push(
          buildLocalizedHotelReason(language, "area_trait", { trait: label }),
        );
      });
      semanticEvidence.push({
        type: "verified_structured",
        label: "catalog_zone_trait_overlap",
        value: zoneLabel,
      });
    }
  }

  if (plan?.viewIntent === "RIVER_VIEW") {
    const textHasRiver = /\b(river|rio|rio de la plata)\b/.test(descriptionBlob);
    const zoneHasWaterfrontTrait = Boolean(
      matchedZone?.entry?.traits?.includes("WATERFRONT_AREA"),
    );
    if (textHasRiver) {
      score += 48;
      reasons.push(buildLocalizedHotelReason(language, "river_view_text"));
      semanticEvidence.push({
        type: "verified_text",
        label: "river_view_description",
      });
    } else if (zoneHasWaterfrontTrait || matchedNeighborhood) {
      score += 32;
      reasons.push(
        buildLocalizedHotelReason(language, "area_match", {
          area: buildCatalogEntityLabel(matchedZone?.entry) || matchedNeighborhood,
        }),
      );
      semanticEvidence.push({
        type: "verified_geo",
        label: "waterfront_neighborhood",
        value: buildCatalogEntityLabel(matchedZone?.entry) || matchedNeighborhood,
      });
    } else if (modelNameMatch) {
      score += 18;
      semanticEvidence.push({
        type: "web_candidate_matched",
        label: "river_view_candidate",
        value: modelNameMatch.candidate,
      });
    }
  } else if (plan?.viewIntent === "WATER_VIEW") {
    const textHasWater =
      /\b(waterfront|water view|water|harbor|marina|port|puerto|costanera)\b/.test(
        descriptionBlob,
      );
    const zoneHasWaterfrontTrait = Boolean(
      matchedZone?.entry?.traits?.includes("WATERFRONT_AREA"),
    );
    if (textHasWater) {
      score += 44;
      reasons.push(buildLocalizedHotelReason(language, "water_view_text"));
      semanticEvidence.push({
        type: "verified_text",
        label: "water_view_description",
      });
    } else if (zoneHasWaterfrontTrait || matchedNeighborhood) {
      score += 28;
      reasons.push(
        buildLocalizedHotelReason(language, "area_match", {
          area: buildCatalogEntityLabel(matchedZone?.entry) || matchedNeighborhood,
        }),
      );
      semanticEvidence.push({
        type: "verified_geo",
        label: "waterfront_neighborhood",
        value: buildCatalogEntityLabel(matchedZone?.entry) || matchedNeighborhood,
      });
    } else if (modelNameMatch) {
      score += 16;
      semanticEvidence.push({
        type: "web_candidate_matched",
        label: "water_view_candidate",
        value: modelNameMatch.candidate,
      });
    }
  } else if (plan?.viewIntent === "SEA_VIEW") {
    if (/\b(sea|ocean|mar)\b/.test(descriptionBlob)) {
      score += 44;
      reasons.push(buildLocalizedHotelReason(language, "sea_view_text"));
      semanticEvidence.push({
        type: "verified_text",
        label: "sea_view_description",
      });
    } else if (modelNameMatch) {
      score += 16;
      semanticEvidence.push({
        type: "web_candidate_matched",
        label: "sea_view_candidate",
        value: modelNameMatch.candidate,
      });
    }
  }

  if (plan?.areaIntent === "GOOD_AREA" && (matchedZone || matchedNeighborhood)) {
    score += 34;
    reasons.push(
      buildLocalizedHotelReason(language, "area_match", {
        area: buildCatalogEntityLabel(matchedZone?.entry) || matchedNeighborhood,
      }),
    );
    semanticEvidence.push({
      type: "verified_geo",
      label: "good_area_neighborhood",
      value: buildCatalogEntityLabel(matchedZone?.entry) || matchedNeighborhood,
    });
  }

  const areaTraits = Array.from(
    new Set([
      ...(Array.isArray(plan?.areaTraits) ? plan.areaTraits : []),
      ...requestedAreaTraits,
    ]),
  );
  areaTraits.forEach((trait) => {
    const label = resolveAreaTraitLabel(language, trait);
    if (!label) return;
    let matched = false;
    switch (String(trait || "").trim().toUpperCase()) {
      case "GOOD_AREA":
      case "SAFE":
        matched =
          Boolean(matchedZone) ||
          Boolean(matchedNeighborhood || (explicitGeoMode ? matchedPlaceTargetFromPlan : null));
        break;
      case "QUIET":
        matched =
          Boolean(matchedZone?.entry?.traits?.includes("QUIET")) ||
          /\b(quiet|silent|residential|tranquil|tranquilo|tranquila)\b/.test(
            blob,
          );
        break;
      case "NIGHTLIFE":
        matched =
          Boolean(matchedZone?.entry?.traits?.includes("NIGHTLIFE")) ||
          /\b(nightlife|bars|restaurants|trendy|vibrant|vida nocturna)\b/.test(
            blob,
          );
        break;
      case "WALKABLE":
        matched =
          Boolean(matchedZone?.entry?.traits?.includes("WALKABLE")) ||
          /\b(walkable|walk|steps from|walking distance|a pasos|a pie)\b/.test(
            blob,
          );
        break;
      case "FAMILY":
        matched =
          Boolean(matchedZone?.entry?.traits?.includes("FAMILY")) ||
          /\b(family|kids|children|childcare|babysitting|family room)\b/.test(
            blob,
          );
        break;
      case "UPSCALE_AREA":
        matched =
          Boolean(matchedZone?.entry?.traits?.includes("UPSCALE_AREA")) ||
          hotelStars >= 5 ||
          hotel?.preferred ||
          hotel?.exclusive ||
          /\b(luxury|premium|exclusive|upscale)\b/.test(blob);
        break;
      case "BUSINESS":
        matched =
          Boolean(matchedZone?.entry?.traits?.includes("BUSINESS")) ||
          /\b(business|corporate|conference|work trip)\b/.test(blob);
        break;
      case "CENTRAL":
        matched =
          Boolean(matchedZone?.entry?.traits?.includes("CENTRAL")) ||
          /\b(city center|downtown|centro|microcentro|central)\b/.test(blob);
        break;
      case "CULTURAL":
        matched =
          Boolean(matchedZone?.entry?.traits?.includes("CULTURAL")) ||
          /\b(cultural|historic|museum|museo|art|arte|heritage)\b/.test(blob);
        break;
      case "WATERFRONT_AREA":
        matched =
          Boolean(matchedZone?.entry?.traits?.includes("WATERFRONT_AREA")) ||
          /\b(waterfront|river|rio|sea|ocean|marina|harbor|costanera)\b/.test(
            blob,
          );
        break;
      case "LUXURY":
        matched =
          hotelStars >= 5 ||
          hotel?.preferred ||
          hotel?.exclusive ||
          /\b(luxury|premium|exclusive)\b/.test(blob);
        break;
      default:
        matched = false;
        break;
    }
    if (!matched) return;
    score +=
      trait === "GOOD_AREA" ||
      trait === "SAFE" ||
      trait === "UPSCALE_AREA"
        ? 18
        : 12;
    reasons.push(
      buildLocalizedHotelReason(language, "area_trait", { trait: label }),
    );
    semanticEvidence.push({
      type:
        traitProfileMode
          ? "verified_structured"
          : trait === "GOOD_AREA" ||
              trait === "SAFE" ||
              trait === "UPSCALE_AREA"
            ? "verified_geo"
            : "verified_text",
      label: `area_trait_${String(trait || "").trim().toLowerCase()}`,
      value: label,
    });
  });

  if (
    plan?.areaIntent === "CITY_CENTER" &&
    (Boolean(matchedZone?.entry?.traits?.includes("CENTRAL")) ||
      /\b(city center|downtown|centro|microcentro)\b/.test(blob))
  ) {
    score += 24;
    reasons.push(buildLocalizedHotelReason(language, "center_hint"));
    semanticEvidence.push({
      type: "verified_geo",
      label: "city_center_hint",
    });
  }

  if (
    plan?.qualityIntent === "BUDGET" &&
    nightlyPrice != null &&
    priceContext?.q1 != null &&
    nightlyPrice <= priceContext.q1
  ) {
    score += 30;
    reasons.push(buildLocalizedHotelReason(language, "budget"));
    semanticEvidence.push({
      type: "verified_structured",
      label: "budget_rank",
      value: String(nightlyPrice),
    });
  }

  if (
    plan?.qualityIntent === "VALUE" &&
    nightlyPrice != null &&
    priceContext?.median != null &&
    nightlyPrice <= priceContext.median &&
    hotelStars != null &&
    hotelStars >= 4
  ) {
    score += 28;
    reasons.push(buildLocalizedHotelReason(language, "value"));
    semanticEvidence.push({
      type: "verified_structured",
      label: "value_rank",
      value: String(nightlyPrice),
    });
  }

  if (
    plan?.qualityIntent === "LUXURY" &&
    (hotelStars >= 5 ||
      hotel?.preferred ||
      hotel?.exclusive ||
      (nightlyPrice != null &&
        priceContext?.q3 != null &&
        nightlyPrice >= priceContext.q3))
  ) {
    score += 26;
    reasons.push(buildLocalizedHotelReason(language, "luxury"));
    semanticEvidence.push({
      type: "verified_structured",
      label: "luxury_profile",
    });
  }

  const distanceMeters = [
    toNumberOrNull(placeDistanceMeters),
    toNumberOrNull(matchedLandmark?.distanceMeters),
    toNumberOrNull(matchedZone?.distanceMeters),
  ]
    .filter((value) => value != null)
    .sort((left, right) => left - right)[0] ?? null;
  const matchedPlaceTarget =
    explicitGeoMode &&
    matchedPlaceTargetFromPlan &&
    formatSemanticPlaceLabel(matchedPlaceTargetFromPlan)
      ? {
          rawText: matchedPlaceTargetFromPlan.rawText || null,
          normalizedName: matchedPlaceTargetFromPlan.normalizedName || null,
          type: matchedPlaceTargetFromPlan.type || null,
        }
      : explicitGeoMode && matchedLandmark
        ? {
            rawText: buildCatalogEntityLabel(matchedLandmark.entry),
            normalizedName: buildCatalogEntityLabel(matchedLandmark.entry),
            type: "LANDMARK",
          }
        : explicitGeoMode && matchedZone
          ? {
              rawText: buildCatalogEntityLabel(matchedZone.entry),
              normalizedName: buildCatalogEntityLabel(matchedZone.entry),
              type: "NEIGHBORHOOD",
            }
          : null;
  const confidence = resolveSemanticMatchConfidence({
    score,
    semanticEvidence,
    matchedZone,
    matchedLandmark,
    plan,
  });
  const decisionExplanation = buildDecisionExplanation({
    language,
    plan,
    requestedAreaTraits,
    matchedZone,
    matchedLandmark,
    zoneTraitOverlap,
    semanticEvidence,
    hotelStars,
    nightlyPrice,
    priceContext,
    confidence,
  });

  return {
    score,
    reasons: uniqueReasonList(reasons, 5),
    semanticEvidence: semanticEvidence.slice(0, 5),
    distanceMeters,
    matchedPlaceTarget,
    semanticMatch: {
      score,
      confidence,
      matchedZoneId: matchedZone?.entry?.id ?? null,
      matchedLandmarkId: matchedLandmark?.entry?.id ?? null,
      evidence: semanticEvidence.slice(0, 6),
      scopeEligible: resolveSemanticScopeEligibility({
        plan,
        semanticEvidence,
        semanticScore: score,
        matchedZone,
        matchedLandmark,
        modelNameMatch,
        zoneTraitOverlapCount: zoneTraitOverlap.length,
      }),
    },
    decisionExplanation,
  };
};

const applySemanticHotelRanking = (cards = [], plan = {}) => {
  if (!Array.isArray(cards) || !cards.length) return [];
  const priceContext = buildSemanticPriceContext(cards);
  const catalogContext = resolveSemanticCatalogContext({ plan });
  const neighborhoodHints = collectSemanticNeighborhoodHints(plan, catalogContext);
  const candidateHotelNames = Array.isArray(plan?.semanticSearch?.candidateHotelNames)
    ? plan.semanticSearch.candidateHotelNames
    : [];
  const semanticActive = hasSemanticSearchIntent(plan);

  const annotated = cards.map((hotel, index) => {
    const semantic = buildSemanticSignalsForHotel({
      plan,
      hotel,
      neighborhoodHints,
      priceContext,
      candidateHotelNames,
      catalogContext,
    });
    const mergedReasons = sanitizeVisibleGeoReasons(
      {
        ...hotel,
        matchedPlaceTarget: semantic.matchedPlaceTarget || hotel?.matchedPlaceTarget || null,
        semanticEvidence: semantic.semanticEvidence,
        semanticMatch: semantic.semanticMatch,
      },
      [...semantic.reasons, ...(Array.isArray(hotel?.matchReasons) ? hotel.matchReasons : [])],
      6,
    );
    const safeShortReason =
      semantic.decisionExplanation?.primaryReasonText &&
      !isGeoReasonText(
        semantic.decisionExplanation.primaryReasonText,
        semantic.matchedPlaceTarget?.normalizedName || semantic.matchedPlaceTarget?.rawText || null,
      )
        ? semantic.decisionExplanation.primaryReasonText
        : mergedReasons[0] || null;
    return {
      ...hotel,
      semanticScore: semantic.score,
      semanticEvidence: semantic.semanticEvidence,
      distanceMeters:
        semantic.distanceMeters != null ? semantic.distanceMeters : null,
      matchedPlaceTarget: semantic.matchedPlaceTarget || null,
      semanticMatch:
        semantic.semanticMatch && typeof semantic.semanticMatch === "object"
          ? semantic.semanticMatch
          : null,
      decisionExplanation:
        semantic.decisionExplanation && typeof semantic.decisionExplanation === "object"
          ? semantic.decisionExplanation
          : null,
      matchReasons: mergedReasons,
      shortReason: safeShortReason,
      __baseIndex: index,
    };
  });

  if (!semanticActive) {
    return annotated.map(({ __baseIndex: _drop, ...hotel }) => hotel);
  }

  annotated.sort((left, right) => {
    if (right.semanticScore !== left.semanticScore) {
      return right.semanticScore - left.semanticScore;
    }
    return left.__baseIndex - right.__baseIndex;
  });

  return annotated.map(({ __baseIndex: _drop, ...hotel }) => hotel);
};

const emitSemanticCandidateMatchTrace = (
  traceSink,
  plan = {},
  cards = [],
) => {
  const candidateHotelNames = Array.isArray(plan?.semanticSearch?.candidateHotelNames)
    ? plan.semanticSearch.candidateHotelNames
    : [];
  if (!candidateHotelNames.length) return;
  const matchedCount = (Array.isArray(cards) ? cards : []).filter((card) =>
    Array.isArray(card?.semanticEvidence)
      ? card.semanticEvidence.some(
          (entry) => entry?.type === "web_candidate_matched",
        )
      : false,
  ).length;
  if (!matchedCount) {
    emitSearchTrace(traceSink, "SEMANTIC_LOCAL_MATCH_REJECTED", {
      reason: "no_strict_catalog_match",
      candidateHotelCount: candidateHotelNames.length,
    });
  }
};

const mapHotelCardsForOutput = ({
  cards = [],
  plan = {},
  limit = ASSISTANT_SEARCH_MAX_LIMIT,
  extraReasons = [],
} = {}) =>
  cards
    .map((hotel) => {
      const baseReasons = Array.isArray(hotel?.matchReasons)
        ? hotel.matchReasons
        : buildHotelMatchReasons({ plan, hotel });
      const mergedReasons = sanitizeVisibleGeoReasons(
        hotel,
        [...baseReasons, ...(Array.isArray(extraReasons) ? extraReasons : [])],
        6,
      );
      return {
        ...hotel,
        stars: resolveHotelStars(hotel),
        inventoryType: "HOTEL",
        matchReasons: mergedReasons,
        shortReason:
          (!isGeoReasonText(
            hotel?.shortReason,
            hotel?.matchedPlaceTarget?.normalizedName || hotel?.matchedPlaceTarget?.rawText || null,
          )
            ? hotel?.shortReason
            : null) ||
          mergedReasons[0] ||
          null,
        semanticEvidence: Array.isArray(hotel?.semanticEvidence)
          ? hotel.semanticEvidence.slice(0, 5)
          : [],
        semanticMatch:
          hotel?.semanticMatch && typeof hotel.semanticMatch === "object"
            ? {
                score:
                  toNumberOrNull(hotel.semanticMatch.score) != null
                    ? Number(hotel.semanticMatch.score)
                    : null,
                confidence: hotel.semanticMatch.confidence ?? null,
                matchedZoneId: hotel.semanticMatch.matchedZoneId ?? null,
                matchedLandmarkId: hotel.semanticMatch.matchedLandmarkId ?? null,
                scopeEligible: hotel.semanticMatch.scopeEligible === true,
                evidence: Array.isArray(hotel.semanticMatch.evidence)
                  ? hotel.semanticMatch.evidence.slice(0, 6)
                  : [],
              }
            : null,
        decisionExplanation:
          hotel?.decisionExplanation && typeof hotel.decisionExplanation === "object"
            ? {
                primaryReasonType:
                  hotel.decisionExplanation.primaryReasonType ?? null,
                primaryReasonText:
                  hotel.decisionExplanation.primaryReasonText ?? null,
                secondaryReasonType:
                  hotel.decisionExplanation.secondaryReasonType ?? null,
                secondaryReasonText:
                  hotel.decisionExplanation.secondaryReasonText ?? null,
                comparisonAngle:
                  hotel.decisionExplanation.comparisonAngle ?? null,
                allowedAngles: Array.isArray(hotel.decisionExplanation.allowedAngles)
                  ? hotel.decisionExplanation.allowedAngles.slice(0, 8)
                  : [],
                angleTexts:
                  hotel.decisionExplanation.angleTexts &&
                  typeof hotel.decisionExplanation.angleTexts === "object"
                    ? { ...hotel.decisionExplanation.angleTexts }
                    : {},
                signals:
                  hotel.decisionExplanation.signals &&
                  typeof hotel.decisionExplanation.signals === "object"
                    ? { ...hotel.decisionExplanation.signals }
                    : {},
                allowedClaims: Array.isArray(hotel.decisionExplanation.allowedClaims)
                  ? hotel.decisionExplanation.allowedClaims.slice(0, 12)
                  : [],
                canMentionZone:
                  hotel.decisionExplanation.canMentionZone === true,
                mentionedZoneLabel:
                  hotel.decisionExplanation.mentionedZoneLabel ?? null,
                confidence: hotel.decisionExplanation.confidence ?? null,
              }
            : null,
      };
    })
    .slice(0, limit);

const buildStringFilter = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  const normalized = stripDiacritics(trimmed);
  return { [iLikeOp]: `%${normalized}%` };
};

const hasLocationConstraint = (location = {}) => {
  if (!location || typeof location !== "object") return false;
  const city = typeof location.city === "string" ? location.city.trim() : "";
  const state = typeof location.state === "string" ? location.state.trim() : "";
  const country = typeof location.country === "string" ? location.country.trim() : "";
  const landmark = typeof location.landmark === "string" ? location.landmark.trim() : "";
  const lat = toNumberOrNull(location.lat);
  const lng = toNumberOrNull(location.lng ?? location.lon);
  return Boolean(city || state || country || landmark || (lat != null && lng != null));
};

const resolveGuestTotal = (plan) => {
  const adults = Number(plan?.guests?.adults);
  const children = Number(plan?.guests?.children);
  const other = Number(plan?.guests?.others);
  const fallback = Number(plan?.guests?.total);
  const sum = [adults, children, other].reduce(
    (acc, value) => (Number.isFinite(value) && value > 0 ? acc + value : acc),
    0
  );
  if (sum > 0) return sum;
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return null;
};

const resolveBudgetMax = (plan) => toNumberOrNull(plan?.budget?.max);

/**
 * Resolves a proximity anchor for hotel sorting.
 * Returns { type: "CITY_CENTER", anchor: {lat, lng} }
 * or      { type: "NEARBY_INTEREST", places: [{location:{lat,lng}, ...}] }
 * or null when no proximity intent is present.
 */
const resolveProximityAnchor = async (plan) => {
  const primaryPlaceTarget = collectSemanticPlaceTargets(plan)[0] || null;
  const areaPrefs = Array.isArray(plan?.preferences?.areaPreference)
    ? plan.preferences.areaPreference.map((s) => String(s || "").toUpperCase())
    : [];
  const nearbyInterest =
    typeof plan?.preferences?.nearbyInterest === "string" && plan.preferences.nearbyInterest.trim().length
      ? plan.preferences.nearbyInterest.trim()
      : null;
  const city = plan?.location?.city || null;
  const country = plan?.location?.country || null;

  if (
    primaryPlaceTarget &&
    primaryPlaceTarget.lat != null &&
    primaryPlaceTarget.lng != null
  ) {
    return {
      type: "PLACE_TARGET",
      target: {
        name: formatSemanticPlaceLabel(primaryPlaceTarget),
        lat: primaryPlaceTarget.lat,
        lng: primaryPlaceTarget.lng,
        radiusMeters: primaryPlaceTarget.radiusMeters ?? null,
      },
    };
  }

  // CITY_CENTER: geocode "city center {city}, {country}"
  if (areaPrefs.includes("CITY_CENTER") && city) {
    const query = ["city center", city, country].filter(Boolean).join(", ");
    try {
      const poi = await resolvePoiToCoordinates(query);
      if (poi?.lat && poi?.lng) {
        console.log(`[search:hotels] CITY_CENTER anchor: ${poi.lat},${poi.lng} (${poi.name})`);
        return { type: "CITY_CENTER", anchor: { lat: poi.lat, lng: poi.lng } };
      }
    } catch (err) {
      console.warn("[search:hotels] CITY_CENTER geocode failed", err?.message);
    }
  }

  // NEARBY_INTEREST: geocode city → find nearby places matching the interest
  if (nearbyInterest && city) {
    const cityQuery = [city, country].filter(Boolean).join(", ");
    try {
      const cityPoi = await resolvePoiToCoordinates(cityQuery);
      if (cityPoi?.lat && cityPoi?.lng) {
        const places = await getNearbyPlaces({
          location: { lat: cityPoi.lat, lng: cityPoi.lng },
          radiusKm: 10,
          keyword: nearbyInterest,
          limit: 6,
        });
        const validPlaces = places.filter((p) => p?.location?.lat && p?.location?.lng);
        if (validPlaces.length) {
          console.log(`[search:hotels] nearbyInterest "${nearbyInterest}": ${validPlaces.length} places found`);
          return { type: "NEARBY_INTEREST", places: validPlaces };
        }
      }
    } catch (err) {
      console.warn("[search:hotels] nearbyInterest resolve failed", err?.message);
    }
  }

  return null;
};

/**
 * Sorts hotel cards by proximity to an anchor resolved by resolveProximityAnchor().
 * Hotels without geoPoint go to the end.
 */
const sortByProximity = (cards, proximityAnchor) => {
  if (!proximityAnchor) return cards;

  const getDistanceForCard = (card) => {
    const gp = card.geoPoint;
    if (!gp?.lat || !gp?.lng) return Number.MAX_SAFE_INTEGER;

    if (proximityAnchor.type === "CITY_CENTER") {
      return computeDistanceKm(gp, proximityAnchor.anchor) ?? Number.MAX_SAFE_INTEGER;
    }

    if (proximityAnchor.type === "PLACE_TARGET") {
      return (
        computeDistanceKm(gp, {
          lat: proximityAnchor.target?.lat,
          lng: proximityAnchor.target?.lng,
        }) ?? Number.MAX_SAFE_INTEGER
      );
    }

    if (proximityAnchor.type === "NEARBY_INTEREST") {
      // Minimum distance to any of the matching places
      let minDist = Number.MAX_SAFE_INTEGER;
      for (const place of proximityAnchor.places) {
        if (!place.location?.lat || !place.location?.lng) continue;
        const d = computeDistanceKm(gp, place.location);
        if (d != null && d < minDist) minDist = d;
      }
      return minDist;
    }

    return Number.MAX_SAFE_INTEGER;
  };

  return [...cards].sort((a, b) => getDistanceForCard(a) - getDistanceForCard(b));
};

const resolveNearbyFallbackOriginalDestination = (plan = {}) => {
  const primaryPlaceTarget = collectSemanticPlaceTargets(plan)[0] || null;
  return (
    formatSemanticPlaceLabel(primaryPlaceTarget) ||
    (typeof plan?.location?.landmark === "string" && plan.location.landmark.trim()
      ? plan.location.landmark.trim()
      : null) ||
    (typeof plan?.location?.city === "string" && plan.location.city.trim()
      ? plan.location.city.trim()
      : null) ||
    (typeof plan?.location?.address === "string" && plan.location.address.trim()
      ? plan.location.address.trim()
      : null) ||
    (typeof plan?.location?.country === "string" && plan.location.country.trim()
      ? plan.location.country.trim()
      : null) ||
    null
  );
};

const resolveNearbyFallbackAnchor = async (plan = {}) => {
  const primaryPlaceTarget = collectSemanticPlaceTargets(plan)[0] || null;
  const primaryPlaceCoordinates = normalizeCoordinatePair(
    primaryPlaceTarget?.lat,
    primaryPlaceTarget?.lng,
  );
  if (
    primaryPlaceCoordinates.lat != null &&
    primaryPlaceCoordinates.lng != null
  ) {
    return {
      lat: primaryPlaceCoordinates.lat,
      lng: primaryPlaceCoordinates.lng,
      label: formatSemanticPlaceLabel(primaryPlaceTarget),
      source: "place_target",
    };
  }

  const resolvedPoiCoordinates = normalizeCoordinatePair(
    plan?.location?.resolvedPoi?.lat,
    plan?.location?.resolvedPoi?.lng,
  );
  if (resolvedPoiCoordinates.lat != null && resolvedPoiCoordinates.lng != null) {
    return {
      lat: resolvedPoiCoordinates.lat,
      lng: resolvedPoiCoordinates.lng,
      label:
        plan?.location?.resolvedPoi?.name ||
        resolveNearbyFallbackOriginalDestination(plan),
      source: "resolved_poi",
    };
  }

  const locationCoordinates = normalizeCoordinatePair(
    plan?.location?.lat,
    plan?.location?.lng ?? plan?.location?.lon,
  );
  if (locationCoordinates.lat != null && locationCoordinates.lng != null) {
    return {
      lat: locationCoordinates.lat,
      lng: locationCoordinates.lng,
      label: resolveNearbyFallbackOriginalDestination(plan),
      source: "location_coordinates",
    };
  }

  const textualDestination = [
    typeof plan?.location?.city === "string" && plan.location.city.trim()
      ? plan.location.city.trim()
      : typeof plan?.location?.address === "string" && plan.location.address.trim()
        ? plan.location.address.trim()
        : typeof plan?.location?.landmark === "string" && plan.location.landmark.trim()
          ? plan.location.landmark.trim()
          : null,
    typeof plan?.location?.country === "string" && plan.location.country.trim()
      ? plan.location.country.trim()
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  if (!textualDestination) return null;

  const poi = await resolvePoiToCoordinates(textualDestination);
  const geocodedCoordinates = normalizeCoordinatePair(poi?.lat, poi?.lng);
  if (geocodedCoordinates.lat == null || geocodedCoordinates.lng == null) {
    return null;
  }
  return {
    lat: geocodedCoordinates.lat,
    lng: geocodedCoordinates.lng,
    label: poi?.name || resolveNearbyFallbackOriginalDestination(plan),
    source: "destination_geocode",
  };
};

const buildNearbyFallbackSafePlan = (
  plan = {},
  anchor = {},
  radiusMeters = NEARBY_GEO_FALLBACK_RADII_METERS[0],
) => {
  const safeRadiusKm = Math.max(0.5, Number(radiusMeters) / 1000);
  const baseLocation =
    plan?.location && typeof plan.location === "object" ? plan.location : {};
  const semanticSearch =
    plan?.semanticSearch && typeof plan.semanticSearch === "object"
      ? plan.semanticSearch
      : {};
  const intentProfile =
    semanticSearch?.intentProfile && typeof semanticSearch.intentProfile === "object"
      ? semanticSearch.intentProfile
      : {};
  const webContext =
    semanticSearch?.webContext && typeof semanticSearch.webContext === "object"
      ? semanticSearch.webContext
      : {};

  return {
    ...plan,
    location: {
      ...baseLocation,
      city: null,
      state: null,
      country: null,
      address: null,
      landmark: null,
      lat: anchor?.lat ?? null,
      lng: anchor?.lng ?? null,
      radiusKm: safeRadiusKm,
      resolvedPoi:
        anchor?.lat != null && anchor?.lng != null
          ? {
              lat: anchor.lat,
              lng: anchor.lng,
              name: anchor.label || null,
            }
          : null,
    },
    geoIntent: null,
    areaIntent: null,
    viewIntent: null,
    areaTraits: [],
    placeTargets: [],
    preferenceNotes: [],
    preferences: {
      ...(plan?.preferences && typeof plan.preferences === "object"
        ? plan.preferences
        : {}),
      nearbyInterest: null,
      areaPreference: [],
    },
    semanticSearch: {
      ...semanticSearch,
      candidateHotelNames: [],
      neighborhoodHints: [],
      webContext: {
        ...webContext,
        resolvedPlaces: [],
        neighborhoodHints: [],
        candidateHotelNames: [],
      },
      intentProfile: {
        ...intentProfile,
        requestedZones: [],
        requestedLandmarks: [],
        candidateZones: [],
        candidateLandmarks: [],
      },
    },
  };
};

const deriveNearbyFallbackCities = ({
  items = [],
  anchor = null,
  maxCities = 2,
} = {}) => {
  const cityStats = new Map();
  items.forEach((item) => {
    const cityLabel =
      typeof item?.city === "string" && item.city.trim() ? item.city.trim() : null;
    if (!cityLabel) return;
    const distanceKm =
      anchor?.lat != null &&
      anchor?.lng != null &&
      item?.geoPoint?.lat != null &&
      item?.geoPoint?.lng != null
        ? computeDistanceKm(item.geoPoint, {
            lat: anchor.lat,
            lng: anchor.lng,
          })
        : null;
    const current = cityStats.get(cityLabel) || {
      city: cityLabel,
      count: 0,
      minDistanceKm: Number.POSITIVE_INFINITY,
    };
    current.count += 1;
    if (distanceKm != null && distanceKm < current.minDistanceKm) {
      current.minDistanceKm = distanceKm;
    }
    cityStats.set(cityLabel, current);
  });
  return Array.from(cityStats.values())
    .sort((left, right) => {
      if (left.minDistanceKm !== right.minDistanceKm) {
        return left.minDistanceKm - right.minDistanceKm;
      }
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.city.localeCompare(right.city);
    })
    .slice(0, Math.max(1, maxCities))
    .map((entry) => entry.city);
};

/** Preference intents: QUIET, BEACH_COAST, CITY_CENTER, FAMILY_FRIENDLY, LUXURY, BUDGET → filters */
const deriveFiltersFromPreferences = (plan = {}) => {
  const areaPreference = Array.isArray(plan?.preferences?.areaPreference)
    ? plan.preferences.areaPreference.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const homeTagKeys = [];
  if (areaPreference.includes("BEACH_COAST")) {
    homeTagKeys.push("BEACH", "BEACHFRONT");
  }
  if (areaPreference.includes("FAMILY_FRIENDLY")) {
    homeTagKeys.push("FAMILY");
  }
  if (areaPreference.includes("LUXURY")) {
    homeTagKeys.push("LUXURY");
  }
  // "Luxury" should broaden ranking, not silently hide the rest of the catalog.
  // Keep explicit preferred-only filtering for direct hotelFilters.preferredOnly requests.
  const hotelPreferredOnly = false;
  const sortBy =
    areaPreference.includes("BUDGET") && !plan?.sortBy ? "PRICE_ASC" : (plan?.sortBy && String(plan.sortBy).trim()) || null;
  return {
    homeTagKeys: Array.from(new Set(homeTagKeys)),
    hotelPreferredOnly,
    sortBy: sortBy || null,
  };
};

const hasAmenityMatch = (home, matcher) => {
  if (!home?.amenities) return false;
  return home.amenities.some((link) => {
    const label = String(link?.amenity?.label || "").toLowerCase();
    const key = String(link?.amenity?.amenity_key || "").toUpperCase();
    const normalizedKey = normalizeAmenityKeyValue(key);
    return matcher({ label, key, normalizedKey });
  });
};

const collectAmenityKeywords = (plan = {}) => {
  const keywords = new Set();
  const noteText = Array.isArray(plan.notes) ? plan.notes.join(" ").toLowerCase() : "";

  const pushAll = (arr) => arr.forEach((k) => keywords.add(k.toLowerCase()));

  // free-form detection from notes (common synonyms)
  const keywordMap = [
    { cues: ["wifi", "wi-fi", "wi fi", "internet"], add: ["wifi", "internet"] },
    { cues: ["washer", "laundry", "washing machine", "lavadora", "lavarropas"], add: ["washer", "laundry"] },
    { cues: ["dryer", "secadora"], add: ["dryer"] },
    { cues: ["parking", "cochera", "garage", "estacionamiento"], add: ["parking", "cochera"] },
    { cues: ["workspace", "desk", "escritorio"], add: ["workspace", "desk"] },
    { cues: ["pool", "piscina", "pileta"], add: ["pool", "piscina"] },
    { cues: ["pet", "mascota"], add: ["pet friendly"] },
  ];
  keywordMap.forEach(({ cues, add }) => {
    if (cues.some((cue) => noteText.includes(cue.toLowerCase()))) {
      pushAll(add);
    }
  });

  return Array.from(keywords).filter(Boolean);
};

const hasAmenityKeywords = (home, keywords = []) => {
  if (!keywords.length) return true;
  return keywords.some((kw) =>
    hasAmenityMatch(home, ({ label, key, normalizedKey }) => {
      const lowerKey = key.toLowerCase();
      const normalizedKeyword = String(kw || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const normalizedKeyLower = String(normalizedKey || "").toLowerCase();
      return (
        label.includes(kw) ||
        lowerKey.includes(kw) ||
        (normalizedKeyword && normalizedKeyLower.includes(normalizedKeyword))
      );
    })
  );
};

const buildHomeMatchReasons = ({ plan, home, card }) => {
  const reasons = [];
  if (plan?.location?.city && card?.city) {
    if (card.city.toLowerCase() === plan.location.city.toLowerCase()) {
      reasons.push(`En ${card.city}`);
    }
  }
  const guests = resolveGuestTotal(plan);
  if (guests && Number(card?.maxGuests) >= guests) {
    reasons.push(`Apto para ${card.maxGuests} huéspedes`);
  }
  const requiredAmenityKeys = Array.isArray(plan?.homeFilters?.amenityKeys) ? plan.homeFilters.amenityKeys : [];
  const wantsParkingByKey = requiredAmenityKeys.some((key) => String(key || "").toUpperCase().includes("PARKING"));
  if (wantsParkingByKey) {
    reasons.push("Incluye cochera/estacionamiento");
  }
  const budgetMax = resolveBudgetMax(plan);
  if (budgetMax != null && card?.pricePerNight != null) {
    if (Number(card.pricePerNight) <= budgetMax) {
      reasons.push(`Desde ${card.pricePerNight} ${card.currency || "USD"} por noche`);
    }
  }
  return reasons;
};

const buildPricingOrderLiteral = () => {
  const alias = resolveDialect() === "postgres" ? '"Home"' : "Home";
  return sequelize.literal(
    `(SELECT hp.base_price FROM home_pricing AS hp WHERE hp.home_id = ${alias}.id AND hp.deleted_at IS NULL LIMIT 1)`
  );
};

const runHomeQuery = async ({
  plan,
  limit,
  guests,
  coordinateFilter,
  addressWhere,
  budgetMax,
  respectGuest,
  respectBudget,
  amenityKeywords,
  homeFilters = {},
  combinedGuestCapacity = null,
  explicitGuestCapacity = null,
  calendarRange = null,
}) => {
  const where = {
    status: "PUBLISHED",
    is_visible: true,
  };
  const propertyTypes = Array.isArray(homeFilters.propertyTypes) ? homeFilters.propertyTypes : [];
  if (propertyTypes.length) {
    where.property_type = { [Op.in]: propertyTypes };
  }
  const spaceTypes = Array.isArray(homeFilters.spaceTypes) ? homeFilters.spaceTypes : [];
  if (spaceTypes.length) {
    where.space_type = { [Op.in]: spaceTypes };
  }
  const dynamicCapacity = respectGuest ? (combinedGuestCapacity ?? guests) : explicitGuestCapacity;
  if (dynamicCapacity) {
    where.max_guests = { [Op.gte]: dynamicCapacity };
  } else if (respectGuest && guests) {
    where.max_guests = { [Op.gte]: guests };
  }
  const minBedrooms = toNumberOrNull(homeFilters.minBedrooms);
  if (minBedrooms != null) {
    where.bedrooms = { ...(where.bedrooms || {}), [Op.gte]: minBedrooms };
  }
  const minBeds = toNumberOrNull(homeFilters.minBeds);
  if (minBeds != null) {
    where.beds = { ...(where.beds || {}), [Op.gte]: minBeds };
  }
  const minBathrooms = toNumberOrNull(homeFilters.minBathrooms);
  if (minBathrooms != null) {
    where.bathrooms = { ...(where.bathrooms || {}), [Op.gte]: minBathrooms };
  }

  const include = [
    {
      model: models.HomeAddress,
      as: "address",
      attributes: ["address_line1", "city", "state", "country", "latitude", "longitude"],
      required: Boolean(Object.keys(addressWhere).length || coordinateFilter),
      where:
        Object.keys({
          ...(Object.keys(addressWhere).length ? addressWhere : {}),
          ...(coordinateFilter || {}),
        }).length > 0
          ? {
            ...(Object.keys(addressWhere).length ? addressWhere : {}),
            ...(coordinateFilter || {}),
          }
          : undefined,
    },
    // LOGGING: Check the address where clause
    // console.log("[assistant] runHomeQuery address where:", JSON.stringify(addressWhere));
    // console.log("[assistant] runHomeQuery coordinate filter:", JSON.stringify(coordinateFilter));
    {
      model: models.HomePricing,
      as: "pricing",
      attributes: ["currency", "base_price", "weekend_price"],
      ...(respectBudget && budgetMax != null
        ? { where: { base_price: { [Op.lte]: budgetMax } } }
        : {}),
    },
    {
      model: models.HomeMedia,
      as: "media",
      attributes: ["id", "url", "is_cover", "order"],
      separate: true,
      limit: 6,
      order: [
        ["is_cover", "DESC"],
        ["order", "ASC"],
        ["id", "ASC"],
      ],
    },
    {
      model: models.User,
      as: "host",
      attributes: ["id", "name", "email", "avatar_url", "role"],
      include: [
        {
          model: models.HostProfile,
          as: "hostProfile",
          attributes: ["metadata"],
          required: false,
        },
      ],
    },
  ];

  const order = [];
  const homeAlias = resolveDialect() === "postgres" ? '"Home"' : "Home";

  if (plan?.sortBy === "POPULARITY") {
    order.push([
      sequelize.literal(
        `(SELECT COUNT(*) FROM home_recent_view WHERE home_recent_view.home_id = ${homeAlias}.id)`
      ),
      "DESC",
    ]);
  } else if (plan?.sortBy === "PRICE_ASC") {
    order.push([buildPricingOrderLiteral(), "ASC"]);
  } else if (plan?.sortBy === "PRICE_DESC") {
    order.push([buildPricingOrderLiteral(), "DESC"]);
  } else {
    order.push(["updated_at", "DESC"]);
    order.push(["id", "DESC"]);
  }

  const amenityFilterKeys = Array.isArray(homeFilters.amenityKeys) ? homeFilters.amenityKeys : [];
  const needsAmenityJoin = Boolean((amenityKeywords && amenityKeywords.length) || amenityFilterKeys.length);

  debugSearchLog("[assistant] runHomeQuery executing with where:", JSON.stringify(where));
  debugSearchLog("[assistant] runHomeQuery address include where:", JSON.stringify(include[0].where));

  const homes = await models.Home.findAll({
    where,
    include: [
      ...include,
      {
        model: models.HomeAmenityLink,
        as: "amenities",
        required: needsAmenityJoin,
        include: [
          {
            model: models.HomeAmenity,
            as: "amenity",
            attributes: ["id", "amenity_key", "label"],
          },
        ],
      },
      ...(Array.isArray(homeFilters.tagKeys) && homeFilters.tagKeys.length
        ? [
          {
            model: models.HomeTagLink,
            as: "tags",
            required: false,
            include: [
              {
                model: models.HomeTag,
                as: "tag",
                attributes: ["id", "tag_key", "label"],
              },
            ],
          },
        ]
        : []),
      ...(calendarRange
        ? [
          {
            model: models.HomeCalendar,
            as: "calendar",
            attributes: ["date", "status"],
            required: false,
            where: {
              status: { [Op.in]: Array.from(BLOCKED_CALENDAR_STATUSES) },
              date: {
                [Op.between]: [calendarRange.startDate, calendarRange.endDate],
              },
            },
          },
        ]
        : []),
    ],
    order,
    limit,
    distinct: true,
  });

  debugSearchLog(`[assistant] runHomeQuery found ${homes.length} raw homes`);
  return homes;
};

const mapHomesToResults = ({
  homes = [],
  plan,
  attempt = {},
  guests,
  budgetMax,
  requiredTagKeys = [],
  requiredAmenityKeys = [],
  amenityKeywords = [],
  calendarRange = null,
  fallbackNote = "",
}) => {
  const note = String(fallbackNote || "").trim();
  return homes
    .map((home) => {
      if (calendarRange && hasCalendarConflicts(home)) {
        return null;
      }
      if (requiredTagKeys.length && !hasRequiredTagKeys(home, requiredTagKeys)) {
        return null;
      }
      if (requiredAmenityKeys.length && !hasRequiredAmenityKeys(home, requiredAmenityKeys)) {
        return null;
      }
      if (amenityKeywords.length && !hasAmenityKeywords(home, amenityKeywords)) {
        return null;
      }
      const card = mapHomeToCard(home);
      if (!card) return null;
      const reasons = buildHomeMatchReasons({ plan, home, card });
      if (!attempt.respectGuest && guests) {
        reasons.push("Mostrando opciones sin validar capacidad exacta");
      }
      if (!attempt.respectBudget && budgetMax != null) {
        reasons.push("Incluye precios por encima del presupuesto seleccionado");
      }
      if (note) {
        reasons.push(note);
      }
      return {
        ...card,
        inventoryType: "HOME",
        matchReasons: reasons,
      };
    })
    .filter(Boolean);
};

export const searchHomesForPlan = async (plan = {}, options = {}) => {
  debugSearchLog("[assistant] plan", JSON.stringify(plan));
  // If the plan has a specific limit, use it, otherwise use the default or requested limit
  const planLimit = typeof plan.limit === "number" && plan.limit > 0 ? plan.limit : null;
  const limit = clampLimit(planLimit || options.limit);
  const traceSink = typeof options.traceSink === "function" ? options.traceSink : null;
  const guests = resolveGuestTotal(plan);
  const prefFilters = deriveFiltersFromPreferences(plan);
  const homeFiltersRaw = plan?.homeFilters || {};
  const baseTagKeys = normalizeKeyList(homeFiltersRaw.tagKeys);
  const mergedTagKeys = Array.from(
    new Set([...baseTagKeys, ...(prefFilters.homeTagKeys || [])].filter(Boolean))
  );
  const normalizedHomeFilters = {
    ...homeFiltersRaw,
    propertyTypes: normalizeKeyList(homeFiltersRaw.propertyTypes),
    spaceTypes: normalizeKeyList(homeFiltersRaw.spaceTypes),
    amenityKeys: normalizeKeyList(homeFiltersRaw.amenityKeys),
    tagKeys: mergedTagKeys,
  };
  const planWithSort = {
    ...plan,
    sortBy: (plan?.sortBy && String(plan.sortBy).trim()) || prefFilters.sortBy || plan.sortBy,
  };
  const addressWhere = {};
  if (plan?.location?.city) {
    const filter = buildStringFilter(plan.location.city);
    if (filter) addressWhere.city = filter;
  }
  if (plan?.location?.country) {
    const filter = buildStringFilter(plan.location.country);
    if (filter) addressWhere.country = filter;
  }
  if (plan?.location?.state && !plan?.location?.city) {
    const filter = buildStringFilter(plan.location.state);
    if (filter) addressWhere.state = filter;
  }

  const coordinateFilter = buildCoordinateFilterUsingRadius(plan?.location || {});
  const budgetMax = resolveBudgetMax(plan);
  const amenityKeywords = collectAmenityKeywords(plan);
  const calendarRange = buildCalendarRange(plan);
  const explicitGuestCapacity = toNumberOrNull(normalizedHomeFilters.maxGuests);
  const combinedGuestCapacity = combineCapacities(guests, explicitGuestCapacity);
  const requiredAmenityKeys = normalizedHomeFilters.amenityKeys || [];
  const requiredTagKeys = normalizedHomeFilters.tagKeys || [];
  const hasLocation = hasLocationConstraint(plan?.location || {});

  const attempts = [
    { respectGuest: true, respectBudget: true },
    { respectGuest: false, respectBudget: true },
    { respectGuest: false, respectBudget: false },
  ];

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    debugSearchLog("[assistant] attempt", attempt);
    const homes = await runHomeQuery({
      plan: planWithSort,
      limit,
      guests,
      coordinateFilter,
      addressWhere,
      budgetMax,
      respectGuest: attempt.respectGuest,
      respectBudget: attempt.respectBudget,
      amenityKeywords,
      homeFilters: normalizedHomeFilters,
      combinedGuestCapacity,
      explicitGuestCapacity,
      calendarRange,
    });

    debugSearchLog(`[assistant] attempt ${JSON.stringify(attempt)} returned ${homes.length} homes`);

    const enriched = mapHomesToResults({
      homes,
      plan: planWithSort,
      attempt,
      guests,
      budgetMax,
      requiredTagKeys,
      requiredAmenityKeys,
      amenityKeywords,
      calendarRange,
    });

    debugSearchLog(`[assistant] attempt enriched count: ${enriched.length}`);
    if (enriched.length) {
      return {
        items: enriched,
        matchType: index === 0 ? "EXACT" : "SIMILAR",
      };
    }
  }

  const relaxedHomeFilters = {
    ...normalizedHomeFilters,
    amenityKeys: [],
    tagKeys: [],
  };
  const relaxedHomes = await runHomeQuery({
    plan: planWithSort,
    limit,
    guests,
    coordinateFilter,
    addressWhere,
    budgetMax,
    respectGuest: false,
    respectBudget: false,
    amenityKeywords: [],
    homeFilters: relaxedHomeFilters,
    combinedGuestCapacity,
    explicitGuestCapacity,
    calendarRange,
  });

  const relaxedEnriched = mapHomesToResults({
    homes: relaxedHomes,
    plan: planWithSort,
    attempt: { respectGuest: false, respectBudget: false },
    guests,
    budgetMax,
    requiredTagKeys: [],
    requiredAmenityKeys: [],
    amenityKeywords: [],
    calendarRange,
    fallbackNote: "Opciones recomendadas con filtros flexibles",
  });
  if (relaxedEnriched.length) {
    return {
      items: relaxedEnriched,
      matchType: "SIMILAR",
    };
  }

  if (hasLocation) {
    emitSearchTrace(traceSink, "NO_RESULTS_AFTER_FILTERS", {
      label: "No matches found for this destination",
      debugLabel: "Location constraint present but both live and static paths returned 0 results",
    });
    debugSearchLog("[assistant] no fallback homes; location constraint present");
    return { items: [], matchType: "NONE" };
  }

  const fallbackHomes = await runHomeQuery({
    plan: planWithSort,
    limit,
    guests: null,
    coordinateFilter: null,
    addressWhere: {},
    budgetMax: null,
    respectGuest: false,
    respectBudget: false,
    amenityKeywords: [],
    homeFilters: {
      ...relaxedHomeFilters,
      propertyTypes: normalizedHomeFilters.propertyTypes,
      spaceTypes: normalizedHomeFilters.spaceTypes,
    },
    combinedGuestCapacity: null,
    explicitGuestCapacity: null,
    calendarRange: null,
  });
  const fallbackEnriched = mapHomesToResults({
    homes: fallbackHomes,
    plan: planWithSort,
    attempt: { respectGuest: false, respectBudget: false },
    guests: null,
    budgetMax: null,
    requiredTagKeys: [],
    requiredAmenityKeys: [],
    amenityKeywords: [],
    calendarRange: null,
    fallbackNote: "Opciones recomendadas basadas en tu busqueda",
  });
  if (fallbackEnriched.length) {
    return {
      items: fallbackEnriched,
      matchType: "SIMILAR",
    };
  }

  debugSearchLog("[assistant] final result count 0");
  return { items: [], matchType: "NONE" };
};

const buildHotelMatchReasons = ({ plan, hotel }) => {
  const language = resolveSemanticLanguage(plan);
  const reasons = [];
  if (plan?.location?.city && hotel.city) {
    if (hotel.city.toLowerCase().includes(plan.location.city.toLowerCase())) {
      reasons.push(
        pickSemanticCopy(language, {
          es: `Ubicado en ${hotel.city}`,
          en: `Located in ${hotel.city}`,
          pt: `Localizado em ${hotel.city}`,
        }),
      );
    }
  }
  if (hotel.preferred) {
    reasons.push(
      pickSemanticCopy(language, {
        es: "Hotel preferido del catálogo",
        en: "Preferred catalog hotel",
        pt: "Hotel preferido do catálogo",
      }),
    );
  }
  return uniqueReasonList(reasons, 4);
};

const hasExplicitHotelGuests = (plan = {}) => {
  const adults = toNumberOrNull(plan?.guests?.adults);
  const total = toNumberOrNull(plan?.guests?.total);
  return (
    (Number.isFinite(adults) && adults > 0) ||
    (Number.isFinite(total) && total > 0)
  );
};

const buildHotelOccupancies = (plan = {}) => {
  const adults =
    toNumberOrNull(plan?.guests?.adults) ??
    toNumberOrNull(plan?.guests?.total) ??
    2;
  const children = toNumberOrNull(plan?.guests?.children) ?? 0;
  const safeAdults = Math.max(1, Math.floor(adults));
  const safeChildren = Math.max(0, Math.floor(children));
  return `${safeAdults}|${safeChildren}`;
};

const parseHotelOccupanciesForCache = (plan = {}) => {
  const adults =
    toNumberOrNull(plan?.guests?.adults) ??
    toNumberOrNull(plan?.guests?.total) ??
    2;
  const children = toNumberOrNull(plan?.guests?.children) ?? 0;
  return [{ adults: Math.max(1, Math.floor(adults)), children: Math.max(0, Math.floor(children)) }];
};

const buildAssistantLocationQuery = (location = {}) => {
  if (!location || typeof location !== "object") return "";
  const rawQuery =
    typeof location.rawQuery === "string" && location.rawQuery.trim()
      ? location.rawQuery.trim()
      : typeof location.query === "string" && location.query.trim()
        ? location.query.trim()
        : "";
  if (rawQuery) return rawQuery;
  const city = typeof location.city === "string" ? location.city.trim() : "";
  const state = typeof location.state === "string" ? location.state.trim() : "";
  const country = typeof location.country === "string" ? location.country.trim() : "";
  const landmark = typeof location.landmark === "string" ? location.landmark.trim() : "";
  if (city || state || country) {
    return [city, state, country].filter(Boolean).join(", ");
  }
  if (landmark) {
    return [landmark, city, country].filter(Boolean).join(", ");
  }
  return "";
};

const resolveCountryCodeByName = async (countryNameValue) => {
  const countryName =
    typeof countryNameValue === "string" ? countryNameValue.trim().toLowerCase() : null;
  if (!countryName) return null;
  const countryRow = await models.WebbedsCountry.findOne({
    where: sequelize.where(sequelize.fn("LOWER", sequelize.col("name")), countryName),
    attributes: ["code"],
    raw: true,
  });
  return countryRow?.code != null ? String(countryRow.code) : null;
};

const resolveWebbedsLocationCodes = async (location = {}) => {
  const result = { cityCode: null, countryCode: null, resolvedCity: null };
  if (!location) return result;
  const explicitCountryCode =
    location.countryCode != null && String(location.countryCode).trim()
      ? String(location.countryCode).trim()
      : null;
  if (explicitCountryCode) {
    result.countryCode = explicitCountryCode;
  } else {
    result.countryCode = await resolveCountryCodeByName(location.country);
  }
  const resolvedCity = await resolveWebbedsCityMatch({
    query: buildAssistantLocationQuery(location),
    cityCode: location.cityCode ?? null,
    countryCode: result.countryCode,
    countryName: location.country ?? null,
    placeId: location.placeId ?? null,
    lat: location.lat ?? null,
    lng: location.lng ?? location.lon ?? null,
  });
  if (resolvedCity?.code != null) {
    result.cityCode = String(resolvedCity.code);
    result.countryCode = resolvedCity.country_code != null
      ? String(resolvedCity.country_code)
      : result.countryCode;
    result.resolvedCity = resolvedCity;
  } else if (location.cityCode != null && String(location.cityCode).trim()) {
    result.cityCode = String(location.cityCode).trim();
  }
  return result;
};

const normalizeNumericList = (values = []) => {
  const result = [];
  values.forEach((value) => {
    if (value === null || value === undefined) return;
    const raw = String(value).trim();
    if (!raw) return;
    const num = Number(raw);
    if (Number.isFinite(num)) result.push(String(num));
  });
  return Array.from(new Set(result));
};

const resolveAmenityCatalogCodes = async (codes = []) => {
  const raw = Array.isArray(codes) ? codes.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const numericCodes = new Set(normalizeNumericList(raw));
  const nameCandidates = raw.filter((value) => !Number.isFinite(Number(value)));
  const expandedNames = expandAmenityNameCandidates(nameCandidates);
  debugSearchLog("[assistant][amenities] resolveAmenityCatalogCodes input", {
    raw,
    numericCount: numericCodes.size,
    nameCandidatesCount: nameCandidates.length,
    expandedNamesCount: expandedNames.length,
  });
  if (!expandedNames.length || !models.WebbedsAmenityCatalog) {
    debugSearchLog("[assistant][amenities] resolveAmenityCatalogCodes resolved (no catalog lookup)", {
      codes: Array.from(numericCodes),
    });
    return Array.from(numericCodes);
  }
  const likeOp = iLikeOp;
  const nameFilters = expandedNames.map((name) => ({ name: { [likeOp]: `%${name}%` } }));
  const rows = await models.WebbedsAmenityCatalog.findAll({
    where: {
      type: { [Op.in]: ["hotel", "leisure", "business"] },
      [Op.or]: nameFilters,
    },
    attributes: ["code"],
    raw: true,
  });
  rows.forEach((row) => {
    if (row?.code != null) numericCodes.add(String(row.code));
  });
  debugSearchLog("[assistant][amenities] resolveAmenityCatalogCodes resolved", {
    matchedRows: rows.length,
    codes: Array.from(numericCodes),
  });
  return Array.from(numericCodes);
};

const filterHotelsByAmenities = async (hotels, filters = {}) => {
  const requestedCodes = Array.isArray(filters.amenityCodes) ? filters.amenityCodes : [];
  const requestedItems = Array.isArray(filters.amenityItemIds) ? filters.amenityItemIds : [];
  const amenityItemIds = normalizeNumericList(requestedItems);

  // Build per-amenity code groups: each original requested code resolves to a Set of catalog codes.
  // When filtering, a hotel must match AT LEAST ONE code from EACH group (OR within, AND between).
  // Example: ['POOL', 'GYM'] → hotel needs any pool code AND any gym code.
  const codeGroups = requestedCodes.length
    ? await Promise.all(requestedCodes.map((code) => resolveAmenityCatalogCodes([code])))
    : [];

  // Flat union of all codes for the SQL IN clause
  const allCodes = [...new Set(codeGroups.flat())];

  const requestedNames = expandAmenityNameCandidates(requestedCodes).map((name) => name.toLowerCase());

  debugSearchLog("[assistant][amenities] filterHotelsByAmenities start", {
    hotelsCount: hotels.length,
    requestedCodes,
    requestedItems,
    codeGroups: codeGroups.map((g, i) => ({ input: requestedCodes[i], codes: g })),
    resolvedItemIds: amenityItemIds,
    requestedNames,
  });

  const matchesAmenityKeywords = (hotel) => {
    if (!requestedNames.length) return false;
    const parts = [];
    if (Array.isArray(hotel?.amenities)) {
      hotel.amenities.forEach((item) => {
        if (!item) return;
        if (typeof item === "string") parts.push(item);
        else if (typeof item === "object") parts.push(item.name || item.label || "");
      });
    }
    if (Array.isArray(hotel?.leisure)) parts.push(...hotel.leisure);
    if (Array.isArray(hotel?.business)) parts.push(...hotel.business);
    const blob = parts.filter(Boolean).join(" ").toLowerCase();
    return requestedNames.some((name) => name && blob.includes(name));
  };

  if (!allCodes.length && !amenityItemIds.length) {
    const fallbackResults =
      requestedCodes.length || requestedItems.length
        ? hotels.filter(matchesAmenityKeywords)
        : hotels;
    debugSearchLog("[assistant][amenities] filterHotelsByAmenities fallback (no codes)", {
      fallbackCount: fallbackResults.length,
    });
    return fallbackResults;
  }

  const hotelIds = hotels.map((hotel) => String(hotel.id)).filter(Boolean);
  if (!hotelIds.length) return [];

  const amenityWhere = { hotel_id: { [Op.in]: hotelIds } };
  if (allCodes.length && amenityItemIds.length) {
    amenityWhere[Op.or] = [
      { catalog_code: { [Op.in]: allCodes } },
      { item_id: { [Op.in]: amenityItemIds } },
    ];
  } else if (allCodes.length) {
    amenityWhere.catalog_code = { [Op.in]: allCodes };
  } else if (amenityItemIds.length) {
    amenityWhere.item_id = { [Op.in]: amenityItemIds };
  }

  const rows = await models.WebbedsHotelAmenity.findAll({
    where: amenityWhere,
    attributes: ["hotel_id", "catalog_code", "item_id"],
    raw: true,
  });
  debugSearchLog("[assistant][amenities] filterHotelsByAmenities rows", { rows: rows.length });

  const amenityMap = new Map();
  rows.forEach((row) => {
    const key = String(row.hotel_id);
    if (!amenityMap.has(key)) amenityMap.set(key, { codes: new Set(), items: new Set() });
    if (row.catalog_code != null) amenityMap.get(key).codes.add(String(row.catalog_code));
    if (row.item_id) amenityMap.get(key).items.add(String(row.item_id));
  });

  const filtered = hotels.filter((hotel) => {
    const info = amenityMap.get(String(hotel.id));
    if (!info) return false;
    // Each group = one original amenity. Hotel passes if it has ANY code from EACH group (AND of ORs).
    const hasAllGroups = codeGroups.every(
      (group) => !group.length || group.some((code) => info.codes.has(String(code)))
    );
    // Item IDs are treated individually — hotel needs at least one match.
    const hasItems = !amenityItemIds.length || amenityItemIds.some((itemId) => info.items.has(String(itemId)));
    return hasAllGroups && hasItems;
  });

  if (!filtered.length && requestedNames.length) {
    const fallbackResults = hotels.filter(matchesAmenityKeywords);
    debugSearchLog("[assistant][amenities] filterHotelsByAmenities fallback (keyword match)", {
      fallbackCount: fallbackResults.length,
    });
    return fallbackResults;
  }
  debugSearchLog("[assistant][amenities] filterHotelsByAmenities done", {
    filteredCount: filtered.length,
  });
  return filtered;
};

const applyHotelFilters = async (hotels, filters = {}) => {
  let filtered = hotels;
  if (filters.preferredOnly) {
    filtered = filtered.filter((hotel) => hotel.preferred);
  }
  const exactStarRatings = normalizeExactStarRatings(filters.starRatings);
  if (exactStarRatings.length) {
    filtered = filtered.filter((hotel) => {
      const stars = resolveHotelStars(hotel);
      return stars != null && exactStarRatings.includes(stars);
    });
  } else if (filters.minRating != null) {
    const minStar = Math.round(filters.minRating);
    filtered = filtered.filter((hotel) => {
      // resolveHotelStars maps WebBeds classification codes (BIGINTs like 563) to star counts (1-5).
      // hotel.rating is usually null for WebBeds hotels, so the code mapping is the primary source.
      const stars = resolveHotelStars(hotel);
      return stars != null && stars >= minStar;
    });
  }
  if ((filters.amenityCodes?.length || filters.amenityItemIds?.length) && filtered.length) {
    filtered = await filterHotelsByAmenities(filtered, filters);
  }
  return filtered;
};

const MIN_STAR_FALLBACK_THRESHOLD = Number(process.env.ASSISTANT_SEARCH_MIN_STAR_FALLBACK_THRESHOLD) || 5;

const ASSISTANT_AMENITIES_FROM_TABLE_DEBUG =
  process.env.AI_AMENITIES_DEBUG === "true" ||
  process.env.ASSISTANT_AMENITIES_FROM_TABLE_DEBUG === "true" ||
  process.env.FLOW_RATE_DEBUG_LOGS === "true";

/** Enrich hotel cards with amenities from webbeds_hotel_amenity when available (single source for chat context). */
const enrichCardsWithAmenitiesFromTable = async (cards) => {
  if (!Array.isArray(cards) || !cards.length) return cards;
  const hotelIds = cards.map((c) => c.id).filter(Boolean);
  if (!hotelIds.length) return cards;
  const rows = await models.WebbedsHotelAmenity.findAll({
    where: { hotel_id: { [Op.in]: hotelIds } },
    attributes: ["hotel_id", "item_name"],
    raw: true,
  });
  const amenityMap = new Map();
  for (const row of rows) {
    const name = row.item_name != null ? String(row.item_name).trim() : "";
    if (!name) continue;
    const key = String(row.hotel_id);
    if (!amenityMap.has(key)) amenityMap.set(key, []);
    amenityMap.get(key).push(name);
  }
  for (const card of cards) {
    const fromTable = amenityMap.get(String(card.id));
    if (fromTable?.length) {
      card.amenities = fromTable;
      if (ASSISTANT_AMENITIES_FROM_TABLE_DEBUG) {
        console.log("[search:hotels][amenities-from-table]", {
          hotel_id: card.id,
          name: card.name,
          amenitiesFromTable: fromTable.length,
          replaced: true,
        });
      }
    } else if (ASSISTANT_AMENITIES_FROM_TABLE_DEBUG) {
      console.log("[search:hotels][amenities-from-table]", {
        hotel_id: card.id,
        name: card.name,
        amenitiesFromTable: 0,
        replaced: false,
      });
    }
  }
  return cards;
};

const STATIC_HOTEL_ATTRS = [
  "hotel_id", "name", "city_name", "city_code", "country_name", "country_code",
  "address", "full_address", "lat", "lng", "rating", "priority", "preferred", "exclusive",
  "chain", "chain_code", "classification_code", "images", "amenities", "leisure", "business", "descriptions",
];
const STATIC_HOTEL_INCLUDE = [
  { model: models.WebbedsHotelChain, as: "chainCatalog", attributes: ["code", "name"] },
  { model: models.WebbedsHotelClassification, as: "classification", attributes: ["code", "name"] },
];

/** Single query + post-filters + map for static hotel search (used for initial and star-fallback paths). */
const runStaticHotelQuery = async (where, options) => {
  const {
    normalizedHotelFilters,
    fetchLimit,
    limit,
    coordinateFilter,
    hasLocationFilter,
    budgetMax,
    plan,
    proximityAnchor,
    orderOverride,
    traceSink = null,
  } = options;
  const order = orderOverride && orderOverride.length
    ? orderOverride
    : [["preferred", "DESC"], ["priority", "DESC"], ["name", "ASC"]];
  const hotels = await models.WebbedsHotel.findAll({
    where,
    attributes: STATIC_HOTEL_ATTRS,
    include: STATIC_HOTEL_INCLUDE,
    order,
    limit: fetchLimit,
  });
  let cards = hotels.map(formatStaticHotel).filter(Boolean);
  emitSearchTrace(traceSink, "CATALOG_DB_FETCHED", {
    label: `Catalog returned ${cards.length} option${cards.length === 1 ? "" : "s"}`,
    debugLabel: `Static DB fetched ${hotels.length} row(s), ${cards.length} mapped card(s)`,
    total: cards.length,
  });
  cards = await applyHotelFilters(cards, normalizedHotelFilters);
  if (coordinateFilter) {
    const nearby = cards.filter(
      (c) => c.geoPoint && matchesCoordinateFilter(c.geoPoint, coordinateFilter)
    );
    if (hasLocationFilter) {
      if (nearby.length) cards = nearby;
    } else {
      cards = nearby;
    }
  }
  if (budgetMax != null) {
    cards = cards.filter(
      (c) => toNumberOrNull(c.pricePerNight) == null || toNumberOrNull(c.pricePerNight) <= budgetMax
    );
  }
  if (proximityAnchor) {
    cards = sortByProximity(cards, proximityAnchor);
  } else {
    const sortByStatic = String(plan?.sortBy || "PRICE_ASC").trim().toUpperCase();
    if (sortByStatic === "PRICE_DESC") {
      cards.sort((a, b) => (toNumberOrNull(b.pricePerNight) ?? 0) - (toNumberOrNull(a.pricePerNight) ?? 0));
    } else if (sortByStatic === "PRICE_ASC") {
      cards.sort((a, b) => (toNumberOrNull(a.pricePerNight) ?? Number.MAX_SAFE_INTEGER) - (toNumberOrNull(b.pricePerNight) ?? Number.MAX_SAFE_INTEGER));
    }
  }
  const starOrder = orderOverride && orderOverride.length && orderOverride[0][0] === "classification_code";
  if (starOrder) {
    cards.sort((a, b) => (toNumberOrNull(b.stars) ?? 0) - (toNumberOrNull(a.stars) ?? 0));
  }
  cards = applySemanticHotelRanking(cards, plan);
  emitSemanticCandidateMatchTrace(traceSink, plan, cards);
  return mapHotelCardsForOutput({ cards, plan, limit });
};

const mapLiveHotelOptions = async ({
  options = [],
  plan,
  limit,
  pricingRole = 20,
  hotelFilters,
  coordinateFilter,
  proximityAnchor = null,
}) => {
  if (!Array.isArray(options) || !options.length) return [];
  const debugLive =
    process.env.WEBBEDS_VERBOSE_LOGS === "true" || process.env.ASSISTANT_DEBUG_HOTEL_MATCH === "true";
  let priceMissing = 0;
  let priceInvalid = 0;
  const stayNights = resolveHotelStayNights({
    checkIn: plan?.dates?.checkIn,
    checkOut: plan?.dates?.checkOut,
    fallback: 1,
  });
  const grouped = new Map();
  options.forEach((option) => {
    const hotelCode = option?.hotelCode ?? option?.hotelDetails?.hotelCode;
    if (!hotelCode) return;
    const key = String(hotelCode);
    const price = toNumberOrNull(option.price);
    if (price == null) {
      priceMissing += 1;
      return;
    }
    if (!Number.isFinite(price)) {
      priceInvalid += 1;
      return;
    }
    const current = grouped.get(key);
    if (!current || price < current.price) {
      grouped.set(key, {
        hotelCode: key,
        price,
        currency: option.currency,
        option,
      });
    }
  });
  if (debugLive) {
    const sample = options.slice(0, 2).map((option) => ({
      hotelCode: option?.hotelCode ?? option?.hotelDetails?.hotelCode ?? null,
      hasPrice: option?.price != null,
      price: option?.price ?? null,
      currency: option?.currency ?? null,
      keys: Object.keys(option || {}).slice(0, 12),
    }));
    debugSearchLog("[assistant][live] options summary", {
      optionsCount: options.length,
      groupedCount: grouped.size,
      priceMissing,
      priceInvalid,
      sample,
    });
  }
  if (!grouped.size) return [];

  const hotelCodes = Array.from(grouped.keys());
  const records = await models.WebbedsHotel.findAll({
    where: { hotel_id: { [Op.in]: hotelCodes } },
    attributes: [
      "hotel_id",
      "name",
      "city_name",
      "city_code",
      "country_name",
      "country_code",
      "address",
      "full_address",
      "lat",
      "lng",
      "rating",
      "priority",
      "preferred",
      "exclusive",
      "chain",
      "chain_code",
      "classification_code",
      "images",
      "amenities",
      "leisure",
      "business",
      "descriptions",
    ],
    include: [
      {
        model: models.WebbedsHotelChain,
        as: "chainCatalog",
        attributes: ["code", "name"],
      },
      {
        model: models.WebbedsHotelClassification,
        as: "classification",
        attributes: ["code", "name"],
      },
    ],
  });
  if (process.env.WEBBEDS_VERBOSE_LOGS === "true" || process.env.ASSISTANT_DEBUG_HOTEL_MATCH === "true") {
    const foundIds = new Set(records.map((row) => String(row.hotel_id)));
    const missing = hotelCodes.filter((code) => !foundIds.has(String(code)));
    debugSearchLog("[assistant][live] hotel match summary", {
      liveCount: hotelCodes.length,
      staticCount: records.length,
      missingCount: missing.length,
      sampleMissing: missing.slice(0, 10),
      city: plan?.location?.city ?? null,
      country: plan?.location?.country ?? null,
    });
  }

  const cards = records
    .map((record) => {
      const card = formatStaticHotel(record);
      if (!card) return null;
      const info = grouped.get(card.id);
      if (!info) return null;
      const baseCard = {
        ...card,
        currency: info.currency || card.currency || "USD",
        bestPrice: info.price,
        stayNights,
        providerInfo: {
          rateKey: info.option.rateKey,
          board: info.option.board,
        },
      };
      return decorateHotelPricingForDisplay(baseCard, {
        providerAmount: info.price,
        minimumSelling: info.option,
        pricingRole,
        stayNights,
      });
    })
    .filter(Boolean);

  let filteredCards = await applyHotelFilters(cards, hotelFilters);
  if (coordinateFilter) {
    const nearbyLiveCards = filteredCards.filter(
      (card) => card.geoPoint && matchesCoordinateFilter(card.geoPoint, coordinateFilter),
    );
    if (nearbyLiveCards.length) {
      filteredCards = nearbyLiveCards;
      debugSearchLog(
        `[DEBUG_SEARCH] Live proximity post-filter: ${nearbyLiveCards.length} hotels near landmark`,
      );
    } else {
      debugSearchLog(
        "[DEBUG_SEARCH] Live proximity post-filter: no live hotels with geoPoint near landmark, returning all live city results",
      );
    }
  }

  // Apply budget.max filter when the user specified an explicit numeric price cap.
  const budgetMax = resolveBudgetMax(plan);
  if (budgetMax != null) {
    filteredCards = filteredCards.filter(
      (card) => toNumberOrNull(card.pricePerNight) == null || toNumberOrNull(card.pricePerNight) <= budgetMax
    );
  }

  // Proximity sort takes priority when user requested CITY_CENTER or nearbyInterest.
  // Otherwise fall back to plan.sortBy (default PRICE_ASC).
  if (proximityAnchor) {
    filteredCards = sortByProximity(filteredCards, proximityAnchor);
  } else {
    const sortByLive = String(plan?.sortBy || "PRICE_ASC").trim().toUpperCase();
    filteredCards.sort((a, b) => {
      const priceA = toNumberOrNull(a.pricePerNight) ?? Number.MAX_SAFE_INTEGER;
      const priceB = toNumberOrNull(b.pricePerNight) ?? Number.MAX_SAFE_INTEGER;
      return sortByLive === "PRICE_DESC" ? priceB - priceA : priceA - priceB;
    });
  }

  filteredCards = applySemanticHotelRanking(filteredCards, plan);
  return mapHotelCardsForOutput({ cards: filteredCards, plan, limit });
};

const LIVE_SUPPLEMENT_MIN_RESULTS = Math.max(
  2,
  Math.min(8, Number(process.env.AI_LIVE_SUPPLEMENT_MIN_RESULTS || 5))
);

const buildLiveHotelAdvancedConditions = async ({ hotelFilters = {} } = {}) => {
  const conditions = [];

  const exactStarRatings = normalizeExactStarRatings(hotelFilters.starRatings);

  if (hotelFilters.preferredOnly) {
    conditions.push({
      fieldName: "preferred",
      fieldTest: "equals",
      fieldValues: ["1"],
    });
  }

  if (exactStarRatings.length >= 1) {
    const exactMin = String(Math.min(...exactStarRatings));
    const exactMax = String(Math.max(...exactStarRatings));
    conditions.push({
      fieldName: "rating",
      fieldTest: "between",
      fieldValues: [exactMin, exactMax],
    });
  } else if (hotelFilters.minRating != null && Number.isFinite(Number(hotelFilters.minRating))) {
    const minStar = Math.max(1, Math.round(Number(hotelFilters.minRating)));
    conditions.push({
      fieldName: "rating",
      fieldTest: "between",
      fieldValues: [String(minStar), "5"],
    });
  }

  const requestedCodes = Array.isArray(hotelFilters.amenityCodes) ? hotelFilters.amenityCodes : [];
  if (requestedCodes.length && models.WebbedsAmenityCatalog) {
    const resolvedCatalogCodes = [
      ...new Set((await Promise.all(requestedCodes.map((code) => resolveAmenityCatalogCodes([code])))).flat()),
    ];

    if (resolvedCatalogCodes.length) {
      const catalogRows = await models.WebbedsAmenityCatalog.findAll({
        where: { code: { [Op.in]: resolvedCatalogCodes } },
        attributes: ["code", "type"],
        raw: true,
      });

      const grouped = {
        hotel: [],
        leisure: [],
        business: [],
      };

      catalogRows.forEach((row) => {
        const type = String(row?.type || "").trim().toLowerCase();
        if (type === "hotel" || type === "leisure" || type === "business") {
          grouped[type].push(String(row.code));
        }
      });

      if (grouped.hotel.length) {
        conditions.push({
          fieldName: "amenitie",
          fieldTest: "in",
          fieldValues: grouped.hotel,
        });
      }
      if (grouped.leisure.length) {
        conditions.push({
          fieldName: "leisure",
          fieldTest: "in",
          fieldValues: grouped.leisure,
        });
      }
      if (grouped.business.length) {
        conditions.push({
          fieldName: "business",
          fieldTest: "in",
          fieldValues: grouped.business,
        });
      }
    }
  }
  return conditions;
};

const shouldSupplementLiveResults = ({ liveResults = [], hotelFilters = {}, limit }) => {
  const liveCount = Array.isArray(liveResults) ? liveResults.length : 0;
  const target = Math.min(clampLimit(limit), LIVE_SUPPLEMENT_MIN_RESULTS);
  if (liveCount <= 0 || liveCount >= target) return false;
  return Boolean(
    hotelFilters.preferredOnly ||
    (Array.isArray(hotelFilters.starRatings) && hotelFilters.starRatings.length) ||
    hotelFilters.minRating != null ||
    (Array.isArray(hotelFilters.amenityCodes) && hotelFilters.amenityCodes.length) ||
    (Array.isArray(hotelFilters.amenityItemIds) && hotelFilters.amenityItemIds.length)
  );
};

const buildLiveCandidateHotelIds = async ({
  plan,
  hotelFilters = {},
  resolvedLocationCodes = null,
  limit,
}) => {
  const referenceHotelIds = normalizeIdList(
    plan?.referenceHotelIds ?? plan?.semanticSearch?.referenceHotelIds,
  );
  const semanticCandidateNames = Array.isArray(
    plan?.semanticSearch?.candidateHotelNames,
  )
    ? plan.semanticSearch.candidateHotelNames
    : [];
  const locationCodes = resolvedLocationCodes || {};
  const requestedCityName =
    typeof plan?.location?.city === "string" && plan.location.city.trim()
      ? plan.location.city.trim()
      : "";
  const resolvedCityName =
    typeof locationCodes?.resolvedCity?.name === "string" && locationCodes.resolvedCity.name.trim()
      ? locationCodes.resolvedCity.name.trim()
      : requestedCityName;
  const cityNameFilterSource = requestedCityName || resolvedCityName;

  const where = {};
  if (locationCodes?.cityCode && cityNameFilterSource) {
    const cityNameFilter = buildStringFilter(cityNameFilterSource);
    where[Op.or] = cityNameFilter
      ? [{ city_code: String(locationCodes.cityCode) }, { city_name: cityNameFilter }]
      : [{ city_code: String(locationCodes.cityCode) }];
  } else if (locationCodes?.cityCode) {
    where.city_code = String(locationCodes.cityCode);
  } else if (cityNameFilterSource) {
    const cityNameFilter = buildStringFilter(cityNameFilterSource);
    if (cityNameFilter) where.city_name = cityNameFilter;
  }

  if (referenceHotelIds.length) {
    where.hotel_id = { [Op.in]: referenceHotelIds };
  }
  if (!Object.keys(where).length) return [];

  const exactStarRatings = normalizeExactStarRatings(hotelFilters.starRatings);
  if (exactStarRatings.length) {
    const exactCodes = resolveClassificationCodesForExactRatings(exactStarRatings);
    if (exactCodes.length) {
      where.classification_code = { [Op.in]: exactCodes };
    }
  } else {
    const minStar =
      hotelFilters.minRating != null && Number.isFinite(Number(hotelFilters.minRating))
        ? Math.round(Number(hotelFilters.minRating))
        : null;
    if (minStar != null) {
      const eligibleCodes = resolveClassificationCodesForMinRating(minStar);
      if (eligibleCodes.length) {
        where.classification_code = { [Op.in]: eligibleCodes };
      }
    }
  }

  const candidateLimit = Math.min(ASSISTANT_SEARCH_MAX_LIMIT, Math.max(limit * 3, 60));
  const rows = await models.WebbedsHotel.findAll({
    where,
    attributes: ["hotel_id", "name"],
    order: [
      ["preferred", "DESC"],
      ["priority", "DESC"],
      ["name", "ASC"],
    ],
    limit: candidateLimit,
  });

  const normalizedIds = rows
    .map((row) => ({
      id: String(row?.hotel_id || "").trim(),
      name: typeof row?.name === "string" ? row.name.trim() : "",
    }))
    .filter((row) => row.id);

  if (semanticCandidateNames.length && !referenceHotelIds.length) {
    const matchedIds = normalizedIds
      .map((row) => {
        const bestMatch = resolveBestModelCandidateMatch(
          row.name,
          semanticCandidateNames,
        );
        return bestMatch
          ? {
              id: row.id,
              score: bestMatch.score,
            }
          : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score)
      .map((row) => row.id);
    if (matchedIds.length) {
      return Array.from(new Set(matchedIds));
    }
  }

  return normalizedIds.map((row) => row.id);
};

const flattenGroupedLiveOptions = (groups = []) => {
  if (!Array.isArray(groups) || !groups.length) return [];
  return groups.flatMap((group) => {
    const hotelCode = group?.hotelCode ?? group?.hotelDetails?.hotelCode ?? null;
    const hotelDetails = group?.hotelDetails ?? null;
    const options = Array.isArray(group?.options) ? group.options : [];
    return options.map((option) => ({
      ...option,
      hotelCode,
      hotelDetails: option?.hotelDetails || hotelDetails,
    }));
  });
};

const tryRunLiveHotelSearch = async ({
  plan,
  limit,
  pricingRole = 20,
  hotelFilters,
  coordinateFilter,
  proximityAnchor = null,
  resolvedLocationCodes = null,
  traceSink = null,
}) => {
  if (!plan?.dates?.checkIn || !plan?.dates?.checkOut) return [];
  if (!hasExplicitHotelGuests(plan)) return [];
  const provider = getLiveHotelProvider();
  if (!provider) return [];
  const referenceHotelIds = normalizeIdList(
    plan?.referenceHotelIds ?? plan?.semanticSearch?.referenceHotelIds,
  );
  const locationCodes = resolvedLocationCodes || await resolveWebbedsLocationCodes(plan?.location || {});
  if (!locationCodes.cityCode && !locationCodes.countryCode && !referenceHotelIds.length) return [];
  try {
    const defaultCountryCode = process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102";
    const passengerNationality =
      plan?.passengerNationality ?? plan?.nationality ?? defaultCountryCode;
    const passengerCountryOfResidence =
      plan?.passengerCountryOfResidence ?? plan?.residence ?? defaultCountryCode;
    const advancedConditions = await buildLiveHotelAdvancedConditions({ hotelFilters });
    const credentials = provider.getCredentials();
    const candidateHotelIds = await buildLiveCandidateHotelIds({
      plan,
      hotelFilters,
      resolvedLocationCodes: locationCodes,
      limit,
    });
    const liveCacheKey = buildLiveHotelSearchCacheKey({
      plan,
      limit,
      pricingRole,
      hotelFilters,
      coordinateFilter,
      proximityAnchor,
      resolvedLocationCodes: locationCodes,
      candidateHotelIds,
    });
    if (liveCacheKey) {
      const cached = await cache.get(liveCacheKey);
      if (cached && Array.isArray(cached.items)) {
        if (!cached.items.length) {
          emitSearchTrace(traceSink, "LIVE_CACHE_EMPTY_IGNORED", {
            label: "Ignoring empty cached live availability",
            debugLabel: `Live cache contained 0 items for ${locationCodes.cityCode || locationCodes.countryCode || "unknown-location"}`,
          });
          console.log("[assistant][live-cache] EMPTY_IGNORED", {
            cityCode: locationCodes.cityCode || null,
            countryCode: locationCodes.countryCode || null,
            checkIn: plan.dates.checkIn,
            checkOut: plan.dates.checkOut,
          });
        } else {
          emitSearchTrace(traceSink, "LIVE_CACHE_HIT", {
            label: "Reusing recent live availability",
            debugLabel: `Live cache HIT for ${locationCodes.cityCode || locationCodes.countryCode || "unknown-location"}`,
          });
          console.log("[assistant][live-cache] HIT", {
            cityCode: locationCodes.cityCode || null,
            countryCode: locationCodes.countryCode || null,
            checkIn: plan.dates.checkIn,
            checkOut: plan.dates.checkOut,
            count: cached.items.length,
          });
          return cached.items;
        }
      }
      emitSearchTrace(traceSink, "LIVE_CACHE_MISS", {
        label: "Fetching fresh live availability",
        debugLabel: `Live cache MISS for ${locationCodes.cityCode || locationCodes.countryCode || "unknown-location"}`,
      });
      console.log("[assistant][live-cache] MISS", {
        cityCode: locationCodes.cityCode || null,
        countryCode: locationCodes.countryCode || null,
        checkIn: plan.dates.checkIn,
        checkOut: plan.dates.checkOut,
      });
    }

    let options = [];
    if (candidateHotelIds.length) {
      let grouped = [];
      await provider.searchByHotelIdBatches({
        req: { id: `assistant-hotels-${Date.now()}`, query: {} },
        res: {
          json(payload) {
            grouped = Array.isArray(payload) ? payload : [];
            return payload;
          },
        },
        payloadOptions: {
          checkIn: plan.dates.checkIn,
          checkOut: plan.dates.checkOut,
          occupancies: buildHotelOccupancies(plan),
          nationality: passengerNationality,
          residence: passengerCountryOfResidence,
          cityCode: locationCodes.cityCode,
          countryCode: locationCodes.countryCode,
        },
        providedHotelIds: candidateHotelIds,
        credentials,
        cityCode: locationCodes.cityCode,
        queryAdvancedConditions: advancedConditions,
        advancedOperator: "AND",
        mergeMode: "lite",
      });
      options = flattenGroupedLiveOptions(grouped);
    } else {
      const { payload, requestAttributes } = buildSearchHotelsPayload({
        checkIn: plan.dates.checkIn,
        checkOut: plan.dates.checkOut,
        occupancies: buildHotelOccupancies(plan),
        nationality: passengerNationality,
        residence: passengerCountryOfResidence,
        cityCode: locationCodes.cityCode,
        countryCode: locationCodes.countryCode,
        resultsPerPage: limit * 2,
        advancedConditions,
        advancedOperator: "AND",
      });
      options = await provider.sendSearchRequest({
        req: { id: `assistant-hotels-${Date.now()}` },
        payload,
        requestAttributes,
        credentials,
      });
    }
    const mappedResults = await mapLiveHotelOptions({
      options,
      plan,
      limit,
      pricingRole,
      hotelFilters,
      coordinateFilter,
      proximityAnchor,
    });
    if (mappedResults.length) {
      emitSearchTrace(traceSink, "LIVE_RESULTS_READY", {
        label: `Live availability returned ${mappedResults.length} option${mappedResults.length === 1 ? "" : "s"}`,
        debugLabel: `Live provider returned ${mappedResults.length} mapped result(s)`,
        total: mappedResults.length,
      });
    }
    if (liveCacheKey && mappedResults.length) {
      await cache.set(
        liveCacheKey,
        {
          items: mappedResults,
          cachedAt: new Date().toISOString(),
        },
        LIVE_HOTEL_SEARCH_CACHE_TTL_SECONDS
      );
      console.log("[assistant][live-cache] STORE", {
        cityCode: locationCodes.cityCode || null,
        countryCode: locationCodes.countryCode || null,
        checkIn: plan.dates.checkIn,
        checkOut: plan.dates.checkOut,
        count: mappedResults.length,
        ttl: LIVE_HOTEL_SEARCH_CACHE_TTL_SECONDS,
      });
    }
    return mappedResults;
  } catch (error) {
    emitSearchTrace(traceSink, "LIVE_PROVIDER_FAILED", {
      label: "Live availability failed, using catalog fallback",
      debugLabel: `Live provider failed: ${error?.message || error}`,
    });
    console.warn("[assistant] live hotel search failed", error?.message || error);
    return [];
  }
};
export const searchHotelsForPlan = async (plan = {}, options = {}) => {
  const planLimit = typeof plan.limit === "number" && plan.limit > 0 ? plan.limit : null;
  const limit = clampLimit(planLimit || options.limit);
  const excludeIds = Array.isArray(options.excludeIds) ? options.excludeIds : [];
  const skipLive = options.skipLive === true;
  const traceSink = typeof options.traceSink === "function" ? options.traceSink : null;
  const pricingRole = toNumberOrNull(options.pricingRole) ?? 20;

  const prefFilters = deriveFiltersFromPreferences(plan);
  const hotelFiltersRaw = plan?.hotelFilters || {};
  const normalizedHotelFilters = {
    ...hotelFiltersRaw,
    amenityCodes: normalizeKeyList(hotelFiltersRaw.amenityCodes),
    amenityItemIds: normalizeIdList(hotelFiltersRaw.amenityItemIds),
    preferredOnly: normalizeBooleanFlag(hotelFiltersRaw.preferredOnly) || prefFilters.hotelPreferredOnly,
    minRating: toNumberOrNull(hotelFiltersRaw.minRating),
    starRatings: normalizeExactStarRatings(
      hotelFiltersRaw.starRatings ?? plan?.starRatings,
    ),
  };
  const referenceHotelIds = normalizeIdList(
    plan?.referenceHotelIds ?? plan?.semanticSearch?.referenceHotelIds,
  );
  const semanticCatalogContext = resolveSemanticCatalogContext({ plan });
  let latestHotelSearchScope = null;
  const finalizeHotelSearchResult = ({
    cards = [],
    matchType = "EXACT",
    metadata = {},
    planOverride = plan,
  } = {}) => {
    const finalized = finalizeScopedHotelSearchResult({
      cards,
      plan: planOverride || plan,
      limit,
      traceSink,
      matchType,
      metadata,
    });
    if (finalized?.searchScope) {
      latestHotelSearchScope = finalized.searchScope;
    }
    return finalized;
  };
  const planLocation = plan?.location;
  const shouldIgnoreSelfLandmark = isSelfReferentialLandmark(planLocation);
  if (shouldIgnoreSelfLandmark && planLocation) {
    console.log("[search:hotels] Ignoring self-referential landmark", {
      city: planLocation.city || null,
      country: planLocation.country || null,
      landmark: planLocation.landmark || null,
    });
    planLocation.landmark = null;
  }

  console.log(
    `[search:hotels] START — city:"${plan?.location?.city || ""}" country:"${plan?.location?.country || ""}"` +
    ` landmark:"${plan?.location?.landmark || ""}"` +
    ` minRating:${normalizedHotelFilters.minRating ?? "none"}` +
    ` starRatings:[${normalizedHotelFilters.starRatings.join(",")}]` +
    ` amenityCodes:[${normalizedHotelFilters.amenityCodes.join(",")}]` +
    ` preferredOnly:${normalizedHotelFilters.preferredOnly}` +
    ` limit:${limit}` +
    ` excludeIds:${excludeIds.length}`
  );

  debugSearchLog(`[DEBUG_SEARCH] searchHotelsForPlan invoked. Limit: ${limit}. Exclude count: ${excludeIds.length}`);
  if (excludeIds.length > 0) {
    debugSearchLog(
      `[DEBUG_SEARCH] Exclude Sample: ${excludeIds.slice(0, 3).join(", ")} (Type: ${typeof excludeIds[0]})`
    );
  }
  if (hasSemanticSearchIntent(plan)) {
    emitSearchTrace(
      traceSink,
      semanticCatalogContext?.cityCatalog
        ? "SEMANTIC_CITY_CATALOG_HIT"
        : "SEMANTIC_CITY_CATALOG_MISS",
      {
        city: plan?.location?.city || null,
        country: plan?.location?.country || null,
        requestedZones: Array.isArray(
          semanticCatalogContext?.profile?.requestedZones,
        )
          ? semanticCatalogContext.profile.requestedZones
          : [],
        requestedLandmarks: Array.isArray(
          semanticCatalogContext?.profile?.requestedLandmarks,
        )
          ? semanticCatalogContext.profile.requestedLandmarks
          : [],
        requestedAreaTraits: Array.isArray(
          semanticCatalogContext?.profile?.requestedAreaTraits,
        )
          ? semanticCatalogContext.profile.requestedAreaTraits
          : [],
      },
    );
  }

  // Resolve landmark to coordinates when the user asked for proximity to a place
  if (
    planLocation &&
    typeof planLocation.landmark === "string" &&
    planLocation.landmark.trim().length > 0 &&
    (toNumberOrNull(planLocation.lat) == null || toNumberOrNull(planLocation.lng) == null)
  ) {
    const landmarkQuery = [planLocation.landmark.trim(), planLocation.city, planLocation.country]
      .filter(Boolean)
      .join(", ");
    try {
      const poi = await resolvePoiToCoordinates(landmarkQuery);
      if (poi) {
        planLocation.lat = poi.lat;
        planLocation.lng = poi.lng;
        planLocation.resolvedPoi = { lat: poi.lat, lng: poi.lng, name: poi.name };
        debugSearchLog(`[DEBUG_SEARCH] Landmark resolved: "${landmarkQuery}" → ${poi.lat},${poi.lng} (${poi.name})`);
      }
    } catch (err) {
      console.warn("[assistant] resolvePoiToCoordinates failed", { landmark: planLocation.landmark, error: err?.message });
    }
  }

  const coordinateFilter = buildCoordinateFilterUsingRadius(plan?.location || {});
  const hasLocation = hasLocationConstraint(plan?.location || {});

  // Resolve proximity anchor once — used by both live and static hotel paths.
  const proximityAnchor = await resolveProximityAnchor(plan);
  const resolvedLocationCodes = await resolveWebbedsLocationCodes(plan?.location || {});
  if (resolvedLocationCodes?.resolvedCity?.name) {
    emitSearchTrace(traceSink, "CITY_RESOLVER_MATCHED", {
      label: `Matched destination: ${resolvedLocationCodes.resolvedCity.name}`,
      debugLabel:
        `City resolver matched ${resolvedLocationCodes.resolvedCity.name} ` +
        `(code:${resolvedLocationCodes.resolvedCity.code || "n/a"}, country:${resolvedLocationCodes.resolvedCity.country_name || resolvedLocationCodes.resolvedCity.country_code || "n/a"})`,
      destination: resolvedLocationCodes.resolvedCity.name,
    });
  }
  const requestedCityName =
    typeof plan?.location?.city === "string" && plan.location.city.trim()
      ? plan.location.city.trim()
      : "";
  const resolvedCityName =
    typeof resolvedLocationCodes?.resolvedCity?.name === "string" &&
    resolvedLocationCodes.resolvedCity.name.trim()
      ? resolvedLocationCodes.resolvedCity.name.trim()
      : requestedCityName;
  const cityNameFilterSource = requestedCityName || resolvedCityName;

  if (!skipLive) {
    const liveResults = await tryRunLiveHotelSearch({
      plan,
      limit,
      pricingRole,
      hotelFilters: normalizedHotelFilters,
      coordinateFilter,
      proximityAnchor,
      resolvedLocationCodes,
      traceSink,
    });

    if (liveResults.length) {
      const filteredLive = excludeIds.length
        ? liveResults.filter((r) => !excludeIds.includes(String(r.id || r.hotelCode)))
        : liveResults;

      if (filteredLive.length) {
        if (!shouldSupplementLiveResults({ liveResults: filteredLive, hotelFilters: normalizedHotelFilters, limit })) {
          emitSearchTrace(traceSink, "LIVE_RESULTS_SELECTED", {
            label: "Using live availability results",
            debugLabel: `Using ${filteredLive.length} live result(s) without static supplement`,
            total: filteredLive.length,
          });
          const finalLiveResult = finalizeHotelSearchResult({
            cards: filteredLive,
            matchType: "EXACT",
          });
          if (finalLiveResult.items.length) {
            return finalLiveResult;
          }
        }

        emitSearchTrace(traceSink, "SUPPLEMENTING_WITH_CATALOG", {
          label: "Adding catalog options to improve coverage",
          debugLabel: `Supplementing ${filteredLive.length} live result(s) with static catalog`,
        });

        const staticSupplement = await searchHotelsForPlan(plan, {
          ...options,
          skipLive: true,
          traceSink: null,
          excludeIds: [
            ...excludeIds,
            ...filteredLive.map((item) => String(item.id || item.hotelCode || "")).filter(Boolean),
          ],
          limit,
        });

        const supplementItems =
          staticSupplement?.matchType === "EXACT" ? staticSupplement.items || [] : [];
        const mergedItems = [...filteredLive, ...supplementItems].slice(0, limit);
        if (mergedItems.length) {
          emitSearchTrace(traceSink, "LIVE_RESULTS_SELECTED", {
            label: "Using live results with catalog backup",
            debugLabel: `Merged live ${filteredLive.length} + static ${supplementItems.length} = ${mergedItems.length}`,
            total: mergedItems.length,
          });
          console.log(
            `[search:hotels] live supplement → live:${filteredLive.length} static:${supplementItems.length} merged:${mergedItems.length}`
          );
          const finalMergedResult = finalizeHotelSearchResult({
            cards: mergedItems,
            matchType: "EXACT",
            metadata: {
              liveSupplemented: Boolean(supplementItems.length),
            },
          });
          if (finalMergedResult.items.length) {
            return finalMergedResult;
          }
        }

        emitSearchTrace(traceSink, "LIVE_RESULTS_SELECTED", {
          label: "Using live availability results",
          debugLabel: `Static supplement returned 0 items; keeping ${filteredLive.length} live result(s)`,
          total: filteredLive.length,
        });
        const fallbackLiveResult = finalizeHotelSearchResult({
          cards: filteredLive,
          matchType: "EXACT",
        });
        if (fallbackLiveResult.items.length) {
          return fallbackLiveResult;
        }
      }
    }
    emitSearchTrace(traceSink, "FALLBACK_TO_CATALOG", {
      label: "No live matches yet, switching to catalog search",
      debugLabel: "Live search returned 0 usable results; falling back to static DB",
    });
  }

  const where = {};

  // Relational Lookup for Static Data
  let cityCodes = [];
  let countryCodes = [];

  if (resolvedLocationCodes.cityCode) {
    cityCodes = [resolvedLocationCodes.cityCode];
    if (resolvedLocationCodes.resolvedCity) {
      console.log(
        `[search:hotels] Shared city resolver matched: ${resolvedLocationCodes.resolvedCity.name} ` +
        `(code:${resolvedLocationCodes.resolvedCity.code}, country:${resolvedLocationCodes.resolvedCity.country_name || resolvedLocationCodes.resolvedCity.country_code || "n/a"})`
      );
    }
  } else if (plan?.location?.city) {
    const filter = buildStringFilter(plan.location.city);
    debugSearchLog(`[DEBUG_SEARCH] Looking up City: "${plan.location.city}" (Filter: ${JSON.stringify(filter)})`);
    if (filter) {
      try {
        const foundCities = await models.WebbedsCity.findAll({
          where: { name: filter },
          attributes: ["code", "name", "country_name"],
          limit: 10
        });
        if (foundCities?.length) {
          cityCodes = foundCities.map(c => c.code);
          console.log(
            `[search:hotels] Cities found: ${foundCities
              .map((c) => `${c.name} (code:${c.code}, country:${c.country_name})`)
              .join(" | ")}`
          );
        } else {
          console.log(`[search:hotels] No cities found for "${plan.location.city}"`);
        }
      } catch (err) {
        debugSearchLog("[assistant] city lookup failed", err);
      }
    }
  }

  if (resolvedLocationCodes.countryCode) {
    countryCodes = [resolvedLocationCodes.countryCode];
  } else if (plan?.location?.country) {
    // Translate Spanish country name to English (WebBeds data is in English).
    const resolvedCountry = resolveCountryName(plan.location.country);
    const filter = buildStringFilter(resolvedCountry);
    debugSearchLog(`[DEBUG_SEARCH] Looking up Country: "${plan.location.country}" → resolved: "${resolvedCountry}"`);
    if (filter) {
      try {
        const foundCountries = await models.WebbedsCountry.findAll({
          where: { name: filter },
          attributes: ["code", "name"],
          limit: 5
        });
        if (foundCountries?.length) {
          countryCodes = foundCountries.map(c => c.code);
          console.log(
            `[search:hotels] Countries found: ${foundCountries.map((c) => `${c.name} (code:${c.code})`).join(" | ")}`
          );
        } else {
          console.log(`[search:hotels] No countries found for "${resolvedCountry}"`);
        }
      } catch (err) {
        debugSearchLog("[assistant] country lookup failed", err);
      }
    }
  }

  // Apply city filter: OR(city_code IN [...], city_name LIKE '%...%') so hotels matched by
  // coded city AND hotels with only city_name are both included. This is critical for providers
  // like WebBeds where many hotels have city_name but no city_code (or a different code).
  if (cityCodes.length > 0 && cityNameFilterSource) {
    const nameFilter = buildStringFilter(cityNameFilterSource);
    if (nameFilter) {
      where[Op.or] = [
        { city_code: { [Op.in]: cityCodes } },
        { city_name: nameFilter },
      ];
    } else {
      where.city_code = { [Op.in]: cityCodes };
    }
  } else if (cityCodes.length > 0) {
    where.city_code = { [Op.in]: cityCodes };
  } else if (cityNameFilterSource) {
    // Guard: if a landmark is set and the city lookup returned 0 codes, the city field might
    // actually be the landmark name (e.g. AI put "Burj Khalifa" in city instead of landmark).
    // Adding city_name LIKE '%Burj Khalifa%' would return 0 hotels. Skip this filter so the
    // coordinate filter (if resolved) or country filter can handle it instead.
    const hasLandmark = typeof plan?.location?.landmark === "string" && plan.location.landmark.trim().length > 0;
    if (!hasLandmark) {
      const filter = buildStringFilter(cityNameFilterSource);
      if (filter) where.city_name = filter;
    } else {
      console.log(`[search:hotels] Skipping city_name fallback (landmark set, city "${cityNameFilterSource}" not found in WebbedsCity)`);
    }
  }

  // Only apply country filter if city didn't capture it (or if checking same country)
  // However, usually we want strict filtering. If city is found, we assume it implies country.
  // If city is NOT found but country IS, we filter by country.
  if (!where[Op.or] && !where.city_code && !where.city_name) {
    if (countryCodes.length > 0) {
      where.country_code = { [Op.in]: countryCodes };
    } else if (plan?.location?.country) {
      const filter = buildStringFilter(plan.location.country);
      if (filter) where.country_name = filter;
    }
  }
  // Only use coordinate filter in SQL when there's no city/country filter already applied.
  // When a city is set, the coordinate comes from a landmark resolution (e.g. "cerca del Burj Khalifa
  // en Dubai") — hotels in that city may not have lat/lng populated, so adding a bbox AND city filter
  // would return 0 results. The landmark is used for ranking only (resolvedPoi), not hard filtering.
  const hasLocationFilter = Boolean(where[Op.or] || where.city_code || where.city_name || where.country_code || where.country_name);
  if (coordinateFilter && !hasLocationFilter) {
    where.lat = coordinateFilter.latitude;
    where.lng = coordinateFilter.longitude;
  }
  // NOTE: preferredOnly is intentionally NOT added to the SQL WHERE.
  // Adding preferred=true in SQL would make the relaxed fallback useless (it reuses the
  // same DB rows — 0 rows if no preferred hotel matches the city+star criteria).
  // Instead, preferredOnly is enforced by applyHotelFilters (post-filter). When 0 hotels
  // pass that filter, the relaxed fallback strips it and returns city+star-filtered hotels.

  // Apply SQL-level classification_code filter when minRating is set.
  // IMPORTANT: classification_code is a BIGINT FK to webbeds_hotel_classification.code —
  // WebBeds codes are NOT 1-5 (e.g., 563 = Luxury/*****). Use the lookup table.
  const exactStarRatings = normalizeExactStarRatings(
    normalizedHotelFilters.starRatings,
  );
  const hasExactStarRequest = exactStarRatings.length > 0;
  const minStar =
    !hasExactStarRequest &&
    normalizedHotelFilters.minRating != null &&
    Number.isFinite(normalizedHotelFilters.minRating)
      ? Math.round(normalizedHotelFilters.minRating)
      : null;
  if (hasExactStarRequest) {
    const exactCodes = resolveClassificationCodesForExactRatings(
      exactStarRatings,
    );
    if (exactCodes.length) {
      where.classification_code = { [Op.in]: exactCodes };
      debugSearchLog(
        `[DEBUG_SEARCH] SQL exact star filter: classification_code IN (${exactCodes.join(",")}) [stars=${exactStarRatings.join(",")}]`,
      );
      console.log(
        `[search:hotels] SQL exact star filter: [${exactStarRatings.join(",")}] → classification_code IN (${exactCodes.join(",")})`,
      );
    }
  } else if (minStar != null) {
    const eligibleCodes = resolveClassificationCodesForMinRating(minStar);
    if (eligibleCodes.length) {
      where.classification_code = { [Op.in]: eligibleCodes };
      debugSearchLog(`[DEBUG_SEARCH] SQL minRating filter: classification_code IN (${eligibleCodes.join(",")}) [minStar=${minStar}]`);
      console.log(`[search:hotels] SQL star filter: ${minStar}★+ → classification_code IN (${eligibleCodes.join(",")})`);
    }
  }

  debugSearchLog(`[DEBUG_SEARCH] Final Query "where" clause:`, JSON.stringify(where, null, 2));

  if (excludeIds.length) {
    where.hotel_id = { [Op.notIn]: excludeIds };
  }
  if (referenceHotelIds.length) {
    const existingHotelIdConstraint = where.hotel_id;
    if (existingHotelIdConstraint?.[Op.notIn]) {
      where.hotel_id = {
        [Op.in]: referenceHotelIds.filter(
          (hotelId) => !existingHotelIdConstraint[Op.notIn].includes(hotelId),
        ),
      };
    } else {
      where.hotel_id = { [Op.in]: referenceHotelIds };
    }
  }

  // When minRating is set, SQL already pre-filters by classification_code so fetchMultiplier=1 is
  // sufficient (no over-fetch needed). For amenity codes we still need the multiplier.
  const fetchMultiplier =
    normalizedHotelFilters.amenityCodes.length || normalizedHotelFilters.amenityItemIds.length
      ? 3
      : 1;
  const fetchLimit = clampLimit(limit * fetchMultiplier);
  const budgetMax = resolveBudgetMax(plan);
  const tryNearbyGeoFallbackSearch = async () => {
    const originalDestination = resolveNearbyFallbackOriginalDestination(plan);
    const anchor = await resolveNearbyFallbackAnchor(plan);
    emitSearchTrace(traceSink, "NEARBY_GEO_FALLBACK_REQUESTED", {
      label: "Trying nearby geographic fallback",
      debugLabel: `Nearby fallback requested for ${originalDestination || "unknown destination"}`,
      originalDestination,
      anchorLabel: anchor?.label || null,
      anchorSource: anchor?.source || null,
      hasLiveContext:
        Boolean(plan?.dates?.checkIn) &&
        Boolean(plan?.dates?.checkOut) &&
        resolveGuestTotal(plan) != null,
      mode: "CATALOG_GEO_EXPANSION",
    });
    if (!anchor || anchor.lat == null || anchor.lng == null) {
      latestHotelSearchScope = {
        ...(latestHotelSearchScope && typeof latestHotelSearchScope === "object"
          ? latestHotelSearchScope
          : {}),
        nearbyFallbackApplied: false,
        nearbyFallbackMode: "CATALOG_GEO_EXPANSION",
        nearbyFallbackAnchorLabel: anchor?.label || null,
        nearbyFallbackRadiiTried: [],
        nearbyFallbackWinningRadiusMeters: null,
        nearbyFallbackCities: [],
        nearbyFallbackOriginalDestination: originalDestination,
      };
      emitSearchTrace(traceSink, "NEARBY_GEO_FALLBACK_EMPTY", {
        label: "Nearby fallback skipped",
        debugLabel: "Nearby fallback could not resolve a geographic anchor",
        originalDestination,
        reason: "anchor_unresolved",
      });
      return null;
    }

    const nearbySearchFilters = {
      ...normalizedHotelFilters,
      preferredOnly: false,
    };
    const nearbyExactStarRatings = normalizeExactStarRatings(
      nearbySearchFilters.starRatings,
    );
    const nearbyHasExactStarRequest = nearbyExactStarRatings.length > 0;
    const nearbyMinStar =
      !nearbyHasExactStarRequest &&
      nearbySearchFilters.minRating != null &&
      Number.isFinite(nearbySearchFilters.minRating)
        ? Math.round(nearbySearchFilters.minRating)
        : null;
    const radiiTried = [];

    for (const radiusMeters of NEARBY_GEO_FALLBACK_RADII_METERS) {
      radiiTried.push(radiusMeters);
      emitSearchTrace(traceSink, "NEARBY_GEO_FALLBACK_RADIUS_ATTEMPT", {
        label: "Expanding search radius",
        debugLabel: `Nearby fallback trying radius ${radiusMeters}m around ${anchor.label || originalDestination || "anchor"}`,
        originalDestination,
        anchorLabel: anchor.label || null,
        anchorSource: anchor.source || null,
        radiusMeters,
      });

      const nearbyPlan = buildNearbyFallbackSafePlan(plan, anchor, radiusMeters);
      const nearbyWhere = {};
      if (excludeIds.length) {
        nearbyWhere.hotel_id = { [Op.notIn]: excludeIds };
      }
      if (nearbyHasExactStarRequest) {
        const exactCodes = resolveClassificationCodesForExactRatings(
          nearbyExactStarRatings,
        );
        if (exactCodes.length) {
          nearbyWhere.classification_code = { [Op.in]: exactCodes };
        }
      } else if (nearbyMinStar != null) {
        const eligibleCodes = resolveClassificationCodesForMinRating(
          nearbyMinStar,
        );
        if (eligibleCodes.length) {
          nearbyWhere.classification_code = { [Op.in]: eligibleCodes };
        }
      }

      const nearbyCoordinateFilter = buildCoordinateFilterUsingRadius(
        nearbyPlan.location || {},
      );
      if (nearbyCoordinateFilter) {
        nearbyWhere.lat = nearbyCoordinateFilter.latitude;
        nearbyWhere.lng = nearbyCoordinateFilter.longitude;
      }
      const nearbyProximityAnchor = {
        type: "PLACE_TARGET",
        target: {
          name: anchor.label || originalDestination || null,
          lat: anchor.lat,
          lng: anchor.lng,
          radiusMeters,
        },
      };

      let nearbyCards = await runStaticHotelQuery(nearbyWhere, {
        normalizedHotelFilters: nearbySearchFilters,
        fetchLimit,
        limit,
        coordinateFilter: nearbyCoordinateFilter,
        hasLocationFilter: false,
        budgetMax,
        plan: nearbyPlan,
        proximityAnchor: nearbyProximityAnchor,
        traceSink,
      });
      nearbyCards = sortByProximity(nearbyCards, nearbyProximityAnchor);
      if (!nearbyCards.length) {
        continue;
      }

      const nearbyResult = finalizeHotelSearchResult({
        cards: nearbyCards,
        matchType: "SIMILAR",
        planOverride: nearbyPlan,
        metadata: {
          searchScopePatch: {
            nearbyFallbackApplied: true,
            nearbyFallbackMode: "CATALOG_GEO_EXPANSION",
            nearbyFallbackAnchorLabel: anchor.label || null,
            nearbyFallbackRadiiTried: radiiTried.slice(),
            nearbyFallbackWinningRadiusMeters: radiusMeters,
            nearbyFallbackCities: [],
            nearbyFallbackOriginalDestination: originalDestination,
          },
        },
      });
      if (!nearbyResult.items.length) {
        continue;
      }

      const nearbyCities = deriveNearbyFallbackCities({
        items: nearbyResult.items,
        anchor,
      });
      nearbyResult.searchScope = {
        ...(nearbyResult.searchScope && typeof nearbyResult.searchScope === "object"
          ? nearbyResult.searchScope
          : {}),
        nearbyFallbackApplied: true,
        nearbyFallbackMode: "CATALOG_GEO_EXPANSION",
        nearbyFallbackAnchorLabel: anchor.label || null,
        nearbyFallbackRadiiTried: radiiTried.slice(),
        nearbyFallbackWinningRadiusMeters: radiusMeters,
        nearbyFallbackCities: nearbyCities,
        nearbyFallbackOriginalDestination: originalDestination,
      };
      latestHotelSearchScope = nearbyResult.searchScope;
      emitSearchTrace(traceSink, "NEARBY_GEO_FALLBACK_APPLIED", {
        label: "Using nearby catalog options",
        debugLabel:
          `Nearby fallback found ${nearbyResult.items.length} option(s) within ${radiusMeters}m` +
          `${nearbyCities.length ? ` in ${nearbyCities.join(", ")}` : ""}`,
        originalDestination,
        anchorLabel: anchor.label || null,
        anchorSource: anchor.source || null,
        radiusMeters,
        total: nearbyResult.items.length,
        cities: nearbyCities,
      });
      await enrichCardsWithAmenitiesFromTable(nearbyResult.items);
      return nearbyResult;
    }

    latestHotelSearchScope = {
      ...(latestHotelSearchScope && typeof latestHotelSearchScope === "object"
        ? latestHotelSearchScope
        : {}),
      nearbyFallbackApplied: false,
      nearbyFallbackMode: "CATALOG_GEO_EXPANSION",
      nearbyFallbackAnchorLabel: anchor.label || null,
      nearbyFallbackRadiiTried: radiiTried,
      nearbyFallbackWinningRadiusMeters: null,
      nearbyFallbackCities: [],
      nearbyFallbackOriginalDestination: originalDestination,
    };
    emitSearchTrace(traceSink, "NEARBY_GEO_FALLBACK_EMPTY", {
      label: "Nearby fallback returned no options",
      debugLabel:
        `Nearby fallback found no hotels after radii ${radiiTried.join(", ")}m`,
      originalDestination,
      anchorLabel: anchor.label || null,
      anchorSource: anchor.source || null,
      radiiTried,
      reason: "no_results",
    });
    return null;
  };

  const hotels = await models.WebbedsHotel.findAll({
    where,
    attributes: STATIC_HOTEL_ATTRS,
    include: STATIC_HOTEL_INCLUDE,
    order: [
      ["preferred", "DESC"],
      ["priority", "DESC"],
      ["name", "ASC"],
    ],
    limit: fetchLimit,
  });

  let cards = hotels.map(formatStaticHotel).filter(Boolean);
  console.log(`[search:hotels] DB → ${hotels.length} hotels fetched, ${cards.length} mapped OK`);

  cards = await applyHotelFilters(cards, normalizedHotelFilters);
  console.log(`[search:hotels] Post-filter → ${cards.length} hotels passed (minRating:${normalizedHotelFilters.minRating ?? "none"}, amenityCodes:[${normalizedHotelFilters.amenityCodes.join(",")}], preferredOnly:${normalizedHotelFilters.preferredOnly})`);

  // When city was used as SQL filter (coordinate skipped), apply proximity as a soft post-filter.
  // Only keep hotels that have lat/lng AND are within the landmark bbox.
  // If none have coordinates → fall through with all city results (better than nothing).
  if (coordinateFilter && hasLocationFilter) {
    const nearbyCards = cards.filter(
      (card) => card.geoPoint && matchesCoordinateFilter(card.geoPoint, coordinateFilter)
    );
    if (nearbyCards.length) {
      cards = nearbyCards;
      debugSearchLog(`[DEBUG_SEARCH] Proximity post-filter: ${nearbyCards.length} of ${cards.length + (cards.length - nearbyCards.length)} hotels near landmark`);
    } else {
      debugSearchLog(`[DEBUG_SEARCH] Proximity post-filter: no hotels with geoPoint near landmark, returning all city results`);
    }
  }

  // Apply budget.max filter when the user specified an explicit numeric price cap.
  if (budgetMax != null) {
    const beforeBudget = cards.length;
    cards = cards.filter(
      (card) => toNumberOrNull(card.pricePerNight) == null || toNumberOrNull(card.pricePerNight) <= budgetMax
    );
    console.log(`[search:hotels] Budget filter (max ${budgetMax}): ${beforeBudget} → ${cards.length} hotels`);
  }

  // Proximity sort takes priority when user requested CITY_CENTER or nearbyInterest.
  // Otherwise fall back to plan.sortBy (default PRICE_ASC).
  if (proximityAnchor) {
    cards = sortByProximity(cards, proximityAnchor);
  } else {
    const sortByStatic = String(plan?.sortBy || "PRICE_ASC").trim().toUpperCase();
    if (sortByStatic === "PRICE_DESC") {
      cards.sort((a, b) => (toNumberOrNull(b.pricePerNight) ?? 0) - (toNumberOrNull(a.pricePerNight) ?? 0));
    } else if (sortByStatic === "PRICE_ASC") {
      cards.sort((a, b) => (toNumberOrNull(a.pricePerNight) ?? Number.MAX_SAFE_INTEGER) - (toNumberOrNull(b.pricePerNight) ?? Number.MAX_SAFE_INTEGER));
    }
    // POPULARITY and RELEVANCE: DB already ordered by preferred DESC, priority DESC — keep as-is.
  }

  cards = applySemanticHotelRanking(cards, plan);
  emitSemanticCandidateMatchTrace(traceSink, plan, cards);
  cards = mapHotelCardsForOutput({ cards, plan, limit });

  const starFallbackOrder = [["classification_code", "DESC"], ["preferred", "DESC"], ["priority", "DESC"], ["name", "ASC"]];
  if (
    !hasExactStarRequest &&
    cards.length > 0 &&
    cards.length < MIN_STAR_FALLBACK_THRESHOLD &&
    minStar != null &&
    minStar >= 4
  ) {
    const relaxedCodes = resolveClassificationCodesForMinRating(minStar - 1);
    if (relaxedCodes.length) {
      const whereRelaxed = { ...where, classification_code: { [Op.in]: relaxedCodes } };
      const relaxedCardsFromStars = await runStaticHotelQuery(whereRelaxed, {
        normalizedHotelFilters: { ...normalizedHotelFilters, minRating: minStar - 1 },
        fetchLimit,
        limit,
        coordinateFilter,
        hasLocationFilter,
        budgetMax,
        plan,
        proximityAnchor,
        orderOverride: starFallbackOrder,
      });
      // Return relaxed only when we have enough (>= threshold) or strictly more than strict 5★.
      // Otherwise try no-star so "Dubai 5★" can show all Dubai hotels when 4+5★ still returns few.
      const relaxedEnough = relaxedCardsFromStars.length >= MIN_STAR_FALLBACK_THRESHOLD || relaxedCardsFromStars.length > cards.length;
      if (relaxedEnough) {
        emitSearchTrace(traceSink, "RELAXING_FILTERS", {
          label: "Relaxing star filters to avoid empty results",
          debugLabel: `Relaxed star filter from ${minStar}+ to ${minStar - 1}+ and got ${relaxedCardsFromStars.length} item(s)`,
        });
        console.log(`[search:hotels] Star filter relaxed: ${minStar}★ returned ${cards.length}, using ${minStar - 1}+★ → ${relaxedCardsFromStars.length} items`);
        const finalRelaxedStarsResult = finalizeHotelSearchResult({
          cards: relaxedCardsFromStars,
          matchType: "EXACT",
          metadata: { starFilterRelaxed: true },
        });
        if (finalRelaxedStarsResult.items.length) {
          await enrichCardsWithAmenitiesFromTable(finalRelaxedStarsResult.items);
          return finalRelaxedStarsResult;
        }
      }
    }

    if (hasLocationFilter && cards.length < MIN_STAR_FALLBACK_THRESHOLD) {
      const { classification_code: _drop, ...whereNoStars } = where;
      const allCards = await runStaticHotelQuery(whereNoStars, {
        normalizedHotelFilters: { ...normalizedHotelFilters, minRating: null },
        fetchLimit,
        limit,
        coordinateFilter,
        hasLocationFilter,
        budgetMax,
        plan,
        proximityAnchor,
        orderOverride: starFallbackOrder,
      });
      if (allCards.length > cards.length) {
        emitSearchTrace(traceSink, "RELAXING_FILTERS", {
          label: "Removing strict star filters to find more options",
          debugLabel: `Dropped star filter ${minStar}+ and found ${allCards.length} item(s)`,
        });
        console.log(`[search:hotels] Star filter dropped: ${minStar}★ returned ${cards.length}, using all stars in location → ${allCards.length} items`);
        const finalDroppedStarsResult = finalizeHotelSearchResult({
          cards: allCards,
          matchType: "EXACT",
          metadata: { starFilterRelaxed: true },
        });
        if (finalDroppedStarsResult.items.length) {
          await enrichCardsWithAmenitiesFromTable(finalDroppedStarsResult.items);
          return finalDroppedStarsResult;
        }
      }
    }
  }

  if (cards.length) {
    console.log(`[search:hotels] RESULT: EXACT — ${cards.length} items`);
    const finalExactResult = finalizeHotelSearchResult({
      cards,
      matchType: "EXACT",
    });
    if (finalExactResult.items.length) {
      await enrichCardsWithAmenitiesFromTable(finalExactResult.items);
      return finalExactResult;
    }
  }

  // Relaxed fallback: only relax preferred-only. Explicit amenities, budget caps and
  // exact star requests remain hard constraints in Semantic Search V1.
  console.log(
    `[search:hotels] strict=0 → relaxed fallback (${hotels.length} DB hotels, dropping preferredOnly only)`,
  );
  let relaxedCards = hotels.map(formatStaticHotel).filter(Boolean);
  const relaxedHardFilters = {
    ...normalizedHotelFilters,
    preferredOnly: false,
  };
  const relaxedHardFilteredCards = await applyHotelFilters(
    relaxedCards,
    relaxedHardFilters,
  );
  if (relaxedHardFilteredCards.length) {
    relaxedCards = relaxedHardFilteredCards;
  }
  const relaxedReason = pickSemanticCopy(resolveSemanticLanguage(plan), {
    es: "Opciones cercanas a tu pedido, sin exigir catálogo preferido",
    en: "Close matches without requiring preferred-catalog status",
    pt: "Opções próximas ao seu pedido sem exigir catálogo preferido",
  });
  relaxedCards = applySemanticHotelRanking(relaxedCards, plan);
  relaxedCards = mapHotelCardsForOutput({
    cards: relaxedCards,
    plan,
    limit,
    extraReasons: relaxedReason ? [relaxedReason] : [],
  });
  if (relaxedCards.length) {
    emitSearchTrace(traceSink, "RELAXING_FILTERS", {
      label: "Relaxing some filters to avoid an empty result",
      debugLabel: `Strict filters returned 0; relaxed fallback produced ${relaxedCards.length} item(s)`,
    });
    console.log(`[search:hotels] RESULT: SIMILAR (relaxed) — ${relaxedCards.length} items`);
    const finalRelaxedResult = finalizeHotelSearchResult({
      cards: relaxedCards,
      matchType: "SIMILAR",
    });
    if (finalRelaxedResult.items.length) {
      await enrichCardsWithAmenitiesFromTable(finalRelaxedResult.items);
      return finalRelaxedResult;
    }
  }

  if (hasLocation) {
    console.log(`[search:hotels] RESULT: NONE — location constraint present but 0 matches`);
    const nearbyFallbackResult = await tryNearbyGeoFallbackSearch();
    if (nearbyFallbackResult?.items?.length) {
      console.log(
        `[search:hotels] RESULT: SIMILAR (nearby fallback) - ${nearbyFallbackResult.items.length} items`,
      );
      return nearbyFallbackResult;
    }
    console.log("[search:hotels] FINAL RESULT: NONE after nearby fallback");
    debugSearchLog("[assistant] no fallback hotels; location constraint present");
    return {
      items: [],
      matchType: "NONE",
      searchScope: latestHotelSearchScope,
    };
  }

  const fallbackWhere = {};
  if (excludeIds.length) {
    fallbackWhere.hotel_id = { [Op.notIn]: excludeIds };
  }

  const fallbackHotels = await models.WebbedsHotel.findAll({
    where: fallbackWhere,
    attributes: [
      "hotel_id",
      "name",
      "city_name",
      "city_code",
      "country_name",
      "country_code",
      "address",
      "full_address",
      "lat",
      "lng",
      "rating",
      "priority",
      "preferred",
      "exclusive",
      "chain",
      "chain_code",
      "classification_code",
      "images",
      "amenities",
      "leisure",
      "business",
      "descriptions",
    ],
    include: [
      {
        model: models.WebbedsHotelChain,
        as: "chainCatalog",
        attributes: ["code", "name"],
      },
      {
        model: models.WebbedsHotelClassification,
        as: "classification",
        attributes: ["code", "name"],
      },
    ],
    order: [
      ["preferred", "DESC"],
      ["priority", "DESC"],
      ["name", "ASC"],
    ],
    limit: fetchLimit,
  });

  let fallbackCardsPool = fallbackHotels.map(formatStaticHotel).filter(Boolean);
  fallbackCardsPool = await applyHotelFilters(fallbackCardsPool, {
    ...normalizedHotelFilters,
    preferredOnly: false,
  });
  const fallbackReason = pickSemanticCopy(resolveSemanticLanguage(plan), {
    es: "Opciones recomendadas basadas en tu búsqueda",
    en: "Recommended options based on your search",
    pt: "Opções recomendadas com base na sua busca",
  });
  const fallbackCards = mapHotelCardsForOutput({
    cards: applySemanticHotelRanking(fallbackCardsPool, plan),
    plan,
    limit,
    extraReasons: fallbackReason ? [fallbackReason] : [],
  });

  const finalFallbackResult = finalizeHotelSearchResult({
    cards: fallbackCards,
    matchType: fallbackCards.length ? "SIMILAR" : "NONE",
  });
  const finalMatchType = finalFallbackResult.items.length ? "SIMILAR" : "NONE";
  emitSearchTrace(traceSink, "GLOBAL_FALLBACK_RESULTS", {
    label: finalFallbackResult.items.length
      ? "Using broader fallback recommendations"
      : "No fallback recommendations available",
    debugLabel: `Global fallback returned ${finalFallbackResult.items.length} visible item(s)`,
    total: finalFallbackResult.items.length,
  });
  console.log(`[search:hotels] RESULT: ${finalMatchType} (global fallback) — ${fallbackCards.length} items`);
  if (finalFallbackResult.items.length) {
    await enrichCardsWithAmenitiesFromTable(finalFallbackResult.items);
    return finalFallbackResult;
  }
  return {
    items: [],
    matchType: "NONE",
    searchScope: latestHotelSearchScope,
  };
};
