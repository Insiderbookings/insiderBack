import {
  generateAssistantReply,
  generateAssistantReplyStream,
} from "../../services/aiAssistant.service.js";
import { NEXT_ACTIONS } from "./ai.planner.js";
import { AI_DEFAULTS } from "./ai.config.js";

const DEFAULT_TONE = "neutral";

const normalizeLanguage = (plan) => {
  const lang =
    typeof plan?.language === "string" ? plan.language.toLowerCase() : "";
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
  const raw = String(value || "USD")
    .trim()
    .toUpperCase();
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
    [...messages].reverse().find((msg) => msg?.role === "user" && msg?.content)
      ?.content;
  const raw = String(latestUserMessage || "").trim();
  const normalized = ` ${raw.toLowerCase()} `;

  // Arabic: script or common words
  if (/\p{Script=Arabic}/u.test(raw)) return "ar";
  const arabicHints = [" مرحبا", " شكرا", " من فضلك", " اريد", " فندق", " سفر"];
  if (
    arabicHints.some(
      (hint) => raw.includes(hint) || normalized.includes(hint.toLowerCase()),
    )
  )
    return "ar";

  // Spanish: common words/chars
  const spanishHints = [
    " hola ",
    " gracias",
    " por favor",
    " necesito",
    " buscar",
    " alojamiento",
    " casa ",
    " hotel ",
    " habitaciones",
    " quiero",
    " viajar",
    " reservar",
    " donde",
    " dónde",
    " cuando",
    " cuándo",
    " cuantos",
    " personas",
    " fechas",
    " puedes ",
    " mostrarme",
    " mostrame",
    " disponibilidad",
    " precio ",
    " precios ",
    " cuales ",
    " cuáles ",
    " de esos ",
    " esos ",
    " tienen ",
    " pileta",
    " piscina",
    " viajeros",
    " huespedes",
    " huéspedes",
  ];
  const hasSpanishChars = /[áéíóúñü¿¡]/.test(raw);
  if (hasSpanishChars || spanishHints.some((hint) => normalized.includes(hint)))
    return "es";

  // English
  const englishHints = [
    " hello ",
    " hi ",
    " please ",
    " thanks",
    " looking",
    " need ",
    " hotel",
    " house ",
    " want ",
    " travel ",
    " book ",
    " where ",
    " when ",
    " how many ",
  ];
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
  [NEXT_ACTIONS.ASK_FOR_NATIONALITY]: {
    es: [
      "Necesito tu nacionalidad para seguir con la disponibilidad.",
      "Â¿De quÃ© nacionalidad son los pasajeros?",
    ],
    en: [
      "I need your nationality to continue with availability.",
      "What is the passenger nationality?",
    ],
  },
  [NEXT_ACTIONS.ASK_FOR_PLACE_DISAMBIGUATION]: {
    es: ["Necesito que me confirmes a quÃ© lugar te referÃ­s."],
    en: ["I need you to confirm which place you mean."],
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
  const idx =
    typeof seed === "number" && Number.isFinite(seed)
      ? Math.abs(Math.floor(seed)) % arr.length
      : Math.floor(Math.random() * arr.length);
  return arr[idx];
};

const inputByAction = {
  [NEXT_ACTIONS.ASK_FOR_DESTINATION]: [
    { type: "destination", id: "DESTINATION", required: true },
  ],
  [NEXT_ACTIONS.ASK_FOR_DATES]: [
    { type: "dateRange", id: "DATES", required: true },
  ],
  [NEXT_ACTIONS.ASK_FOR_GUESTS]: [
    { type: "guestCount", id: "GUESTS", required: true },
  ],
  [NEXT_ACTIONS.ASK_FOR_NATIONALITY]: [
    { type: "nationality", id: "NATIONALITY", required: true },
  ],
  [NEXT_ACTIONS.ASK_FOR_PLACE_DISAMBIGUATION]: [
    { type: "placeDisambiguation", id: "PLACE_DISAMBIGUATION", required: true },
  ],
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
    priceFrom:
      isLiveMode && numericPrice != null && numericPrice > 0
        ? numericPrice
        : null,
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
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

const compactHotelCardPickReason = (value, language = "es") => {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/g, "")
    .trim();
  if (!text) return null;

  if (language === "es") {
    let match =
      text.match(/^te deja bien parado para moverte cerca de (.+)$/i) ||
      text.match(/^cerca de (.+)$/i);
    if (match?.[1]) return clampText(`Cerca de ${match[1].trim()}`, 24);

    match =
      text.match(/^queda bien ubicado para moverte por (.+)$/i) ||
      text.match(/^bien ubicado en (.+)$/i);
    if (match?.[1]) return clampText(`Bien ubicado en ${match[1].trim()}`, 24);

    match =
      text.match(
        /^la zona de (.+?) suele funcionar bien si buscas algo .+$/i,
      ) ||
      text.match(
        /^la zona de (.+?) le da mejor encaje que a otras alternativas cercanas$/i,
      );
    if (match?.[1]) return clampText(`Buen fit en ${match[1].trim()}`, 24);

    if (/^encaja mejor con un plan /i.test(text)) return "Buen fit";
    if (/moverte a pie|caminable/i.test(text)) return "Caminable";
    if (/tranquilo|descansar/i.test(text)) return "Mas tranquilo";
    if (/refinado|premium|mas cuidado/i.test(text)) return "Mas premium";

    match = text.match(/(\d)\s*estrellas/i);
    if (match?.[1]) return `${match[1]} estrellas`;

    if (/precio/i.test(text)) return "Buen precio";
    if (/valor|equilib|balance/i.test(text)) return "Buen balance";
    if (/simple/i.test(text)) return "Opcion simple";
    if (/vista/i.test(text)) return "Buena vista";
    if (/recomend/i.test(text)) return "Recomendado";
    if (/favorit/i.test(text)) return "Favorito";
  }

  if (language === "en") {
    if (/walk|on foot/i.test(text)) return "Walkable";
    if (/quiet|unwind/i.test(text)) return "Quieter";
    if (/premium|refined|polished/i.test(text)) return "Premium";
    if (/price|value|balance/i.test(text)) return "Good value";
    if (/view/i.test(text)) return "Nice view";
  }

  if (language === "pt") {
    if (/a pe|percorrer/i.test(text)) return "Caminhavel";
    if (/tranquilo|descansar/i.test(text)) return "Mais tranquilo";
    if (/premium|refinado/i.test(text)) return "Mais premium";
    if (/preco|valor|equilibr/i.test(text)) return "Bom valor";
    if (/vista/i.test(text)) return "Boa vista";
  }

  return clampText(text, 24);
};

const firstSentence = (value) => {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
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
    (Array.isArray(item?.hotelDetails?.amenities) &&
      item.hotelDetails.amenities) ||
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
  toNum(
    item?.reviewScore ??
      item?.rating ??
      item?.stars ??
      item?.starRating ??
      item?.classification?.code ??
      item?.hotelDetails?.rating,
  ) ?? 0;
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
  return (
    hasDates &&
    ((Number.isFinite(adults) && adults > 0) ||
      (Number.isFinite(total) && total > 0))
  );
};
const getItemCoords = (item) => {
  const lat = toNum(
    item?.latitude ??
      item?.lat ??
      item?.locationLat ??
      item?.location?.lat ??
      item?.geoPoint?.lat ??
      item?.full_address?.latitude ??
      item?.hotelDetails?.latitude ??
      item?.hotelDetails?.lat,
  );
  const lng = toNum(
    item?.longitude ??
      item?.lng ??
      item?.locationLng ??
      item?.location?.lng ??
      item?.geoPoint?.lng ??
      item?.full_address?.longitude ??
      item?.hotelDetails?.longitude ??
      item?.hotelDetails?.lng,
  );
  return lat != null && lng != null ? { lat, lng } : null;
};
const distanceKm = (a, b) => {
  if (!a?.lat || !a?.lng || !b?.lat || !b?.lng) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
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

const hasSemanticSearchPlan = (plan = {}) =>
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
    (Array.isArray(plan?.semanticSearch?.webContext?.resolvedPlaces) &&
      plan.semanticSearch.webContext.resolvedPlaces.length),
  );

const getCanonicalSemanticTraits = (plan = {}) =>
  Array.isArray(plan?.semanticSearch?.intentProfile?.userRequestedAreaTraits)
    ? plan.semanticSearch.intentProfile.userRequestedAreaTraits
    : Array.isArray(plan?.semanticSearch?.intentProfile?.requestedAreaTraits)
      ? plan.semanticSearch.intentProfile.requestedAreaTraits
      : Array.isArray(plan?.areaTraits)
        ? plan.areaTraits
        : [];

const buildSemanticProfileLabel = (plan = {}, language = "es") => {
  const traits = new Set(
    getCanonicalSemanticTraits(plan).map((trait) =>
      String(trait || "")
        .trim()
        .toUpperCase(),
    ),
  );
  const areaIntent = String(plan?.areaIntent || "")
    .trim()
    .toUpperCase();
  if (language === "es") {
    if (
      areaIntent === "GOOD_AREA" ||
      (traits.has("SAFE") &&
        traits.has("WALKABLE") &&
        traits.has("UPSCALE_AREA"))
    ) {
      return "de buena zona y caminable";
    }
    if (traits.has("QUIET") && traits.has("WALKABLE"))
      return "tranquilo y caminable";
    if (traits.has("SAFE") && traits.has("WALKABLE"))
      return "seguro y caminable";
    if (traits.has("QUIET")) return "tranquilo";
    if (traits.has("WALKABLE")) return "caminable";
    if (traits.has("SAFE")) return "en una zona mas cuidada";
    if (traits.has("UPSCALE_AREA")) return "con un entorno mas refinado";
  }
  if (language === "pt") {
    if (traits.has("QUIET") && traits.has("WALKABLE"))
      return "tranquilo e facil de percorrer";
    if (traits.has("SAFE") && traits.has("WALKABLE"))
      return "seguro e facil de percorrer";
  }
  if (
    areaIntent === "GOOD_AREA" ||
    (traits.has("SAFE") && traits.has("WALKABLE") && traits.has("UPSCALE_AREA"))
  ) {
    return "in a good, walkable area";
  }
  if (traits.has("QUIET") && traits.has("WALKABLE"))
    return "quiet and walkable";
  if (traits.has("SAFE") && traits.has("WALKABLE"))
    return "comfortable and walkable";
  if (traits.has("QUIET")) return "quiet";
  if (traits.has("WALKABLE")) return "walkable";
  if (traits.has("SAFE")) return "in a comfortable area";
  if (traits.has("UPSCALE_AREA")) return "with a more refined setting";
  return null;
};

const normalizeSemanticExplanationFragment = (value = null) =>
  String(value || "")
    .trim()
    .replace(/[.;:,]+$/g, "")
    .replace(/\s+/g, " ");

const normalizeSemanticExplanationSentence = (value = null) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[.;:,]+$/g, "")
    .trim();

