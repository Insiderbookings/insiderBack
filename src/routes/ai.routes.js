import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth.js";
import { handleAiChat } from "../controllers/ai.controller.js";

const router = Router();

router.use(authenticate);
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(aiLimiter);
router.post("/chat", handleAiChat);

export default router;
