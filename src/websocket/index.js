import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import registerChatGateway from "./chat.gateway.js";
import registerSupportGateway from "./support.gateway.js";
import {
  setIOReference,
  joinUserRoom,
  leaveUserRoom,
} from "./emitter.js";

const getAllowedOrigins = () => {
  const origins = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!origins.length) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CORS_ALLOWED_ORIGINS is required for websocket in production");
    }
    return ["*"];
  }
  return origins;
};

export const initSocketServer = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: true,
    },
  });

  setIOReference(io);

  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers.authorization ||
        "";
      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const raw = token.startsWith("Bearer ") ? token.slice(7) : token;
      const payload = jwt.verify(raw, process.env.JWT_SECRET);
      if (!payload?.id) {
        return next(new Error("Unauthorized"));
      }
      socket.data.user = payload;
      return next();
    } catch (err) {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.user?.id;
    if (userId) {
      joinUserRoom(socket, userId);
    }

    registerChatGateway(io, socket);
    registerSupportGateway(io, socket);

    socket.on("disconnect", () => {
      if (userId) {
        leaveUserRoom(socket, userId);
      }
    });
  });

  return io;
};

