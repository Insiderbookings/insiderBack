// src/routes/payment.routes.js
import { Router } from "express";
import {
  createCheckoutSession,
  createAddOnSession,
  handleWebhook,
  validateMerchant,
  processApplePay,
  createOutsideAddOnsSession,
} from "../controllers/payment.controller.js";

import express from "express";

const router = Router();

/* Bookings */
router.post("/stripe/create-session",   createCheckoutSession);
router.post("/apple-pay/process",       processApplePay);
router.post("/outside-addons/create-session", createOutsideAddOnsSession);

/* Add-Ons */
router.post("/upsell/create-session",   createAddOnSession);

/* Webhook */
router.post("/stripe/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);

/* Apple Pay merchant validation */
router.post("/stripe/validate-merchant", validateMerchant);

export default router;
