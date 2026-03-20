import { generateAssistantReply, generateAssistantReplyStream } from "../../services/aiAssistant.service.js";
import { NEXT_ACTIONS } from "./ai.planner.js";
import { AI_DEFAULTS } from "./ai.config.js";

const DEFAULT_TONE = "neutral";

const normalizeLanguage = (plan) => {
  const lang = typeof plan?.language === "string" ? plan.language.toLowerCase() : "";
  if (lang.startsWith("es")) return "es";
  if (lang.startsWith("pt")) return "pt";
  if (lang.startsWith("en")) return "en";
  return AI_DEFAULTS.language || "es";
};

const copyForLanguage = (language, values = {}) =>
  values?.[language] || values?.en || values?.es || "";

const localeForLanguage = (language) => {
  if (language === "es") return "es-ES";
  if (language === "pt") return "pt-BR";
  return "en-US";
};

const normalizeDisplayCurrencyCode = (value) => {
  const raw = String(value || "USD").trim().toUpperCase();
  if (!raw) return "USD";
  if (/^\d+$/.test(raw)) {
    if (raw === "520" || raw === "840") return "USD";
    if (raw === "978") return "EUR";
    if (raw === "826") return "GBP";
    if (raw === "124") return "CAD";
    if (raw === "036" || raw === "36") return "AUD";
    return "USD";
  }
  return raw.slice(0, 3) || "USD";
};

/**
 * Detect reply language from the latest user message only.
 * Priority: user's message language over plan/app/profile.
 * Supports: es, en, ar (and more can be added).
 */
const detectLanguageFromMessages = (messages, fallback) => {
  const latestUserMessage =
    Array.isArray(messages) &&
    [...messages].reverse().find((msg) => msg?.role === "user" && msg?.content)?.content;
  const raw = String(latestUserMessage || "").trim();
  const normalized = ` ${raw.toLowerCase()} `;

  // Arabic: script or common words
  if (/\p{Script=Arabic}/u.test(raw)) return "ar";
  const arabicHints = [" مرحبا", " شكرا", " من فضلك", " اريد", " فندق", " سفر"];
  if (arabicHints.some((hint) => raw.includes(hint) || normalized.includes(hint.toLowerCase()))) return "ar";

  // Spanish: common words/chars
  const spanishHints = [
    " hola ", " gracias", " por favor", " necesito", " buscar", " alojamiento",
    " casa ", " hotel ", " habitaciones", " quiero", " viajar", " reservar",
    " donde", " dónde", " cuando", " cuándo", " cuantos", " personas", " fechas",
    " puedes ", " mostrarme", " mostrame", " disponibilidad", " precio ",
    " precios ", " cuales ", " cuáles ", " de esos ", " esos ", " tienen ",
    " pileta", " piscina", " viajeros", " huespedes", " huéspedes",
  ];
  const hasSpanishChars = /[áéíóúñü¿¡]/.test(raw);
  if (hasSpanishChars || spanishHints.some((hint) => normalized.includes(hint))) return "es";

  // English
  const englishHints = [" hello ", " hi ", " please ", " thanks", " looking", " need ", " hotel", " house ", " want ", " travel ", " book ", " where ", " when ", " how many "];
  if (englishHints.some((hint) => normalized.includes(hint))) return "en";

  return fallback || "es";
};

const promptByAction = {
  [NEXT_ACTIONS.ASK_FOR_DESTINATION]: {
    es: [
      "¿A dónde te gustaría viajar?",
      "¿Qué destino tenés en mente?",
      "Decime a dónde querés ir.",
    ],
    en: [
      "Where do you want to travel?",
      "What destination are you thinking?",
      "Tell me where you'd like to go.",
    ],
  },
  [NEXT_ACTIONS.ASK_FOR_DATES]: {
    es: [
      "¿Qué fechas tenés en mente?",
      "¿Cuándo sería el viaje?",
      "Decime las fechas de entrada y salida.",
    ],
    en: [
      "What dates are you thinking?",
      "When is the trip?",
      "Tell me your check-in and check-out dates.",
    ],
  },
  [NEXT_ACTIONS.ASK_FOR_GUESTS]: {
    es: [
      "¿Cuántas personas viajan?",
      "¿Cuántos serían?",
      "Decime cuántos adultos y niños.",
    ],
    en: [
      "How many guests are traveling?",
      "How many people?",
      "Tell me how many adults and children.",
    ],
  },
};

const promptDatesAndGuests = {
  es: [
    "Genial. ¿Cuántas personas y para qué fechas?",
    "Perfecto. ¿Cuántos viajan y cuándo?",
    "Dale. Necesito fechas y cantidad de personas para mostrarte precios y disponibilidad.",
  ],
  en: [
    "Great. How many people and what dates?",
    "Sure. When are you going and how many guests?",
    "Got it. I need dates and guest count to show you prices and availability.",
  ],
};

/** Pick one variant to avoid repetitive bot-like replies. */
const pickVariant = (arr, seed) => {
  if (!Array.isArray(arr) || !arr.length) return null;
  const idx = typeof seed === "number" && Number.isFinite(seed)
    ? Math.abs(Math.floor(seed)) % arr.length
    : Math.floor(Math.random() * arr.length);
  return arr[idx];
};

const inputByAction = {
  [NEXT_ACTIONS.ASK_FOR_DESTINATION]: [{ type: "destination", id: "DESTINATION", required: true }],
  [NEXT_ACTIONS.ASK_FOR_DATES]: [{ type: "dateRange", id: "DATES", required: true }],
  [NEXT_ACTIONS.ASK_FOR_GUESTS]: [{ type: "guestCount", id: "GUESTS", required: true }],
};

const toChipId = (label, index) => {
  const normalized = String(label || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `CHIP_${index + 1}`;
};

const buildChips = (followUps = []) =>
  followUps.map((label, index) => ({
    id: toChipId(label, index),
    label,
  }));

const mapStayCard = (item, type, { isLiveMode = false } = {}) => {
  if (!item) return null;
  const id = String(item.id || item.hotelCode || item.homeId || "");
  if (!id) return null;
  const title = item.title || item.name || "Stay";
  const locationText = item.locationText || item.city || item.country || null;
  const numericPrice = toNum(item?.pricePerNight ?? item?.price ?? null);
  return {
    type: "stay",
    id,
    title,
    subtitle: locationText,
    priceFrom: isLiveMode && numericPrice != null && numericPrice > 0 ? numericPrice : null,
    currency: normalizeDisplayCurrencyCode(item.currency || "USD"),
    image: item.coverImage || item.image || null,
    meta: {
      kind: type,
      inventoryType: item.inventoryType || type,
      livePricing: isLiveMode,
    },
  };
};

const buildCards = (inventory, { isLiveMode = false } = {}) => {
  const homes = Array.isArray(inventory?.homes) ? inventory.homes : [];
  const hotels = Array.isArray(inventory?.hotels) ? inventory.hotels : [];
  return [
    ...homes.map((item) => mapStayCard(item, "HOME", { isLiveMode })),
    ...hotels.map((item) => mapStayCard(item, "HOTEL", { isLiveMode })),
  ].filter(Boolean);
};

const clampText = (value, max = 160) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

const firstSentence = (value) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const match = text.match(/(.+?[.!?])(?:\s|$)/);
  return clampText(match ? match[1] : text);
};

