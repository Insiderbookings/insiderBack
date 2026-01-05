import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth.js";
import {
  createAiChat,
  deleteAiChat,
  getAiChat,
  handleAiChat,
  listAiChats,
} from "../controllers/ai.controller.js";

const router = Router();

router.use(authenticate);
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/chat", aiLimiter, handleAiChat);
router.post("/chats", createAiChat);
router.get("/chats", listAiChats);
router.get("/chats/:sessionId", getAiChat);
router.delete("/chats/:sessionId", deleteAiChat);

export default router;
