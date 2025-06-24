// ─────────────────────────────────────────────────────────────────────────────
// src/controllers/payment.controller.js
// 100 % COMPLETO — TODAS LAS LÍNEAS, SIN OMISIONES
// Maneja pagos de Bookings y de Add-Ons (UpsellCode)
// ─────────────────────────────────────────────────────────────────────────────
import Stripe  from "stripe";
import dotenv  from "dotenv";
import models  from "../models/index.js";

dotenv.config();

/* ─────────── Validación de credenciales ─────────── */
if (!process.env.STRIPE_SECRET_KEY)    throw new Error("🛑 Falta STRIPE_SECRET_KEY en .env");
if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error("🛑 Falta STRIPE_WEBHOOK_SECRET en .env");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });

/* ─────────── Utilidad URL segura ─────────── */
const safeURL = (maybe, fallback) => { try { return new URL(maybe).toString(); } catch { return fallback; } };
const YOUR_DOMAIN = safeURL(process.env.CLIENT_URL, "http://localhost:5173");

/* ============================================================================
   1. CREAR SESSION PARA BOOKING
============================================================================ */
export const createCheckoutSession = async (req, res) => {
  const { bookingId, amount, currency = "usd" } = req.body;
  if (!bookingId || !amount) return res.status(400).json({ error: "bookingId y amount son obligatorios" });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: { currency, product_data: { name: `Booking #${bookingId}` }, unit_amount: amount },
        quantity  : 1,
      }],
      mode       : "payment",
      success_url: `${YOUR_DOMAIN}payment/success?bookingId=${bookingId}`,
      cancel_url : `${YOUR_DOMAIN}payment/fail?bookingId=${bookingId}`,
      metadata   : { bookingId },
      payment_intent_data: { metadata: { bookingId } },
    });

    await models.Booking.update({ payment_id: session.id }, { where: { id: bookingId } });
    res.json({ sessionId: session.id });
  } catch (error) {
    console.error("Stripe create session error:", error);
    res.status(500).json({ error: error.message });
  }
};

/* ============================================================================
   1.b CREAR SESSION PARA ADD-ON (UpsellCode)
============================================================================ */
export const createAddOnSession = async (req, res) => {
  console.log(req.body, "body")
  const { addOnId } = req.body;              // ← ahora recibimos addOnId
  if (!addOnId) {
    return res.status(400).json({ error: "addOnId requerido" });
  }

  /* Buscar el UpsellCode pendiente para ese add_on_id */
  const upsell = await models.UpsellCode.findOne({
    where: { id: addOnId, status: "pending" },
    include: { model: models.AddOn, attributes: ["name", "price"] },
  });

  if (!upsell) {
    return res.status(404).json({ error: "Upsell code invalid or used" });
  }

  try {
    const amount = Math.round(Number(upsell.AddOn.price) * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Add-On: ${upsell.AddOn.name}` },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${YOUR_DOMAIN}payment/addon-success?codeId=${upsell.id}`,
      cancel_url:  `${YOUR_DOMAIN}payment/addon-fail?codeId=${upsell.id}`,
      metadata: { upsellCodeId: upsell.id },
      payment_intent_data: { metadata: { upsellCodeId: upsell.id } },
    });

    upsell.payment_id = session.id;
    await upsell.save();

    res.json({ sessionId: session.id });
  } catch (err) {
    console.error("Stripe add-on session error:", err);
    res.status(500).json({ error: "Stripe session error" });
  }
};

