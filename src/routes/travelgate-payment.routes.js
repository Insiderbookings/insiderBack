// src/routes/travelgate-payment.routes.js
import { Router } from "express"
import express from "express"

import {
  createTravelgatePaymentIntent,
  confirmPaymentAndBook,
  handleTravelgateWebhook,
} from "../controllers/travelgate-payment.controller.js" // ⬅️ corregido el import

const router = Router()

// Estas rutas normalmente las montas bajo /api/tgx-payment en tu app principal:
// app.use("/api/tgx-payment", router)

// Crear Payment Intent para TravelgateX
router.post("/create-payment-intent", createTravelgatePaymentIntent)

// Confirmar pago y hacer booking
router.post("/confirm-and-book", confirmPaymentAndBook)

// Webhook específico para TravelgateX (raw body SOLO aquí)
router.post("/webhook", express.raw({ type: "application/json" }), handleTravelgateWebhook)

export default router