const normalizeStars = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.max(1, Math.min(5, Math.round(numeric)));
};

const pickAmenityLabels = (item, max = 2) => {
  const raw =
    (Array.isArray(item?.amenityHighlights) && item.amenityHighlights) ||
    (Array.isArray(item?.amenities) && item.amenities) ||
    (Array.isArray(item?.hotelDetails?.amenities) && item.hotelDetails.amenities) ||
    [];
  return raw
    .map((entry) => {
      if (!entry) return "";
      if (typeof entry === "string") return entry.trim();
      if (typeof entry?.name === "string") return entry.name.trim();
      if (typeof entry?.label === "string") return entry.label.trim();
      return "";
    })
    .filter(Boolean)
    .slice(0, max);
};

const getTopInventoryPicks = (inventory, max = 5) => {
  const hotels = Array.isArray(inventory?.hotels) ? inventory.hotels : [];
  const homes = Array.isArray(inventory?.homes) ? inventory.homes : [];
  const source = hotels.length ? hotels : homes;
  return source.slice(0, max);
};

const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const getItemRating = (item) =>
  toNum(item?.reviewScore ?? item?.rating ?? item?.stars ?? item?.starRating ?? item?.classification?.code ?? item?.hotelDetails?.rating) ?? 0;
const getItemPrice = (item) =>
  toNum(item?.pricePerNight ?? item?.price ?? item?.nightlyRate) ?? 999999;
const hasUsablePrice = (item) => {
  const price = toNum(item?.pricePerNight ?? item?.price ?? item?.nightlyRate);
  return price != null && price > 0;
};
const hasLiveSearchContext = (plan) => {
  const hasDates = Boolean(plan?.dates?.checkIn && plan?.dates?.checkOut);
  const adults = Number(plan?.guests?.adults);
  const total = Number(plan?.guests?.total);
  return hasDates && (
    (Number.isFinite(adults) && adults > 0) ||
    (Number.isFinite(total) && total > 0)
  );
};
const getItemCoords = (item) => {
  const lat = toNum(
    item?.latitude ?? item?.lat ?? item?.locationLat ?? item?.location?.lat ?? item?.geoPoint?.lat
    ?? item?.full_address?.latitude ?? item?.hotelDetails?.latitude ?? item?.hotelDetails?.lat
  );
  const lng = toNum(
    item?.longitude ?? item?.lng ?? item?.locationLng ?? item?.location?.lng ?? item?.geoPoint?.lng
    ?? item?.full_address?.longitude ?? item?.hotelDetails?.longitude ?? item?.hotelDetails?.lng
  );
  return lat != null && lng != null ? { lat, lng } : null;
};
const distanceKm = (a, b) => {
  if (!a?.lat || !a?.lng || !b?.lat || !b?.lng) return null;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

/** Catalog of recommendation reasons (≥10). Categories: rating, priceQuality, location, general. */
const PICK_REASON_CATALOG = {
  rating: [
    { es: "Mayor valoración", en: "Top rated" },
    { es: "Mejor puntuado", en: "Highest rated" },
    { es: "Destacado por reseñas", en: "Rated by guests" },
    { es: "Muy bien valorado", en: "Highly rated" },
    { es: "Excelente puntuación", en: "Excellent rating" },
  ],
  priceQuality: [
    { es: "Precio/calidad", en: "Price/quality" },
    { es: "Mejor relación precio-calidad", en: "Best value" },
    { es: "Buena relación calidad-precio", en: "Great value" },
    { es: "Precio justo para lo que ofrece", en: "Fair price" },
    { es: "Oferta destacada", en: "Standout deal" },
  ],
  location: [
    { es: "Cerca del centro", en: "Near the center" },
    { es: "Buena ubicación", en: "Great location" },
    { es: "Bien ubicado", en: "Well located" },
    { es: "Zona céntrica", en: "Central area" },
    { es: "Ubicación privilegiada", en: "Prime location" },
  ],
  general: [
    { es: "Recomendado", en: "Recommended" },
    { es: "Recomendación BookingGPT", en: "BookingGPT pick" },
    { es: "Opción destacada", en: "Featured option" },
    { es: "Una de nuestras favoritas", en: "One of our favorites" },
    { es: "Ideal para tu búsqueda", en: "Ideal for your search" },
  ],
};

const pickReasonFromCatalog = (category, language, seed) => {
  const list = PICK_REASON_CATALOG[category];
  if (!list?.length) return language === "es" ? "Recomendado" : "Recommended";
  const idx = Math.abs(seed) % list.length;
  const row = list[idx];
  return language === "es" ? row.es : row.en;
};

/** Picks 5 items using a sortBy-aware strategy. Uses catalog to choose reason labels per call. */
const getTopInventoryPicksByCategory = (inventory, plan, language, seed = 0) => {
  const hotels = Array.isArray(inventory?.hotels) ? inventory.hotels : [];
  const homes = Array.isArray(inventory?.homes) ? inventory.homes : [];
  const baseSource = hotels.length ? hotels : homes;
  const pricedSource = baseSource.filter((item) => hasUsablePrice(item));
  const source =
    hasLiveSearchContext(plan) && pricedSource.length
      ? pricedSource
      : baseSource;
  if (!source.length) return [];

  const sortBy = plan?.sortBy || null;
  const destStr = [plan?.location?.city, plan?.location?.country].filter(Boolean).join(" ") || "default";
  const seedNum = seed + (destStr.length * 31) + (destStr.charCodeAt(0) ?? 0);

  const usedIds = new Set();
  const take = (list, n, sortFn) => {
    return list
      .filter((x) => !usedIds.has(String(x.id || x.hotelCode || "")))
      .sort(sortFn)
      .slice(0, n)
      .map((item) => {
        usedIds.add(String(item.id || item.hotelCode || ""));
        return item;
      });
  };

  let center = null;
  if (plan?.location?.lat != null && plan?.location?.lng != null) {
    center = { lat: Number(plan.location.lat), lng: Number(plan.location.lng) };
  } else {
    const coordsList = source.map((item) => getItemCoords(item)).filter(Boolean);
    if (coordsList.length >= 2) {
      const sumLat = coordsList.reduce((a, c) => a + c.lat, 0);
      const sumLng = coordsList.reduce((a, c) => a + c.lng, 0);
      center = { lat: sumLat / coordsList.length, lng: sumLng / coordsList.length };
    }
  }

  const out = [];

  if (sortBy === "PRICE_ASC") {
    // User explicitly asked for cheapest — lead with 3 by price asc, then 1 price-quality, 1 extra
    const byPriceAsc = [...source].sort((a, b) => (getItemPrice(a) || Infinity) - (getItemPrice(b) || Infinity));
    const cheapest3 = take(byPriceAsc, 3, (a, b) => (getItemPrice(a) || Infinity) - (getItemPrice(b) || Infinity));
    const reasonBudget = pickReasonFromCatalog("priceQuality", language, seedNum + 1);
    cheapest3.forEach((item) => out.push({ item, pickReason: reasonBudget }));

    const byPriceQuality = [...source].sort((a, b) => {
      const sA = (getItemRating(a) || 1) / Math.max((getItemPrice(a) || 1) / 100, 0.01);
      const sB = (getItemRating(b) || 1) / Math.max((getItemPrice(b) || 1) / 100, 0.01);
      return sB - sA;
    });
    const pq1 = take(byPriceQuality, 1, (a, b) => {
      const sA = (getItemRating(a) || 1) / Math.max((getItemPrice(a) || 1) / 100, 0.01);
      const sB = (getItemRating(b) || 1) / Math.max((getItemPrice(b) || 1) / 100, 0.01);
      return sB - sA;
    });
    pq1.forEach((item) => out.push({ item, pickReason: pickReasonFromCatalog("priceQuality", language, seedNum + 2) }));

  } else if (sortBy === "PRICE_DESC") {
    // User wants premium — lead with 3 highest-priced, then 1 by rating, 1 extra
    const byPriceDesc = [...source].sort((a, b) => (getItemPrice(b) || 0) - (getItemPrice(a) || 0));
    const premium3 = take(byPriceDesc, 3, (a, b) => (getItemPrice(b) || 0) - (getItemPrice(a) || 0));
    const reasonPremium = pickReasonFromCatalog("rating", language, seedNum + 1);
    premium3.forEach((item) => out.push({ item, pickReason: reasonPremium }));

    const byRating = [...source].sort((a, b) => getItemRating(b) - getItemRating(a));
    const rated1 = take(byRating, 1, (a, b) => getItemRating(b) - getItemRating(a));
    rated1.forEach((item) => out.push({ item, pickReason: pickReasonFromCatalog("rating", language, seedNum + 2) }));

  } else {
    // Default: 2 by rating + 2 by price-quality + 1 extra
    const byRating = [...source].sort((a, b) => getItemRating(b) - getItemRating(a));
    const byPriceQuality = [...source].sort((a, b) => {
      const rA = getItemRating(a) || 1;
      const rB = getItemRating(b) || 1;
      const pA = getItemPrice(a) || 1;
      const pB = getItemPrice(b) || 1;
      const scoreA = rA / Math.max(pA / 100, 0.01);
      const scoreB = rB / Math.max(pB / 100, 0.01);
      return scoreB - scoreA;
    });

    const topRated2 = take(byRating, 2, (a, b) => getItemRating(b) - getItemRating(a));
    const reasonRating = pickReasonFromCatalog("rating", language, seedNum + 1);
    topRated2.forEach((item) => out.push({ item, pickReason: reasonRating }));

    const priceQuality2 = take(byPriceQuality, 2, (a, b) => {
      const sA = (getItemRating(a) || 1) / Math.max(getItemPrice(a) / 100 || 0.01, 0.01);
      const sB = (getItemRating(b) || 1) / Math.max(getItemPrice(b) / 100 || 0.01, 0.01);
      return sB - sA;
    });
    const reasonPriceQuality = pickReasonFromCatalog("priceQuality", language, seedNum + 2);
    priceQuality2.forEach((item) => out.push({ item, pickReason: reasonPriceQuality }));
  }

  // Extra pick: closest to center (or fallback by rating) — applies to all branches
  const remaining = source.filter((x) => !usedIds.has(String(x.id || x.hotelCode || "")));
  let extra = null;
  if (remaining.length) {
    const withCoords = remaining.map((item) => ({ item, coords: getItemCoords(item) })).filter((x) => x.coords);
    if (center && withCoords.length) {
      const withDist = withCoords
        .map(({ item, coords }) => ({ item, d: distanceKm(coords, center) }))
        .filter((x) => x.d != null)
        .sort((a, b) => a.d - b.d);
      if (withDist.length) {
        extra = {
          item: withDist[0].item,
          pickReason: pickReasonFromCatalog("location", language, seedNum + 3),
        };
      }
    }
    if (!extra) {
      const next = remaining.sort((a, b) => getItemRating(b) - getItemRating(a))[0];
      usedIds.add(String(next.id || next.hotelCode || ""));
      extra = { item: next, pickReason: pickReasonFromCatalog("general", language, seedNum + 4) };
    }
  }
  if (extra) out.push(extra);

  return out.slice(0, 5);
};

const decodeHtmlEntities = (str) => {
  if (!str) return null;
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
};

const toTitleCase = (str) =>
  String(str || "")
    .replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

const extractImageUrls = (item, max = 4) => {
  const imgs =
    (Array.isArray(item?.images) && item.images) ||
    (Array.isArray(item?.hotelDetails?.images) && item.hotelDetails.images) ||
    [];
  const seen = new Set();
  const urls = [];
  for (const img of imgs) {
    const url = typeof img === "string" ? img : img?.url ?? null;
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
      if (urls.length >= max) break;
    }
  }
  if (urls.length < max && item?.coverImage && !seen.has(item.coverImage)) {
    urls.push(item.coverImage);
    seen.add(item.coverImage);
  }
  if (urls.length < max && item?.image && !seen.has(item.image)) {
    urls.push(item.image);
  }
  return urls;
};

