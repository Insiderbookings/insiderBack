import { generateAssistantReply } from "../../services/aiAssistant.service.js";
import { NEXT_ACTIONS } from "./ai.planner.js";
import { AI_DEFAULTS } from "./ai.config.js";

const DEFAULT_TONE = "neutral";

const normalizeLanguage = (plan) => {
  const lang = typeof plan?.language === "string" ? plan.language.toLowerCase() : "";
  if (lang.startsWith("es")) return "es";
  if (lang.startsWith("en")) return "en";
  return AI_DEFAULTS.language || "es";
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
    " dónde", " cuándo", " cuantos", " personas", " fechas",
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

const mapStayCard = (item, type) => {
  if (!item) return null;
  const id = String(item.id || item.hotelCode || item.homeId || "");
  if (!id) return null;
  const title = item.title || item.name || "Stay";
  const locationText = item.locationText || item.city || item.country || null;
  return {
    type: "stay",
    id,
    title,
    subtitle: locationText,
    priceFrom: item.pricePerNight ?? item.price ?? null,
    currency: item.currency || "USD",
    image: item.coverImage || item.image || null,
    meta: {
      kind: type,
      inventoryType: item.inventoryType || type,
    },
  };
};

const buildCards = (inventory) => {
  const homes = Array.isArray(inventory?.homes) ? inventory.homes : [];
  const hotels = Array.isArray(inventory?.hotels) ? inventory.hotels : [];
  return [
    ...homes.map((item) => mapStayCard(item, "HOME")),
    ...hotels.map((item) => mapStayCard(item, "HOTEL")),
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
  const urls = imgs
    .map((img) => (typeof img === "string" ? img : img?.url ?? null))
    .filter(Boolean)
    .slice(0, max);
  if (!urls.length && item?.coverImage) urls.push(item.coverImage);
  if (!urls.length && item?.image) urls.push(item.image);
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

  const poi = plan?.location?.resolvedPoi?.name;
  if (poi) {
    parts.push(lang === "es" ? `cerca de ${poi}` : `near ${poi}`);
  }

  return parts.length ? parts : null;
};

const buildHotelPickSection = (item) => {
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
  const description = clampText(decodeHtmlEntities(rawDescription) || (location ? `Located in ${location}.` : ""), 450);
  const stars = normalizeStars(
    item?.stars ?? item?.rating ?? item?.classification?.code ??
    item?.reviewScore ?? item?.hotelDetails?.rating ?? item?.hotelPayload?.rating
  );
  const amenities = pickAmenityLabels(item, 3);
  const images = extractImageUrls(item, 4);
  const priceFrom = item?.pricePerNight ?? item?.price ?? null;
  const currency = item?.currency || "USD";
  return {
    type: "hotelPick",
    id,
    name: clampText(name, 80),
    description,
    location,
    address,
    stars,
    amenities,
    images,
    priceFrom: Number.isFinite(Number(priceFrom)) ? Number(priceFrom) : null,
    currency,
  };
};

const buildStructuredSearchReply = ({ inventory, plan, language, seed, userName }) => {
  const picks = getTopInventoryPicks(inventory, 5);
  if (!picks.length) return null;

  const isSpanish = language === "es";
  const destination =
    plan?.location?.city || plan?.location?.address || plan?.location?.country || "";
  const name = userName ? String(userName).split(" ")[0] : null;
  const filterContext = buildFilterContext(plan, language);
  const hasDates = Boolean(plan?.dates?.checkIn && plan?.dates?.checkOut);

  const dest = destination ? ` para ${destination}` : "";
  const destEn = destination ? ` for ${destination}` : "";
  const filterJoined = filterContext
    ? (isSpanish
        ? ` con ${filterContext.join(" y ")}`
        : ` with ${filterContext.join(" and ")}`)
    : "";

  let introVariants;
  if (filterContext?.length) {
    introVariants = isSpanish
      ? [
          `${name ? `${name}, a` : "A"}cá van los resultados${destination ? ` en ${destination}` : ""}${filterJoined}.`,
          `Encontré estas opciones${destination ? ` en ${destination}` : ""}${filterJoined}${name ? `, ${name}` : ""}.`,
          `${name ? `${name}, m` : "M"}irá lo que tenemos${destination ? ` en ${destination}` : ""}${filterJoined}.`,
        ]
      : [
          `${name ? `${name}, here` : "Here"} are the results${destination ? ` in ${destination}` : ""}${filterJoined}.`,
          `Found options${destination ? ` in ${destination}` : ""}${filterJoined}${name ? ` for you, ${name}` : ""}.`,
          `${name ? `${name}, take` : "Take"} a look at what we have${destEn}${filterJoined}.`,
        ];
  } else {
    introVariants = isSpanish
      ? [
          `${name ? `¡Buena elección, ${name}! Te` : "Te"} dejo las mejores opciones que tenemos${dest}.`,
          `${name ? `${name}, a` : "A"}cá van mis picks${destination ? ` en ${destination}` : ""}. Agregá fechas y guests para ver precios reales.`,
          `${name ? `${name}, e` : "E"}stas son nuestras recomendaciones${dest}. Sumá fechas o guests para ver disponibilidad real.`,
          `Encontré opciones interesantes${destination ? ` en ${destination}` : ""}${name ? `, ${name}` : ""}. Chequeá las cards y completá los detalles para afinar.`,
          `${name ? `${name}, m` : "M"}irá lo que tenemos${destination ? ` en ${destination}` : ""}. Con fechas y guests te muestro disponibilidad y precios.`,
        ]
      : [
          `${name ? `Nice, ${name}! Here` : "Here"} are the best options we have${destEn}. Add more details to refine.`,
          `${name ? `${name}, here` : "Here"} are my top picks${destination ? ` in ${destination}` : ""}. Add dates and guests to see live prices.`,
          `${name ? `Good call, ${name}! These` : "These"} are some solid options${destEn}. Refine with dates or guest count anytime.`,
          `Found some great spots${destination ? ` in ${destination}` : ""}${name ? ` for you, ${name}` : ""}. Check them out and fill in your dates to see real availability.`,
          `${name ? `${name}, take` : "Take"} a look at what we have${destEn}. Dates and guests will unlock live pricing.`,
        ];
  }

  let outroVariants;
  if (hasDates) {
    outroVariants = isSpanish
      ? [
          "Tocá cualquier card para ver los detalles y reservar.",
          "¿Te gusta alguno? Tocá la card para continuar.",
          "Seleccioná el que más te guste para ver disponibilidad y confirmar.",
        ]
      : [
          "Tap any card to see details and book.",
          "Like any of these? Tap to continue.",
          "Select the one you like to check availability and confirm.",
        ];
  } else {
    outroVariants = isSpanish
      ? [
          "Agregá las fechas y guests para ver disponibilidad y precios reales.",
          "Completá fechas y guests para afinar los resultados con precios en vivo.",
          "Con fechas y cantidad de viajeros te muestro disponibilidad y costos exactos.",
          "Estos son tus puntos de partida. Sumá los datos de viaje para ver qué hay disponible.",
          "¿Te gusta alguno? Ingresá fechas y guests para confirmar disponibilidad.",
        ]
      : [
          "Add dates and guests to see availability and live pricing.",
          "Fill in your travel dates and guest count to get real prices.",
          "These are your starting options — dates and guests will refine everything.",
          "Like any of these? Add your dates to check availability.",
          "Drop in your dates and guest count to see what's actually available.",
        ];
  }

  const intro = pickVariant(introVariants) || introVariants[0];
  const outro = pickVariant(outroVariants) || outroVariants[0];
  const sections = picks.map(buildHotelPickSection).filter(Boolean);
  return { intro, outro, sections };
};

export const renderAssistantPayload = async ({ plan, messages, inventory, nextAction, trip, tripContext, userContext, weather, missing = [], visualContext }) => {
  const baseLanguage = normalizeLanguage(plan);
  const language = detectLanguageFromMessages(messages, baseLanguage);
  // Force the assistant to reply in the user's language (based on the latest user message),
  // even if the extracted plan.language is wrong/missing.
  if (plan && typeof plan === "object") {
    plan.language = language;
  }
  let replyText = "";
  let followUps = [];
  let searchSections = [];

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
    const structuredReply = buildStructuredSearchReply({
      inventory,
      plan,
      language,
      seed,
      userName,
    });
    if (structuredReply) {
      replyText = structuredReply.intro;
      followUps = [];
      searchSections = [
        ...structuredReply.sections,
        { type: "outro", text: structuredReply.outro },
      ];
    } else {
      const replyPayload = await generateAssistantReply({
        plan,
        messages,
        inventory,
        trip,
        tripContext,
        userContext,
        weather,
      });
      replyText = (replyPayload?.reply || "").trim();
      followUps = Array.isArray(replyPayload?.followUps) ? replyPayload.followUps : [];
    }
  } else {
    const replyPayload = await generateAssistantReply({
      plan,
      messages,
      inventory,
      trip,
      tripContext,
      userContext,
      weather,
    });
    replyText = (replyPayload?.reply || "").trim();
    followUps = Array.isArray(replyPayload?.followUps) ? replyPayload.followUps : [];
  }

  if (!replyText) {
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
    cards: buildCards(inventory),
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
