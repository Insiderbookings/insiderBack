import models, { sequelize } from "../models/index.js";
import {
  AI_CHAT_HISTORY_LIMITS,
  AI_CHAT_QUOTAS,
} from "../modules/ai/ai.config.js";

export const DEFAULT_ASSISTANT_GREETING =
  "Hi there! I am your Insider assistant. Tell me what kind of hotel you're looking for and I'll find it.";

const MESSAGE_ROLES = ["assistant", "user", "system"];

const sanitizeContent = (value) => {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
};

const buildPreview = (value, max = 140) => {
  const sanitized = sanitizeContent(value);
  if (!sanitized) return "";
  return sanitized.replace(/\s+/g, " ").slice(0, max).trim();
};

const parseJsonField = (value) => {
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

const hasInventorySnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return false;
  const homes = Array.isArray(snapshot.homes) ? snapshot.homes.length : 0;
  const hotels = Array.isArray(snapshot.hotels) ? snapshot.hotels.length : 0;
  return homes > 0 || hotels > 0;
};

const normalizeLimit = (
  value,
  { fallback = 1, min = 1, max = Number.MAX_SAFE_INTEGER } = {},
) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Math.min(max, Math.max(fallback, min));
  }
  return Math.min(max, Math.max(Math.floor(numeric), min));
};

const quotaError = (message, code, status = 429) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const sessionQuotaError = () =>
  quotaError(
    "You have reached the maximum number of AI chat sessions. Delete an older chat to continue.",
    "AI_CHAT_SESSION_QUOTA_EXCEEDED",
  );

const messageQuotaError = () =>
  quotaError(
    "This chat reached the maximum number of messages. Start a new chat to continue.",
    "AI_CHAT_MESSAGE_QUOTA_EXCEEDED",
  );

const mapSession = (session, { includeMetadata = true } = {}) => {
  if (!session) return null;
  const data = session.get({ plain: true });
  return {
    id: data.id,
    title: data.title,
    preview: data.last_message_preview || "",
    lastMessageAt: data.last_message_at,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    messageCount: data.message_count ?? 0,
    metadata: includeMetadata ? parseJsonField(data.metadata) || null : null,
  };
};

const mapMessage = (message) => {
  if (!message) return null;
  const data = message.get({ plain: true });
  const ui = parseJsonField(data.ui_snapshot) || null;
  return {
    id: data.id,
    sessionId: data.session_id,
    role: data.role,
    content: data.content,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    planSnapshot: parseJsonField(data.plan_snapshot) || null,
    inventorySnapshot: parseJsonField(data.inventory_snapshot) || null,
    ui,
    nextAction: ui?.meta?.nextAction || null,
    followUpKind: ui?.meta?.followUpKind || null,
    replyMode: ui?.meta?.replyMode || null,
    referencedHotelIds: Array.isArray(ui?.meta?.referencedHotelIds)
      ? ui.meta.referencedHotelIds
      : [],
    webSearchUsed: Boolean(ui?.meta?.webSearchUsed),
    webSources: Array.isArray(ui?.webSources) ? ui.webSources : [],
  };
};

const notFoundError = () => {
  const error = new Error("Chat session not found");
  error.code = "AI_CHAT_NOT_FOUND";
  error.status = 404;
  return error;
};

export const createAssistantSessionForUser = async (
  userId,
  { greeting } = {},
) => {
  if (!userId) throw new Error("userId is required");
  const activeSessions = await models.AiChatSession.count({
    where: { user_id: userId },
  });
  if (activeSessions >= AI_CHAT_QUOTAS.maxSessionsPerUser) {
    throw sessionQuotaError();
  }
  const normalizedGreeting = sanitizeContent(greeting);
  const preview = buildPreview(normalizedGreeting);
  const now = new Date();

  const session = await sequelize.transaction(async (transaction) => {
    const record = await models.AiChatSession.create(
      {
        user_id: userId,
        title: "New chat",
        last_message_preview: preview || "",
        last_message_at: now,
        message_count: preview ? 1 : 0,
        metadata: {},
      },
      { transaction },
    );

    if (normalizedGreeting) {
      await models.AiChatMessage.create(
        {
          session_id: record.id,
          role: "assistant",
          content: normalizedGreeting,
        },
        { transaction },
      );
    }

    return record;
  });

  return mapSession(session);
};

export const listAssistantSessionsForUser = async (
  userId,
  { limit = AI_CHAT_HISTORY_LIMITS.listDefault } = {},
) => {
  if (!userId) return [];
  const rows = await models.AiChatSession.findAll({
    where: { user_id: userId },
    order: [["last_message_at", "DESC"]],
    limit: normalizeLimit(limit, {
      fallback: AI_CHAT_HISTORY_LIMITS.listDefault,
      max: AI_CHAT_HISTORY_LIMITS.listMax,
    }),
  });
  return rows.map((row) => mapSession(row, { includeMetadata: false }));
};

