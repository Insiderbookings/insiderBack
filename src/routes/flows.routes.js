import { Router } from "express";
import rateLimit from "express-rate-limit";
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
import { authenticate, requireVerifiedEmail } from "../middleware/auth.js";

const router = Router();
const FLOW_READ_WINDOW_MS = 15 * 60 * 1000;
const FLOW_READ_LIMIT_MAX = Math.max(20, Number(process.env.FLOW_READ_RATE_LIMIT_MAX || 120));
const FLOW_WRITE_LIMIT_MAX = Math.max(5, Number(process.env.FLOW_WRITE_RATE_LIMIT_MAX || 30));
const flowReadLimiter = rateLimit({
  windowMs: FLOW_READ_WINDOW_MS,
  max: FLOW_READ_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many booking flow requests. Please slow down." },
});
const flowWriteLimiter = rateLimit({
  windowMs: FLOW_READ_WINDOW_MS,
  max: FLOW_WRITE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many booking flow write attempts. Please wait and retry." },
});

router.post("/start", flowReadLimiter, authenticate, startFlow);
router.post("/select", flowReadLimiter, authenticate, selectFlow);
router.post("/block", flowReadLimiter, authenticate, blockFlow);
router.post("/savebooking", flowWriteLimiter, authenticate, requireVerifiedEmail, saveBookingFlow);
router.post("/price", flowReadLimiter, authenticate, priceFlow);
router.post("/preauth", flowWriteLimiter, authenticate, requireVerifiedEmail, preauthFlow);
router.post("/confirm", flowWriteLimiter, authenticate, requireVerifiedEmail, confirmFlow);
router.post("/cancel/quote", flowReadLimiter, authenticate, cancelQuoteFlow);
router.post("/cancel", flowWriteLimiter, authenticate, cancelFlow);
router.get("/:flowId/steps", flowReadLimiter, authenticate, getFlowSteps);
router.get("/:flowId", flowReadLimiter, authenticate, getFlow);

export default router;
