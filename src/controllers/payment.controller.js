// ─────────────────────────────────────────────────────────────────────────────
// src/controllers/payment.controller.js
// 100 % COMPLETO — TODAS LAS LÍNEAS, SIN OMISIONES
// Maneja pagos de Bookings y de Add-Ons (UpsellCode & BookingAddOn)
// ─────────────────────────────────────────────────────────────────────────────
import Stripe  from "stripe"
import dotenv  from "dotenv"
import models, { sequelize } from "../models/index.js";
import { sendBookingEmail } from "../emailTemplates/booking-email.js";

dotenv.config()

/* ─────────── Validación de credenciales ─────────── */
if (!process.env.STRIPE_SECRET_KEY)     throw new Error("🛑 Falta STRIPE_SECRET_KEY en .env")
if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error("🛑 Falta STRIPE_WEBHOOK_SECRET en .env")

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" })

/* ─────────── Utilidad URL segura ─────────── */
const safeURL   = (maybe, fallback) => { try { return new URL(maybe).toString() } catch { return fallback } }
const YOUR_DOMAIN = safeURL(process.env.CLIENT_URL, "http://localhost:5173")

/* ============================================================================
   1. CREAR SESSION PARA BOOKING
============================================================================ */
export const createCheckoutSession = async (req, res) => {
  const { bookingId, amount, currency = "usd" } = req.body
  if (!bookingId || !amount) return res.status(400).json({ error: "bookingId y amount son obligatorios" })

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
    })

    await models.Booking.update({ payment_id: session.id }, { where: { id: bookingId } })
    res.json({ sessionId: session.id })
  } catch (error) {
    console.error("Stripe create session error:", error)
    res.status(500).json({ error: error.message })
  }
}

/* ============================================================================
   1.b CREAR SESSION PARA ADD-ON (UpsellCode)
============================================================================ */
export const createAddOnSession = async (req, res) => {
  const { addOnId } = req.body
  if (!addOnId) return res.status(400).json({ error: "addOnId requerido" })

  const upsell = await models.UpsellCode.findOne({
    where  : { id: addOnId, status: "PENDING" },
    include: { model: models.AddOn, attributes: ["name", "price"] },
  })
  if (!upsell) return res.status(404).json({ error: "Upsell code invalid or used" })

  try {
    const amount  = Math.round(Number(upsell.AddOn.price) * 100)

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency    : "usd",
          product_data: { name: `Add-On: ${upsell.AddOn.name}` },
          unit_amount : amount,
        },
        quantity: 1,
      }],
      mode       : "payment",
      success_url: `${YOUR_DOMAIN}payment/addon-success?codeId=${upsell.id}`,
      cancel_url : `${YOUR_DOMAIN}payment/addon-fail?codeId=${upsell.id}`,
      metadata   : { upsellCodeId: upsell.id },
      payment_intent_data: { metadata: { upsellCodeId: upsell.id } },
    })

    upsell.payment_id = session.id
    await upsell.save()

    res.json({ sessionId: session.id })
  } catch (err) {
    console.error("Stripe add-on session error:", err)
    res.status(500).json({ error: "Stripe session error" })
  }
}

/* ============================================================================
   1.c CREAR SESSION PARA ADD-ONS de una BOOKING source=OUTSIDE
============================================================================ */
export const createOutsideAddOnsSession = async (req, res) => {
  const { bookingId, amount, currency = "usd" } = req.body
  if (!bookingId || !amount) return res.status(400).json({ error: "bookingId y amount son obligatorios" })

  const booking = await models.Booking.findOne({ where: { id: bookingId, source: "OUTSIDE" } })
  if (!booking) return res.status(404).json({ error: "Outside-booking not found" })

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency,
          product_data: { name: `Add-Ons Outside #${bookingId}` },
          unit_amount : amount,
        },
        quantity: 1,
      }],
      mode       : "payment",
      success_url: `${YOUR_DOMAIN}payment/outside-addons-success?bookingId=${bookingId}`,
      cancel_url : `${YOUR_DOMAIN}payment/outside-addons-fail?bookingId=${bookingId}`,
      metadata   : { outsideBookingId: bookingId },
      payment_intent_data: { metadata: { outsideBookingId: bookingId } },
    })

    res.json({ sessionId: session.id })
  } catch (err) {
    console.error("Stripe create outside-addons session error:", err)
    res.status(500).json({ error: err.message })
  }
}

