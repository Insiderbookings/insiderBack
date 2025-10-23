import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
import { emitToRoom, emitToUser } from "../websocket/emitter.js";

const {
  ChatThread,
  ChatParticipant,
  ChatMessage,
  ChatAutoPrompt,
  Home,
  User,
} = models;

const CHAT_ROOM = (chatId) => `chat:${chatId}`;

const mapUserSummary = (user) =>
  user
    ? {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role,
      }
    : null;

const mapMessage = (message) => ({
  id: message.id,
  chatId: message.chat_id,
  senderId: message.sender_id,
  senderRole: message.sender_role,
  type: message.type,
  body: message.body,
  metadata: message.metadata,
  deliveredAt: message.delivered_at,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
});

const ensureSnapshot = async ({
  homeId,
  snapshotName,
  snapshotImage,
  transaction,
}) => {
  if (snapshotName && snapshotImage) {
    return { name: snapshotName, image: snapshotImage };
  }

  if (!homeId) {
    return { name: snapshotName ?? null, image: snapshotImage ?? null };
  }

  const home = await Home.findByPk(homeId, {
    attributes: ["id", "title"],
    include: [
      {
        association: "media",
        attributes: ["url", "cover"],
        where: { cover: true },
        required: false,
        limit: 1,
      },
    ],
    transaction,
  });

  if (!home) {
    return { name: snapshotName ?? null, image: snapshotImage ?? null };
  }

  const cover =
    home.media?.length && home.media[0]?.url ? home.media[0].url : null;

  return {
    name: snapshotName ?? home.title ?? null,
    image: snapshotImage ?? cover,
  };
};

const ensureParticipants = async (thread, transaction) => {
  const existing = await ChatParticipant.findAll({
    where: { chat_id: thread.id },
    transaction,
  });
  if (existing.length === 2) return existing;

  const participants = [
    {
      chat_id: thread.id,
      user_id: thread.guest_user_id,
      role: "GUEST",
      last_read_at: null,
    },
    {
      chat_id: thread.id,
      user_id: thread.host_user_id,
      role: "HOST",
      last_read_at: null,
    },
  ];

  await ChatParticipant.bulkCreate(participants, {
    transaction,
    ignoreDuplicates: true,
  });

  return ChatParticipant.findAll({ where: { chat_id: thread.id }, transaction });
};

const attachUserRecords = async (thread, transaction) => {
  const [guest, host] = await Promise.all([
    User.findByPk(thread.guest_user_id, {
      attributes: ["id", "name", "email", "avatar_url", "role"],
      transaction,
    }),
    User.findByPk(thread.host_user_id, {
      attributes: ["id", "name", "email", "avatar_url", "role"],
      transaction,
    }),
  ]);

  thread.setDataValue("guestUser", guest);
  thread.setDataValue("hostUser", host);
};

export const createThread = async ({
  guestUserId,
  hostUserId,
  homeId = null,
  reserveId = null,
  checkIn = null,
  checkOut = null,
  homeSnapshotName = null,
  homeSnapshotImage = null,
}) => {
  return sequelize.transaction(async (transaction) => {
    const existing = await ChatThread.findOne({
      where: {
        guest_user_id: guestUserId,
        host_user_id: hostUserId,
        reserve_id: reserveId,
        status: "OPEN",
        ...(homeId ? { home_id: homeId } : {}),
      },
      transaction,
    });
    if (existing) {
      const messageCount = await ChatMessage.count({
        where: { chat_id: existing.id },
        transaction,
      });

      if (messageCount === 0) {
        await enqueueInitialPrompt({ thread: existing, transaction });

        transaction.afterCommit(() => {
          emitUnreadCounters(existing);
        });
      }

      return existing;
    }

    const snapshot = await ensureSnapshot({
      homeId,
      snapshotName: homeSnapshotName,
      snapshotImage: homeSnapshotImage,
      transaction,
    });

    const thread = await ChatThread.create(
      {
        guest_user_id: guestUserId,
        host_user_id: hostUserId,
        home_id: homeId,
        reserve_id: reserveId,
        check_in: checkIn,
        check_out: checkOut,
        home_snapshot_name: snapshot.name,
        home_snapshot_image: snapshot.image,
      },
      { transaction }
    );

    await ensureParticipants(thread, transaction);
    await attachUserRecords(thread, transaction);

    await enqueueInitialPrompt({
      thread,
      transaction,
    });

    transaction.afterCommit(() => {
      emitUnreadCounters(thread);
    });

    return thread;
  });
};