const AMENITY_CODE_LABELS = {
  es: {
    POOL: "piscina", SWIMMING_POOL: "piscina", OUTDOOR_POOL: "piscina exterior",
    INDOOR_POOL: "piscina climatizada", SPA: "spa", GYM: "gimnasio",
    FITNESS: "gimnasio", WIFI: "WiFi", PARKING: "estacionamiento",
    RESTAURANT: "restaurante", BAR: "bar", BEACH: "playa",
    BREAKFAST: "desayuno incluido", ROOM_SERVICE: "room service",
    PETS: "admite mascotas", FAMILY: "familiar", TENNIS: "tenis",
    GOLF: "golf", CASINO: "casino", AIRPORT_SHUTTLE: "traslado al aeropuerto",
    LAUNDRY: "lavandería", CONFERENCE: "sala de conferencias",
  },
  en: {
    POOL: "pool", SWIMMING_POOL: "pool", OUTDOOR_POOL: "outdoor pool",
    INDOOR_POOL: "indoor pool", SPA: "spa", GYM: "gym",
    FITNESS: "fitness center", WIFI: "WiFi", PARKING: "parking",
    RESTAURANT: "restaurant", BAR: "bar", BEACH: "beach",
    BREAKFAST: "breakfast included", ROOM_SERVICE: "room service",
    PETS: "pet-friendly", FAMILY: "family-friendly", TENNIS: "tennis",
    GOLF: "golf", CASINO: "casino", AIRPORT_SHUTTLE: "airport shuttle",
    LAUNDRY: "laundry", CONFERENCE: "conference room",
  },
};