/* ============================================================================
   2. WEBHOOK GENERAL  (Bookings + Add-Ons)
============================================================================ */
export const handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"]
  let event

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error("⚠️  Webhook signature failed:", err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  /* ─── Helpers ─── */
  const markBookingAsPaid = async ({ bookingId, paymentId }) => {
    try {
      await models.Booking.update(
        { status: "CONFIRMED", payment_status: "PAID", payment_id: paymentId },
        { where: { id: bookingId } }
      )
    } catch (e) { console.error("DB error (Booking):", e) }
  }

  const markUpsellAsPaid = async ({ upsellCodeId, paymentId }) => {
    try {
      await models.UpsellCode.update(
        { status: "USED", payment_id: paymentId },
        { where: { id: upsellCodeId } }
      )
    } catch (e) { console.error("DB error (UpsellCode):", e) }
  }

  const markBookingAddOnsAsPaid = async ({ bookingId }) => {
    try {
      await models.BookingAddOn.update(
        { payment_status: "PAID" },
        { where: { booking_id: bookingId } }
      )
    } catch (e) { console.error("DB error (BookingAddOn):", e) }
  }

  /* ─── Procesar eventos ─── */
  if (event.type === "checkout.session.completed") {
    const s              = event.data.object
    const bookingId      = Number(s.metadata?.bookingId)        || 0
    const upsellCodeId   = Number(s.metadata?.upsellCodeId)     || 0
    const outsideBooking = Number(s.metadata?.outsideBookingId) || 0

    if (bookingId)      await markBookingAsPaid     ({ bookingId, paymentId: s.payment_intent || s.id })
    if (upsellCodeId)   await markUpsellAsPaid      ({ upsellCodeId,        paymentId: s.payment_intent || s.id })
    if (outsideBooking) await markBookingAddOnsAsPaid({ bookingId: outsideBooking })
  }

  if (event.type === "payment_intent.succeeded") {
    const pi             = event.data.object
    const bookingId      = Number(pi.metadata?.bookingId)        || 0
    const upsellCodeId   = Number(pi.metadata?.upsellCodeId)     || 0
    const outsideBooking = Number(pi.metadata?.outsideBookingId) || 0

    if (bookingId)      await markBookingAsPaid     ({ bookingId, paymentId: pi.id })
    if (upsellCodeId)   await markUpsellAsPaid      ({ upsellCodeId,        paymentId: pi.id })
    if (outsideBooking) await markBookingAddOnsAsPaid({ bookingId: outsideBooking })
  }

  res.json({ received: true })
}

/* ============================================================================
   3. VALIDAR MERCHANT (Apple Pay dominio)
============================================================================ */
export const validateMerchant = async (req, res) => {
  try {
    const { validationURL } = req.body
    const session = await stripe.applePayDomains.create({
      domain_name        : new URL(validationURL).hostname,
      validation_url     : validationURL,
      merchant_identifier: process.env.APPLE_MERCHANT_ID,
    })
    res.json(session)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Merchant validation failed" })
  }
}