const getOrderedPromptsForThread = async ({ thread, transaction }) => {
  const scopeFilter = [{ scope: "GLOBAL" }];
  if (thread.home_id != null) {
    scopeFilter.push({ scope: "HOME", home_id: thread.home_id });
  }

  return ChatAutoPrompt.findAll({
    where: {
      host_user_id: thread.host_user_id,
      is_active: true,
      trigger: "INITIAL",
      [Op.or]: scopeFilter,
    },
    // Sequence strictly by sort_order, then id
    order: [["sort_order", "ASC"], ["id", "ASC"]],
    transaction,
  });
};

const enqueueInitialPrompt = async ({ thread, transaction }) => {
  const prompts = await getOrderedPromptsForThread({ thread, transaction });
  if (!prompts.length) return;

  const prompt = prompts[0];

  const message = await ChatMessage.create(
    {
      chat_id: thread.id,
      sender_id: thread.host_user_id,
      sender_role: "HOST",
      type: "PROMPT",
      body: prompt.prompt_text,
      metadata: { autoPromptId: prompt.id, scope: prompt.scope },
      delivered_at: new Date(),
    },
    { transaction }
  );

  await ChatParticipant.update(
    { last_read_at: message.createdAt },
    {
      where: { chat_id: thread.id, user_id: thread.host_user_id },
      limit: 1,
      transaction,
    }
  );

  await ChatThread.update(
    { last_message_at: message.createdAt },
    { where: { id: thread.id }, transaction }
  );

  thread.setDataValue("last_message_at", message.createdAt);
};

const enqueueAutoPrompts = async ({ thread, transaction }) => {
  const prompts = await getOrderedPromptsForThread({ thread, transaction });

  if (!prompts.length) return;

  let lastCreatedAt = null;

  for (const prompt of prompts) {
    const message = await ChatMessage.create(
      {
        chat_id: thread.id,
        sender_id: thread.host_user_id,
        sender_role: "HOST",
        type: "PROMPT",
        body: prompt.prompt_text,
        metadata: { autoPromptId: prompt.id, scope: prompt.scope },
        delivered_at: new Date(),
      },
      { transaction }
    );
    lastCreatedAt = message.createdAt;
  }

  await ChatParticipant.update(
    { last_read_at: lastCreatedAt || new Date() },
    {
      where: {
        chat_id: thread.id,
        user_id: thread.host_user_id,
      },
      limit: 1,
      transaction,
    }
  );

  if (lastCreatedAt) {
    await ChatThread.update(
      { last_message_at: lastCreatedAt },
      {
        where: { id: thread.id },
        transaction,
      }
    );
    thread.setDataValue("last_message_at", lastCreatedAt);
  }
};

const fetchParticipant = async ({ chatId, userId, transaction }) => {
  const participant = await ChatParticipant.findOne({
    where: { chat_id: chatId, user_id: userId },
    transaction,
  });
  if (!participant) {
    throw new Error("User is not a participant of this chat");
  }
  return participant;
};