const buildFilterContext = (plan, language) => {
  const lang = language === "es" ? "es" : "en";
  const filters = plan?.hotelFilters || {};
  const parts = [];
  const areaPreference = Array.isArray(plan?.preferences?.areaPreference)
    ? plan.preferences.areaPreference.map((value) => String(value || "").toUpperCase())
    : [];

  const minRating = Number(filters.minRating);
  if (Number.isFinite(minRating) && minRating >= 1 && minRating <= 5) {
    parts.push(lang === "es" ? `${minRating} estrellas` : `${minRating}-star`);
  }

  const amenityCodes = Array.isArray(filters.amenityCodes) ? filters.amenityCodes : [];
  if (amenityCodes.length) {
    const labelMap = AMENITY_CODE_LABELS[lang] || AMENITY_CODE_LABELS.en;
    const labels = amenityCodes
      .map((code) => labelMap[String(code).toUpperCase()] || null)
      .filter(Boolean)
      .slice(0, 2);
    labels.forEach((l) => parts.push(l));
  }

  const sortBy = String(plan?.sortBy || "").trim().toUpperCase();
  if (sortBy === "PRICE_ASC") {
    parts.push(lang === "es" ? "mejor precio" : "best price");
  } else if (sortBy === "PRICE_DESC") {
    parts.push(lang === "es" ? "gama alta" : "higher-end");
  } else if (sortBy === "POPULARITY") {
    parts.push(lang === "es" ? "más recomendados" : "most recommended");
  }

  if (areaPreference.includes("CITY_CENTER")) {
    parts.push(lang === "es" ? "zona céntrica" : "central area");
  }
  if (areaPreference.includes("LUXURY")) {
    parts.push(lang === "es" ? "perfil premium" : "premium profile");
  }
  if (areaPreference.includes("FAMILY_FRIENDLY")) {
    parts.push(lang === "es" ? "family-friendly" : "family-friendly");
  }
  if (areaPreference.includes("BEACH_COAST")) {
    parts.push(lang === "es" ? "cerca de playa" : "near the beach");
  }

  const poi = plan?.location?.resolvedPoi?.name;
  if (poi) {
    parts.push(lang === "es" ? `cerca de ${poi}` : `near ${poi}`);
  }

  return parts.length ? Array.from(new Set(parts)) : null;
};

const buildAppreciationLine = (pickReason, language) => {
  if (!pickReason || !String(pickReason).trim()) return null;
  return copyForLanguage(language, {
    es: `Lo destacamos por ${String(pickReason).trim()}.`,
    en: `We highlight it for ${String(pickReason).trim()}.`,
    pt: `Destacamos este hotel por ${String(pickReason).trim()}.`,
  });
};

const buildAdvisorTakeSection = ({
  eyebrow = null,
  title,
  body = null,
  tone = "neutral",
  tags = [],
}) => ({
  type: "advisorTake",
  eyebrow,
  title,
  body,
  tone,
  tags: Array.isArray(tags) ? tags.filter(Boolean).slice(0, 4) : [],
});

const formatCompactPriceLabel = (value, currency = "USD", language = "es") => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const normalizedCurrency = normalizeDisplayCurrencyCode(currency);
  try {
    return new Intl.NumberFormat(localeForLanguage(language), {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: numeric >= 100 ? 0 : 2,
    }).format(numeric);
  } catch (_) {
    const rounded = numeric >= 100 ? Math.round(numeric) : numeric.toFixed(2);
    return `${normalizedCurrency} ${rounded}`;
  }
};

const buildSearchShortlistSection = ({
  language = "es",
  picks = [],
  isLiveMode = false,
  destination = "",
}) => {
  const shortlistItems = picks
    .slice(0, Math.min(3, picks.length))
    .map(({ item, pickReason }, index) => {
      const id = String(item?.id || item?.hotelCode || `shortlist-${index + 1}`);
      const name =
        item?.title || item?.name || item?.hotelName ||
        item?.hotelDetails?.hotelName || item?.hotelDetails?.name || "Hotel";
      const city = item?.city || item?.cityName || null;
      const stars = normalizeStars(
        item?.stars ??
        item?.rating ??
        item?.classification?.code ??
        item?.hotelDetails?.rating
      );
      const value = isLiveMode && hasUsablePrice(item)
        ? formatCompactPriceLabel(item?.pricePerNight ?? item?.price ?? null, item?.currency || "USD", language)
        : (stars ? `${stars}★` : null);
      const subtitle =
        pickReason && String(pickReason).trim()
          ? buildAppreciationLine(pickReason, language)
          : city
            ? toTitleCase(city)
            : null;
      const tags = [
        city ? toTitleCase(city) : null,
        ...pickAmenityLabels(item, 2),
      ].filter(Boolean).slice(0, 3);

      return {
        id,
        rank: index + 1,
        inventoryType: String(item?.inventoryType || "HOTEL").toUpperCase(),
        title: clampText(name, 64),
        subtitle,
        value,
        priceFrom: isLiveMode && hasUsablePrice(item) ? Number(item?.pricePerNight ?? item?.price ?? null) : null,
        currency: normalizeDisplayCurrencyCode(item?.currency || "USD"),
        city: city ? toTitleCase(city) : null,
        locationText: city ? toTitleCase(city) : null,
        tags,
      };
    })
    .filter(Boolean);

  if (!shortlistItems.length) return null;
  const destinationLabel = destination || copyForLanguage(language, {
    es: "este destino",
    en: "this destination",
    pt: "este destino",
  });
  return {
    type: "shortlist",
    eyebrow: copyForLanguage(language, {
      es: "Vista rápida",
      en: "Quick view",
      pt: "Visão rápida",
    }),
    title: copyForLanguage(language, {
      es: `Mirada rápida de estas opciones${destination ? ` en ${destinationLabel}` : ""}`,
      en: `Quick look at these options${destination ? ` in ${destinationLabel}` : ""}`,
      pt: `Visão rápida destas opções${destination ? ` em ${destinationLabel}` : ""}`,
    }),
    body: copyForLanguage(language, isLiveMode
      ? {
          es: "Ya tengo disponibilidad para tus fechas, así que acá ves una lectura corta con precio por noche.",
          en: "I already have live availability for your dates, so this is a quick view with nightly pricing.",
          pt: "Já tenho disponibilidade para as suas datas, então aqui você vê um resumo curto com preço por noite.",
        }
      : {
          es: "Te resumo el perfil de cada opción para que ubiques rápido cuáles te cierran más.",
          en: "Here is a quick summary so you can spot which options fit best.",
          pt: "Aqui vai um resumo do perfil de cada opção para você identificar rápido quais fazem mais sentido.",
        }),
    items: shortlistItems,
  };
};

