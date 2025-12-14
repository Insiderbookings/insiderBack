import models, { sequelize } from "../models/index.js";

export const DEFAULT_ASSISTANT_GREETING =
  "Hi there! I am your Insider assistant. Tell me what kind of home or hotel you're looking for and I'll find it.";

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

const mapSession = (session) => {
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
    metadata: parseJsonField(data.metadata) || null,
  };
};

const mapMessage = (message) => {
  if (!message) return null;
  const data = message.get({ plain: true });
  return {
    id: data.id,
    sessionId: data.session_id,
    role: data.role,
    content: data.content,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    planSnapshot: parseJsonField(data.plan_snapshot) || null,
    inventorySnapshot: parseJsonField(data.inventory_snapshot) || null,
  };
};

const notFoundError = () => {
  const error = new Error("Chat session not found");
  error.code = "AI_CHAT_NOT_FOUND";
  error.status = 404;
  return error;
};

export const createAssistantSessionForUser = async (userId, { greeting } = {}) => {
  if (!userId) throw new Error("userId is required");
  const normalizedGreeting = sanitizeContent(greeting) || DEFAULT_ASSISTANT_GREETING;
  const preview = buildPreview(normalizedGreeting);
  const now = new Date();

  const session = await sequelize.transaction(async (transaction) => {
    const record = await models.AiChatSession.create(
      {
        user_id: userId,
        title: "New chat",
        last_message_preview: preview,
        last_message_at: now,
        message_count: 1,
        metadata: {},
      },
      { transaction }
    );

    await models.AiChatMessage.create(
      {
        session_id: record.id,
        role: "assistant",
        content: normalizedGreeting,
      },
      { transaction }
    );

    return record;
  });

  return mapSession(session);
};

export const listAssistantSessionsForUser = async (userId, { limit = 15 } = {}) => {
  if (!userId) return [];
  const rows = await models.AiChatSession.findAll({
    where: { user_id: userId },
    order: [["last_message_at", "DESC"]],
    limit: Math.max(Number(limit) || 0, 1),
  });
  return rows.map(mapSession);
};

export const getAssistantSessionForUser = async (sessionId, userId, options = {}) => {
  if (!sessionId || !userId) return null;
  return models.AiChatSession.findOne({
    where: { id: sessionId, user_id: userId },
    ...options,
  });
};

export const getAssistantSessionOrThrow = async (sessionId, userId, options = {}) => {
  const session = await getAssistantSessionForUser(sessionId, userId, options);
  if (!session) throw notFoundError();
  return session;
};

export const getAssistantSessionWithMessages = async (
  sessionId,
  userId,
  { limit = 200 } = {}
) => {
  const session = await getAssistantSessionOrThrow(sessionId, userId);
  const rows = await models.AiChatMessage.findAll({
    where: { session_id: sessionId },
    order: [["created_at", "ASC"]],
    limit: Math.max(Number(limit) || 0, 1),
  });
  return {
    session: mapSession(session),
    messages: rows.map(mapMessage),
  };
};

export const fetchAssistantMessages = async (sessionId, userId, { limit = 60 } = {}) => {
  await getAssistantSessionOrThrow(sessionId, userId);
  const rows = await models.AiChatMessage.findAll({
    where: { session_id: sessionId },
    order: [["created_at", "ASC"]],
    limit: Math.max(Number(limit) || 0, 1),
  });
  return rows.map(mapMessage);
};

export const appendAssistantChatMessage = async (
  sessionId,
  userId,
  { role = "user", content, planSnapshot = null, inventorySnapshot = null } = {}
) => {
  const normalizedRole = MESSAGE_ROLES.includes(role) ? role : "user";
  const sanitized = sanitizeContent(content);
  if (!sanitized) throw new Error("Message content is required");

  return sequelize.transaction(async (transaction) => {
    const lock = transaction.LOCK ? transaction.LOCK.UPDATE : undefined;
    const session = await models.AiChatSession.findOne({
      where: { id: sessionId, user_id: userId },
      transaction,
      lock,
    });
    if (!session) throw notFoundError();

    const message = await models.AiChatMessage.create(
      {
        session_id: sessionId,
        role: normalizedRole,
        content: sanitized,
        plan_snapshot: planSnapshot ?? null,
        inventory_snapshot: inventorySnapshot ?? null,
      },
      { transaction }
    );

    const preview = buildPreview(sanitized);
    const currentCount = session.message_count ?? 0;
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
