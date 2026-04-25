import { filterWebSourcesForPolicy } from "./ai.webSearchPolicy.js";

export const getAiClientType = (reqOrHeaders) => {
  const headers =
    reqOrHeaders &&
    typeof reqOrHeaders === "object" &&
    !Array.isArray(reqOrHeaders) &&
    reqOrHeaders.headers &&
    typeof reqOrHeaders.headers === "object"
      ? reqOrHeaders.headers
      : reqOrHeaders;

  return String(
    headers?.["x-client-type"] || headers?.["x-client-platform"] || "",
  )
    .trim()
    .toLowerCase();
};

export const normalizeAssistantWebSources = (
  sources = [],
  { allowCompetitors = false } = {},
) => {
  const normalizedSources = Array.isArray(sources)
    ? sources
        .map((source) => {
          const title =
            typeof source?.title === "string" ? source.title.trim() : "";
          const url = typeof source?.url === "string" ? source.url.trim() : "";
          if (!url) return null;
          return { title, url };
        })
        .filter(Boolean)
    : [];

  return filterWebSourcesForPolicy(normalizedSources, { allowCompetitors })
    .safeSources;
};

export const buildAssistantUiSnapshot = (ui, webSources = [], options = {}) => {
  const normalizedWebSources = normalizeAssistantWebSources(
    webSources,
    options,
  );
  const baseUi = ui && typeof ui === "object" && !Array.isArray(ui) ? ui : null;

  if (!baseUi && !normalizedWebSources.length) return null;
  if (!normalizedWebSources.length) return baseUi;

  return {
    ...(baseUi || {}),
    webSources: normalizedWebSources,
  };
};

export const buildAssistantDerivedFields = (result = {}) => ({
  nextAction: result?.nextAction || result?.ui?.meta?.nextAction || null,
  followUpKind: result?.followUpKind || result?.ui?.meta?.followUpKind || null,
  replyMode: result?.replyMode || result?.ui?.meta?.replyMode || null,
  referencedHotelIds: Array.isArray(result?.referencedHotelIds)
    ? result.referencedHotelIds
    : Array.isArray(result?.ui?.meta?.referencedHotelIds)
      ? result.ui.meta.referencedHotelIds
      : [],
  webSearchUsed: Boolean(
    result?.webSearchUsed || result?.ui?.meta?.webSearchUsed,
  ),
});

const buildAssistantEnvelope = (assistant, replyText) => {
  if (!assistant || typeof assistant !== "object" || Array.isArray(assistant)) {
    return {
      text: replyText,
      tone: "neutral",
      disclaimers: [],
    };
  }

  return {
    ...assistant,
    text:
      typeof assistant.text === "string" && assistant.text.trim()
        ? assistant.text
        : replyText,
    tone:
      typeof assistant.tone === "string" && assistant.tone.trim()
        ? assistant.tone
        : "neutral",
    disclaimers: Array.isArray(assistant.disclaimers)
      ? assistant.disclaimers
      : [],
  };
};

export const buildAssistantResponsePayload = ({
  conversationId,
  replyText,
  result,
  counts,
  searchContext,
  sections,
  quickReplies,
  items,
  quickStartPrompts,
  assistantReady,
  closingMessage,
} = {}) => {
  const normalizedReplyText =
    typeof replyText === "string" ? replyText : String(replyText || "");
  const normalizedCounts =
    counts && typeof counts === "object" && !Array.isArray(counts)
      ? counts
      : { homes: 0, hotels: 0 };
  const derivedFields = buildAssistantDerivedFields(result);

  const payload = {
    ok: true,
    conversationId,
    sessionId: conversationId,
    reply: normalizedReplyText,
    message: normalizedReplyText,
    assistant: buildAssistantEnvelope(result?.assistant, normalizedReplyText),
    ui: result?.ui,
    state: result?.state,
    plan: result?.plan,
    carousels: Array.isArray(result?.carousels) ? result.carousels : [],
    trip: result?.trip,
    counts: normalizedCounts,
    webSources: normalizeAssistantWebSources(result?.webSources, {
      allowCompetitors: Boolean(result?.allowCompetitorWebSources),
    }),
    searchContext: searchContext || undefined,
    sections: Array.isArray(sections) ? sections : [],
    quick_replies: Array.isArray(quickReplies) ? quickReplies : [],
    items: Array.isArray(items) ? items : [],
    intent: result?.intent,
    assistantReady: Boolean(assistantReady),
    quickStartPrompts: Array.isArray(quickStartPrompts)
      ? quickStartPrompts
      : [],
    ...derivedFields,
  };

  if (closingMessage !== undefined) {
    payload.closingMessage = closingMessage || null;
  }

  return payload;
};