const buildNextStepSection = ({
  language = "es",
  isLiveMode = false,
  destination = "",
  filterContext = null,
  assumedDefaultGuests = false,
}) => {
  const destinationLabel = destination || copyForLanguage(language, {
    es: "el set",
    en: "the set",
    pt: "a seleção",
  });
  const filterLabel = Array.isArray(filterContext) && filterContext.length
    ? filterContext.slice(0, 2).join(language === "es" ? " y " : language === "pt" ? " e " : " and ")
    : null;

  if (isLiveMode) {
    return {
      type: "nextStep",
      eyebrow: copyForLanguage(language, { es: "Siguiente paso", en: "Next step", pt: "Próximo passo" }),
      title: copyForLanguage(language, {
        es: "Abrí el hotel que más te guste y compará tranquilo",
        en: "Open the hotel you like most and compare calmly",
        pt: "Abra o hotel que mais gostar e compare com calma",
      }),
      body: copyForLanguage(language, {
        es: `Estas opciones ya tienen disponibilidad real${filterLabel ? ` con foco en ${filterLabel}` : ""}.${assumedDefaultGuests ? " Tomé 1 adulto por defecto para mostrarte precio real; si cambia, lo ajustamos." : ""} El mejor siguiente paso es comparar ubicación, política y extras.`,
        en: `These options already have live availability${filterLabel ? ` with focus on ${filterLabel}` : ""}.${assumedDefaultGuests ? " I used 1 adult by default to show live pricing; if that changes, we can adjust it." : ""} The best next step is to compare location, policy, and perks.`,
        pt: `Estas opções já têm disponibilidade real${filterLabel ? ` com foco em ${filterLabel}` : ""}.${assumedDefaultGuests ? " Considerei 1 adulto por padrão para mostrar o preço real; se isso mudar, ajustamos." : ""} O melhor próximo passo é comparar localização, política e extras.`,
      }),
      steps: [
        {
          id: "open-main",
          title: copyForLanguage(language, {
            es: "Abrí la que más te guste",
            en: "Open your favorite one",
            pt: "Abra a sua favorita",
          }),
          subtitle: copyForLanguage(language, {
            es: "Ahí vas a ver fotos, ubicación, política y tarifa con más detalle.",
            en: "There you can review photos, location, policy, and rate details.",
            pt: "Lá você pode revisar fotos, localização, política e tarifa com mais detalhe.",
          }),
        },
        {
          id: "compare-compact",
          title: copyForLanguage(language, {
            es: "Compará ubicación y beneficios",
            en: "Compare location and perks",
            pt: "Compare localização e benefícios",
          }),
          subtitle: copyForLanguage(language, {
            es: "Fijate cuál te cierra mejor por extras, cancelación y precio por noche.",
            en: "Check which one fits best by perks, cancellation, and nightly price.",
            pt: "Veja qual combina melhor com você por extras, cancelamento e preço por noite.",
          }),
        },
      ],
    };
  }

  return {
    type: "nextStep",
    eyebrow: copyForLanguage(language, {
      es: "Para verlo con precio real",
      en: "To see real pricing",
      pt: "Para ver o preço real",
    }),
    title: copyForLanguage(language, {
      es: "Confirmame fechas y viajeros",
      en: "Confirm your dates and guests",
      pt: "Confirme datas e viajantes",
    }),
    body: copyForLanguage(language, {
      es: `Con eso te puedo decir qué opciones siguen disponibles en ${destinationLabel}${filterLabel ? ` y con foco en ${filterLabel}` : ""}.`,
      en: `With that, I can tell you which options are still available in ${destinationLabel}${filterLabel ? ` with focus on ${filterLabel}` : ""}.`,
      pt: `Com isso eu consigo te dizer quais opções ainda seguem disponíveis em ${destinationLabel}${filterLabel ? ` com foco em ${filterLabel}` : ""}.`,
    }),
    steps: [
      {
        id: "dates",
        title: copyForLanguage(language, {
          es: "Elegí las fechas",
          en: "Choose your dates",
          pt: "Escolha as datas",
        }),
        subtitle: copyForLanguage(language, {
          es: "Ahí aparece el precio por noche y la disponibilidad real.",
          en: "That unlocks nightly pricing and real availability.",
          pt: "Aí aparecem o preço por noite e a disponibilidade real.",
        }),
      },
      {
        id: "guests",
        title: copyForLanguage(language, {
          es: "Confirmame quiénes viajan",
          en: "Confirm who is traveling",
          pt: "Confirme quem vai viajar",
        }),
        subtitle: copyForLanguage(language, {
          es: "Así te muestro opciones que de verdad encajan con tu viaje.",
          en: "That helps me show options that truly fit your trip.",
          pt: "Assim eu te mostro opções que realmente combinam com a sua viagem.",
        }),
      },
    ],
  };
};

const buildSearchAdvisorSection = ({
  language = "es",
  isLiveMode = false,
  filterContext = null,
  destination = "",
  userAskedCheap = false,
  userAskedPool = false,
}) => {
  const filterLabel = Array.isArray(filterContext) ? filterContext.slice(0, 2).join(language === "es" ? " y " : language === "pt" ? " e " : " and ") : "";
  const destinationLabel = destination || copyForLanguage(language, {
    es: "este destino",
    en: "this destination",
    pt: "este destino",
  });

  if (isLiveMode) {
    return buildAdvisorTakeSection({
      eyebrow: copyForLanguage(language, {
        es: "Ya tengo disponibilidad",
        en: "Live availability",
        pt: "Já tenho disponibilidade",
      }),
      title: copyForLanguage(language, {
        es: "Estas opciones ya tienen precio real",
        en: "These options already have live pricing",
        pt: "Estas opções já têm preço real",
      }),
      body: copyForLanguage(language, {
        es: `Ya tengo disponibilidad real para tus fechas${filterLabel ? ` con foco en ${filterLabel}` : ""}. Si querés, abrimos el que más te guste y comparamos bien ubicación, cancelación y extras.`,
        en: `I already have live availability for your dates${filterLabel ? ` with focus on ${filterLabel}` : ""}. If you want, we can open your favorite and compare location, cancellation, and perks.`,
        pt: `Já tenho disponibilidade real para as suas datas${filterLabel ? ` com foco em ${filterLabel}` : ""}. Se quiser, abrimos o que você mais gostar e comparamos localização, cancelamento e extras.`,
      }),
      tone: "positive",
      tags: [filterLabel || null, destinationLabel],
    });
  }

  if (userAskedCheap || userAskedPool || filterLabel) {
    return buildAdvisorTakeSection({
      eyebrow: language === "es" ? "Resumen" : "Summary",
      title:
        language === "es"
          ? `Opciones bien orientadas para ${destinationLabel}`
          : `Well-targeted options for ${destinationLabel}`,
      body:
        language === "es"
          ? `Estas opciones van en la dirección de lo que pediste${filterLabel ? `, con foco en ${filterLabel}` : ""}. Cuando me confirmes fechas y viajeros te digo cuáles siguen disponibles y cuánto salen.`
          : `These options are aligned with what you asked for${filterLabel ? `, with focus on ${filterLabel}` : ""}. Once you confirm dates and guests, I can tell you which ones are still available and how much they cost.`,
      tone: "neutral",
      tags: [filterLabel || null],
    });
  }

  return buildAdvisorTakeSection({
    eyebrow: language === "es" ? "Resumen" : "Summary",
    title:
      language === "es"
        ? `Buena base para comparar en ${destinationLabel}`
        : `A good base set for ${destinationLabel}`,
    body:
      language === "es"
        ? "Te dejo una selección ordenada para que ubiques rápido cuál tiene mejor perfil para tu viaje."
        : "Here is an ordered set so you can quickly see which option fits your trip best.",
    tone: "neutral",
    tags: [destinationLabel],
  });
};

