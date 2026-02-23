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

  const missingDest = missing.includes("DESTINATION");
  const missingDates = missing.includes("DATES");
  const missingGuests = missing.includes("GUESTS");
  const multipleMissing = (missingDest ? 1 : 0) + (missingDates ? 1 : 0) + (missingGuests ? 1 : 0) > 1;

  // Seed for variant pick: use message count + total content length so same convo gets variety over turns
  const seed =
    (messages?.length ?? 0) * 31 +
    (messages?.reduce((acc, m) => acc + (m?.content?.length ?? 0), 0) ?? 0);

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

  if (nextAction === NEXT_ACTIONS.RUN_SEARCH && (missingDates || missingGuests)) {
    const missingLabelsEs = [];
    const missingLabelsEn = [];
    if (missingDates) {
      missingLabelsEs.push("fechas");
      missingLabelsEn.push("dates");
    }
    if (missingGuests) {
      missingLabelsEs.push("huespedes");
      missingLabelsEn.push("guests");
    }
    const listEs = missingLabelsEs.join(" y ");
    const listEn = missingLabelsEn.join(" and ");
    const staticHint =
      language === "es"
        ? `Estas son sugerencias iniciales. Para continuar con disponibilidad y precios reales necesito ${listEs}.`
        : `These are initial suggestions. To continue with live availability and pricing I need ${listEn}.`;
    replyText = replyText ? `${staticHint}\n\n${replyText}` : staticHint;
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
    sections: [],
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