export const postMessage = async ({
  chatId,
  senderId,
  senderRole = null,
  body,
  type = "TEXT",
  metadata = null,
}) => {
  const result = await sequelize.transaction(async (transaction) => {
    let role = senderRole;

    if (senderId) {
      const participant = await fetchParticipant({
        chatId,
        userId: senderId,
        transaction,
      });
      role = role ?? participant.role;
    }

    if (!role) {
      role = "SYSTEM";
    }

    const clientTempId =
      metadata && typeof metadata === "object"
        ? metadata.clientTempId ?? metadata.client_temp_id ?? null
        : null;

    if (clientTempId) {
      const existingMessage = await ChatMessage.findOne({
        where: {
          chat_id: chatId,
          [Op.or]: [
            sequelize.where(
              sequelize.json("metadata.clientTempId"),
              clientTempId
            ),
            sequelize.where(
              sequelize.json("metadata.client_temp_id"),
              clientTempId
            ),
          ],
        },
        transaction,
      });

      if (existingMessage) {
        return existingMessage;
      }
    }

    if (senderId) {
      await fetchParticipant({ chatId, userId: senderId, transaction });
    }

    const message = await ChatMessage.create(
      {
        chat_id: chatId,
        sender_id: senderId,
        sender_role: role,
        body,
        type,
        metadata,
        delivered_at: new Date(),
      },
      { transaction }
    );

    await ChatThread.update(
      { last_message_at: message.createdAt },
      { where: { id: chatId }, transaction }
    );

    if (senderId) {
      await ChatParticipant.update(
        { last_read_at: message.createdAt },
        {
          where: { chat_id: chatId, user_id: senderId },
          limit: 1,
          transaction,
        }
      );
    }

    return message;
  });

  const message = await ChatMessage.findByPk(result.id, {
    include: [
      {
        model: User,
        as: "sender",
        attributes: ["id", "name", "email", "avatar_url", "role"],
      },
    ],
  });

  emitToRoom(CHAT_ROOM(chatId), "chat:message", mapMessage(message));
  const thread = await ChatThread.findByPk(chatId, {
    // include home_id so prompt filtering by HOME works
    attributes: [
      "id",
      "guest_user_id",
      "host_user_id",
      "home_id",
      "last_message_at",
      "status",
    ],
  });

  if (thread) {
    emitUnreadCounters(thread);
  }

  // After a guest replies, enqueue next prompt if any remaining
  if (thread && message.sender_role === "GUEST" && type !== "PROMPT") {
    await enqueueNextPromptIfNeeded({ thread });
  }

  return mapMessage(message);
};

const enqueueNextPromptIfNeeded = async ({ thread }) => {
  // Collect already sent autoPromptIds in this chat
  const sentPromptMessages = await ChatMessage.findAll({
    where: { chat_id: thread.id, type: "PROMPT" },
    order: [["id", "ASC"]],
  });

  const sentPromptIds = new Set(
    sentPromptMessages
      .map((m) => {
        const meta = m.metadata || {};
        const raw = meta.autoPromptId ?? meta.auto_prompt_id ?? null;
        const num = raw != null ? Number(raw) : null;
        return Number.isFinite(num) ? num : null;
      })
      .filter((v) => v != null)
  );

  // Fallback dedupe by body text in case metadata is missing
  const sentBodies = new Set(sentPromptMessages.map((m) => m.body).filter(Boolean));

  const prompts = await getOrderedPromptsForThread({ thread });
  const next = prompts.find(
    (p) => !sentPromptIds.has(Number(p.id)) && !sentBodies.has(p.prompt_text)
  );
  if (!next) return;

  const message = await ChatMessage.create({
    chat_id: thread.id,
    sender_id: thread.host_user_id,
    sender_role: "HOST",
    type: "PROMPT",
    body: next.prompt_text,
    metadata: { autoPromptId: next.id, scope: next.scope },
    delivered_at: new Date(),
  });

  await ChatParticipant.update(
    { last_read_at: message.createdAt },
    { where: { chat_id: thread.id, user_id: thread.host_user_id }, limit: 1 }
  );

  await ChatThread.update(
    { last_message_at: message.createdAt },
    { where: { id: thread.id } }
  );

  emitToRoom(CHAT_ROOM(thread.id), "chat:message", mapMessage(message));
  await emitUnreadCounters(await ChatThread.findByPk(thread.id));
};