const buildHotelPickSection = (item, pickReason = null, language = "es", options = {}) => {
  if (!item) return null;
  const id = String(item.id || item.hotelCode || "");
  if (!id) return null;
  const name =
    item?.title || item?.name || item?.hotelName ||
    item?.hotelDetails?.hotelName || item?.hotelDetails?.name || "Hotel";
  const locationRaw =
    item?.locationText ||
    [item?.city, item?.country].filter(Boolean).join(", ") ||
    [item?.cityName, item?.countryName].filter(Boolean).join(", ") ||
    "";
  const location = locationRaw ? toTitleCase(locationRaw) : "";
  const addressRaw =
    item?.address ||
    item?.hotelDetails?.address ||
    item?.fullAddress?.hotelStreetAddress ||
    null;
  const address = addressRaw ? toTitleCase(String(addressRaw)) : null;
  const rawDescription =
    item?.shortDescription || item?.description ||
    item?.hotelDetails?.shortDescription || item?.hotelDetails?.description || "";
  const description = clampText(
    decodeHtmlEntities(rawDescription) ||
      (location
        ? copyForLanguage(language, {
            es: `Ubicado en ${location}.`,
            en: `Located in ${location}.`,
            pt: `Localizado em ${location}.`,
          })
        : ""),
    450
  );
  const shortDescription = description ? clampText(description, 180) : null;
  const stars = normalizeStars(
    item?.stars ?? item?.rating ?? item?.classification?.code ??
    item?.reviewScore ?? item?.hotelDetails?.rating ?? item?.hotelPayload?.rating
  );
  const amenities = pickAmenityLabels(item, 3);
  const images = extractImageUrls(item, 4);
  const priceFrom = item?.pricePerNight ?? item?.price ?? null;
  const currency = normalizeDisplayCurrencyCode(item?.currency || "USD");
  const amenityLabels = pickAmenityLabels(item, 6);
  const characteristics = (amenityLabels && amenityLabels.length ? amenityLabels : amenities).slice(0, 5);
  const appreciation = buildAppreciationLine(pickReason, language);
  return {
    type: "hotelPick",
    id,
    layoutVariant: options.layoutVariant || "hero",
    name: clampText(name, 80),
    description,
    shortDescription: shortDescription || description,
    location,
    address,
    stars,
    amenities,
    characteristics,
    appreciation: appreciation || null,
    images,
    priceFrom: options.isLiveMode && Number.isFinite(Number(priceFrom)) && Number(priceFrom) > 0 ? Number(priceFrom) : null,
    currency,
    pickReason: pickReason && String(pickReason).trim() ? String(pickReason).trim() : null,
  };
};

const buildStructuredSearchReply = ({ inventory, plan, language, seed, userName, resultCount = 0, latestUserMessage = "" }) => {
  const picksWithReasons = getTopInventoryPicksByCategory(inventory, plan, language, seed ?? 0);
  const picks = picksWithReasons.length ? picksWithReasons : getTopInventoryPicks(inventory, 5).map((item) => ({ item, pickReason: null }));
  if (!picks.length) return null;

  const isSpanish = language === "es";
  const destination =
    plan?.location?.city || plan?.location?.address || plan?.location?.country || "";
  const name = userName ? String(userName).split(" ")[0] : null;
  const filterContext = buildFilterContext(plan, language);
  const isLiveMode = hasLiveSearchContext(plan);
  const assumedDefaultGuests = Boolean(plan?.assumptions?.defaultGuestsApplied);
  const total = resultCount || (inventory?.hotels?.length || 0) + (inventory?.homes?.length || 0);
  const userAskedPool = /\b(pileta|piscina|pool|swimming)\b/i.test(latestUserMessage || "");
  const userAskedCheap = /\b(barato|económico|cheap|budget|low cost)\b/i.test(latestUserMessage || "");

  const dest = destination ? ` en ${destination}` : "";
  const destEn = destination ? ` in ${destination}` : "";
  const filterJoined = filterContext
    ? (isSpanish ? ` ${filterContext.join(" y ")}` : ` ${filterContext.join(" and ")}`)
    : "";

  let introVariants;
  if (isLiveMode) {
    const countPhrase = isSpanish
      ? (total <= 3 ? `Encontré ${total} opción${total === 1 ? "" : "es"} disponible${total === 1 ? "" : "s"}` : `Tengo ${total} opciones disponibles`)
      : (total <= 3 ? `I found ${total} available option${total === 1 ? "" : "s"}` : `I found ${total} available options`);
    introVariants = isSpanish
      ? [
          `${countPhrase}${dest}.`,
          `${name ? `${name}, ` : ""}${countPhrase.toLowerCase()}${dest} para tus fechas.`,
          `Estas son las opciones que veo disponibles${dest}.`,
        ]
      : [
          `${countPhrase}${destEn}.`,
          `${name ? `${name}, ` : ""}${countPhrase.toLowerCase()}${destEn} for your dates.`,
          `These are the options I see available${destEn}.`,
        ];
  } else if (total > 0 && (userAskedPool || userAskedCheap || filterContext?.length)) {
    const countPhrase = isSpanish
      ? (total <= 3 ? `Encontré ${total} opción${total === 1 ? "" : "es"}` : `Hay ${total} opciones`)
      : (total <= 3 ? `Found ${total} option${total === 1 ? "" : "s"}` : `There are ${total} options`);
    introVariants = isSpanish
      ? [
          `${countPhrase}${dest}${filterJoined}. ${name ? `${name}, m` : "M"}irá las que más te cierran.`,
          `${name ? `${name}, ` : ""}${countPhrase.toLowerCase()}${dest}${filterJoined}. Si querés, abrimos la que más te guste.`,
          `Acá van ${total} opciones${dest}${filterJoined}.`,
        ]
      : [
          `${countPhrase}${destEn}${filterJoined}. ${name ? `${name}, take` : "Take"} a look.`,
          `${name ? `${name}, ` : ""}${countPhrase.toLowerCase()}${destEn}${filterJoined}. Tap one for details.`,
          `Here are ${total} options${destEn}${filterJoined}.`,
        ];
  } else if (filterContext?.length) {
    introVariants = isSpanish
      ? [
          `${name ? `${name}, a` : "A"}cá van los resultados${dest}${filterJoined}.`,
          `Encontré opciones${dest}${filterJoined}${name ? `, ${name}` : ""}.`,
          `${total ? `Son ${total} opciones` : "Opciones"}${dest}${filterJoined}.`,
        ]
      : [
          `${name ? `${name}, here` : "Here"} are the results${destEn}${filterJoined}.`,
          `Found options${destEn}${filterJoined}${name ? ` for you, ${name}` : ""}.`,
          `${total ? `${total} options` : "Options"}${destEn}${filterJoined}.`,
        ];
  } else {
    introVariants = isSpanish
      ? [
          `${name ? `¡Dale, ${name}! Te` : "Te"} dejo opciones${dest}.`,
          `${name ? `${name}, ` : ""}Estas son opciones${dest}. Sumá fechas y viajeros para ver precios reales.`,
          total ? `Encontré ${total} opciones${dest}.` : `Opciones${dest}.`,
        ]
      : [
          `${name ? `Sure, ${name}. Here` : "Here"} are options${destEn}.`,
          `${name ? `${name}, ` : ""}Options${destEn}. Add dates and guests for live prices.`,
          total ? `Found ${total} options${destEn}.` : `Options${destEn}.`,
        ];
  }

  const intro = pickVariant(introVariants, seed) || introVariants[0];
  const introWithAssumption =
    assumedDefaultGuests && isLiveMode
      ? language === "es"
        ? `${intro} Tomé 1 adulto por defecto para mostrarte precio real; si viajás con más personas, lo ajustamos.`
        : `${intro} I used 1 adult by default to show live pricing; if more people are traveling, we can adjust it.`
      : intro;
  const sections = [
    buildSearchAdvisorSection({
      language,
      isLiveMode,
      filterContext,
      destination,
      userAskedCheap,
      userAskedPool,
    }),
    buildSearchShortlistSection({
      language,
      picks,
      isLiveMode,
      destination,
    }),
    ...picks
      .map((p, index) =>
        buildHotelPickSection(p.item, p.pickReason, language, {
          layoutVariant: index === 0 ? "hero" : "compact",
          isLiveMode,
        })
      )
      .filter(Boolean),
    buildNextStepSection({
      language,
      isLiveMode,
      destination,
      filterContext,
      assumedDefaultGuests,
    }),
  ].filter(Boolean);
  return { intro: introWithAssumption, outro: null, sections };
};

