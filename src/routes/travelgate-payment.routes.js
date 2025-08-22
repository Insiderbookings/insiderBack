// src/routes/travelgate-payment.routes.js
import { Router } from "express";
import express from "express";
console.log("[tgx-payment] routes file loaded");

import {
  createTravelgatePaymentIntent,
  confirmPaymentAndBook,
  handleTravelgateWebhook,
  bookWithCard,
} from "../controllers/travelgate-payment.controller.js";

const router = Router();
console.log("[tgx-payment] registering endpoints...");

router.post("/create-payment-intent", createTravelgatePaymentIntent);
router.post("/confirm-and-book", confirmPaymentAndBook);
router.post("/webhook", express.raw({ type: "application/json" }), handleTravelgateWebhook);
router.post("/book-with-card", (req, res, next) => {
  console.log("[tgx-payment] /book-with-card hit");
  next();
}, bookWithCard);

export default router;
