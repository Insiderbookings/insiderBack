import { Router } from "express";
import {
  startFlow,
  selectFlow,
  blockFlow,
  saveBookingFlow,
  priceFlow,
  preauthFlow,
  confirmFlow,
  cancelQuoteFlow,
  cancelFlow,
  getFlow,
  getFlowSteps,
} from "../controllers/flowOrchestrator.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/start", authenticate, startFlow);
router.post("/select", authenticate, selectFlow);
router.post("/block", authenticate, blockFlow);
router.post("/savebooking", authenticate, saveBookingFlow);
router.post("/price", authenticate, priceFlow);
router.post("/preauth", authenticate, preauthFlow);
router.post("/confirm", authenticate, confirmFlow);
router.post("/cancel/quote", authenticate, cancelQuoteFlow);
router.post("/cancel", authenticate, cancelFlow);
router.get("/:flowId/steps", authenticate, getFlowSteps);
router.get("/:flowId", authenticate, getFlow);

export default router;
