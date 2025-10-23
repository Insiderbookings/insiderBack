import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  listUserThreads,
  createUserThread,
  getUserThread,
  listUserMessages,
  sendUserMessage,
  markUserThreadRead,
  listHostAutoPrompts,
  saveHostAutoPrompt,
  deleteHostAutoPrompt,
} from "../controllers/chat.controller.js";

const router = Router();
const hostRouter = Router();

router.use(authenticate);

router.get("/", listUserThreads);
router.post("/", createUserThread);
router.get("/:chatId", getUserThread);
router.get("/:chatId/messages", listUserMessages);
router.post("/:chatId/messages", sendUserMessage);
router.post("/:chatId/read", markUserThreadRead);

hostRouter.get("/auto-prompts", listHostAutoPrompts);
hostRouter.post("/auto-prompts", saveHostAutoPrompt);
hostRouter.delete("/auto-prompts/:promptId", deleteHostAutoPrompt);

router.use("/host", hostRouter);

export default router;

