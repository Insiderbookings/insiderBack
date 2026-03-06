import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AI_RATE_LIMITS } from "../modules/ai/ai.config.js";
import { authenticate } from "../middleware/auth.js";
import {
  createAiChat,
  deleteAiChat,
  getAiChat,
  handleAiChat,
  listAiChats,
} from "../controllers/ai.controller.js";

const router = Router();

const resolveAiRateLimitKey = (req) => {
  const userId = Number(req.user?.id);
  if (Number.isFinite(userId) && userId > 0) return `user:${userId}`;
  return `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
};

const buildAiLimiter = (max) =>
  rateLimit({
    windowMs: AI_RATE_LIMITS.windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: resolveAiRateLimitKey,
    handler: (_req, res) =>
      res.status(429).json({
        error: "Too many AI chat requests right now. Please wait a moment.",
        code: "AI_RATE_LIMITED",
      }),
  });

router.use(authenticate);
const aiTurnLimiter = buildAiLimiter(AI_RATE_LIMITS.chatPerMinute);
const aiSessionReadLimiter = buildAiLimiter(AI_RATE_LIMITS.sessionReadPerMinute);
const aiSessionWriteLimiter = buildAiLimiter(AI_RATE_LIMITS.sessionWritePerMinute);

router.post("/chat", aiTurnLimiter, handleAiChat);
router.post("/chats", aiSessionWriteLimiter, createAiChat);
router.get("/chats", aiSessionReadLimiter, listAiChats);
router.get("/chats/:sessionId", aiSessionReadLimiter, getAiChat);
router.delete("/chats/:sessionId", aiSessionWriteLimiter, deleteAiChat);

export default router;
