import { Router } from "express";
import { handleAssistantSearch } from "../controllers/aiAssistant.controller.js";

const router = Router();

router.post("/search", handleAssistantSearch);

export default router;