const buildNoResultsSearchReply = ({
  plan,
  language = "es",
  missing = [],
}) => {
  const destination =
    plan?.location?.city || plan?.location?.address || plan?.location?.country || "";
  const destinationLabel = destination || copyForLanguage(language, {
    es: "ese destino",
    en: "that destination",
    pt: "esse destino",
  });
  const isLiveMode = hasLiveSearchContext(plan);
  const needsDates = missing.includes("DATES");
  const needsGuests = missing.includes("GUESTS");
  const canUnlockLive = !isLiveMode && (needsDates || needsGuests);

  const intro = isLiveMode
    ? copyForLanguage(language, {
        es: `No veo disponibilidad real en ${destinationLabel} para esa búsqueda.`,
        en: `I do not see live availability in ${destinationLabel} for that search.`,
        pt: `Não vejo disponibilidade real em ${destinationLabel} para essa busca.`,
      })
    : copyForLanguage(language, {
        es: `No encontré hoteles para mostrarte ahora en ${destinationLabel}.`,
        en: `I could not find hotels to show you right now in ${destinationLabel}.`,
        pt: `Não encontrei hotéis para te mostrar agora em ${destinationLabel}.`,
      });

  const sections = [
    buildAdvisorTakeSection({
      eyebrow: copyForLanguage(language, {
        es: "Búsqueda rápida",
        en: "Quick search",
        pt: "Busca rápida",
      }),
      title: isLiveMode
        ? copyForLanguage(language, {
            es: "No apareció disponibilidad con esas fechas",
            en: "No availability showed up for those dates",
            pt: "Não apareceu disponibilidade para essas datas",
          })
        : copyForLanguage(language, {
            es: "No apareció inventario para ese destino",
            en: "No inventory showed up for that destination",
            pt: "Não apareceu inventário para esse destino",
          }),
      body: canUnlockLive
        ? copyForLanguage(language, {
            es: "Si me confirmás fechas y viajeros, hago una pasada más precisa con disponibilidad real.",
            en: "If you confirm dates and guests, I can run a more precise pass with live availability.",
            pt: "Se você confirmar datas e viajantes, eu faço uma busca mais precisa com disponibilidade real.",
          })
        : copyForLanguage(language, {
            es: "Podemos probar otra zona, ajustar fechas o afinar un poco más la búsqueda.",
            en: "We can try another area, adjust dates, or narrow the search a bit more.",
            pt: "Podemos tentar outra área, ajustar datas ou refinar um pouco mais a busca.",
          }),
      tone: "neutral",
      tags: [destination || null],
    }),
    canUnlockLive
      ? buildNextStepSection({
          language,
          isLiveMode: false,
          destination,
          filterContext: null,
          assumedDefaultGuests: false,
        })
      : null,
  ].filter(Boolean);

  return { intro, sections };
};