/* ============================================================================
   4. PROCESAR PAGO APPLE PAY (token → PaymentIntent) PARA BOOKING
============================================================================ */
export const processApplePay = async (req, res) => {
  try {
    const { token, bookingId, amount, currency = "usd" } = req.body
    if (!token || !bookingId || !amount)
      return res.status(400).json({ error: "token, bookingId y amount son obligatorios" })

    const intent = await stripe.paymentIntents.create({
      amount             : Math.round(amount * 100),
      currency,
      payment_method_data: { type: "card", card: { token } },
      confirmation_method: "automatic",
      confirm            : true,
      metadata           : { bookingId },
    })

    await models.Booking.update({ payment_id: intent.id }, { where: { id: bookingId } })

    if (intent.status === "succeeded") {
      await models.Booking.update(
        { status: "CONFIRMED", payment_status: "PAID" },
        { where: { id: bookingId } }
      )
    }

    res.json({
      clientSecret   : intent.client_secret,
      requiresAction : intent.status !== "succeeded",
      paymentStatus  : intent.status,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Apple Pay charge failed" })
  }
}

const trim500 = (v) => (v == null ? "" : String(v).slice(0, 500));
const genRef  = () => `IB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const isNum   = (v) => /^\d+$/.test(String(v || ""));

const toDateOnly = (s) => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d)) return null;
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

async function generateUniqueBookingRef() {
  for (let i = 0; i < 5; i++) {
    const ref = genRef();
    const exists = await models.Booking.findOne({ where: { booking_ref: ref } });
    if (!exists) return ref;
  }
  return `${genRef()}-${Math.random().toString(36).slice(2, 4)}`;
}

/* ╔══════════════════════════════════════════════════════════════════════╗
   ║  PARTNER: CREATE PAYMENT INTENT + PRE-CREATE BOOKING (PENDING)       ║
   ╚══════════════════════════════════════════════════════════════════════╝ */
export const createPartnerPaymentIntent = async (req, res) => {
  let tx;
  try {
    const {
      amount,
      currency = "USD",
      guestInfo = {},
      bookingData = {},   // { checkIn, checkOut, hotelId, roomId, adults, children, ... }
      user_id = null,
      discount_code_id = null,
      net_cost = null,
      captureManual,      // opcional: forzar auth+capture manual
      source = "PARTNER", // forzado a PARTNER
    } = req.body;

    console.log(req.body, "body")

    if (!amount || !guestInfo?.fullName || !guestInfo?.email) {
      return res.status(400).json({ error: "amount, guestInfo.fullName y guestInfo.email son obligatorios" });
    }

    const checkInDO  = toDateOnly(bookingData.checkIn);
    const checkOutDO = toDateOnly(bookingData.checkOut);
    if (!checkInDO || !checkOutDO) {
      return res.status(400).json({ error: "bookingData.checkIn y bookingData.checkOut son obligatorios/válidos" });
    }

    const hotelIdRaw = bookingData.localHotelId ?? bookingData.hotelId;
    const roomIdRaw  = bookingData.roomId;

    if (!isNum(hotelIdRaw) || !isNum(roomIdRaw)) {
      return res.status(400).json({ error: "hotelId y roomId numéricos son obligatorios para PARTNER" });
    }
    const hotel_id = Number(hotelIdRaw);
    const room_id  = Number(roomIdRaw);

    // (Opcional) validar que la room pertenece al hotel
    const room = await models.Room.findOne({ where: { id: room_id, hotel_id } });
    if (!room) {
      return res.status(400).json({ error: "Room no encontrada o no pertenece al hotel indicado" });
    }

    const currency3 = String(currency || "USD").slice(0, 3).toUpperCase();

    tx = await sequelize.transaction();

    const booking_ref = await generateUniqueBookingRef();

    const booking = await models.Booking.create({
      booking_ref,
      user_id,
      hotel_id,
      tgx_hotel_id: null,
      room_id,
      discount_code_id,

      source,
      external_ref: null, // partners: si el PMS genera algo, lo podrás setear en confirm

      check_in:  checkInDO,
      check_out: checkOutDO,
      adults:    Number(bookingData.adults || 1),
      children:  Number(bookingData.children || 0),

      guest_name:  String(guestInfo.fullName || "").slice(0, 120),
      guest_email: String(guestInfo.email || "").slice(0, 150),
      guest_phone: String(guestInfo.phone || "").slice(0, 50),

      status:          "PENDING",
      payment_status:  "UNPAID",
      gross_price:     Number(amount),
      net_cost:        net_cost != null ? Number(net_cost) : null,
      currency:        currency3,

      payment_provider:  "STRIPE",
      payment_intent_id: null,

      rate_expires_at: bookingData.rateExpiresAt || null,

      meta: {
        specialRequests: guestInfo.specialRequests || "",
        origin: "partner-payment.create-payment-intent",
        snapshot: {
          checkIn: bookingData.checkIn,
          checkOut: bookingData.checkOut,
          source,
          hotelId: hotel_id,
          roomId: room_id,
        },
        // si mandas discount en req.body.discount, lo guardamos
        ...(bookingData.meta && typeof bookingData.meta === "object" ? bookingData.meta : {}),
        ...(req.body.discount ? { discount: req.body.discount } : {}),
      },
    }, { transaction: tx });

    const wantManualCapture =
      captureManual === true ||
      String(process.env.STRIPE_CAPTURE_MANUAL || "").toLowerCase() === "true";

    const metadata = {
      type: "partner_booking",
      bookingRef: booking_ref,
      booking_id: String(booking.id),
      hotelId: String(hotel_id),
      roomId: String(room_id),
      guestName: trim500(guestInfo.fullName),
      guestEmail: trim500(guestInfo.email),
      checkIn: trim500(checkInDO),
      checkOut: trim500(checkOutDO),
    };

    const paymentIntentPayload = {
      amount: Math.round(Number(amount) * 100),
      currency: currency3.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: `Partner booking H${hotel_id} R${room_id} ${checkInDO}→${checkOutDO}`,
      metadata,
    };
    if (wantManualCapture) paymentIntentPayload.capture_method = "manual";

    const pi = await stripe.paymentIntents.create(paymentIntentPayload);

    await booking.update(
      { payment_intent_id: pi.id, payment_provider: "STRIPE" },
      { transaction: tx }
    );

    await tx.commit(); tx = null;

    return res.json({
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      bookingRef: booking_ref,
      bookingId: booking.id,
      currency: currency3,
      amount: Number(amount),
      status: "PENDING_PAYMENT",
      captureManual: wantManualCapture,
    });
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (_) {} }
    console.error("❌ partner create-payment-intent error:", err);
    return res.status(500).json({ error: err.message });
  }
};

/* ╔══════════════════════════════════════════════════════════════════════╗
   ║  PARTNER: CONFIRMAR PAGO Y CONFIRMAR BOOKING LOCAL                   ║
   ╚══════════════════════════════════════════════════════════════════════╝ */
// ────────────────────────────────────────────────────────────────
// PARTNER
// ────────────────────────────────────────────────────────────────
export const confirmPartnerPayment = async (req, res) => {
  try {
    const { paymentIntentId, bookingRef, captureManual, discount } = req.body;

    if (!paymentIntentId && !bookingRef) {
      return res.status(400).json({ error: "paymentIntentId o bookingRef es requerido" });
    }

    const wantManualCapture =
      captureManual === true ||
      String(process.env.STRIPE_CAPTURE_MANUAL || "").toLowerCase() === "true";

    // Recupero el PI (si se envía)
    const pi = paymentIntentId ? await stripe.paymentIntents.retrieve(paymentIntentId) : null;

    // Validación de estado según el flujo
    if (pi) {
      if (wantManualCapture) {
        if (!["requires_capture", "succeeded"].includes(pi.status)) {
          return res.status(400).json({ error: "Pago no autorizado para captura", status: pi.status });
        }
      } else {
        if (pi.status !== "succeeded") {
          return res.status(400).json({ error: "Pago no completado", status: pi.status });
        }
      }
    }

    // Buscar booking con múltiples fallbacks
    let booking = null;

    if (paymentIntentId) {
      booking = await models.Booking.findOne({ where: { payment_intent_id: paymentIntentId } });
    }
    if (!booking && bookingRef) {
      booking = await models.Booking.findOne({ where: { booking_ref: bookingRef } });
    }
    if (!booking && pi?.metadata?.booking_id) {
      const id = Number(pi.metadata.booking_id);
      if (Number.isFinite(id)) booking = await models.Booking.findByPk(id);
    }
    if (!booking && pi?.metadata?.bookingRef) {
      booking = await models.Booking.findOne({ where: { booking_ref: pi.metadata.bookingRef } });
    }

    if (!booking) {
      return res.status(404).json({
        error: "Booking no encontrada para los identificadores enviados",
        hint: { paymentIntentId, bookingRef, piMeta: pi?.metadata || null },
      });
    }

    // Idempotencia
    if (booking.status === "CONFIRMED") {
      return res.json({
        success: true,
        alreadyConfirmed: true,
        bookingData: {
          bookingID: booking.external_ref || booking.id,
          status: "CONFIRMED",
        },
        paymentAmount: booking.gross_price,
        currency: booking.currency,
        paymentIntentId: booking.payment_intent_id,
      });
    }

    // Capturar si es manual y está en requires_capture
    let captureResult = null;
    if (wantManualCapture && pi && pi.status === "requires_capture") {
      try {
        captureResult = await stripe.paymentIntents.capture(pi.id);
      } catch (capErr) {
        console.error("❌ Error capturando PaymentIntent:", capErr);
        return res.status(500).json({ error: capErr.message || "No se pudo capturar el pago" });
      }
    }

    // Confirmar booking local
    await booking.update({
      status: "CONFIRMED",
      payment_status: "PAID",
      booked_at: new Date(),
      meta: {
        ...(booking.meta || {}),
        confirmedAt: new Date().toISOString(),
      },
    });

    /* ─────────────────────────────────────────────────────────────
       Finalizar descuento (guardar por el código real)
    ───────────────────────────────────────────────────────────── */
    if (discount?.active) {
      try {
        const raw = (discount.code || "").toString().trim().toUpperCase();
        const vb  = discount.validatedBy || {}; // { staff_id?, user_id? }
        const isStaffCode = /^\d{4}$/.test(raw);

        const [dc, created] = await models.DiscountCode.findOrCreate({
          where: { code: raw },
          defaults: {
            code: raw,
            percentage: Number(discount.percentage || 0) || 0,
            special_discount_price:
              discount.specialDiscountPrice != null ? Number(discount.specialDiscountPrice) : null,
            default: true,
            staff_id: isStaffCode
              ? (Number.isFinite(Number(vb.staff_id)) ? Number(vb.staff_id) : null)
              : null,
            user_id : !isStaffCode
              ? (Number.isFinite(Number(vb.user_id))  ? Number(vb.user_id)  : null)
              : null,
            booking_id: booking.id,
            starts_at: null,
            ends_at: null,
            max_uses: null,
            times_used: 1,
          },
        });

        if (!created) {
          const updates = {};
          if (discount.percentage != null) updates.percentage = Number(discount.percentage) || 0;
          if (discount.specialDiscountPrice != null) {
            updates.special_discount_price = Number(discount.specialDiscountPrice);
          }
          if (!dc.booking_id) updates.booking_id = booking.id;
          if (!dc.staff_id && vb.staff_id) updates.staff_id = Number(vb.staff_id);
          if (!dc.user_id && vb.user_id)   updates.user_id  = Number(vb.user_id);

          await dc.update(updates);
          await dc.increment("times_used", { by: 1 });
        }

        if (booking.discount_code_id !== dc.id) {
          await booking.update({ discount_code_id: dc.id });
        }

        await booking.update({
          meta: {
            ...(booking.meta || {}),
            discount: {
              ...(discount || {}),
              finalizedAt: new Date().toISOString(),
              discount_code_id: (created ? dc.id : booking.discount_code_id || dc.id),
            },
          },
        });
      } catch (e) {
        console.warn("⚠️ No se pudo finalizar el descuento PARTNER:", e?.message || e);
      }
    }

    /* ─────────────────────────────────────────────────────────────
       Enviar mail con certificado PDF (sin attributes inválidos)
    ───────────────────────────────────────────────────────────── */
    try {
      // ⬇️ sin attributes para no pedir columnas inexistentes
      const fullBooking = await models.Booking.findByPk(booking.id, {
        include: [
          { model: models.User },
          { model: models.Hotel },
        ],
      });

      const u = fullBooking?.User  || null;
      const h = fullBooking?.Hotel || null;

      // Crear PDF (pdfkit)
      const { default: PDFDocument } = await import("pdfkit");
      const chunks = [];
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      doc.on("data", (c) => chunks.push(c));
      const pdfDone = new Promise((resolve) => doc.on("end", resolve));

      const hotelName = h?.name || h?.hotelName || "Hotel";
      const hotelAddress = [h?.address, h?.city, h?.country].filter(Boolean).join(", ");

      doc.fontSize(18).text("Booking Certificate", { align: "center" }).moveDown(0.5);
      doc.fontSize(12)
        .text(`Booking ID: ${booking.external_ref || booking.id}`)
        .text(`Status: ${booking.status}`)
        .text(`Date: ${new Date().toLocaleString()}`)
        .moveDown();

      doc.fontSize(14).text("Guest", { underline: true }).moveDown(0.3);
      doc.fontSize(12)
        .text(`Name:  ${booking.guest_name}`)
        .text(`Email: ${booking.guest_email}`)
        .text(`Phone: ${booking.guest_phone || "-"}`)
        .moveDown();

      doc.fontSize(14).text("Hotel", { underline: true }).moveDown(0.3);
      doc.fontSize(12)
        .text(`Name:    ${hotelName}`)
        .text(`Address: ${hotelAddress || "-"}`)
        .text(`Phone:   ${h?.phone || "-"}`)
        .moveDown();

      doc.fontSize(14).text("Stay", { underline: true }).moveDown(0.3);
      doc.fontSize(12)
        .text(`Check-in:  ${booking.check_in}`)
        .text(`Check-out: ${booking.check_out}`)
        .text(`Guests:    ${Number(booking.adults || 1)} adult(s)${Number(booking.children||0)>0 ? `, ${booking.children} child(ren)` : ""}`)
        .moveDown();

      doc.fontSize(14).text("Payment", { underline: true }).moveDown(0.3);
      doc.fontSize(12)
        .text(`Total:    ${booking.currency} ${Number(booking.gross_price).toFixed(2)}`)
        .text(`Provider: ${booking.payment_provider || "STRIPE"}`)
        .text(`Intent:   ${booking.payment_intent_id || "-"}`)
        .moveDown();

      doc.moveDown(1).fontSize(10).text("This certificate confirms your reservation.", { align: "center" });

      doc.end();
      await pdfDone;
      const pdfBuffer = Buffer.concat(chunks);

      // Enviar e-mail (nodemailer)
      const { default: nodemailer } = await import("nodemailer");
      const host   = process.env.SMTP_HOST;
      const port   = Number(process.env.SMTP_PORT || 587);
      const user   = process.env.SMTP_USER;
      const pass   = process.env.SMTP_PASS;
      const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;

      if (!host || !user || !pass) {
        console.warn("⚠️ SMTP no configurado, se omite envío de e-mail.");
      } else {
        const transporter = nodemailer.createTransport({ host, port, secure, pool: true, auth: { user, pass } });

        await transporter.sendMail({
          from   : process.env.MAIL_FROM || "no-reply@insiderbookings.com",
          to     : booking.guest_email,
          subject: `Booking confirmation • ${hotelName}`,
          html   : `
            <h2>Your booking is confirmed</h2>
            <p><b>Booking ID:</b> ${booking.external_ref || booking.id}</p>
            <p><b>Guest:</b> ${booking.guest_name} &lt;${booking.guest_email}&gt;</p>
            <p><b>Hotel:</b> ${hotelName}</p>
            <p><b>Address:</b> ${hotelAddress || "-"}</p>
            <p><b>Check-in:</b> ${booking.check_in} &nbsp;|&nbsp; <b>Check-out:</b> ${booking.check_out}</p>
            <p><b>Total:</b> ${booking.currency} ${Number(booking.gross_price).toFixed(2)}</p>
          `,
          attachments: [
            {
              filename: `BookingCertificate-${booking.external_ref || booking.id}.pdf`,
              content : pdfBuffer,
            },
          ],
        });
      }
    } catch (mailErr) {
      console.warn("⚠️ No se pudo enviar el mail de confirmación (partner):", mailErr?.message || mailErr);
    }

    return res.json({
      success: true,
      paymentIntentId: booking.payment_intent_id,
      paymentCaptured: wantManualCapture ? (captureResult?.status === "succeeded") : true,
      bookingData: {
        bookingID: booking.external_ref || booking.id,
        status: "CONFIRMED",
      },
      paymentAmount: Number(booking.gross_price),
      currency: booking.currency,
    });
  } catch (err) {
    console.error("❌ partner confirm error:", err);
    return res.status(500).json({ error: err.message });
  }
};



/* ╔══════════════════════════════════════════════════════════════════════╗
   ║  WEBHOOK (opcional)                                                  ║
   ╚══════════════════════════════════════════════════════════════════════╝ */
export const handlePartnerWebhook = async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      if (pi.metadata?.type === "partner_booking") {
        console.log("🎯 Partner payment succeeded:", pi.id, "bookingRef:", pi.metadata.bookingRef);
      }
    }
    return res.json({ received: true });
  } catch (err) {
    console.error("⚠️ Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
};