const lowerCaseLeadingFragment = (value = "") => {
  const normalized = normalizeSemanticExplanationFragment(value);
  if (!normalized) return normalized;
  return normalized.charAt(0).toLowerCase() + normalized.slice(1);
};

const resolveDecisionExplanationAngleText = (item = {}, angle = null) => {
  const decisionExplanation =
    item?.decisionExplanation && typeof item.decisionExplanation === "object"
      ? item.decisionExplanation
      : null;
  const normalizedAngle = String(angle || "").trim();
  if (!decisionExplanation || !normalizedAngle) return null;
  if (
    decisionExplanation.angleTexts &&
    typeof decisionExplanation.angleTexts === "object" &&
    typeof decisionExplanation.angleTexts[normalizedAngle] === "string"
  ) {
    return normalizeSemanticExplanationFragment(
      decisionExplanation.angleTexts[normalizedAngle],
    );
  }
  if (
    decisionExplanation.comparisonAngle === normalizedAngle &&
    decisionExplanation.primaryReasonText
  ) {
    return normalizeSemanticExplanationFragment(
      decisionExplanation.primaryReasonText,
    );
  }
  if (
    decisionExplanation.secondaryReasonType &&
    (decisionExplanation.secondaryReasonType === normalizedAngle ||
      decisionExplanation.secondaryReasonType ===
        normalizedAngle.replace(/_profile$/, "")) &&
    decisionExplanation.secondaryReasonText
  ) {
    return normalizeSemanticExplanationFragment(
      decisionExplanation.secondaryReasonText,
    );
  }
  return normalizeSemanticExplanationFragment(
    decisionExplanation.primaryReasonText,
  );
};

const pickDeterministicExplanationAngle = ({
  item = {},
  usedAngles = new Set(),
  usedZoneAngles = new Set(),
} = {}) => {
  const decisionExplanation =
    item?.decisionExplanation && typeof item.decisionExplanation === "object"
      ? item.decisionExplanation
      : null;
  const zoneLabel =
    typeof decisionExplanation?.mentionedZoneLabel === "string"
      ? decisionExplanation.mentionedZoneLabel.trim()
      : "";
  const candidates = Array.from(
    new Set(
      [
        ...(Array.isArray(decisionExplanation?.allowedAngles)
          ? decisionExplanation.allowedAngles
          : []),
        decisionExplanation?.comparisonAngle || null,
      ]
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    ),
  );
  if (!candidates.length) return "overall_fit";
  const zoneAngleCandidates = candidates.filter(
    (angle) => !(zoneLabel && usedZoneAngles.has(`${zoneLabel}::${angle}`)),
  );
  const unusedAngleCandidates = zoneAngleCandidates.filter(
    (angle) => !usedAngles.has(angle),
  );
  return (
    unusedAngleCandidates[0] ||
    zoneAngleCandidates[0] ||
    candidates.find((angle) => !usedAngles.has(angle)) ||
    candidates[0]
  );
};

const buildDeterministicSemanticExplanationSentence = ({
  item = {},
  angle = "overall_fit",
  language = "es",
  rank = 1,
} = {}) => {
  if (!item?.name) return null;
  const mainReason = lowerCaseLeadingFragment(
    resolveDecisionExplanationAngleText(item, angle),
  );
  const secondaryReason = lowerCaseLeadingFragment(
    item?.decisionExplanation?.secondaryReasonText,
  );
  const openers =
    language === "es"
      ? {
          zone_fit: [
            "entró entre los primeros porque",
            "quedó arriba porque",
            "lo dejé primero porque",
          ],
          quiet_profile: [
            "subió porque",
            "lo prioricé porque",
            "entró fuerte porque",
          ],
          walkability: [
            "me cerró porque",
            "quedó bien parado porque",
            "entró bien porque",
          ],
          value: [
            "sumó puntos porque",
            "lo sostuve arriba porque",
            "entró por equilibrio porque",
          ],
          balance: [
            "se mantuvo arriba porque",
            "entró bien porque",
            "quedó entre los primeros porque",
          ],
          premium_profile: [
            "quedó arriba porque",
            "se sostuvo arriba porque",
            "entró bien porque",
          ],
          stars_match: [
            "entró arriba porque",
            "quedó bien parado porque",
            "lo dejé primero porque",
          ],
          view_match: [
            "subió porque",
            "entró bien porque",
            "quedó arriba porque",
          ],
          landmark_proximity: [
            "quedó arriba porque",
            "lo prioricé porque",
            "entró entre los primeros porque",
          ],
          profile_fit: [
            "entró bien porque",
            "quedó arriba porque",
            "lo prioricé porque",
          ],
          overall_fit: [
            "entró bien porque",
            "quedó arriba porque",
            "lo prioricé porque",
          ],
        }
      : {
          zone_fit: [
            "made the first picks because",
            "stayed near the top because",
            "was kept high because",
          ],
          quiet_profile: [
            "moved up because",
            "was prioritized because",
            "came through strongly because",
          ],
          walkability: [
            "stood out because",
            "stayed well positioned because",
            "came in well because",
          ],
          value: [
            "earned its place because",
            "stayed high because",
            "came through on balance because",
          ],
          balance: [
            "stayed high because",
            "came through well because",
            "made the first picks because",
          ],
          premium_profile: [
            "stayed near the top because",
            "held up well because",
            "came in well because",
          ],
          stars_match: [
            "made the first picks because",
            "stayed well positioned because",
            "was kept high because",
          ],
          view_match: [
            "moved up because",
            "came in well because",
            "stayed near the top because",
          ],
          landmark_proximity: [
            "stayed near the top because",
            "was prioritized because",
            "made the first picks because",
          ],
          profile_fit: [
            "came in well because",
            "stayed near the top because",
            "was prioritized because",
          ],
          overall_fit: [
            "came in well because",
            "stayed near the top because",
            "was prioritized because",
          ],
        };
  const variants = openers[angle] || openers.overall_fit;
  const opener = variants[(Math.max(rank, 1) - 1) % variants.length];
  if (!mainReason) {
    return language === "es"
      ? `**${item.name}** ${opener} encaja mejor que otras alternativas de este grupo.`
      : `**${item.name}** ${opener} it fits this search better than similar alternatives.`;
  }
  const canAddSecondary =
    secondaryReason &&
    secondaryReason !== mainReason &&
    angle !== item?.decisionExplanation?.comparisonAngle;
  if (language === "es") {
    return canAddSecondary
      ? `**${item.name}** ${opener} ${mainReason}; además, ${secondaryReason}.`
      : `**${item.name}** ${opener} ${mainReason}.`;
  }
  return canAddSecondary
    ? `**${item.name}** ${opener} ${mainReason}; it also ${secondaryReason}.`
    : `**${item.name}** ${opener} ${mainReason}.`;
};

const normalizeSemanticExplanationPlanForPicks = ({
  explanationPlan = null,
  picks = [],
} = {}) => {
  if (!explanationPlan || typeof explanationPlan !== "object") return null;
  const planItems = Array.isArray(explanationPlan.items)
    ? explanationPlan.items
    : [];
  if (!planItems.length || !Array.isArray(picks) || !picks.length) return null;
  const itemById = new Map(
    planItems
      .map((item) => {
        const hotelId = String(item?.hotelId || "").trim();
        const sentence = normalizeSemanticExplanationSentence(item?.sentence);
        if (!hotelId || !sentence) return null;
        return [
          hotelId,
          {
            hotelId,
            angle: String(item?.angle || "").trim() || null,
            sentence,
          },
        ];
      })
      .filter(Boolean),
  );
  const normalizedItems = picks
    .map((pick) => {
      const hotelId = String(
        pick?.item?.id || pick?.item?.hotelCode || "",
      ).trim();
      return hotelId ? itemById.get(hotelId) || null : null;
    })
    .filter(Boolean);
  if (normalizedItems.length !== picks.length) return null;
  const intro =
    typeof explanationPlan.intro === "string" && explanationPlan.intro.trim()
      ? explanationPlan.intro.trim()
      : null;
  return {
    intro,
    items: normalizedItems,
    source:
      typeof explanationPlan.source === "string" &&
      explanationPlan.source.trim()
        ? explanationPlan.source.trim()
        : null,
    fallbackUsed: explanationPlan.fallbackUsed === true,
  };
};

export const buildDeterministicSemanticExplanationPlan = ({
  inventory,
  plan,
  language = "es",
  seed = 0,
} = {}) => {
  if (!hasSemanticSearchPlan(plan)) return null;
  const picks = getTopInventoryPicksByCategory(
    inventory,
    plan,
    language,
    seed,
  ).slice(0, 5);
  if (!picks.length) return null;
  const destination = plan?.location?.city || plan?.location?.country || null;
  const semanticProfileLabel = buildSemanticProfileLabel(plan, language);
  const semanticInferenceMode = String(
    plan?.semanticSearch?.intentProfile?.inferenceMode || "",
  )
    .trim()
    .toUpperCase();
  const primaryPlaceLabel =
    plan?.placeTargets?.[0]?.normalizedName ||
    plan?.placeTargets?.[0]?.rawText ||
    null;
  const intro =
    semanticInferenceMode === "TRAIT_PROFILE"
      ? copyForLanguage(language, {
          es: `Dejé primero opciones que encajan mejor con un perfil ${semanticProfileLabel || "como el que pediste"}${destination ? ` dentro de ${destination}` : ""}.`,
          en: `I left the first picks for hotels that fit a ${semanticProfileLabel || "similar"} profile better${destination ? ` in ${destination}` : ""}.`,
          pt: `Deixei primeiro as opcoes que encaixam melhor com um perfil ${semanticProfileLabel || "parecido"}${destination ? ` em ${destination}` : ""}.`,
        })
      : copyForLanguage(language, {
          es: `Dejé primero las opciones más alineadas con tu búsqueda${primaryPlaceLabel ? ` en ${primaryPlaceLabel}` : ""}.`,
          en: `I left the strongest first picks for your search${primaryPlaceLabel ? ` in ${primaryPlaceLabel}` : ""}.`,
          pt: `Deixei primeiro as opcoes mais alinhadas com a sua busca${primaryPlaceLabel ? ` em ${primaryPlaceLabel}` : ""}.`,
        });
  const usedAngles = new Set();
  const usedZoneAngles = new Set();
  const items = picks
    .map((pick, index) => {
      const item = pick?.item || null;
      if (!item?.id || !item?.name) return null;
      const angle = pickDeterministicExplanationAngle({
        item,
        usedAngles,
        usedZoneAngles,
      });
      const sentence = buildDeterministicSemanticExplanationSentence({
        item,
        angle,
        language,
        rank: index + 1,
      });
      if (!sentence) return null;
      const zoneLabel =
        typeof item?.decisionExplanation?.mentionedZoneLabel === "string"
          ? item.decisionExplanation.mentionedZoneLabel.trim()
          : "";
      usedAngles.add(angle);
      if (zoneLabel) {
        usedZoneAngles.add(`${zoneLabel}::${angle}`);
      }
      return {
        hotelId: String(item.id),
        angle,
        sentence,
      };
    })
    .filter(Boolean);
  if (!items.length) return null;
  return {
    intro,
    items,
    source: "deterministic",
    fallbackUsed: true,
  };
};

