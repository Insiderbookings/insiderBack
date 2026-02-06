// src/routes/payment.routes.js
import { Router } from "express";
import {
  createCheckoutSession,
  createAddOnSession,
  handleWebhook,
  validateMerchant,
  processApplePay,
  createOutsideAddOnsSession,
  createPartnerPaymentIntent,
  confirmPartnerPayment,
  handlePartnerWebhook,
  createHomePaymentIntent,
} from "../controllers/payment.controller.js";
import { createHomePaymentIntentAppTest } from "../controllers/paymentAppTest.controller.js";

import express from "express";
import { authenticate, authenticateOrPartnerKey, requireVerifiedEmail } from "../middleware/auth.js";

const router = Router();
console.log("[payments] registering /api/payments routes (includes /stripe/webhook)");

/* Bookings */
router.post("/stripe/create-session", authenticate, createCheckoutSession);
router.post("/apple-pay/process",       processApplePay);
router.post("/booking-addons/create-session", authenticate, createOutsideAddOnsSession);
router.post("/homes/create-payment-intent", authenticate, requireVerifiedEmail, createHomePaymentIntent);
router.post("/homes/test/create-payment-intent", authenticate, requireVerifiedEmail, createHomePaymentIntentAppTest);

/* Add-Ons */
router.post("/upsell/create-session", authenticate, createAddOnSession);

/* Webhook */
router.post("/stripe/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);

/* Apple Pay merchant validation */
router.post("/stripe/validate-merchant", validateMerchant);

router.post("/create-payment-intent", authenticateOrPartnerKey, createPartnerPaymentIntent);
router.post("/confirm-and-book", authenticateOrPartnerKey, confirmPartnerPayment);

// (opcional) webhook específico de partner si quieres auditar
router.post("/webhook",
  express.raw({ type: "application/json" }),
  handlePartnerWebhook
);

export default router;
