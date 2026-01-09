import models from "../models/index.js";
import {
  createThread,
  listThreadsForUser,
  getThreadForUser,
  listMessagesForUser,
  postMessage,
  markThreadRead,
  listAutoPrompts,
  upsertAutoPrompt,
  deactivateAutoPrompt,
} from "../services/chat.service.js";

const { User } = models;

const respondError = (res, next, err) => {
  const status = err?.status || err?.statusCode;
  if (status) {
    return res.status(status).json({ error: err.message });
  }
  return next(err);
};

const ensureUser = (req) => {
  const userId = Number(req.user?.id);
  if (!userId) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  return userId;
};

const ensureHostRole = (req) => {
  const role = Number(req.user?.role);
  if (role !== 6) {
    const err = new Error("Host access required");
    err.status = 403;
    throw err;
  }
};

export const listUserThreads = async (req, res, next) => {
  try {
    const userId = ensureUser(req);
    const threads = await listThreadsForUser({ userId });
    return res.json({ threads });
  } catch (err) {
    return respondError(res, next, err);
  }
};

export const createUserThread = async (req, res, next) => {
  try {
    const guestUserId = ensureUser(req);
    const {
      hostUserId,
      homeId,
      reserveId,
      checkIn,
      checkOut,
      homeSnapshotName,
      homeSnapshotImage,
    } = req.body;

    if (!hostUserId) {
      return res.status(400).json({ error: "hostUserId is required" });
    }

    const host = await User.findByPk(hostUserId, {
      attributes: ["id", "role"],
    });
    if (!host) {
      return res.status(404).json({ error: "Host user not found" });
    }

    const thread = await createThread({
      guestUserId,
      hostUserId,
      homeId,
      reserveId,
      checkIn,
      checkOut,
      homeSnapshotName,
      homeSnapshotImage,
    });

    const dto = await getThreadForUser({ userId: guestUserId, chatId: thread.id });

    return res.status(201).json({ chat: dto });
  } catch (err) {
    return respondError(res, next, err);
  }
};

export const getUserThread = async (req, res, next) => {
  try {
    const userId = ensureUser(req);
    const { chatId } = req.params;
    const chat = await getThreadForUser({ userId, chatId });
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }
    return res.json({ chat });
  } catch (err) {
    return respondError(res, next, err);
  }
};

export const listUserMessages = async (req, res, next) => {
  try {
    const startedAt = Date.now();
    const userId = ensureUser(req);
    const { chatId } = req.params;
    const { before, limit } = req.query;
    const messages = await listMessagesForUser({
      chatId,
      userId,
      before,
      limit: limit ? Number(limit) : undefined,
    });
    console.log("[perf] chat.listMessages", {
      chatId,
      userId,
      count: messages?.length ?? 0,
      durationMs: Date.now() - startedAt,
    });
    return res.json({ messages });
  } catch (err) {
    return respondError(res, next, err);
  }
};

export const sendUserMessage = async (req, res, next) => {
  try {
    const startedAt = Date.now();
    const userId = ensureUser(req);
    const { chatId } = req.params;
    const { body, type, metadata } = req.body;

    if (!body && type !== "SYSTEM") {
      return res.status(400).json({ error: "Message body is required" });
    }

    const message = await postMessage({
      chatId,
      senderId: userId,
      body,
      type,
      metadata,
    });
    console.log("[perf] chat.sendMessage", {
      chatId,
      userId,
      type: type || "TEXT",
      durationMs: Date.now() - startedAt,
    });
    return res.status(201).json({ message });
  } catch (err) {
    return respondError(res, next, err);
  }
};

export const markUserThreadRead = async (req, res, next) => {
  try {
    const userId = ensureUser(req);
    const { chatId } = req.params;
    await markThreadRead({ chatId, userId });
    return res.json({ ok: true });
  } catch (err) {
    return respondError(res, next, err);
  }
};

export const listHostAutoPrompts = async (req, res, next) => {
  try {
    ensureHostRole(req);
    const hostUserId = ensureUser(req);
    const prompts = await listAutoPrompts({ hostUserId });
    return res.json({ prompts });
  } catch (err) {
    return respondError(res, next, err);
  }
};

export const saveHostAutoPrompt = async (req, res, next) => {
  try {
    ensureHostRole(req);
    const hostUserId = ensureUser(req);
    const {
      id: promptId,
      scope,
      homeId,
      trigger,
      promptText,
      sortOrder,
      isActive,
    } = req.body;

    const prompt = await upsertAutoPrompt({
      hostUserId,
      promptId,
      scope,
      homeId,
      trigger,
      promptText,
      sortOrder,
      isActive,
    });

    return res.status(promptId ? 200 : 201).json({ prompt });
  } catch (err) {
    return respondError(res, next, err);
  }
};

export const deleteHostAutoPrompt = async (req, res, next) => {
  try {
    ensureHostRole(req);
    const hostUserId = ensureUser(req);
    const { promptId } = req.params;
    await deactivateAutoPrompt({ hostUserId, promptId });
    return res.status(204).send();
  } catch (err) {
    return respondError(res, next, err);
  }
};
