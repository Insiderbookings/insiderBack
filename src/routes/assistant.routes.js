import { Router } from "express";
import {
  createAssistantChat,
  deleteAssistantChat,
  getAssistantChat,
  handleAssistantSearch,
  listAssistantChats,
} from "../controllers/aiAssistant.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);
router.post("/search", handleAssistantSearch);
router.post("/chats", createAssistantChat);
router.get("/chats", listAssistantChats);
router.get("/chats/:sessionId", getAssistantChat);
router.delete("/chats/:sessionId", deleteAssistantChat);

export default router;
