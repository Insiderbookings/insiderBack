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

const detectLanguageFromMessages = (messages, fallback) => {
  const latestUserMessage =
    Array.isArray(messages) &&
    [...messages].reverse().find((msg) => msg?.role === "user" && msg?.content)?.content;
  const normalized = ` ${String(latestUserMessage || "").toLowerCase()} `;
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
  ];
  const englishHints = [" hello ", " hi ", " please ", " thanks", " looking", " need ", " hotel", " house "];
  if (spanishHints.some((hint) => normalized.includes(hint))) return "es";
  if (englishHints.some((hint) => normalized.includes(hint))) return "en";
  return fallback || "es";
};

const promptByAction = {
  [NEXT_ACTIONS.ASK_FOR_DESTINATION]: {
    es: "A donde quieres viajar?",
    en: "Where do you want to travel?",
  },
  [NEXT_ACTIONS.ASK_FOR_DATES]: {
    es: "Que fechas quieres reservar?",
    en: "What dates do you want to book?",
  },
  [NEXT_ACTIONS.ASK_FOR_GUESTS]: {
    es: "Cuantas personas viajan?",
    en: "How many guests are traveling?",
  },
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

export const renderAssistantPayload = async ({ plan, messages, inventory, nextAction, trip, tripContext }) => {
  const baseLanguage = normalizeLanguage(plan);
  const language = detectLanguageFromMessages(messages, baseLanguage);
  let replyText = "";
  let followUps = [];

  if (
    nextAction === NEXT_ACTIONS.ASK_FOR_DESTINATION ||
    nextAction === NEXT_ACTIONS.ASK_FOR_DATES ||
    nextAction === NEXT_ACTIONS.ASK_FOR_GUESTS
  ) {
    replyText =
      promptByAction[nextAction]?.[language] ||
      promptByAction[nextAction]?.en ||
      "Can you clarify?";
    followUps = [];
  } else {
    const replyPayload = await generateAssistantReply({
      plan,
      messages,
      inventory,
      trip,
      tripContext,
    });
    replyText = replyPayload?.reply || "";
    followUps = Array.isArray(replyPayload?.followUps) ? replyPayload.followUps : [];
  }

  if (!replyText) {
    replyText =
      language === "es"
        ? "Listo. Contame que necesitas y lo resolvemos."
        : "Got it. Tell me what you need and I will help.";
  }

  const ui = {
    chips: buildChips(followUps),
    cards: buildCards(inventory),
    inputs: inputByAction[nextAction] || [],
    sections: [],
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