const emitUnreadCounters = async (thread) => {
  const participants = await ChatParticipant.findAll({
    where: { chat_id: thread.id },
  });

  for (const participant of participants) {
    const unread = await countUnreadForUser({
      chatId: thread.id,
      userId: participant.user_id,
      lastReadAt: participant.last_read_at,
    });

    emitToUser(participant.user_id, "chat:unread", {
      chatId: thread.id,
      unread,
      lastMessageAt: thread.last_message_at,
    });
  }
};

const countUnreadForUser = async ({ chatId, userId, lastReadAt }) => {
  const where = {
    chat_id: chatId,
    sender_role: { [Op.ne]: "SYSTEM" },
  };
  if (lastReadAt) {
    where.createdAt = { [Op.gt]: lastReadAt };
  }
  return ChatMessage.count({
    where: {
      ...where,
      [Op.or]: [
        { sender_id: { [Op.ne]: userId } },
        { sender_id: null },
      ],
    },
  });
};

export const markThreadRead = async ({ chatId, userId }) => {
  const now = new Date();

  await sequelize.transaction(async (transaction) => {
    const thread = await ChatThread.findByPk(chatId, { transaction });
    if (!thread) {
      throw new Error("Chat not found");
    }

    let role = "SYSTEM";
    if (thread.guest_user_id === userId) {
      role = "GUEST";
    } else if (thread.host_user_id === userId) {
      role = "HOST";
    }

    const [participant] = await ChatParticipant.findOrCreate({
      where: { chat_id: chatId, user_id: userId },
      defaults: {
        chat_id: chatId,
        user_id: userId,
        role,
        last_read_at: now,
      },
      transaction,
    });

    const currentLastRead = participant.get("last_read_at");
    const needsUpdate =
      !currentLastRead || new Date(currentLastRead).getTime() < now.getTime();

    if (needsUpdate) {
      await participant.update({ last_read_at: now }, { transaction });
    }
  });

  emitToUser(userId, "chat:unread", { chatId, unread: 0, lastMessageAt: now });
};

export const listThreadsForUser = async ({ userId }) => {
  const threads = await ChatThread.findAll({
    where: {
      [Op.or]: [
        { guest_user_id: userId },
        { host_user_id: userId },
      ],
    },
    include: [
      {
        model: ChatParticipant,
        as: "participants",
      },
    ],
    order: [["last_message_at", "DESC"]],
  });

  return Promise.all(
    threads.map((thread) => mapThreadForUser({ thread, userId }))
  );
};

export const getThreadForUser = async ({ userId, chatId }) => {
  const thread = await ChatThread.findByPk(chatId, {
    include: [
      {
        model: ChatParticipant,
        as: "participants",
      },
    ],
  });
  if (!thread) return null;

  const isParticipant =
    thread.guest_user_id === userId || thread.host_user_id === userId;

  if (!isParticipant) {
    return null;
  }

  return mapThreadForUser({ thread, userId });
};

const mapThreadForUser = async ({ thread, userId }) => {
  const lastMessage = await ChatMessage.findOne({
    where: { chat_id: thread.id },
    order: [["createdAt", "DESC"]],
  });

  const participant = thread.participants?.find(
    (p) => p.user_id === userId
  );

  const unread = await countUnreadForUser({
    chatId: thread.id,
    userId,
    lastReadAt: participant?.last_read_at,
  });

  const guest =
    thread.guestUser ??
    (await User.findByPk(thread.guest_user_id, {
      attributes: ["id", "name", "email", "avatar_url", "role"],
    }));
  const host =
    thread.hostUser ??
    (await User.findByPk(thread.host_user_id, {
      attributes: ["id", "name", "email", "avatar_url", "role"],
    }));

  return {
    id: thread.id,
    status: thread.status,
    reserveId: thread.reserve_id,
    homeId: thread.home_id,
    homeSnapshot: {
      name: thread.home_snapshot_name,
      image: thread.home_snapshot_image,
    },
    checkIn: thread.check_in,
    checkOut: thread.check_out,
    lastMessageAt: thread.last_message_at,
    unreadCount: unread,
    guest: mapUserSummary(guest),
    host: mapUserSummary(host),
    lastMessage: lastMessage ? mapMessage(lastMessage) : null,
  };
};

