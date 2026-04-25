export const parseAiJsonField = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }
  return value;
};

const toPlainObject = (value) =>
  value && typeof value.get === "function" ? value.get({ plain: true }) : value;

export const mapAssistantHistoryMessage = (message) => {
  if (!message) return null;
  const data = toPlainObject(message);
  const ui = parseAiJsonField(data.ui_snapshot) || null;

  return {
    id: data.id,
    sessionId: data.session_id,
    role: data.role,
    content: data.content,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    planSnapshot: parseAiJsonField(data.plan_snapshot) || null,
    inventorySnapshot: parseAiJsonField(data.inventory_snapshot) || null,
    ui,
    nextAction: ui?.meta?.nextAction || null,
    followUpKind: ui?.meta?.followUpKind || null,
    replyMode: ui?.meta?.replyMode || null,
    referencedHotelIds: Array.isArray(ui?.meta?.referencedHotelIds)
      ? ui.meta.referencedHotelIds
      : [],
    webSearchUsed: Boolean(ui?.meta?.webSearchUsed),
    webSources: Array.isArray(ui?.webSources) ? ui.webSources : [],
    feedback: null,
  };
};

export const mapAssistantMessageFeedback = (feedback) => {
  if (!feedback) return null;
  const data = toPlainObject(feedback);

  return {
    id: data.id,
    sessionId: data.session_id,
    messageId: data.message_id,
    value: data.value,
    reason: data.reason ?? null,
    metadata: parseAiJsonField(data.metadata) || null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
};
