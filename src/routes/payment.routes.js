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
} from "../controllers/payment.controller.js";

import express from "express";

const router = Router();

/* Bookings */
router.post("/stripe/create-session",   createCheckoutSession);
router.post("/apple-pay/process",       processApplePay);
router.post("/booking-addons/create-session", createOutsideAddOnsSession);

/* Add-Ons */
router.post("/upsell/create-session",   createAddOnSession);

/* Webhook */
router.post("/stripe/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);

/* Apple Pay merchant validation */
router.post("/stripe/validate-merchant", validateMerchant);

router.post("/create-payment-intent", createPartnerPaymentIntent);
router.post("/confirm-and-book",      confirmPartnerPayment);

// (opcional) webhook específico de partner si quieres auditar
router.post("/webhook",
  express.raw({ type: "application/json" }),
  handlePartnerWebhook
);

export default router;
