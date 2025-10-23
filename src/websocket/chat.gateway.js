import {
  joinChatRoom,
  leaveChatRoom,
} from "./emitter.js";
import {
  listThreadsForUser,
  getThreadForUser,
  listMessagesForUser,
  postMessage,
  markThreadRead,
} from "../services/chat.service.js";

const withAck = (handler) => async (payload, ack) => {
  try {
    const result = await handler(payload);
    if (typeof ack === "function") {
      ack({ ok: true, data: result });
    }
  } catch (error) {
    if (typeof ack === "function") {
      ack({
        ok: false,
        error: error?.message || "Unexpected error",
      });
    }
  }
};

export default function registerChatGateway(io, socket) {
  const userId = socket.data.user?.id;
  if (!userId) return;

  const bootstrap = async () => {
    const threads = await listThreadsForUser({ userId });
    socket.emit("chat:init", { threads });
  };

  bootstrap().catch(() => {});

  socket.on(
    "chat:list",
    withAck(async () => {
      const threads = await listThreadsForUser({ userId });
      return { threads };
    })
  );

  socket.on(
    "chat:subscribe",
    withAck(async ({ chatId }) => {
      if (!chatId) throw new Error("chatId is required");
      const thread = await getThreadForUser({ userId, chatId });
      if (!thread) throw new Error("Chat not found");
      joinChatRoom(socket, chatId);
      return { chat: thread };
    })
  );

  socket.on(
    "chat:unsubscribe",
    withAck(async ({ chatId }) => {
      if (chatId) {
        leaveChatRoom(socket, chatId);
      }
      return { chatId };
    })
  );

  socket.on(
    "chat:messages",
    withAck(async ({ chatId, before, limit }) => {
      if (!chatId) throw new Error("chatId is required");
      const messages = await listMessagesForUser({
        chatId,
        userId,
        before,
        limit,
      });
      return { messages };
    })
  );

  socket.on(
    "chat:message",
    withAck(async ({ chatId, body, type, metadata }) => {
      if (!chatId) throw new Error("chatId is required");
      if (!body && type !== "SYSTEM") {
        throw new Error("Message body is required");
      }
      const message = await postMessage({
        chatId,
        senderId: userId,
        senderRole: socket.data.user?.role === 6 ? "HOST" : "GUEST",
        body,
        type,
        metadata,
      });
      return { message };
    })
  );

  socket.on(
    "chat:read",
    withAck(async ({ chatId }) => {
      if (!chatId) throw new Error("chatId is required");
      await markThreadRead({ chatId, userId });
      return { chatId };
    })
  );
}