const buildEditorialSemanticPickExplanation = ({
  pick = null,
  language = "es",
  rank = 1,
  repeatedZone = false,
} = {}) => {
  const item = pick?.item || null;
  if (!item?.name) return null;
  const originalPrimaryReason = normalizeSemanticExplanationFragment(
    item?.decisionExplanation?.primaryReasonText ||
      item?.shortReason ||
      pick?.pickReason,
  );
  const originalSecondaryReason = normalizeSemanticExplanationFragment(
    item?.decisionExplanation?.secondaryReasonText,
  );
  let primaryReason = originalPrimaryReason;
  let secondaryReason = originalSecondaryReason;
  if (repeatedZone && secondaryReason) {
    primaryReason = secondaryReason;
    secondaryReason = null;
  }
  if (!primaryReason) return null;

  const openerIndex = Math.max(0, (rank - 1) % 3);
  if (language === "es") {
    const openers = [
      "lo deje arriba porque",
      "quedo entre los primeros porque",
      "lo priorice porque",
    ];
    if (secondaryReason) {
      return `**${item.name}** ${openers[openerIndex]} ${primaryReason}, y ademas ${secondaryReason}.`;
    }
    return `**${item.name}** ${openers[openerIndex]} ${primaryReason}.`;
  }

  const openers = [
    "made the first picks because",
    "stayed near the top because",
    "was prioritized because",
  ];
  return secondaryReason
    ? `**${item.name}** ${openers[openerIndex]} ${primaryReason}, and it also ${secondaryReason}.`
    : `**${item.name}** ${openers[openerIndex]} ${primaryReason}.`;
};

const buildSemanticPickReason = (item, language) => {
  const semanticEvidence = Array.isArray(item?.semanticEvidence)
    ? item.semanticEvidence
    : Array.isArray(item?.semanticMatch?.evidence)
      ? item.semanticMatch.evidence
      : [];
  const hasVerifiedGeoEvidence = semanticEvidence.some(
    (entry) => entry?.type === "verified_geo",
  );
  const matchedPlaceName =
    item?.matchedPlaceTarget?.normalizedName ||
    item?.matchedPlaceTarget?.rawText ||
    null;
  const explanationReason = normalizeSemanticExplanationFragment(
    item?.decisionExplanation?.primaryReasonText,
  );
  if (
    explanationReason &&
    (!matchedPlaceName ||
      hasVerifiedGeoEvidence ||
      !String(explanationReason)
        .toLowerCase()
        .includes(String(matchedPlaceName).toLowerCase()))
  ) {
    return explanationReason;
  }
  const directReason =
    item?.shortReason ||
    (Array.isArray(item?.matchReasons) ? item.matchReasons[0] : null) ||
    null;
  if (
    matchedPlaceName &&
    !hasVerifiedGeoEvidence &&
    directReason &&
    String(directReason)
      .toLowerCase()
      .includes(String(matchedPlaceName).toLowerCase())
  ) {
    return null;
  }
  if (directReason && String(directReason).trim()) {
    return String(directReason).trim();
  }
  return copyForLanguage(language, {
    es: "Coincide con tu búsqueda",
    en: "Matches your search",
    pt: "Combina com a sua busca",
  });
};

const pickReasonFromCatalog = (category, language, seed) => {
  const list = PICK_REASON_CATALOG[category];
  if (!list?.length) return language === "es" ? "Recomendado" : "Recommended";
  const idx = Math.abs(seed) % list.length;
  const row = list[idx];
  return language === "es" ? row.es : row.en;
};