export const listMessagesForUser = async ({
  chatId,
  userId,
  limit = 50,
  before = null,
}) => {
  await fetchParticipant({ chatId, userId });

  // If this is the first load (no paging cursor) and the
  // thread has no messages yet, enqueue auto-prompts so that
  // a freshly started chat shows initial questions.
  if (!before) {
    const existingCount = await ChatMessage.count({ where: { chat_id: chatId } });
    if (existingCount === 0) {
      const thread = await ChatThread.findByPk(chatId);
      if (thread && thread.status === "OPEN") {
        await enqueueInitialPrompt({ thread });
      }
    }
  }

  const where = { chat_id: chatId };
  if (before) {
    where.id = { [Op.lt]: before };
  }

  const messages = await ChatMessage.findAll({
    where,
    order: [["id", "DESC"]],
    limit,
  });

  return messages.reverse().map(mapMessage);
};

export const listAutoPrompts = async ({ hostUserId }) => {
  const prompts = await ChatAutoPrompt.findAll({
    where: { host_user_id: hostUserId },
    order: [
      ["scope", "DESC"],
      ["home_id", "ASC"],
      ["sort_order", "ASC"],
      ["id", "ASC"],
    ],
  });

  return prompts.map((prompt) => ({
    id: prompt.id,
    hostUserId: prompt.host_user_id,
    homeId: prompt.home_id,
    scope: prompt.scope,
    trigger: prompt.trigger,
    promptText: prompt.prompt_text,
    sortOrder: prompt.sort_order,
    isActive: prompt.is_active,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
  }));
};

export const upsertAutoPrompt = async ({
  hostUserId,
  promptId,
  scope,
  homeId = null,
  trigger = "INITIAL",
  promptText,
  sortOrder = 0,
  isActive = true,
}) => {
  if (!promptText) {
    throw new Error("promptText is required");
  }

  if (!["GLOBAL", "HOME"].includes(scope)) {
    throw new Error("Invalid scope");
  }

  if (scope === "HOME" && !homeId) {
    throw new Error("homeId is required for HOME scope");
  }

  let prompt = null;

  if (promptId) {
    prompt = await ChatAutoPrompt.findOne({
      where: { id: promptId, host_user_id: hostUserId },
    });
  }

  if (prompt) {
    await prompt.update({
      scope,
      home_id: scope === "HOME" ? homeId : null,
      trigger,
      prompt_text: promptText,
      sort_order: sortOrder,
      is_active: isActive,
    });
  } else {
    prompt = await ChatAutoPrompt.create({
      host_user_id: hostUserId,
      scope,
      home_id: scope === "HOME" ? homeId : null,
      trigger,
      prompt_text: promptText,
      sort_order: sortOrder,
      is_active: isActive,
    });
  }

  return {
    id: prompt.id,
    hostUserId: prompt.host_user_id,
    homeId: prompt.home_id,
    scope: prompt.scope,
    trigger: prompt.trigger,
    promptText: prompt.prompt_text,
    sortOrder: prompt.sort_order,
    isActive: prompt.is_active,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
  };
};

export const deactivateAutoPrompt = async ({ hostUserId, promptId }) => {
  await ChatAutoPrompt.update(
    { is_active: false },
    { where: { id: promptId, host_user_id: hostUserId } }
  );
};