export const getAssistantSessionForUser = async (
  sessionId,
  userId,
  options = {},
) => {
  if (!sessionId || !userId) return null;
  return models.AiChatSession.findOne({
    where: { id: sessionId, user_id: userId },
    ...options,
  });
};

export const getAssistantSessionOrThrow = async (
  sessionId,
  userId,
  options = {},
) => {
  const session = await getAssistantSessionForUser(sessionId, userId, options);
  if (!session) throw notFoundError();
  return session;
};

export const getAssistantSessionWithMessages = async (
  sessionId,
  userId,
  { limit = AI_CHAT_HISTORY_LIMITS.detailDefault } = {},
) => {
  const session = await getAssistantSessionOrThrow(sessionId, userId);
  const rows = await models.AiChatMessage.findAll({
    where: { session_id: sessionId },
    order: [["created_at", "DESC"]],
    limit: normalizeLimit(limit, {
      fallback: AI_CHAT_HISTORY_LIMITS.detailDefault,
      max: AI_CHAT_HISTORY_LIMITS.detailMax,
    }),
  });
  return {
    session: mapSession(session),
    messages: rows.reverse().map(mapMessage),
  };
};

export const fetchAssistantMessages = async (
  sessionId,
  userId,
  { limit = AI_CHAT_HISTORY_LIMITS.contextDefault } = {},
) => {
  await getAssistantSessionOrThrow(sessionId, userId);
  const rows = await models.AiChatMessage.findAll({
    where: { session_id: sessionId },
    order: [["created_at", "DESC"]],
    limit: normalizeLimit(limit, {
      fallback: AI_CHAT_HISTORY_LIMITS.contextDefault,
      max: AI_CHAT_HISTORY_LIMITS.contextMax,
    }),
  });
  return rows.reverse().map(mapMessage);
};

export const appendAssistantChatMessage = async (
  sessionId,
  userId,
  {
    role = "user",
    content,
    planSnapshot = null,
    inventorySnapshot = null,
    uiSnapshot = null,
    reserveSlots = 0,
  } = {},
) => {
  const normalizedRole = MESSAGE_ROLES.includes(role) ? role : "user";
  const sanitized = sanitizeContent(content);
  if (!sanitized) throw new Error("Message content is required");
  const normalizedReserveSlots = Math.max(
    0,
    Math.floor(Number(reserveSlots) || 0),
  );

  return sequelize.transaction(async (transaction) => {
    const lock = transaction.LOCK ? transaction.LOCK.UPDATE : undefined;
    const session = await models.AiChatSession.findOne({
      where: { id: sessionId, user_id: userId },
      transaction,
      lock,
    });
    if (!session) throw notFoundError();

    const currentCount = Number(session.message_count) || 0;
    const maxCountBeforeInsert = Math.max(
      1,
      AI_CHAT_QUOTAS.maxMessagesPerSession - normalizedReserveSlots,
    );
    if (currentCount >= maxCountBeforeInsert) {
      throw messageQuotaError();
    }

    const message = await models.AiChatMessage.create(
      {
        session_id: sessionId,
        role: normalizedRole,
        content: sanitized,
        plan_snapshot: planSnapshot ?? null,
        inventory_snapshot: inventorySnapshot ?? null,
        ui_snapshot: uiSnapshot ?? null,
      },
      { transaction },
    );

    const preview = buildPreview(sanitized);
    const updates = {
      last_message_at: new Date(),
      last_message_preview: preview || session.last_message_preview,
    };

    if (normalizedRole === "user" && currentCount <= 1 && preview) {
      updates.title = preview;
    }

    const existingMetadata = parseJsonField(session.metadata) || {};
    if (normalizedRole === "assistant") {
      const metadata = { ...existingMetadata };
      let metadataChanged = false;
      if (planSnapshot) {
        metadata.lastPlanSnapshot = planSnapshot;
        metadataChanged = true;
      }
      if (hasInventorySnapshot(inventorySnapshot)) {
        metadata.lastInventorySnapshot = inventorySnapshot;
        metadataChanged = true;
      }
      if (metadataChanged) {
        updates.metadata = metadata;
      }
    }

    await session.update(updates, { transaction });
    await session.increment("message_count", { by: 1, transaction });

    return mapMessage(message);
  });
};

export const deleteAssistantSession = async (sessionId, userId) => {
  if (!sessionId || !userId) throw notFoundError();
  return sequelize.transaction(async (transaction) => {
    const session = await models.AiChatSession.findOne({
      where: { id: sessionId, user_id: userId },
      transaction,
    });
    if (!session) throw notFoundError();

    await models.AiChatMessage.destroy({
      where: { session_id: sessionId },
      transaction,
    });
    await session.destroy({ transaction });
    return true;
  });
};
