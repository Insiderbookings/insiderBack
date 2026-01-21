import { Router } from "express";
import {
  createAiChat,
  deleteAiChat,
  getAiChat,
  handleAiChat,
  listAiChats,
} from "../controllers/ai.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);
router.post("/search", handleAiChat);
router.post("/chats", createAiChat);
router.get("/chats", listAiChats);
router.get("/chats/:sessionId", getAiChat);
router.delete("/chats/:sessionId", deleteAiChat);

export default router;