/** Picks 5 items using a sortBy-aware strategy. Uses catalog to choose reason labels per call. */
export const getTopInventoryPicksByCategory = (
  inventory,
  plan,
  language,
  seed = 0,
) => {
  const hotels = Array.isArray(inventory?.hotels) ? inventory.hotels : [];
  const homes = Array.isArray(inventory?.homes) ? inventory.homes : [];
  const baseSource = hotels.length ? hotels : homes;
  const pricedSource = baseSource.filter((item) => hasUsablePrice(item));
  const source =
    hasLiveSearchContext(plan) && pricedSource.length
      ? pricedSource
      : baseSource;
  if (!source.length) return [];
  if (hasSemanticSearchPlan(plan)) {
    const preferredIds = Array.isArray(
      inventory?.searchScope?.hotels?.threadTopPickIds,
    )
      ? inventory.searchScope.hotels.threadTopPickIds
      : [];
    const sourceById = new Map(
      source.map((item) => [String(item?.id || item?.hotelCode || ""), item]),
    );
    const preferredItems = preferredIds
      .map((id) => sourceById.get(String(id || "")))
      .filter(Boolean);
    const usedIds = new Set(
      preferredItems
        .map((item) => String(item?.id || item?.hotelCode || ""))
        .filter(Boolean),
    );
    const orderedItems = [
      ...preferredItems,
      ...source.filter((item) => {
        const id = String(item?.id || item?.hotelCode || "");
        return !id || !usedIds.has(id);
      }),
    ];
    return orderedItems.slice(0, 5).map((item) => ({
      item,
      pickReason: buildSemanticPickReason(item, language),
    }));
  }

  const sortBy = plan?.sortBy || null;
  const destStr =
    [plan?.location?.city, plan?.location?.country].filter(Boolean).join(" ") ||
    "default";
  const seedNum = seed + destStr.length * 31 + (destStr.charCodeAt(0) ?? 0);

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
    const coordsList = source
      .map((item) => getItemCoords(item))
      .filter(Boolean);
    if (coordsList.length >= 2) {
      const sumLat = coordsList.reduce((a, c) => a + c.lat, 0);
      const sumLng = coordsList.reduce((a, c) => a + c.lng, 0);
      center = {
        lat: sumLat / coordsList.length,
        lng: sumLng / coordsList.length,
      };
    }
  }

  const out = [];

  if (sortBy === "PRICE_ASC") {
    // User explicitly asked for cheapest — lead with 3 by price asc, then 1 price-quality, 1 extra
    const byPriceAsc = [...source].sort(
      (a, b) => (getItemPrice(a) || Infinity) - (getItemPrice(b) || Infinity),
    );
    const cheapest3 = take(
      byPriceAsc,
      3,
      (a, b) => (getItemPrice(a) || Infinity) - (getItemPrice(b) || Infinity),
    );
    const reasonBudget = pickReasonFromCatalog(
      "priceQuality",
      language,
      seedNum + 1,
    );
    cheapest3.forEach((item) => out.push({ item, pickReason: reasonBudget }));

    const byPriceQuality = [...source].sort((a, b) => {
      const sA =
        (getItemRating(a) || 1) / Math.max((getItemPrice(a) || 1) / 100, 0.01);
      const sB =
        (getItemRating(b) || 1) / Math.max((getItemPrice(b) || 1) / 100, 0.01);
      return sB - sA;
    });
    const pq1 = take(byPriceQuality, 1, (a, b) => {
      const sA =
        (getItemRating(a) || 1) / Math.max((getItemPrice(a) || 1) / 100, 0.01);
      const sB =
        (getItemRating(b) || 1) / Math.max((getItemPrice(b) || 1) / 100, 0.01);
      return sB - sA;
    });
    pq1.forEach((item) =>
      out.push({
        item,
        pickReason: pickReasonFromCatalog(
          "priceQuality",
          language,
          seedNum + 2,
        ),
      }),
    );
  } else if (sortBy === "PRICE_DESC") {
    // User wants premium — lead with 3 highest-priced, then 1 by rating, 1 extra
    const byPriceDesc = [...source].sort(
      (a, b) => (getItemPrice(b) || 0) - (getItemPrice(a) || 0),
    );
    const premium3 = take(
      byPriceDesc,
      3,
      (a, b) => (getItemPrice(b) || 0) - (getItemPrice(a) || 0),
    );
    const reasonPremium = pickReasonFromCatalog(
      "rating",
      language,
      seedNum + 1,
    );
    premium3.forEach((item) => out.push({ item, pickReason: reasonPremium }));

    const byRating = [...source].sort(
      (a, b) => getItemRating(b) - getItemRating(a),
    );
    const rated1 = take(
      byRating,
      1,
      (a, b) => getItemRating(b) - getItemRating(a),
    );
    rated1.forEach((item) =>
      out.push({
        item,
        pickReason: pickReasonFromCatalog("rating", language, seedNum + 2),
      }),
    );
  } else {
    // Default: 2 by rating + 2 by price-quality + 1 extra
    const byRating = [...source].sort(
      (a, b) => getItemRating(b) - getItemRating(a),
    );
    const byPriceQuality = [...source].sort((a, b) => {
      const rA = getItemRating(a) || 1;
      const rB = getItemRating(b) || 1;
      const pA = getItemPrice(a) || 1;
      const pB = getItemPrice(b) || 1;
      const scoreA = rA / Math.max(pA / 100, 0.01);
      const scoreB = rB / Math.max(pB / 100, 0.01);
      return scoreB - scoreA;
    });

    const topRated2 = take(
      byRating,
      2,
      (a, b) => getItemRating(b) - getItemRating(a),
    );
    const reasonRating = pickReasonFromCatalog("rating", language, seedNum + 1);
    topRated2.forEach((item) => out.push({ item, pickReason: reasonRating }));

    const priceQuality2 = take(byPriceQuality, 2, (a, b) => {
      const sA =
        (getItemRating(a) || 1) / Math.max(getItemPrice(a) / 100 || 0.01, 0.01);
      const sB =
        (getItemRating(b) || 1) / Math.max(getItemPrice(b) / 100 || 0.01, 0.01);
      return sB - sA;
    });
    const reasonPriceQuality = pickReasonFromCatalog(
      "priceQuality",
      language,
      seedNum + 2,
    );
    priceQuality2.forEach((item) =>
      out.push({ item, pickReason: reasonPriceQuality }),
    );
  }

  // Extra pick: closest to center (or fallback by rating) — applies to all branches
  const remaining = source.filter(
    (x) => !usedIds.has(String(x.id || x.hotelCode || "")),
  );
  let extra = null;
  if (remaining.length) {
    const withCoords = remaining
      .map((item) => ({ item, coords: getItemCoords(item) }))
      .filter((x) => x.coords);
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
      const next = remaining.sort(
        (a, b) => getItemRating(b) - getItemRating(a),
      )[0];
      usedIds.add(String(next.id || next.hotelCode || ""));
      extra = {
        item: next,
        pickReason: pickReasonFromCatalog("general", language, seedNum + 4),
      };
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
  String(str || "").replace(
    /\b\w+/g,
    (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
  );

const extractImageUrls = (item, max = 4) => {
  const imgs =
    (Array.isArray(item?.images) && item.images) ||
    (Array.isArray(item?.hotelDetails?.images) && item.hotelDetails.images) ||
    [];
  const seen = new Set();
  const urls = [];
  for (const img of imgs) {
    const url = typeof img === "string" ? img : (img?.url ?? null);
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
    POOL: "piscina",
    SWIMMING_POOL: "piscina",
    OUTDOOR_POOL: "piscina exterior",
    INDOOR_POOL: "piscina climatizada",
    SPA: "spa",
    GYM: "gimnasio",
    FITNESS: "gimnasio",
    WIFI: "WiFi",
    PARKING: "estacionamiento",
    RESTAURANT: "restaurante",
    BAR: "bar",
    BEACH: "playa",
    BREAKFAST: "desayuno incluido",
    ROOM_SERVICE: "room service",
    PETS: "admite mascotas",
    FAMILY: "familiar",
    TENNIS: "tenis",
    GOLF: "golf",
    CASINO: "casino",
    AIRPORT_SHUTTLE: "traslado al aeropuerto",
    LAUNDRY: "lavandería",
    CONFERENCE: "sala de conferencias",
  },
  en: {
    POOL: "pool",
    SWIMMING_POOL: "pool",
    OUTDOOR_POOL: "outdoor pool",
    INDOOR_POOL: "indoor pool",
    SPA: "spa",
    GYM: "gym",
    FITNESS: "fitness center",
    WIFI: "WiFi",
    PARKING: "parking",
    RESTAURANT: "restaurant",
    BAR: "bar",
    BEACH: "beach",
    BREAKFAST: "breakfast included",
    ROOM_SERVICE: "room service",
    PETS: "pet-friendly",
    FAMILY: "family-friendly",
    TENNIS: "tennis",
    GOLF: "golf",
    CASINO: "casino",
    AIRPORT_SHUTTLE: "airport shuttle",
    LAUNDRY: "laundry",
    CONFERENCE: "conference room",
  },
};

const buildFilterContext = (plan, language) => {
  const lang = language === "es" ? "es" : "en";
  const filters = plan?.hotelFilters || {};
  const parts = [];
  const areaPreference = Array.isArray(plan?.preferences?.areaPreference)
    ? plan.preferences.areaPreference.map((value) =>
        String(value || "").toUpperCase(),
      )
    : [];

  const minRating = Number(filters.minRating);
  if (Number.isFinite(minRating) && minRating >= 1 && minRating <= 5) {
    parts.push(lang === "es" ? `${minRating} estrellas` : `${minRating}-star`);
  }

  const amenityCodes = Array.isArray(filters.amenityCodes)
    ? filters.amenityCodes
    : [];
  if (amenityCodes.length) {
    const labelMap = AMENITY_CODE_LABELS[lang] || AMENITY_CODE_LABELS.en;
    const labels = amenityCodes
      .map((code) => labelMap[String(code).toUpperCase()] || null)
      .filter(Boolean)
      .slice(0, 2);
    labels.forEach((l) => parts.push(l));
  }

  const sortBy = String(plan?.sortBy || "")
    .trim()
    .toUpperCase();
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

const buildEnhancedFilterContext = (plan, language) => {
  const baseContext = buildFilterContext(plan, language);
  const base = Array.isArray(baseContext) ? baseContext : [];
  const lang = language === "es" ? "es" : language === "pt" ? "pt" : "en";
  const semanticParts = [];
  const placeTargets = Array.isArray(plan?.placeTargets)
    ? plan.placeTargets
    : Array.isArray(plan?.semanticSearch?.webContext?.resolvedPlaces)
      ? plan.semanticSearch.webContext.resolvedPlaces
      : [];
  const exactStarRatings = Array.isArray(plan?.starRatings)
    ? [
        ...new Set(
          plan.starRatings
            .map((value) => Number(value))
            .filter(
              (value) => Number.isFinite(value) && value >= 1 && value <= 5,
            ),
        ),
      ].sort((a, b) => a - b)
    : [];

  if (exactStarRatings.length) {
    semanticParts.push(
      copyForLanguage(lang, {
        es:
          exactStarRatings.length === 1
            ? `${exactStarRatings[0]} estrellas`
            : `${exactStarRatings.join(" o ")} estrellas`,
        en:
          exactStarRatings.length === 1
            ? `${exactStarRatings[0]}-star`
            : `${exactStarRatings.join(" or ")} stars`,
        pt:
          exactStarRatings.length === 1
            ? `${exactStarRatings[0]} estrelas`
            : `${exactStarRatings.join(" ou ")} estrelas`,
      }),
    );
  }

  const viewIntentLabels = {
    RIVER_VIEW: copyForLanguage(lang, {
      es: "vista al río",
      en: "river view",
      pt: "vista para o rio",
    }),
    WATER_VIEW: copyForLanguage(lang, {
      es: "vista al agua",
      en: "water view",
      pt: "vista para a água",
    }),
    SEA_VIEW: copyForLanguage(lang, {
      es: "vista al mar",
      en: "sea view",
      pt: "vista para o mar",
    }),
    CITY_VIEW: copyForLanguage(lang, {
      es: "vista urbana",
      en: "city view",
      pt: "vista para a cidade",
    }),
    LANDMARK_VIEW: copyForLanguage(lang, {
      es: "vista abierta",
      en: "landmark view",
      pt: "vista para ponto turístico",
    }),
  };
  if (plan?.viewIntent && viewIntentLabels[plan.viewIntent]) {
    semanticParts.push(viewIntentLabels[plan.viewIntent]);
  }

  const areaIntentLabels = {
    GOOD_AREA: copyForLanguage(lang, {
      es: "buena zona",
      en: "good area",
      pt: "boa região",
    }),
    CITY_CENTER: copyForLanguage(lang, {
      es: "zona céntrica",
      en: "central area",
      pt: "região central",
    }),
    QUIET: copyForLanguage(lang, {
      es: "zona tranquila",
      en: "quiet area",
      pt: "região tranquila",
    }),
    NIGHTLIFE: copyForLanguage(lang, {
      es: "vida nocturna",
      en: "nightlife area",
      pt: "vida noturna",
    }),
    BEACH_COAST: copyForLanguage(lang, {
      es: "cerca del agua",
      en: "coastal area",
      pt: "área costeira",
    }),
  };
  if (plan?.areaIntent && areaIntentLabels[plan.areaIntent]) {
    semanticParts.push(areaIntentLabels[plan.areaIntent]);
  }

  if (placeTargets.length) {
    const primaryTarget = placeTargets[0];
    const label =
      primaryTarget?.normalizedName || primaryTarget?.rawText || null;
    if (label) {
      semanticParts.push(
        plan?.geoIntent === "IN_AREA"
          ? copyForLanguage(lang, {
              es: `en ${label}`,
              en: `in ${label}`,
              pt: `em ${label}`,
            })
          : copyForLanguage(lang, {
              es: `cerca de ${label}`,
              en: `near ${label}`,
              pt: `perto de ${label}`,
            }),
      );
    }
  }

  const qualityIntentLabels = {
    BUDGET: copyForLanguage(lang, {
      es: "perfil económico",
      en: "budget-friendly",
      pt: "perfil econômico",
    }),
    VALUE: copyForLanguage(lang, {
      es: "buena relación precio-calidad",
      en: "strong value",
      pt: "bom custo-benefício",
    }),
    LUXURY: copyForLanguage(lang, {
      es: "perfil premium",
      en: "luxury profile",
      pt: "perfil premium",
    }),
  };
  if (plan?.qualityIntent && qualityIntentLabels[plan.qualityIntent]) {
    semanticParts.push(qualityIntentLabels[plan.qualityIntent]);
  }

  const areaTraitLabels = {
    GOOD_AREA: copyForLanguage(lang, {
      es: "buena zona",
      en: "good area",
      pt: "boa região",
    }),
    SAFE: copyForLanguage(lang, {
      es: "zona segura",
      en: "safe area",
      pt: "área segura",
    }),
    QUIET: copyForLanguage(lang, {
      es: "zona tranquila",
      en: "quiet area",
      pt: "área tranquila",
    }),
    NIGHTLIFE: copyForLanguage(lang, {
      es: "vida nocturna",
      en: "nightlife",
      pt: "vida noturna",
    }),
    WALKABLE: copyForLanguage(lang, {
      es: "caminable",
      en: "walkable",
      pt: "caminhável",
    }),
    UPSCALE_AREA: copyForLanguage(lang, {
      es: "zona premium",
      en: "upscale area",
      pt: "área premium",
    }),
    FAMILY: copyForLanguage(lang, {
      es: "familiar",
      en: "family-friendly",
      pt: "familiar",
    }),
    BUSINESS: copyForLanguage(lang, {
      es: "zona de negocios",
      en: "business area",
      pt: "área de negócios",
    }),
    CENTRAL: copyForLanguage(lang, {
      es: "céntrica",
      en: "central",
      pt: "central",
    }),
    CULTURAL: copyForLanguage(lang, {
      es: "cultural",
      en: "cultural",
      pt: "cultural",
    }),
    WATERFRONT_AREA: copyForLanguage(lang, {
      es: "zona ribereña",
      en: "waterfront area",
      pt: "área à beira d'água",
    }),
    LUXURY: copyForLanguage(lang, {
      es: "premium",
      en: "premium",
      pt: "premium",
    }),
  };
  Array.from(
    new Set([
      ...(Array.isArray(plan?.areaTraits) ? plan.areaTraits : []),
      ...(Array.isArray(
        plan?.semanticSearch?.intentProfile?.requestedAreaTraits,
      )
        ? plan.semanticSearch.intentProfile.requestedAreaTraits
        : []),
    ]),
  )
    .map((trait) => areaTraitLabels[trait])
    .filter(Boolean)
    .forEach((label) => semanticParts.push(label));

  const merged = Array.from(new Set([...semanticParts, ...base]));
  return merged.length ? merged : null;
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
      const id = String(
        item?.id || item?.hotelCode || `shortlist-${index + 1}`,
      );
      const name =
        item?.title ||
        item?.name ||
        item?.hotelName ||
        item?.hotelDetails?.hotelName ||
        item?.hotelDetails?.name ||
        "Hotel";
      const city = item?.city || item?.cityName || null;
      const stars = normalizeStars(
        item?.stars ??
          item?.rating ??
          item?.classification?.code ??
          item?.hotelDetails?.rating,
      );
      const value =
        isLiveMode && hasUsablePrice(item)
          ? formatCompactPriceLabel(
              item?.pricePerNight ?? item?.price ?? null,
              item?.currency || "USD",
              language,
            )
          : stars
            ? `${stars}★`
            : null;
      const subtitle =
        pickReason && String(pickReason).trim()
          ? buildAppreciationLine(pickReason, language)
          : city
            ? toTitleCase(city)
            : null;
      const tags = [
        city ? toTitleCase(city) : null,
        ...pickAmenityLabels(item, 2),
      ]
        .filter(Boolean)
        .slice(0, 3);

      return {
        id,
        rank: index + 1,
        inventoryType: String(item?.inventoryType || "HOTEL").toUpperCase(),
        title: clampText(name, 64),
        subtitle,
        value,
        priceFrom:
          isLiveMode && hasUsablePrice(item)
            ? Number(item?.pricePerNight ?? item?.price ?? null)
            : null,
        currency: normalizeDisplayCurrencyCode(item?.currency || "USD"),
        city: city ? toTitleCase(city) : null,
        locationText: city ? toTitleCase(city) : null,
        tags,
      };
    })
    .filter(Boolean);

  if (!shortlistItems.length) return null;
  const destinationLabel =
    destination ||
    copyForLanguage(language, {
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
    body: copyForLanguage(
      language,
      isLiveMode
        ? {
            es: "Ya tengo disponibilidad para tus fechas, así que acá ves una lectura corta con precio por noche.",
            en: "I already have live availability for your dates, so this is a quick view with nightly pricing.",
            pt: "Já tenho disponibilidade para as suas datas, então aqui você vê um resumo curto com preço por noite.",
          }
        : {
            es: "Te resumo el perfil de cada opción para que ubiques rápido cuáles te cierran más.",
            en: "Here is a quick summary so you can spot which options fit best.",
            pt: "Aqui vai um resumo do perfil de cada opção para você identificar rápido quais fazem mais sentido.",
          },
    ),
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
  const destinationLabel =
    destination ||
    copyForLanguage(language, {
      es: "el set",
      en: "the set",
      pt: "a seleção",
    });
  const filterLabel =
    Array.isArray(filterContext) && filterContext.length
      ? filterContext
          .slice(0, 2)
          .join(language === "es" ? " y " : language === "pt" ? " e " : " and ")
      : null;

  if (isLiveMode) {
    return {
      type: "nextStep",
      eyebrow: copyForLanguage(language, {
        es: "Siguiente paso",
        en: "Next step",
        pt: "Próximo passo",
      }),
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
  const filterLabel = Array.isArray(filterContext)
    ? filterContext
        .slice(0, 2)
        .join(language === "es" ? " y " : language === "pt" ? " e " : " and ")
    : "";
  const destinationLabel =
    destination ||
    copyForLanguage(language, {
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

const buildHotelPickSection = (
  item,
  pickReason = null,
  language = "es",
  options = {},
) => {
  if (!item) return null;
  const id = String(item.id || item.hotelCode || "");
  if (!id) return null;
  const name =
    item?.title ||
    item?.name ||
    item?.hotelName ||
    item?.hotelDetails?.hotelName ||
    item?.hotelDetails?.name ||
    "Hotel";
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
    item?.shortDescription ||
    item?.description ||
    item?.hotelDetails?.shortDescription ||
    item?.hotelDetails?.description ||
    "";
  const description = clampText(
    decodeHtmlEntities(rawDescription) ||
      (location
        ? copyForLanguage(language, {
            es: `Ubicado en ${location}.`,
            en: `Located in ${location}.`,
            pt: `Localizado em ${location}.`,
          })
        : ""),
    450,
  );
  const shortDescription = description ? clampText(description, 180) : null;
  const stars = normalizeStars(
    item?.stars ??
      item?.rating ??
      item?.classification?.code ??
      item?.reviewScore ??
      item?.hotelDetails?.rating ??
      item?.hotelPayload?.rating,
  );
  const amenities = pickAmenityLabels(item, 3);
  const images = extractImageUrls(item, 4);
  const priceFrom = item?.pricePerNight ?? item?.price ?? null;
  const currency = normalizeDisplayCurrencyCode(item?.currency || "USD");
  const amenityLabels = pickAmenityLabels(item, 6);
  const characteristics = (
    amenityLabels && amenityLabels.length ? amenityLabels : amenities
  ).slice(0, 5);
  const compactPickReason = compactHotelCardPickReason(pickReason, language);
  const appreciation = buildAppreciationLine(pickReason, language);
  return {
    type: "hotelCard",
    id,
    rank: options.rank || 1,
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
    priceFrom:
      options.isLiveMode &&
      Number.isFinite(Number(priceFrom)) &&
      Number(priceFrom) > 0
        ? Number(priceFrom)
        : null,
    currency,
    pickReason: compactPickReason,
  };
};

const buildStructuredSearchReply = ({
  inventory,
  plan,
  language,
  seed,
  userName,
  resultCount = 0,
  latestUserMessage = "",
}) => {
  const picksWithReasons = getTopInventoryPicksByCategory(
    inventory,
    plan,
    language,
    seed ?? 0,
  );
  const picks = picksWithReasons.length
    ? picksWithReasons
    : getTopInventoryPicks(inventory, 5).map((item) => ({
        item,
        pickReason: null,
      }));
  if (!picks.length) return null;

  const isSpanish = language === "es";
  const destination =
    plan?.location?.city ||
    plan?.location?.address ||
    plan?.location?.country ||
    "";
  const name = userName ? String(userName).split(" ")[0] : null;
  const filterContext = buildEnhancedFilterContext(plan, language);
  const isLiveMode = hasLiveSearchContext(plan);
  const semanticInferenceMode = String(
    plan?.semanticSearch?.intentProfile?.inferenceMode || "",
  )
    .trim()
    .toUpperCase();
  const semanticTraitProfileActive =
    hasSemanticSearchPlan(plan) && semanticInferenceMode === "TRAIT_PROFILE";
  const semanticGeoActive =
    hasSemanticSearchPlan(plan) &&
    semanticInferenceMode !== "TRAIT_PROFILE" &&
    (Boolean(plan?.geoIntent) ||
      (Array.isArray(plan?.placeTargets) && plan.placeTargets.length) ||
      (Array.isArray(plan?.semanticSearch?.webContext?.resolvedPlaces) &&
        plan.semanticSearch.webContext.resolvedPlaces.length) ||
      Boolean(plan?.viewIntent));
  const hotelSearchScope = inventory?.searchScope?.hotels || null;
  const scopeWarningMode = hotelSearchScope?.warningMode || null;
  const scopeConfidence = hotelSearchScope?.scopeConfidence || null;
  const nearbyFallbackApplied =
    hotelSearchScope?.nearbyFallbackApplied === true;
  const nearbyFallbackCities = Array.isArray(
    hotelSearchScope?.nearbyFallbackCities,
  )
    ? hotelSearchScope.nearbyFallbackCities
        .map((entry) =>
          typeof entry === "string" && entry.trim() ? entry.trim() : null,
        )
        .filter(Boolean)
        .slice(0, 2)
    : [];
  const nearbyFallbackOriginalDestination =
    hotelSearchScope?.nearbyFallbackOriginalDestination ||
    plan?.location?.landmark ||
    destination ||
    null;
  const strongScopedCount =
    Number.isFinite(Number(hotelSearchScope?.strongHotelCount)) &&
    Number(hotelSearchScope.strongHotelCount) > 0
      ? Number(hotelSearchScope.strongHotelCount)
      : null;
  const assumedDefaultGuests = Boolean(plan?.assumptions?.defaultGuestsApplied);
  const totalFound =
    hotelSearchScope?.visibleHotelCount ||
    resultCount ||
    (inventory?.hotels?.length || 0) + (inventory?.homes?.length || 0);
  const total = totalFound > 0 ? totalFound : picks.length;
  const userAskedPool = /\b(pileta|piscina|pool|swimming)\b/i.test(
    latestUserMessage || "",
  );
  const userAskedCheap = /\b(barato|económico|cheap|budget|low cost)\b/i.test(
    latestUserMessage || "",
  );

  const dest = destination ? ` en ${destination}` : "";
  const destEn = destination ? ` in ${destination}` : "";
  const filterJoined = filterContext
    ? isSpanish
      ? ` ${filterContext.join(" y ")}`
      : ` ${filterContext.join(" and ")}`
    : "";
  const primaryPlaceLabel =
    plan?.placeTargets?.[0]?.normalizedName ||
    plan?.placeTargets?.[0]?.rawText ||
    plan?.semanticSearch?.webContext?.resolvedPlaces?.[0]?.normalizedName ||
    plan?.semanticSearch?.webContext?.resolvedPlaces?.[0]?.rawText ||
    null;
  const requestedAreaTraits = Array.isArray(
    plan?.semanticSearch?.intentProfile?.userRequestedAreaTraits,
  )
    ? plan.semanticSearch.intentProfile.userRequestedAreaTraits
    : Array.isArray(plan?.semanticSearch?.intentProfile?.requestedAreaTraits)
      ? plan.semanticSearch.intentProfile.requestedAreaTraits
      : Array.isArray(plan?.areaTraits)
        ? plan.areaTraits
        : [];
  const semanticProfileLabel = buildSemanticProfileLabel(plan, language);
  const nearbyCitiesJoined = nearbyFallbackCities
    .join(", ")
    .replace(
      /, ([^,]*)$/,
      language === "es" ? " y $1" : language === "pt" ? " e $1" : " and $1",
    );

  let introVariants;
  if (isLiveMode) {
    const countPhrase = isSpanish
      ? total <= 3
        ? `Encontré ${total} opción${total === 1 ? "" : "es"} disponible${total === 1 ? "" : "s"}`
        : `Tengo ${total} opciones disponibles`
      : total <= 3
        ? `I found ${total} available option${total === 1 ? "" : "s"}`
        : `I found ${total} available options`;
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
  } else if (
    semanticTraitProfileActive &&
    scopeWarningMode === "EXPANDED_WITH_NOTICE"
  ) {
    introVariants = isSpanish
      ? [
          `Encontré ${Math.max(1, strongScopedCount || total)} opciones muy alineadas con un perfil ${semanticProfileLabel || "como el que pediste"} y completé con hoteles cercanos a ese estilo.`,
          `${name ? `${name}, ` : ""}prioricé las opciones que mejor encajan con un perfil ${semanticProfileLabel || "tranquilo y caminable"} y sumé alternativas cercanas.`,
          `Primero dejé los hoteles más alineados con ese perfil y después agregué opciones de ajuste cercano.`,
        ]
      : [
          `I found ${Math.max(1, strongScopedCount || total)} options that strongly match a ${semanticProfileLabel || "similar"} profile and filled the rest with close-fit hotels.`,
          `${name ? `${name}, ` : ""}I prioritized the hotels that best match a ${semanticProfileLabel || "quiet and walkable"} profile and added nearby alternatives.`,
          `I kept the strongest profile matches first and then added close-fit alternatives.`,
        ];
  } else if (semanticGeoActive && scopeWarningMode === "EXPANDED_WITH_NOTICE") {
    introVariants = isSpanish
      ? [
          `Encontré ${Math.max(1, strongScopedCount || total)} opciones muy alineadas${primaryPlaceLabel ? ` con ${primaryPlaceLabel}` : ""} y completé con hoteles cercanos a ese perfil.`,
          `${name ? `${name}, ` : ""}dejé primero las opciones más precisas${primaryPlaceLabel ? ` para ${primaryPlaceLabel}` : ""} y después sumé alternativas cercanas.`,
          `Priorizé los matches más fuertes${primaryPlaceLabel ? ` en ${primaryPlaceLabel}` : ""} y completé con opciones de ajuste cercano.`,
        ]
      : [
          `I found ${Math.max(1, strongScopedCount || total)} strongly aligned options${primaryPlaceLabel ? ` for ${primaryPlaceLabel}` : ""} and filled the rest with nearby close-fit hotels.`,
          `${name ? `${name}, ` : ""}I kept the strongest matches first${primaryPlaceLabel ? ` for ${primaryPlaceLabel}` : ""} and then added nearby alternatives.`,
          `I prioritized the strongest matches${primaryPlaceLabel ? ` around ${primaryPlaceLabel}` : ""} and completed the list with close-fit options.`,
        ];
  } else if (semanticTraitProfileActive && scopeConfidence === "LOW") {
    introVariants = isSpanish
      ? [
          `Te muestro las opciones que más se acercan a un perfil ${semanticProfileLabel || "como el que pediste"}${dest}.`,
          `${name ? `${name}, ` : ""}no vi suficientes matches exactos, así que prioricé hoteles que se acercan a ese perfil.`,
          `No encontré suficientes matches exactos, así que dejé primero los hoteles que más se aproximan a ese estilo.`,
        ]
      : [
          `These are the options that come closest to a ${semanticProfileLabel || "similar"} profile${destEn}.`,
          `${name ? `${name}, ` : ""}I did not see enough exact matches, so I prioritized the hotels that come closest to that profile.`,
          `I did not find enough exact matches, so I kept the hotels that come closest to that style first.`,
        ];
  } else if (semanticGeoActive && scopeConfidence === "LOW") {
    introVariants = isSpanish
      ? [
          `Te muestro las opciones que más se acercan a tu pedido${primaryPlaceLabel ? ` alrededor de ${primaryPlaceLabel}` : ""}.`,
          `${name ? `${name}, ` : ""}estas son las opciones más cercanas a ese perfil${primaryPlaceLabel ? ` cerca de ${primaryPlaceLabel}` : ""}.`,
          `No vi suficientes matches exactos, así que prioricé los hoteles que más se aproximan${primaryPlaceLabel ? ` a ${primaryPlaceLabel}` : ""}.`,
        ]
      : [
          `These are the options that come closest to your request${primaryPlaceLabel ? ` around ${primaryPlaceLabel}` : ""}.`,
          `${name ? `${name}, ` : ""}these are the closest matches I found${primaryPlaceLabel ? ` near ${primaryPlaceLabel}` : ""}.`,
          `I did not see enough exact matches, so I prioritized the hotels that come closest${primaryPlaceLabel ? ` to ${primaryPlaceLabel}` : ""}.`,
        ];
  } else if (semanticTraitProfileActive) {
    introVariants = isSpanish
      ? [
          `Priorizé hoteles en zonas de ${destination || "la ciudad"} que suelen funcionar bien para un perfil ${semanticProfileLabel || "como el que pediste"}.`,
          `${name ? `${name}, ` : ""}elegí opciones que encajan mejor con un perfil ${semanticProfileLabel || "tranquilo y caminable"} en ${destination || "la ciudad"}.`,
          `Estas opciones quedaron primero porque encajan mejor con ese perfil en ${destination || "la ciudad"}.`,
        ]
      : [
          `I prioritized hotels in areas of ${destination || "the city"} that usually work well for a ${semanticProfileLabel || "similar"} profile.`,
          `${name ? `${name}, ` : ""}I chose options that fit a ${semanticProfileLabel || "quiet and walkable"} profile better in ${destination || "the city"}.`,
          `These options came first because they fit that profile better in ${destination || "the city"}.`,
        ];
  } else if (semanticGeoActive) {
    introVariants = isSpanish
      ? [
          `Te propongo ${total <= 1 ? "esta opción" : `estas ${total} opciones`}${primaryPlaceLabel ? ` con foco en ${primaryPlaceLabel}` : " alineadas con tu búsqueda"}.`,
          `${total <= 1 ? "Esta opción" : "Estas opciones"} quedaron priorizadas${primaryPlaceLabel ? ` por cercanía a ${primaryPlaceLabel}` : " por cómo encajan con tu búsqueda"}.`,
          `${name ? `${name}, ` : ""}prioricé ${total <= 1 ? "esta opción" : "estas opciones"}${primaryPlaceLabel ? ` cerca de ${primaryPlaceLabel}` : " según tu pedido"}.`,
        ]
      : [
          `I shortlisted ${total <= 1 ? "this option" : `these ${total} options`}${primaryPlaceLabel ? ` with focus on ${primaryPlaceLabel}` : " based on your request"}.`,
          `${total <= 1 ? "This option" : "These options"} were prioritized${primaryPlaceLabel ? ` for proximity to ${primaryPlaceLabel}` : " for how they match your search"}.`,
          `${name ? `${name}, ` : ""}I prioritized ${total <= 1 ? "this option" : "these options"}${primaryPlaceLabel ? ` near ${primaryPlaceLabel}` : " for overall fit"}.`,
        ];
  } else if (
    total > 0 &&
    (userAskedPool || userAskedCheap || filterContext?.length)
  ) {
    const countPhrase = isSpanish
      ? total <= 3
        ? `Encontré ${total} opción${total === 1 ? "" : "es"}`
        : `Hay ${total} opciones`
      : total <= 3
        ? `Found ${total} option${total === 1 ? "" : "s"}`
        : `There are ${total} options`;
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
  const orientationDeliveredSeparately =
    plan?.assumptions?.separateSemanticOrientationMessage === true;
  const progressiveResultsIntro =
    orientationDeliveredSeparately &&
    (semanticGeoActive ||
      semanticTraitProfileActive ||
      Boolean(plan?.viewIntent))
      ? copyForLanguage(language, {
          es:
            total === 1
              ? "AcÃ¡ estÃ¡ la opciÃ³n recomendada."
              : "AcÃ¡ estÃ¡n las opciones recomendadas.",
          en:
            total === 1
              ? "Here is the recommended option."
              : "Here are the recommended options.",
          pt:
            total === 1
              ? "Aqui estÃ¡ a opÃ§Ã£o recomendada."
              : "Aqui estÃ£o as opÃ§Ãµes recomendadas.",
        })
      : null;
  const progressiveResultsIntroSafe =
    orientationDeliveredSeparately &&
    (semanticGeoActive ||
      semanticTraitProfileActive ||
      Boolean(plan?.viewIntent))
      ? copyForLanguage(language, {
          es:
            total === 1
              ? "Aca esta la opcion recomendada."
              : "Aca estan las opciones recomendadas.",
          en:
            total === 1
              ? "Here is the recommended option."
              : "Here are the recommended options.",
          pt:
            total === 1
              ? "Aqui esta a opcao recomendada."
              : "Aqui estao as opcoes recomendadas.",
        })
      : progressiveResultsIntro;
  const neutralResultsIntroSafe = copyForLanguage(language, {
    es:
      total === 1
        ? "Aca esta la opcion recomendada."
        : "Aca estan las opciones recomendadas.",
    en:
      total === 1
        ? "Here is the recommended option."
        : "Here are the recommended options.",
    pt:
      total === 1
        ? "Aqui esta a opcao recomendada."
        : "Aqui estao as opcoes recomendadas.",
  });
  const nearbyFallbackIntroSafe = nearbyFallbackApplied
    ? copyForLanguage(language, {
        es: nearbyCitiesJoined
          ? `No encontre hoteles en ${nearbyFallbackOriginalDestination || "ese destino"}, pero si opciones cercanas en ${nearbyCitiesJoined}.`
          : `No encontre hoteles en ${nearbyFallbackOriginalDestination || "ese destino"}, pero si opciones cercanas que pueden servirte.`,
        en: nearbyCitiesJoined
          ? `I did not find hotels in ${nearbyFallbackOriginalDestination || "that destination"}, but I did find nearby options in ${nearbyCitiesJoined}.`
          : `I did not find hotels in ${nearbyFallbackOriginalDestination || "that destination"}, but I did find nearby options that could work for you.`,
        pt: nearbyCitiesJoined
          ? `Nao encontrei hoteis em ${nearbyFallbackOriginalDestination || "esse destino"}, mas encontrei opcoes proximas em ${nearbyCitiesJoined}.`
          : `Nao encontrei hoteis em ${nearbyFallbackOriginalDestination || "esse destino"}, mas encontrei opcoes proximas que podem funcionar para voce.`,
      })
    : null;
  const finalResultsIntro = nearbyFallbackIntroSafe
    ? nearbyFallbackIntroSafe
    : assumedDefaultGuests && isLiveMode
      ? language === "es"
        ? `${neutralResultsIntroSafe} Tome 1 adulto por defecto para mostrarte precio real; si viajas con mas personas, lo ajustamos.`
        : `${neutralResultsIntroSafe} I used 1 adult by default to show live pricing; if more people are traveling, we can adjust it.`
      : neutralResultsIntroSafe;
  void intro;
  void introWithAssumption;
  void progressiveResultsIntro;
  void progressiveResultsIntroSafe;
  const footerText = nearbyFallbackApplied
    ? copyForLanguage(language, {
        es: isLiveMode
          ? "Estas opciones cercanas son exploratorias. Si queres, hago una pasada precisa con precio real para esa zona cercana."
          : "Si queres, ajusto la busqueda a una de esas zonas cercanas para afinar mas.",
        en: isLiveMode
          ? "These nearby options are exploratory. If you want, I can run a precise live-pricing search for that nearby area."
          : "If you want, I can narrow the search to one of those nearby areas.",
        pt: isLiveMode
          ? "Estas opcoes proximas sao exploratorias. Se quiser, faco uma busca precisa com preco real para essa area proxima."
          : "Se quiser, posso ajustar a busca para uma dessas areas proximas.",
      })
    : isLiveMode
      ? copyForLanguage(language, {
          es: "Abrí el que más te guste para ver fotos, ubicación y política de cancelación.",
          en: "Open the one you like most to view photos, location, and cancellation policy.",
          pt: "Abra o que mais gostar para ver fotos, localização e política de cancelamento.",
        })
      : scopeWarningMode === "EXPANDED_WITH_NOTICE" || scopeConfidence === "LOW"
        ? copyForLanguage(language, {
            es: "Si querés, puedo afinar la zona o el estilo del hotel para acotar todavía más.",
            en: "If you want, I can narrow the area or hotel style even further.",
            pt: "Se quiser, posso refinar a área ou o estilo do hotel para filtrar ainda mais.",
          })
        : copyForLanguage(language, {
            es: "Sumá fechas y viajeros para ver precio real y disponibilidad.",
            en: "Add dates and guests to see live pricing and availability.",
            pt: "Adicione datas e viajantes para ver preços reais e disponibilidade.",
          });

  // Group consecutive picks by pickReason — insert textBlock separators between groups
  const grouped = [];
  picks.forEach((p) => {
    const reason = p.pickReason || null;
    const last = grouped[grouped.length - 1];
    if (last && last.reason === reason) {
      last.items.push(p);
    } else {
      grouped.push({ reason, items: [p] });
    }
  });

  const groupSeparators = isSpanish
    ? [
        "Si buscás mejor relación precio/calidad:",
        "Más opciones que podrían interesarte:",
        "Y una opción adicional:",
      ]
    : [
        "Better value for money:",
        "More options you might like:",
        "One more option:",
      ];

  const sections = [];
  let cardRank = 0;
  const shouldExplainEachPick =
    !isLiveMode &&
    Boolean(plan?.assumptions?.showSemanticPickExplanations) &&
    (semanticGeoActive ||
      semanticTraitProfileActive ||
      Boolean(plan?.viewIntent));
  const normalizedExplanationPlan = shouldExplainEachPick
    ? normalizeSemanticExplanationPlanForPicks({
        explanationPlan: inventory?.semanticExplanationPlan,
        picks,
      }) ||
      buildDeterministicSemanticExplanationPlan({
        inventory,
        plan,
        language,
        seed,
      })
    : null;
  const explanationPlanByHotelId = new Map(
    Array.isArray(normalizedExplanationPlan?.items)
      ? normalizedExplanationPlan.items.map((entry) => [
          String(entry.hotelId),
          entry,
        ])
      : [],
  );
  picks.forEach((pick) => {
    cardRank += 1;
    if (shouldExplainEachPick) {
      const hotelId = String(pick?.item?.id || pick?.item?.hotelCode || "");
      const explanation =
        explanationPlanByHotelId.get(hotelId)?.sentence ||
        buildEditorialSemanticPickExplanation({
          pick,
          language,
          rank: cardRank,
          repeatedZone: false,
        });
      if (explanation) {
        sections.push({ type: "textBlock", text: explanation });
      }
    }
    const card = buildHotelPickSection(pick.item, pick.pickReason, language, {
      isLiveMode,
      rank: cardRank,
    });
    if (card) sections.push(card);
  });
  sections.push({ type: "contextualFooter", text: footerText });
  return {
    intro: finalResultsIntro,
    outro: null,
    sections,
  };
};

const countHotelCardSections = (sections = []) =>
  Array.isArray(sections)
    ? sections.filter((section) => section?.type === "hotelCard").length
    : 0;

const ensureRunSearchSectionsInvariant = ({
  nextAction,
  searchSections,
  inventory,
  plan,
  language,
  seed,
  userName,
  latestUserMessage,
  replyText,
}) => {
  if (nextAction !== NEXT_ACTIONS.RUN_SEARCH) {
    return { replyText, searchSections };
  }
  const inventoryCount =
    (inventory?.hotels?.length || 0) + (inventory?.homes?.length || 0);
  if (inventoryCount <= 0 || countHotelCardSections(searchSections) > 0) {
    return { replyText, searchSections };
  }

  const fallbackStructuredReply = buildStructuredSearchReply({
    inventory,
    plan,
    language,
    seed,
    userName,
    resultCount: inventoryCount,
    latestUserMessage,
  });
  if (!fallbackStructuredReply) {
    return { replyText, searchSections };
  }

  return {
    replyText: replyText || fallbackStructuredReply.intro,
    searchSections: [
      ...fallbackStructuredReply.sections,
      ...(fallbackStructuredReply.outro
        ? [{ type: "outro", text: fallbackStructuredReply.outro }]
        : []),
    ],
  };
};

const buildNoResultsSearchReply = ({
  plan,
  inventory,
  language = "es",
  missing = [],
  seed = 0,
}) => {
  const destination =
    plan?.location?.city ||
    plan?.location?.address ||
    plan?.location?.country ||
    "";
  const destinationLabel =
    destination ||
    copyForLanguage(language, {
      es: "ese destino",
      en: "that destination",
      pt: "esse destino",
    });
  const isLiveMode = hasLiveSearchContext(plan);
  const wantsMoreResults = plan?.assumptions?.wantsMoreResults === true;

  {
    const hotelSearchScope = inventory?.searchScope?.hotels || null;
    const nearbyFallbackAttempted =
      Array.isArray(hotelSearchScope?.nearbyFallbackRadiiTried) &&
      hotelSearchScope.nearbyFallbackRadiiTried.length > 0 &&
      hotelSearchScope?.nearbyFallbackApplied !== true;
    const searchTargetLabel =
      hotelSearchScope?.nearbyFallbackOriginalDestination || destinationLabel;

    const introVariants = nearbyFallbackAttempted
      ? copyForLanguage(language, {
          es: [
            `No encontre hoteles en ${searchTargetLabel} y tampoco aparecieron opciones cercanas en esta pasada.`,
            `No vi hoteles en ${searchTargetLabel}, y el fallback cercano tampoco devolvio opciones esta vez.`,
            `Para ${searchTargetLabel} no encontre hoteles ni alternativas cercanas para mostrarte ahora.`,
          ],
          en: [
            `I did not find hotels in ${searchTargetLabel}, and the nearby fallback did not return options either.`,
            `I did not see hotels in ${searchTargetLabel}, and the nearby pass also came back empty this time.`,
            `For ${searchTargetLabel}, I could not find hotels or nearby alternatives to show right now.`,
          ],
          pt: [
            `Nao encontrei hoteis em ${searchTargetLabel}, e o fallback proximo tambem nao trouxe opcoes.`,
            `Nao vi hoteis em ${searchTargetLabel}, e a busca nas proximidades tambem voltou vazia desta vez.`,
            `Para ${searchTargetLabel}, nao encontrei hoteis nem alternativas proximas para mostrar agora.`,
          ],
        })
      : isLiveMode
        ? copyForLanguage(language, {
            es: [
              `No veo disponibilidad real en ${destinationLabel} para esa busqueda.`,
              `No aparecio disponibilidad real en ${destinationLabel} con esa combinacion.`,
              `Con esa busqueda no veo inventario real disponible en ${destinationLabel}.`,
            ],
            en: [
              `I do not see live availability in ${destinationLabel} for that search.`,
              `No live availability showed up in ${destinationLabel} for that combination.`,
              `For that search, I do not see real inventory available in ${destinationLabel}.`,
            ],
            pt: [
              `Nao vejo disponibilidade real em ${destinationLabel} para essa busca.`,
              `Nao apareceu disponibilidade real em ${destinationLabel} com essa combinacao.`,
              `Para essa busca, nao vejo inventario real disponivel em ${destinationLabel}.`,
            ],
          })
        : wantsMoreResults
          ? copyForLanguage(language, {
              es: [
                `No encontre mas hoteles alineados con ese pedido en ${destinationLabel}.`,
                `Ya no veo mas opciones en ${destinationLabel} que encajen con ese criterio.`,
                `No aparecieron mas hoteles en ${destinationLabel} que sigan ese pedido.`,
              ],
              en: [
                `I could not find more hotels aligned with that request in ${destinationLabel}.`,
                `I do not see more options in ${destinationLabel} that fit that criteria.`,
                `No additional hotels in ${destinationLabel} matched that request.`,
              ],
              pt: [
                `Nao encontrei mais hoteis alinhados com esse pedido em ${destinationLabel}.`,
                `Nao vejo mais opcoes em ${destinationLabel} que encaixem nesse criterio.`,
                `Nao apareceram mais hoteis em ${destinationLabel} que sigam esse pedido.`,
              ],
            })
          : copyForLanguage(language, {
              es: [
                `No encontre hoteles en ${destinationLabel} para mostrarte ahora.`,
                `Por ahora no veo hoteles en ${destinationLabel} para ese pedido.`,
                `En esta pasada no aparecieron hoteles en ${destinationLabel}.`,
              ],
              en: [
                `I could not find hotels in ${destinationLabel} to show right now.`,
                `For now, I do not see hotels in ${destinationLabel} for that request.`,
                `No hotels showed up in ${destinationLabel} in this pass.`,
              ],
              pt: [
                `Nao encontrei hoteis em ${destinationLabel} para te mostrar agora.`,
                `Por enquanto nao vejo hoteis em ${destinationLabel} para esse pedido.`,
                `Nesta busca, nao apareceram hoteis em ${destinationLabel}.`,
              ],
            });
    const intro = pickVariant(introVariants, seed) || introVariants[0];

    const guidanceVariants = nearbyFallbackAttempted
      ? copyForLanguage(language, {
          es: [
            "Si queres, probamos otro destino cercano o cambiamos la zona base.",
            "Puedo intentar con otra ciudad cercana o abrir la busqueda a otra area.",
            "Si queres, cambiamos de zona o probamos un destino alternativo cercano.",
          ],
          en: [
            "If you want, we can try another nearby destination or change the base area.",
            "I can try a different nearby city or open the search to another area.",
            "If you want, we can switch areas or try a nearby alternative destination.",
          ],
          pt: [
            "Se quiser, podemos tentar outro destino proximo ou mudar a area base.",
            "Posso tentar outra cidade proxima ou abrir a busca para outra area.",
            "Se quiser, mudamos de area ou tentamos um destino alternativo proximo.",
          ],
        })
      : copyForLanguage(language, {
          es: wantsMoreResults
            ? [
                "Si queres, puedo abrir otra zona, otra vista o relajar un poco el criterio actual.",
                "Puedo ampliar la zona, cambiar el enfoque o aflojar un poco el filtro actual.",
                "Si queres, pruebo con otra area o relajo un poco el pedido para abrir mas opciones.",
              ]
            : [
                "Podemos probar otra zona, ajustar fechas o afinar un poco mas la busqueda.",
                "Si queres, cambiamos la zona, las fechas o el criterio para abrir mas opciones.",
                "Puedo volver a buscar con otra zona o con un criterio mas amplio.",
              ],
          en: wantsMoreResults
            ? [
                "If you want, I can open the search to another area, another view, or relax the current criteria a bit.",
                "I can widen the area, change the angle, or loosen the current filter a bit.",
                "If you want, I can try another area or relax the request to open more options.",
              ]
            : [
                "We can try another area, adjust dates, or narrow the search a bit more.",
                "If you want, we can change the area, dates, or criteria to open more options.",
                "I can search again with a different area or a broader criteria.",
              ],
          pt: wantsMoreResults
            ? [
                "Se quiser, posso abrir a busca para outra area, outra vista ou relaxar um pouco o criterio atual.",
                "Posso ampliar a area, mudar o foco ou aliviar um pouco o filtro atual.",
                "Se quiser, tento outra area ou relaxo o pedido para abrir mais opcoes.",
              ]
            : [
                "Podemos tentar outra area, ajustar datas ou refinar um pouco mais a busca.",
                "Se quiser, mudamos a area, as datas ou o criterio para abrir mais opcoes.",
                "Posso buscar de novo com outra area ou com um criterio mais amplo.",
              ],
        });
    const guidance =
      pickVariant(guidanceVariants, seed + 17) || guidanceVariants[0];

    return {
      intro: `${intro} ${guidance}`.trim(),
      sections: [],
    };
  }

  const intro = isLiveMode
    ? copyForLanguage(language, {
        es: `No veo disponibilidad real en ${destinationLabel} para esa búsqueda.`,
        en: `I do not see live availability in ${destinationLabel} for that search.`,
        pt: `Não vejo disponibilidade real em ${destinationLabel} para essa busca.`,
      })
    : wantsMoreResults
      ? copyForLanguage(language, {
          es: `No encontré más hoteles alineados con ese pedido en ${destinationLabel}.`,
          en: `I could not find more hotels aligned with that request in ${destinationLabel}.`,
          pt: `Não encontrei mais hotéis alinhados com esse pedido em ${destinationLabel}.`,
        })
      : copyForLanguage(language, {
          es: `No encontré hoteles para mostrarte ahora en ${destinationLabel}.`,
          en: `I could not find hotels to show you right now in ${destinationLabel}.`,
          pt: `Não encontrei hotéis para te mostrar agora em ${destinationLabel}.`,
        });

  const guidance = canUnlockLive
    ? copyForLanguage(language, {
        es: "Si me confirmás fechas y viajeros, hago una pasada más precisa con disponibilidad real.",
        en: "If you confirm dates and guests, I can run a more precise pass with live availability.",
        pt: "Se você confirmar datas e viajantes, eu faço uma busca mais precisa com disponibilidade real.",
      })
    : copyForLanguage(language, {
        es: wantsMoreResults
          ? "Si querés, puedo abrir otra zona, otra vista o relajar un poco el criterio actual."
          : "Podemos probar otra zona, ajustar fechas o afinar un poco más la búsqueda.",
        en: wantsMoreResults
          ? "If you want, I can open the search to another area, another view, or relax the current criteria a bit."
          : "We can try another area, adjust dates, or narrow the search a bit more.",
        pt: wantsMoreResults
          ? "Se quiser, posso abrir a busca para outra área, outra vista ou relaxar um pouco o critério atual."
          : "Podemos tentar outra área, ajustar datas ou refinar um pouco mais a busca.",
      });

  return {
    intro: `${intro} ${guidance}`.trim(),
    sections: [],
  };
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
  const hasInventoryThisTurn =
    (inventory?.hotels?.length || inventory?.homes?.length) > 0;
  const effectiveInventoryForReply =
    !hasInventoryThisTurn && inventoryForReply
      ? {
          hotels: inventoryForReply.hotels || [],
          homes: inventoryForReply.homes || [],
          matchTypes: {},
          foundExact: false,
        }
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
  const missingNationality = missing.includes("NATIONALITY");
  const multipleMissing =
    (missingDest ? 1 : 0) + (missingDates ? 1 : 0) + (missingGuests ? 1 : 0) >
    1;

  // Seed for variant pick: combine message count + content length + timestamp so each call gets genuine variety
  const seed =
    (messages?.length ?? 0) * 31 +
    (messages?.reduce((acc, m) => acc + (m?.content?.length ?? 0), 0) ?? 0) +
    (Date.now() % 997);

  // Multiple phrases when asking for several missing fields (avoid single repetitive line)
  const multipleMissingPhrases = {
    es: [
      (list) =>
        `Me encanta la idea. Para mostrarte opciones y precios reales necesito saber ${list}.`,
      (list) =>
        `Dale, para buscar necesito que me cuentes ${list}. Así te muestro disponibilidad y tarifas.`,
      (list) =>
        `Genial. Decime ${list} y te armo las mejores opciones con precios y disponibilidad.`,
      (list) => `Perfecto. Para ver precios y disponibilidad necesito ${list}.`,
    ],
    en: [
      (list) =>
        `Sounds good. To show you real prices and availability I need to know ${list}.`,
      (list) =>
        `Great. Tell me ${list} and I'll find options with live rates and availability.`,
      (list) =>
        `Sure. Once I know ${list}, I can show you availability and prices.`,
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
    const phrases =
      multipleMissingPhrases[language] || multipleMissingPhrases.en;
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
      const variants =
        promptDatesAndGuests[language] || promptDatesAndGuests.en;
      replyText = Array.isArray(variants)
        ? pickVariant(variants, seed)
        : variants;
    } else {
      const byAction = promptByAction[nextAction];
      const variants = byAction?.[language] || byAction?.en;
      replyText = Array.isArray(variants)
        ? pickVariant(variants, seed)
        : variants || "Can you clarify?";
    }
    followUps = [];
  } else if (nextAction === NEXT_ACTIONS.RUN_SEARCH) {
    const userName = userContext?.userName || userContext?.name || null;
    const latestUserMessage =
      [...(messages || [])].reverse().find((m) => m?.role === "user")
        ?.content ?? "";
    const preStreamedRunSearchIntro =
      normalizedPreparedReply?.stage !== "search_no_results_closing" &&
      normalizedPreparedReply?.mode !== "separate_message" &&
      typeof normalizedPreparedReply?.text === "string" &&
      normalizedPreparedReply.text.trim()
        ? normalizedPreparedReply.text.trim()
        : "";
    const noResultsPreparedClosing =
      normalizedPreparedReply?.stage === "search_no_results_closing" &&
      typeof normalizedPreparedReply?.text === "string" &&
      normalizedPreparedReply.text.trim()
        ? normalizedPreparedReply.text.trim()
        : "";
    if (preStreamedRunSearchIntro) {
      wasStreamed = true;
    }
    const resultCount =
      (inventory?.hotels?.length || 0) + (inventory?.homes?.length || 0);
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
      replyText = preStreamedRunSearchIntro || structuredReply.intro;
      followUps = [];
      searchSections = [
        ...structuredReply.sections,
        ...(structuredReply.outro
          ? [{ type: "outro", text: structuredReply.outro }]
          : []),
      ];
    } else {
      if (noResultsPreparedClosing) {
        replyText = noResultsPreparedClosing;
      } else {
        const noResultsReply = buildNoResultsSearchReply({
          plan,
          inventory,
          language,
          missing,
          seed,
        });
        replyText = noResultsReply.intro;
        searchSections = noResultsReply.sections;
      }
      followUps = [];
    }
  } else if (
    nextAction === NEXT_ACTIONS.RUN_PLANNING ||
    nextAction === NEXT_ACTIONS.RUN_LOCATION
  ) {
    if (normalizedPreparedReply?.text) {
      // Function calling: text already streamed by runFunctionCallingTurn
      replyText = normalizedPreparedReply.text;
      followUps = Array.isArray(normalizedPreparedReply.followUps)
        ? normalizedPreparedReply.followUps
        : [];
    } else {
      const replyMode =
        nextAction === NEXT_ACTIONS.RUN_PLANNING ? "planning" : "location";
      try {
        if (onTextChunk) {
          wasStreamed = true;
          const sp = await generateAssistantReplyStream({
            plan,
            messages,
            inventory: effectiveInventoryForReply,
            trip,
            tripContext,
            userContext,
            weather,
            onChunk: onTextChunk,
          });
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
          followUps = Array.isArray(replyPayload?.followUps)
            ? replyPayload.followUps
            : [];
        }
      } catch (planLocErr) {
        console.warn(
          "[ai.renderer] planning/location reply failed",
          planLocErr?.message || planLocErr,
        );
        replyText =
          language === "es"
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
      followUps = Array.isArray(normalizedPreparedReply.followUps)
        ? normalizedPreparedReply.followUps
        : [];
    } else {
      try {
        if (onTextChunk) {
          wasStreamed = true;
          const sp = await generateAssistantReplyStream({
            plan,
            messages,
            inventory: effectiveInventoryForReply,
            trip,
            tripContext,
            userContext,
            weather,
            onChunk: onTextChunk,
          });
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
          followUps = Array.isArray(replyPayload?.followUps)
            ? replyPayload.followUps
            : [];
        }
      } catch (err) {
        console.warn(
          "[ai.renderer] ANSWER_WITH_LAST_RESULTS reply failed",
          err?.message || err,
        );
        replyText =
          language === "es"
            ? "No pude revisar esos resultados ahora. Proba de nuevo."
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
          const sp = await generateAssistantReplyStream({
            plan,
            messages,
            inventory: effectiveInventoryForReply,
            trip,
            tripContext,
            userContext,
            weather,
            onChunk: onTextChunk,
          });
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
          followUps = Array.isArray(replyPayload?.followUps)
            ? replyPayload.followUps
            : [];
        }
      } catch (genErr) {
        console.warn(
          "[ai.renderer] generateAssistantReply failed",
          genErr?.message || genErr,
        );
        replyText =
          language === "es"
            ? "No pude procesar eso ahora. Proba de nuevo en un momento o reformula el mensaje."
            : "I couldn't process that right now. Try again in a moment or rephrase your message.";
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

  const latestUserMessage =
    [...(messages || [])].reverse().find((m) => m?.role === "user")?.content ??
    "";
  const userName = userContext?.userName || userContext?.name || null;
  const invariantSafeSearchUi = ensureRunSearchSectionsInvariant({
    nextAction,
    searchSections,
    inventory,
    plan,
    language,
    seed,
    userName,
    latestUserMessage,
    replyText,
  });
  replyText = invariantSafeSearchUi.replyText;
  searchSections = invariantSafeSearchUi.searchSections;

  // Emit static reply text via SSE if streaming path wasn't used (e.g. ASK_FOR_*, RUN_SEARCH intro)
  if (
    onTextChunk &&
    replyText &&
    !wasStreamed &&
    !normalizedPreparedReply?.text
  ) {
    onTextChunk(replyText);
  }

  let combinedInputs = [];
  if (missing.length > 0) {
    if (missingDest)
      combinedInputs.push({
        type: "destination",
        id: "DESTINATION",
        required: true,
      });
    if (missingDates)
      combinedInputs.push({ type: "dateRange", id: "DATES", required: true });
    if (missingGuests)
      combinedInputs.push({ type: "guestCount", id: "GUESTS", required: true });
    if (missingNationality)
      combinedInputs.push({
        type: "nationality",
        id: "NATIONALITY",
        required: true,
      });
  } else {
    combinedInputs = inputByAction[nextAction] || [];
  }

  const ui = {
    chips: buildChips(followUps),
    cards: buildCards(inventory, { isLiveMode: hasLiveSearchContext(plan) }),
    inputs: combinedInputs,
    sections: searchSections,
    visualContext: visualContext || null,
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