export const renderAssistantPayload = async ({
  plan,
  messages,
  inventory,
  nextAction,
  trip,
  tripContext,
  userContext,
  weather,
  missing = [],
  visualContext,
  tripSearchContext = null,
  lastShownResultsContext = null,
  inventoryForReply = null,
  stayDetailsFromDb = null,
  preparedReply = null,
  onTextChunk = null,
}) => {
  const baseLanguage = normalizeLanguage(plan);
  const language = baseLanguage;
  const hasInventoryThisTurn = (inventory?.hotels?.length || inventory?.homes?.length) > 0;
  const effectiveInventoryForReply = !hasInventoryThisTurn && inventoryForReply
    ? { hotels: inventoryForReply.hotels || [], homes: inventoryForReply.homes || [], matchTypes: {}, foundExact: false }
    : inventory;
  const normalizedPreparedReply =
    typeof preparedReply === "string"
      ? { text: preparedReply, sections: [] }
      : preparedReply && typeof preparedReply === "object"
        ? preparedReply
        : null;
  if (plan && typeof plan === "object") {
    plan.language = language;
  }
  let replyText = "";
  let followUps = [];
  let searchSections = [];
  let wasStreamed = false;

  const missingDest = missing.includes("DESTINATION");
  const missingDates = missing.includes("DATES");
  const missingGuests = missing.includes("GUESTS");
  const multipleMissing = (missingDest ? 1 : 0) + (missingDates ? 1 : 0) + (missingGuests ? 1 : 0) > 1;

  // Seed for variant pick: combine message count + content length + timestamp so each call gets genuine variety
  const seed =
    (messages?.length ?? 0) * 31 +
    (messages?.reduce((acc, m) => acc + (m?.content?.length ?? 0), 0) ?? 0) +
    (Date.now() % 997);

  // Multiple phrases when asking for several missing fields (avoid single repetitive line)
  const multipleMissingPhrases = {
    es: [
      (list) => `Me encanta la idea. Para mostrarte opciones y precios reales necesito saber ${list}.`,
      (list) => `Dale, para buscar necesito que me cuentes ${list}. Así te muestro disponibilidad y tarifas.`,
      (list) => `Genial. Decime ${list} y te armo las mejores opciones con precios y disponibilidad.`,
      (list) => `Perfecto. Para ver precios y disponibilidad necesito ${list}.`,
    ],
    en: [
      (list) => `Sounds good. To show you real prices and availability I need to know ${list}.`,
      (list) => `Great. Tell me ${list} and I'll find options with live rates and availability.`,
      (list) => `Sure. Once I know ${list}, I can show you availability and prices.`,
      (list) => `Got it. I need ${list} to show you prices and availability.`,
    ],
  };

  // Only override text if we are NOT running a search (i.e. we are stuck asking for info)
  if (multipleMissing && nextAction !== "RUN_SEARCH") {
    const partsEs = [];
    const partsEn = [];
    if (missingDest) {
      partsEs.push("a dónde querés ir");
      partsEn.push("where you want to go");
    }
    if (missingDates) {
      partsEs.push("cuándo");
      partsEn.push("when");
    }
    if (missingGuests) {
      partsEs.push("cuántos son");
      partsEn.push("how many guests");
    }

    const listEs = partsEs.join(", ").replace(/, ([^,]*)$/, " y $1");
    const listEn = partsEn.join(", ").replace(/, ([^,]*)$/, " and $1");
    const phrases = multipleMissingPhrases[language] || multipleMissingPhrases.en;
    const fn = pickVariant(phrases, seed);
    replyText = language === "es" ? fn(listEs) : fn(listEn);
    followUps = [];
  } else if (
    nextAction === NEXT_ACTIONS.ASK_FOR_DESTINATION ||
    nextAction === NEXT_ACTIONS.ASK_FOR_DATES ||
    nextAction === NEXT_ACTIONS.ASK_FOR_GUESTS
  ) {
    const bothDatesAndGuestsMissing = missingDates && missingGuests;
    if (bothDatesAndGuestsMissing) {
      const variants = promptDatesAndGuests[language] || promptDatesAndGuests.en;
      replyText = Array.isArray(variants) ? pickVariant(variants, seed) : variants;
    } else {
      const byAction = promptByAction[nextAction];
      const variants = byAction?.[language] || byAction?.en;
      replyText = Array.isArray(variants) ? pickVariant(variants, seed) : (variants || "Can you clarify?");
    }
    followUps = [];
  } else if (nextAction === NEXT_ACTIONS.RUN_SEARCH) {
    const userName = userContext?.userName || userContext?.name || null;
    const latestUserMessage = [...(messages || [])].reverse().find((m) => m?.role === "user")?.content ?? "";
    const resultCount = (inventory?.hotels?.length || 0) + (inventory?.homes?.length || 0);
    const structuredReply = buildStructuredSearchReply({
      inventory,
      plan,
      language,
      seed,
      userName,
      resultCount,
      latestUserMessage,
    });
    if (structuredReply) {
      replyText = structuredReply.intro;
      followUps = [];
      searchSections = [
        ...structuredReply.sections,
        ...(structuredReply.outro ? [{ type: "outro", text: structuredReply.outro }] : []),
      ];
    } else {
      const noResultsReply = buildNoResultsSearchReply({
        plan,
        language,
        missing,
      });
      replyText = noResultsReply.intro;
      followUps = [];
      searchSections = noResultsReply.sections;
    }
  } else if (nextAction === NEXT_ACTIONS.RUN_PLANNING || nextAction === NEXT_ACTIONS.RUN_LOCATION) {
    if (normalizedPreparedReply?.text) {
      // Function calling: text already streamed by runFunctionCallingTurn
      replyText = normalizedPreparedReply.text;
      followUps = Array.isArray(normalizedPreparedReply.followUps) ? normalizedPreparedReply.followUps : [];
    } else {
      const replyMode = nextAction === NEXT_ACTIONS.RUN_PLANNING ? "planning" : "location";
      try {
        if (onTextChunk) {
          wasStreamed = true;
          const sp = await generateAssistantReplyStream({ plan, messages, inventory: effectiveInventoryForReply, trip, tripContext, userContext, weather, onChunk: onTextChunk });
          followUps = Array.isArray(sp?.followUps) ? sp.followUps : [];
        } else {
          const replyPayload = await generateAssistantReply({
            plan,
            messages,
            inventory: effectiveInventoryForReply,
            trip,
            tripContext,
            userContext,
            weather,
            replyMode,
            tripSearchContext,
            lastShownResultsContext,
            stayDetailsFromDb,
          });
          replyText = (replyPayload?.reply || "").trim();
          followUps = Array.isArray(replyPayload?.followUps) ? replyPayload.followUps : [];
        }
      } catch (planLocErr) {
        console.warn("[ai.renderer] planning/location reply failed", planLocErr?.message || planLocErr);
        replyText = language === "es"
          ? "Puedo ayudarte a planificar tu viaje o contarte sobre un destino. Decime destino y fechas (o flexibilidad) y arranco."
          : "I can help you plan your trip or tell you about a destination. Share your destination and dates (or flexibility) to get started.";
        followUps = [];
      }
    }
  } else if (nextAction === NEXT_ACTIONS.ANSWER_WITH_LAST_RESULTS) {
    if (normalizedPreparedReply?.text) {
      replyText = normalizedPreparedReply.text;
      searchSections = Array.isArray(normalizedPreparedReply.sections)
        ? normalizedPreparedReply.sections
        : [];
      followUps = [];
    } else {
      try {
        if (onTextChunk) {
          wasStreamed = true;
          const sp = await generateAssistantReplyStream({ plan, messages, inventory: effectiveInventoryForReply, trip, tripContext, userContext, weather, onChunk: onTextChunk });
          followUps = Array.isArray(sp?.followUps) ? sp.followUps : [];
        } else {
          const replyPayload = await generateAssistantReply({
            plan,
            messages,
            inventory: effectiveInventoryForReply,
            trip,
            tripContext,
            userContext,
            weather,
            tripSearchContext,
            lastShownResultsContext,
            stayDetailsFromDb,
          });
          replyText = (replyPayload?.reply || "").trim();
          followUps = Array.isArray(replyPayload?.followUps) ? replyPayload.followUps : [];
        }
      } catch (err) {
        console.warn("[ai.renderer] ANSWER_WITH_LAST_RESULTS reply failed", err?.message || err);
        replyText = language === "es"
          ? "No pude revisar esos resultados ahora. Probá de nuevo."
          : "I couldn't check those results right now. Try again.";
        followUps = [];
      }
    }
  } else {
    if (normalizedPreparedReply?.text) {
      replyText = normalizedPreparedReply.text;
      searchSections = Array.isArray(normalizedPreparedReply.sections)
        ? normalizedPreparedReply.sections
        : [];
      followUps = [];
    } else {
      try {
        if (onTextChunk) {
          wasStreamed = true;
          const sp = await generateAssistantReplyStream({ plan, messages, inventory: effectiveInventoryForReply, trip, tripContext, userContext, weather, onChunk: onTextChunk });
          followUps = Array.isArray(sp?.followUps) ? sp.followUps : [];
        } else {
          const replyPayload = await generateAssistantReply({
            plan,
            messages,
            inventory: effectiveInventoryForReply,
            trip,
            tripContext,
            userContext,
            weather,
            tripSearchContext,
            lastShownResultsContext,
            stayDetailsFromDb,
          });
          replyText = (replyPayload?.reply || "").trim();
          followUps = Array.isArray(replyPayload?.followUps) ? replyPayload.followUps : [];
        }
    } catch (genErr) {
      console.warn("[ai.renderer] generateAssistantReply failed", genErr?.message || genErr);
      replyText = language === "es"
        ? "No pude procesar eso ahora. Probá de nuevo en un momento o reformulá el mensaje."
        : "I couldn’t process that right now. Try again in a moment or rephrase your message.";
      followUps = [];
      }
    }
  }

  if (!replyText && !wasStreamed) {
    const fallbackEs = [
      "Listo. Contame qué necesitás y lo resolvemos.",
      "Dale, decime en qué te ayudo.",
      "Acá estoy. ¿En qué andás?",
    ];
    const fallbackEn = [
      "Got it. Tell me what you need and I'll help.",
      "Sure. What can I do for you?",
      "Here when you need me. What are you looking for?",
    ];
    const fallbacks = language === "es" ? fallbackEs : fallbackEn;
    replyText = pickVariant(fallbacks, seed);
  }

  // Emit static reply text via SSE if streaming path wasn't used (e.g. ASK_FOR_*, RUN_SEARCH intro)
  if (onTextChunk && replyText && !wasStreamed) {
    onTextChunk(replyText);
  }

  let combinedInputs = [];
  if (missing.length > 0) {
    if (missingDest) combinedInputs.push({ type: "destination", id: "DESTINATION", required: true });
    if (missingDates) combinedInputs.push({ type: "dateRange", id: "DATES", required: true });
    if (missingGuests) combinedInputs.push({ type: "guestCount", id: "GUESTS", required: true });
  } else {
    combinedInputs = inputByAction[nextAction] || [];
  }

  const ui = {
    chips: buildChips(followUps),
    cards: buildCards(inventory, { isLiveMode: hasLiveSearchContext(plan) }),
    inputs: combinedInputs,
    sections: searchSections,
    visualContext: visualContext || null
  };

  return {
    assistant: {
      text: replyText,
      tone: DEFAULT_TONE,
      disclaimers: [],
    },
    followUps,
    ui,
  };
};