/* ============================================================================
   2. WEBHOOK GENERAL  (Bookings + Add-Ons)
============================================================================ */
export const handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("⚠️  Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  /* ─── Helpers para marcar como pagado ─── */
  const markBookingAsPaid = async ({ bookingId, paymentId }) => {
    try {
      await models.Booking.update(
        { status: "confirmed", paymentStatus: "paid", payment_id: paymentId },
        { where: { id: bookingId } }
      );
    } catch (e) {
      console.error("DB error (Booking):", e);
    }
  };

  const markUpsellAsPaid = async ({ upsellCodeId, paymentId }) => {
    try {
      await models.UpsellCode.update(
        { status: "used", payment_id: paymentId },
        { where: { id: upsellCodeId } }
      );
    } catch (e) {
      console.error("DB error (UpsellCode):", e);
    }
  };

  const markOutsideAddOnsAsPaid = async ({ outsideBookingId }) => {
    try {
      await models.OutsideBookingAddOn.update(
        { paymentStatus: "paid" },
        { where: { outsidebooking_id: outsideBookingId } }
      );
    } catch (e) {
      console.error("DB error (OutsideBookingAddOn):", e);
    }
  };

  /* ─── Procesar eventos que confirman pago ─── */
  if (event.type === "checkout.session.completed") {
    const s              = event.data.object;
    const bookingId      = Number(s.metadata?.bookingId)      || 0;
    const upsellCodeId   = Number(s.metadata?.upsellCodeId)   || 0;
    const outsideBooking = Number(s.metadata?.outsideBookingId) || 0;

    if (bookingId)      await markBookingAsPaid({ bookingId, paymentId: s.payment_intent || s.id });
    if (upsellCodeId)   await markUpsellAsPaid({ upsellCodeId, paymentId: s.payment_intent || s.id });
    if (outsideBooking) await markOutsideAddOnsAsPaid({ outsideBookingId: outsideBooking });
  }

  if (event.type === "payment_intent.succeeded") {
    const pi             = event.data.object;
    const bookingId      = Number(pi.metadata?.bookingId)      || 0;
    const upsellCodeId   = Number(pi.metadata?.upsellCodeId)   || 0;
    const outsideBooking = Number(pi.metadata?.outsideBookingId) || 0;

    if (bookingId)      await markBookingAsPaid({ bookingId, paymentId: pi.id });
    if (upsellCodeId)   await markUpsellAsPaid({ upsellCodeId, paymentId: pi.id });
    if (outsideBooking) await markOutsideAddOnsAsPaid({ outsideBookingId: outsideBooking });
  }

  res.json({ received: true });
};


/* ============================================================================
   3. VALIDAR MERCHANT (Apple Pay dominio)
============================================================================ */
export const validateMerchant = async (req, res) => {
  try {
    const { validationURL } = req.body;
    const session = await stripe.applePayDomains.create({
      domain_name        : new URL(validationURL).hostname,
      validation_url     : validationURL,
      merchant_identifier: process.env.APPLE_MERCHANT_ID,
    });
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Merchant validation failed" });
  }
};

/* ============================================================================
   4. PROCESAR PAGO APPLE PAY  (token → PaymentIntent) PARA BOOKING
============================================================================ */
export const processApplePay = async (req, res) => {
  try {
    const { token, bookingId, amount, currency = "usd" } = req.body;
    if (!token || !bookingId || !amount)
      return res.status(400).json({ error: "token, bookingId y amount son obligatorios" });

    const intent = await stripe.paymentIntents.create({
      amount             : Math.round(amount * 100),
      currency,
      payment_method_data: { type: "card", card: { token } },
      confirmation_method: "automatic",
      confirm            : true,
      metadata           : { bookingId },
    });

    await models.Booking.update({ payment_id: intent.id }, { where: { id: bookingId } });

    if (intent.status === "succeeded") {
      await models.Booking.update(
        { status: "confirmed", paymentStatus: "paid" },
        { where: { id: bookingId } }
      );
    }

    res.json({
      clientSecret   : intent.client_secret,
      requiresAction : intent.status !== "succeeded",
      paymentStatus  : intent.status,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Apple Pay charge failed" });
  }
};

export const createOutsideAddOnsSession = async (req, res) => {
  const { outsideBookingId, amount, currency = "usd" } = req.body;

  console.log(req.body, "body")
  if (!outsideBookingId || !amount) {
    return res.status(400).json({ error: "outsideBookingId y amount son obligatorios" });
  }

  // Verificamos que exista la reserva externa
  const booking = await models.OutsideBooking.findByPk(outsideBookingId);
  if (!booking) {
    return res.status(404).json({ error: "Outside-booking not found" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency,
          product_data: { name: `Add-Ons Outside #${outsideBookingId}` },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      mode       : "payment",
      success_url: `${YOUR_DOMAIN}payment/outside-addons-success?outsideBookingId=${outsideBookingId}`,
      cancel_url : `${YOUR_DOMAIN}payment/outside-addons-fail?outsideBookingId=${outsideBookingId}`,
      metadata   : { outsideBookingId },
      payment_intent_data: { metadata: { outsideBookingId } },
    });

    // Opcional: podrías guardar session.id en algún campo si lo necesitaras
    res.json({ sessionId: session.id });
  } catch (err) {
    console.error("Stripe create outside-addons session error:", err);
    res.status(500).json({ error: err.message });
  }
};

