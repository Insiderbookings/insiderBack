// ─────────────────────────────────────────────────────────────────────────────
// src/controllers/payment.controller.js
// 100 % COMPLETO — TODAS LAS LÍNEAS, SIN OMISIONES
// Maneja pagos de Bookings y de Add-Ons (UpsellCode & BookingAddOn)
// ─────────────────────────────────────────────────────────────────────────────
import Stripe from "stripe"
import { Op } from "sequelize";
import dotenv from "dotenv"
import models, { sequelize } from "../models/index.js";
import { sendBookingEmail } from "../emailTemplates/booking-email.js";
import { sendMail } from "../helpers/mailer.js";
import { resolveVaultBranding } from "../helpers/vaultBranding.js";
import { emitAdminActivity } from "../websocket/emitter.js";
import { createThread, postMessage } from "../services/chat.service.js";
import { generateAndSaveTripIntelligence } from "../services/aiAssistant.service.js";
import {
  finalizeReferralRedemption,
  recordInfluencerEvent,
  upgradeSignupBonusOnBooking,
} from "../services/referralRewards.service.js";

dotenv.config()

/* ─────────── Validación de credenciales ─────────── */
if (!process.env.STRIPE_SECRET_KEY) throw new Error("\U0001f6d1 Falta STRIPE_SECRET_KEY en .env");
if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error("\U0001f6d1 Falta STRIPE_WEBHOOK_SECRET en .env");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

const getMinorUnit = (currency) => {
  const upper = String(currency || "USD").toUpperCase();
  if (THREE_DECIMAL_CURRENCIES.has(upper)) return 3;
  if (ZERO_DECIMAL_CURRENCIES.has(upper)) return 0;
  return 2;
};

const toMinorUnits = (amount, currency) => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;
  const unit = getMinorUnit(currency);
  return Math.round(numeric * Math.pow(10, unit));
};

const isPrivilegedUser = (user) => {
  const role = Number(user?.role);
  return role === 1 || role === 100;
};

const safeURL = (maybe, fallback) => {
  try {
    const url = new URL(maybe);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("CLIENT_URL must use https in production");
    }
    return url.toString();
  } catch {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CLIENT_URL is required and must be valid in production");
    }
    return fallback;
  }
};
const YOUR_DOMAIN = safeURL(process.env.CLIENT_URL, "http://localhost:5173")

const toUtcDay = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const diffDays = (checkIn, checkOut) => {
  const inDay = toUtcDay(checkIn);
  const outDay = toUtcDay(checkOut);
  if (inDay == null || outDay == null) return null;
  const days = Math.round((outDay - inDay) / (1000 * 60 * 60 * 24));
  return days > 0 ? days : null;
};

const ensureBookingNights = async (booking) => {
  const current = Number(booking?.nights);
  if (Number.isFinite(current) && current > 0) return current;
  const nights = diffDays(booking?.check_in, booking?.check_out);
  if (!nights) throw new Error("Invalid booking nights");
  await booking.update({ nights });
  return nights;
};
const getStayIdFromMeta = (meta = {}) =>
  Number(meta.stayId || meta.stay_id || meta.bookingId || meta.booking_id) || 0;

export const dispatchBookingConfirmation = async (booking) => {
  if (!booking) return;

  const isHome = booking.inventory_type === "HOME";
  const isHotel = !isHome; // Simplify for now, assuming HOTEL or similar

  const home = booking.homeStay?.home || null;
  const hotel = booking.hotelStay?.hotel || null;

  // Resolve Host ID
  let hostUserId = null;
  if (isHome) {
    hostUserId = booking.homeStay?.host_id || home?.host_id || booking.meta?.home?.hostId || null;
  } else {
    // For Hotels, use the Support/Bot User
    hostUserId = process.env.HOTEL_SUPPORT_USER_ID ? Number(process.env.HOTEL_SUPPORT_USER_ID) : null;
  }

  const guestUserId = booking.user_id || null;
  if (!hostUserId || !guestUserId) return;

  // Resolve Property Details
  const propertyName = isHome ? home?.title : (hotel?.name || booking.meta?.snapshot?.hotelName || "Hotel Stay");
  const propertyImage = isHome ? (home?.media?.[0]?.url || null) : (booking.meta?.snapshot?.hotelImage || null);
  const homeId = isHome ? (home?.id || booking.homeStay?.home_id || null) : null;

  // Create Thread
  const thread = await createThread({
    guestUserId,
    hostUserId,
    homeId, // Null for hotels
    reserveId: booking.id,
    checkIn: booking.check_in || null,
    checkOut: booking.check_out || null,
    homeSnapshotName: propertyName,
    homeSnapshotImage: propertyImage,
  });

  // Idempotency check
  const confirmationExists = await models.ChatMessage.findOne({
    where: {
      chat_id: thread.id,
      type: "SYSTEM",
      [Op.and]: [
        sequelize.where(
          sequelize.json("metadata.notificationType"),
          "BOOKING_CONFIRMATION"
        ),
      ],
    },
  });
  if (confirmationExists) return;

  const adultsCount = Number(booking.adults ?? 0) || 0;
  const childrenCount = Number(booking.children ?? 0) || 0;
  const infantsCount = Number(booking.infants ?? 0) || 0;
  const guestParts = [];
  if (adultsCount) guestParts.push(`${adultsCount} ${adultsCount === 1 ? "adult" : "adults"}`);
  if (childrenCount) guestParts.push(`${childrenCount} ${childrenCount === 1 ? "child" : "children"}`);
  if (infantsCount) guestParts.push(`${infantsCount} ${infantsCount === 1 ? "infant" : "infants"}`);
  const guestLine = guestParts.length ? guestParts.join(", ") : null;

  const roomName =
    booking.hotelStay?.room_name ||
    booking.hotelStay?.room?.name ||
    booking.hotelStay?.room_snapshot?.name ||
    booking.meta?.roomName ||
    null;
  const ratePlanName =
    booking.hotelStay?.rate_plan_name ||
    booking.meta?.ratePlanName ||
    null;
  const boardCode =
    booking.hotelStay?.board_code ||
    booking.meta?.boardCode ||
    null;
  const bookingRef = booking.booking_ref || booking.bookingRef || null;
  const supplierRef = booking.external_ref || booking.externalRef || null;
  const currency = booking.currency || "USD";
  const totalValue = Number(booking.gross_price ?? booking.total ?? 0);
  const totalLabel =
    Number.isFinite(totalValue) && totalValue > 0
      ? `${currency} ${totalValue.toFixed(2)}`
      : null;
  const paymentStatus = booking.payment_status || booking.paymentStatus || null;

  const detailLines = [
    propertyName ? `${isHome ? "Listing" : "Hotel"}: ${propertyName}` : null,
    booking.check_in ? `Check-in: ${booking.check_in}` : null,
    booking.check_out ? `Check-out: ${booking.check_out}` : null,
    guestLine ? `Guests: ${guestLine}` : null,
    roomName ? `Room: ${roomName}` : null,
    ratePlanName ? `Rate plan: ${ratePlanName}` : null,
    boardCode ? `Board: ${boardCode}` : null,
    totalLabel ? `Total: ${totalLabel}` : null,
    paymentStatus ? `Payment status: ${paymentStatus}` : null,
    bookingRef ? `Booking ref: ${bookingRef}` : null,
    supplierRef ? `Supplier ref: ${supplierRef}` : null,
    booking.id ? `Booking ID: ${booking.id}` : null,
  ].filter(Boolean);

  const baseMetadata = {
    notificationTitle: "Booking confirmation",
    notificationSender: "BookingGPT",
    notificationType: "BOOKING_CONFIRMATION",
    senderName: "BookingGPT",
  };

  const guestMessage = [
    "Your reservation is confirmed.",
    ...detailLines,
    "You can find all the details in your Trips tab.",
  ].join("\n");

  // For Host message (only relevant if real host, but for Bot we can log/skip or just send self-message)
  const hostMessage = [
    `${booking.guest_name || "Guest"} has booked ${isHome ? "your listing" : "a stay"}${propertyName ? ` ${propertyName}` : ""}.`,
    ...detailLines,
    isHome ? "Review the reservation details in your Host dashboard." : "System notification.",
  ].join("\n");

  const messagesToPost = [
    postMessage({
      chatId: thread.id,
      senderId: null,
      senderRole: "SYSTEM",
      type: "SYSTEM",
      body: guestMessage,
      metadata: { ...baseMetadata, audience: "GUEST" },
    }),
  ];

  // Only send HOST message if it's a Home (real host) or if we want the Bot to see it (optional)
  // The original code sent to HOST audience.
  // For Hotels, HOST audience is the Bot. It doesn't hurt to send it.
  messagesToPost.push(
    postMessage({
      chatId: thread.id,
      senderId: null,
      senderRole: "SYSTEM",
      type: "SYSTEM",
      body: hostMessage,
      metadata: { ...baseMetadata, audience: "HOST" },
    })
  );

  await Promise.allSettled(messagesToPost);
};

export const finalizeBookingAfterPayment = async ({ bookingId }) => {
  if (!bookingId) return null;
  const booking = await models.Booking.findByPk(bookingId, {
    include: [
      {
        model: models.StayHome,
        as: "homeStay",
        required: false,
        include: [
          {
            model: models.Home,
            as: "home",
            attributes: ["id", "title", "host_id"],
            include: [
              {
                model: models.HomeAddress,
                as: "address",
                attributes: ["address_line1", "city", "state", "country"],
              },
              {
                association: "media",
                attributes: ["url", "is_cover", "order"],
                required: false,
                separate: true,
                limit: 1,
                order: [
                  ["is_cover", "DESC"],
                  ["order", "ASC"],
                  ["id", "ASC"],
                ],
              },
            ],
          },
        ],
      },
      {
        model: models.StayHotel,
        as: "hotelStay",
        required: false,
        include: [
          {
            model: models.Hotel,
            as: "hotel",
            attributes: ["id", "name", "city", "country"],
          },
        ],
      },
    ],
  });
  if (!booking) return null;

  const meta =
    booking.meta && typeof booking.meta === "object" ? { ...booking.meta } : {};
  if (meta.confirmationProcessedAt) return booking;

  const influencerId = Number(booking.influencer_user_id) || null;

  let redemption = null;
  let nightsForEvent = null;
  try {
    await sequelize.transaction(async (tx) => {
      nightsForEvent = await ensureBookingNights(booking);
      redemption = await finalizeReferralRedemption(booking.id, tx);
      if (influencerId) {
        await recordInfluencerEvent({
          eventType: "booking",
          influencerUserId: influencerId,
          stayId: booking.id,
          nights: nightsForEvent,
          currency: booking.currency || "USD",
          transaction: tx,
        });
        await upgradeSignupBonusOnBooking({
          influencerUserId: influencerId,
          bookingUserId: booking.user_id,
          transaction: tx,
        });
      }
    });
  } catch (e) {
    console.warn("[payments] referral redemption finalize failed:", e?.message || e);
  }

  if (redemption) {
    const snapshot =
      booking.pricing_snapshot && typeof booking.pricing_snapshot === "object"
        ? { ...booking.pricing_snapshot }
        : {};
    if (snapshot.referralCoupon) snapshot.referralCoupon.status = redemption.status;
    if (meta.referralCoupon) meta.referralCoupon.status = redemption.status;
    await booking.update({ meta, pricing_snapshot: snapshot });
  }

  try {
    await dispatchBookingConfirmation(booking);
  } catch (err) {
    console.warn("[payments] booking confirmation notify failed:", err?.message || err);
  }

  try {
    const home = booking.homeStay?.home || null;
    const hotel = booking.hotelStay?.hotel || null;
    const stayName =
      booking.hotel_name ||
      home?.title ||
      hotel?.name ||
      booking.meta?.snapshot?.hotelName ||
      "Your Stay";
    const locationText =
      booking.location ||
      hotel?.city ||
      home?.address?.city ||
      booking.meta?.snapshot?.city ||
      "Destination";
    const city =
      hotel?.city ||
      home?.address?.city ||
      booking.meta?.snapshot?.city ||
      null;
    const country =
      hotel?.country ||
      home?.address?.country ||
      booking.meta?.snapshot?.country ||
      null;
    const amenities = hotel?.amenities || home?.amenities || [];
    const houseRules = home?.house_rules || "";
    const inventoryType =
      booking.inventory_type || (hotel ? "HOTEL" : "HOME");

    generateAndSaveTripIntelligence({
      stayId: booking.id,
      tripContext: {
        stayName,
        locationText,
        location: { city, country },
        amenities,
        houseRules,
        inventoryType,
      },
      lang: "en",
    }).catch((err) => {
      console.warn("[payments] trip intelligence failed:", err?.message || err);
    });
  } catch (err) {
    console.warn("[payments] trip intelligence failed:", err?.message || err);
  }

  try {
    const home = booking.homeStay?.home || null;
    const hotel = booking.hotelStay?.hotel || null;
    const tripContext = {
      inventoryType: booking.inventory_type || (home ? "HOME" : "HOTEL"),
      location: {
        city:
          home?.address?.city ||
          hotel?.city ||
          booking.meta?.snapshot?.city ||
          null,
        country:
          home?.address?.country ||
          hotel?.country ||
          booking.meta?.snapshot?.country ||
          null,
      },
      stayName:
        home?.title ||
        hotel?.name ||
        booking.meta?.snapshot?.hotelName ||
        "Your stay",
      amenities: home?.amenities || hotel?.amenities || [],
      houseRules: home?.house_rules || null,
      dates: {
        checkIn: booking.check_in,
        checkOut: booking.check_out,
      },
    };
    generateAndSaveTripIntelligence({
      stayId: booking.id,
      tripContext,
      lang: booking.meta?.language || "en",
    }).catch((err) => {
      console.warn("[payments] proactive AI trigger failed:", err?.message || err);
    });
  } catch (err) {
    console.warn("[payments] proactive AI trigger failed:", err?.message || err);
  }

  meta.confirmationProcessedAt = new Date().toISOString();
  await booking.update({ meta });
  return booking;
};

/* ============================================================================
   1. CREAR SESSION PARA BOOKING
============================================================================ */
export const createCheckoutSession = async (req, res) => {
  const { bookingId } = req.body;
  if (!bookingId) return res.status(400).json({ error: "bookingId es obligatorio" });

  try {
    const booking = await models.Booking.findByPk(bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    if (
      booking.user_id &&
      req.user?.id &&
      booking.user_id !== req.user.id &&
      !isPrivilegedUser(req.user)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (String(booking.status || "").toUpperCase() === "CANCELLED") {
      return res.status(400).json({ error: "Booking is cancelled" });
    }
    if (String(booking.payment_status || "").toUpperCase() === "PAID") {
      return res.status(400).json({ error: "Booking is already paid" });
    }

    const currencyUpper = String(booking.currency || "USD").toUpperCase();
    const amountMinor = toMinorUnits(booking.gross_price, currencyUpper);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      return res.status(400).json({ error: "Invalid booking amount" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: currencyUpper.toLowerCase(),
            product_data: { name: `Booking #${booking.id}` },
            unit_amount: amountMinor,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${YOUR_DOMAIN}payment/success?bookingId=${booking.id}`,
      cancel_url: `${YOUR_DOMAIN}payment/fail?bookingId=${booking.id}`,
      metadata: { bookingId: String(booking.id) },
      payment_intent_data: { metadata: { bookingId: String(booking.id) } },
    });

    await models.Booking.update({ payment_id: session.id }, { where: { id: booking.id } });
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
  const { addOnId } = req.body
  if (!addOnId) return res.status(400).json({ error: "addOnId requerido" })

  const upsell = await models.UpsellCode.findOne({
    where: { id: addOnId, status: "PENDING" },
    include: { model: models.AddOn, attributes: ["name", "price"] },
  })
  if (!upsell) return res.status(404).json({ error: "Upsell code invalid or used" })

  try {
    const amount = Math.round(Number(upsell.AddOn.price) * 100)

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: `Add-On: ${upsell.AddOn.name}` },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${YOUR_DOMAIN}payment/addon-success?codeId=${upsell.id}`,
      cancel_url: `${YOUR_DOMAIN}payment/addon-fail?codeId=${upsell.id}`,
      metadata: { upsellCodeId: upsell.id },
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
  const { bookingId } = req.body;
  if (!bookingId) return res.status(400).json({ error: "bookingId es obligatorio" });

  const booking = await models.Booking.findOne({
    where: { id: bookingId, source: "OUTSIDE" },
  });
  if (!booking) return res.status(404).json({ error: "Outside-booking not found" });

  if (
    booking.user_id &&
    req.user?.id &&
    booking.user_id !== req.user.id &&
    !isPrivilegedUser(req.user)
  ) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const addOns = await models.BookingAddOn.findAll({
      where: {
        stay_id: booking.id,
        payment_status: "unpaid",
        status: { [Op.ne]: "cancelled" },
      },
      attributes: ["quantity", "unit_price"],
    });

    const total = addOns.reduce((sum, item) => {
      const qty = Number(item.quantity) || 0;
      const unit = Number(item.unit_price) || 0;
      return sum + qty * unit;
    }, 0);

    const currencyUpper = String(booking.currency || "USD").toUpperCase();
    const amountMinor = toMinorUnits(total, currencyUpper);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      return res.status(400).json({ error: "No unpaid add-ons available" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: currencyUpper.toLowerCase(),
            product_data: { name: `Add-Ons Outside #${booking.id}` },
            unit_amount: amountMinor,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${YOUR_DOMAIN}payment/outside-addons-success?bookingId=${booking.id}`,
      cancel_url: `${YOUR_DOMAIN}payment/outside-addons-fail?bookingId=${booking.id}`,
      metadata: { outsideBookingId: String(booking.id) },
      payment_intent_data: { metadata: { outsideBookingId: String(booking.id) } },
    });

    res.json({ sessionId: session.id });
  } catch (err) {
    console.error("Stripe create outside-addons session error:", err);
    res.status(500).json({ error: err.message });
  }
};

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
    const altSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || ""
    if (altSecret) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, altSecret)
      } catch (altErr) {
        console.error("Webhook signature failed:", altErr.message)
        return res.status(400).send(`Webhook Error: ${altErr.message}`)
      }
    } else {
      console.error("Webhook signature failed:", err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }
  }

  console.log("[payments] handleWebhook:event", {
    id: event.id,
    type: event.type,
  });

  /* ─── Helpers ─── */
  const touchBookingPayment = async (bookingId, updater) => {
    if (!bookingId) {
      console.warn("[payments] touchBookingPayment:missing-bookingId");
      return null;
    }
    try {
      const booking = await models.Booking.findByPk(bookingId);
      if (!booking) {
        console.warn("[payments] touchBookingPayment:not-found", { bookingId });
        return null;
      }
      const patch =
        typeof updater === "function" ? updater(booking) : { ...updater };
      if (!patch || Object.keys(patch).length === 0) return booking;
      await booking.update(patch);
      console.log("[payments] touchBookingPayment:update", {
        bookingId,
        fields: Object.keys(patch),
      });
      return booking;
    } catch (e) {
      console.error("DB error (Booking touch):", e);
      return null;
    }
  };

  const markBookingAsPaid = async ({ bookingId, paymentId, amountMinor = null, currency = null }) => {
    console.log("[payments] markBookingAsPaid:start", {
      bookingId,
      paymentId,
      amountMinor,
      currency,
    });

    const bookingRecord = await models.Booking.findByPk(bookingId);
    if (!bookingRecord) {
      console.warn("[payments] markBookingAsPaid:not-found", { bookingId });
      return;
    }

    if (amountMinor != null && currency) {
      const expectedCurrency = String(bookingRecord.currency || "USD").toUpperCase();
      const receivedCurrency = String(currency).toUpperCase();
      if (expectedCurrency !== receivedCurrency) {
        console.warn("[payments] markBookingAsPaid:currency-mismatch", {
          bookingId,
          expectedCurrency,
          receivedCurrency,
        });
        return;
      }
      const expectedMinor = toMinorUnits(bookingRecord.gross_price, expectedCurrency);
      const receivedMinor = Number(amountMinor);
      const tolerance = Number(process.env.PAYMENT_AMOUNT_TOLERANCE_MINOR || 1);
      if (!Number.isFinite(expectedMinor) || expectedMinor <= 0) {
        console.warn("[payments] markBookingAsPaid:invalid-expected-amount", {
          bookingId,
          expectedMinor,
        });
        return;
      }
      if (!Number.isFinite(receivedMinor) || Math.abs(expectedMinor - receivedMinor) > tolerance) {
        console.warn("[payments] markBookingAsPaid:amount-mismatch", {
          bookingId,
          expectedMinor,
          receivedMinor,
          tolerance,
        });
        return;
      }
    }

    const booking = await touchBookingPayment(bookingId, (booking) => {
      const next = {
        payment_status: "PAID",
        payment_intent_id: paymentId ?? booking.payment_intent_id,
      };
      if (!booking.payment_provider || booking.payment_provider === "NONE") {
        next.payment_provider = "STRIPE";
      }
      if (booking.status !== "CONFIRMED" && booking.inventory_type !== "HOME") {
        next.status = "CONFIRMED";
      }
      return next;
    });
    if (booking) {
      if (booking.inventory_type === "HOME" && booking.status !== "CONFIRMED") {
        await booking.update({ status: "CONFIRMED" });
      }

      console.log("[payments] markBookingAsPaid:done", {
        bookingId,
        status: booking.status,
        paymentStatus: booking.payment_status,
      });

      // Emit real-time activity to Admin Dashboard
      emitAdminActivity({
        type: "booking",
        user: { name: booking.guest_name || "Guest" },
        action: "confirmed booking at",
        location: booking.meta?.hotel?.name || "Hotel",
        amount: booking.gross_price,
        status: "PAID",
        timestamp: new Date(),
      });

      try {
        await finalizeBookingAfterPayment({ bookingId: booking.id });
      } catch (err) {
        console.warn("[payments] post-payment finalize failed:", err?.message || err);
      }
    }
  };

  const markBookingPending = async ({ bookingId, paymentId }) => {
    console.log("[payments] markBookingPending:start", { bookingId, paymentId });
    const booking = await touchBookingPayment(bookingId, (booking) => {
      if (booking.payment_status === "PAID") return null;
      const next = {
        payment_status: "PENDING",
        payment_intent_id: paymentId ?? booking.payment_intent_id,
      };
      if (!booking.payment_provider || booking.payment_provider === "NONE") {
        next.payment_provider = "STRIPE";
      }
      return next;
    });
    if (booking) {
      console.log("[payments] markBookingPending:done", {
        bookingId,
        paymentStatus: booking.payment_status,
      });
    }
  };

  const markBookingPaymentFailed = async ({ bookingId }) => {
    console.log("[payments] markBookingPaymentFailed:start", { bookingId });
    const booking = await touchBookingPayment(bookingId, (booking) => {
      if (booking.payment_status === "PAID") return null;
      return { payment_status: "UNPAID" };
    });
    if (booking) {
      console.log("[payments] markBookingPaymentFailed:done", {
        bookingId,
        paymentStatus: booking.payment_status,
      });
    }
  };

  const markUpsellAsPaid = async ({ upsellCodeId, paymentId }) => {
    try {
      console.log("[payments] markUpsellAsPaid:start", { upsellCodeId, paymentId });
      await models.UpsellCode.update(
        { status: "USED", payment_id: paymentId },
        { where: { id: upsellCodeId } }
      )
      console.log("[payments] markUpsellAsPaid:done", { upsellCodeId });
    } catch (e) { console.error("DB error (UpsellCode):", e) }
  }

  const markBookingAddOnsAsPaid = async ({ bookingId }) => {
    try {
      console.log("[payments] markBookingAddOnsAsPaid:start", { bookingId });
      await models.BookingAddOn.update(
        { payment_status: "PAID" },
        { where: { stay_id: bookingId } }
      )
      console.log("[payments] markBookingAddOnsAsPaid:done", { bookingId });
    } catch (e) { console.error("DB error (BookingAddOn):", e) }
  }

  const resolveStripeAccountStatus = (account) => {
    const transfersActive = account?.capabilities?.transfers === "active";
    const payoutsEnabled = Boolean(account?.payouts_enabled);
    const chargesEnabled = Boolean(account?.charges_enabled);
    if (transfersActive && payoutsEnabled && chargesEnabled) return "VERIFIED";
    if (transfersActive) return "READY";
    if (account?.details_submitted) return "PENDING";
    return "INCOMPLETE";
  };

  const buildStripeAccountMetadata = (account) => ({
    stripe: {
      accountId: account?.id || null,
      chargesEnabled: account?.charges_enabled || false,
      payoutsEnabled: account?.payouts_enabled || false,
      detailsSubmitted: account?.details_submitted || false,
      capabilities: account?.capabilities || null,
      requirements: account?.requirements || null,
      disabledReason: account?.requirements?.disabled_reason || account?.disabled_reason || null,
      updatedAt: new Date().toISOString(),
    },
  });

  const updateStripeConnectAccount = async (stripeAccount) => {
    if (!stripeAccount?.id) return;
    try {
      const payoutAccount = await models.PayoutAccount.findOne({
        where: { provider: "STRIPE", external_customer_id: stripeAccount.id },
      });
      if (!payoutAccount) return;
      const status = resolveStripeAccountStatus(stripeAccount);
      const metadata = {
        ...(payoutAccount.metadata || {}),
        ...buildStripeAccountMetadata(stripeAccount),
      };
      await payoutAccount.update({ status, metadata });
    } catch (err) {
      console.error("[payments] updateStripeConnectAccount error:", err?.message || err);
    }
  };

  const findPayoutItemByTransfer = async (transferId) => {
    if (!transferId) return null;
    return models.PayoutItem.findOne({
      where: sequelize.where(sequelize.json("metadata.provider_payout_id"), transferId),
    });
  };

  const updatePayoutItemFromTransfer = async ({ transferId, status, failureReason, paidAt }) => {
    const item = await findPayoutItemByTransfer(transferId);
    if (!item) return;
    const patch = { status };
    if (paidAt) patch.paid_at = paidAt;
    if (failureReason) patch.failure_reason = failureReason;
    await item.update(patch);
  };

  /* ─── Procesar eventos ─── */
  if (event.type === "checkout.session.completed") {
    const s = event.data.object
    const bookingId = getStayIdFromMeta(s.metadata)
    const upsellCodeId = Number(s.metadata?.upsellCodeId) || 0
    const outsideBooking = Number(s.metadata?.outsideBookingId) || 0
    console.log("[payments] webhook checkout.session.completed", {
      sessionId: s.id,
      bookingId,
      upsellCodeId,
      outsideBooking,
    });

    if (bookingId) {
      await markBookingAsPaid({
        bookingId,
        paymentId: s.payment_intent || s.id,
        amountMinor: s.amount_total ?? null,
        currency: s.currency ?? null,
      });
    }
    if (upsellCodeId) await markUpsellAsPaid({ upsellCodeId, paymentId: s.payment_intent || s.id })
    if (outsideBooking) await markBookingAddOnsAsPaid({ bookingId: outsideBooking })
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object
    const bookingId = getStayIdFromMeta(pi.metadata)
    const upsellCodeId = Number(pi.metadata?.upsellCodeId) || 0
    const outsideBooking = Number(pi.metadata?.outsideBookingId) || 0
    const vccCardId = Number(pi.metadata?.vccCardId) || 0
    console.log("[payments] webhook payment_intent.succeeded", {
      intentId: pi.id,
      bookingId,
      upsellCodeId,
      outsideBooking,
      vccCardId,
      amount: pi.amount_received ?? pi.amount,
      currency: pi.currency,
    });

    if (bookingId) {
      await markBookingAsPaid({
        bookingId,
        paymentId: pi.id,
        amountMinor: pi.amount_received ?? pi.amount ?? null,
        currency: pi.currency ?? null,
      });
    }
    if (upsellCodeId) await markUpsellAsPaid({ upsellCodeId, paymentId: pi.id })
    if (outsideBooking) await markBookingAddOnsAsPaid({ bookingId: outsideBooking })
    if (vccCardId) {
      try {
        const card = await models.WcVCard.findByPk(vccCardId)
        if (card) {
          const prevMeta = (card.metadata && typeof card.metadata === 'object') ? card.metadata : {}
          const payment = Object.assign({}, prevMeta.payment || {}, {
            confirmed: true,
            at: new Date().toISOString(),
            method: 'stripe',
            reference: pi.id,
            amount: (pi.amount_received ?? pi.amount) ? Number((pi.amount_received ?? pi.amount) / 100) : (prevMeta.payment?.amount ?? card.amount ?? null),
            currency: (pi.currency || card.currency || 'USD').toUpperCase(),
            origin: 'operator',
          })
          // Auto-approve when payment confirmed and card was delivered
          const next = { metadata: { ...prevMeta, payment } }
          if (card.status === 'delivered') {
            next.status = 'approved'
            next.approved_at = new Date()
          }
          await card.update(next)
        }
      } catch (e) { console.error('VCC mark paid via webhook error:', e) }
    }
  }

  if (event.type === "payment_intent.amount_capturable_updated") {
    const pi = event.data.object;
    const bookingId = getStayIdFromMeta(pi.metadata);
    console.log("[payments] webhook amount_capturable_updated", {
      intentId: pi.id,
      bookingId,
      amount: pi.amount,
    });
    if (bookingId) await markBookingPending({ bookingId, paymentId: pi.id });
  }

  if (event.type === "payment_intent.canceled") {
    const pi = event.data.object;
    const bookingId = getStayIdFromMeta(pi.metadata);
    console.log("[payments] webhook payment_intent.canceled", {
      intentId: pi.id,
      bookingId,
    });
    if (bookingId) await markBookingPaymentFailed({ bookingId });
  }

  if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object;
    const bookingId = getStayIdFromMeta(pi.metadata);
    console.log("[payments] webhook payment_intent.payment_failed", {
      intentId: pi.id,
      bookingId,
    });
    if (bookingId) await markBookingPaymentFailed({ bookingId });
  }

  if (event.type === "account.updated") {
    const account = event.data.object;
    console.log("[payments] webhook account.updated", { accountId: account.id });
    await updateStripeConnectAccount(account);
  }

  if (event.type === "transfer.created") {
    const transfer = event.data.object;
    console.log("[payments] webhook transfer.created", { transferId: transfer.id });
    await updatePayoutItemFromTransfer({
      transferId: transfer.id,
      status: "PAID",
      paidAt: new Date(),
    });
  }

  if (event.type === "transfer.reversed") {
    const transfer = event.data.object;
    console.log("[payments] webhook transfer.reversed", { transferId: transfer.id });
    await updatePayoutItemFromTransfer({
      transferId: transfer.id,
      status: "FAILED",
      failureReason: "Transfer reversed",
    });
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
      domain_name: new URL(validationURL).hostname,
      validation_url: validationURL,
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
      amount: Math.round(amount * 100),
      currency,
      payment_method_data: { type: "card", card: { token } },
      confirmation_method: "automatic",
      confirm: true,
      metadata: { bookingId },
    })

    await models.Booking.update({ payment_id: intent.id }, { where: { id: bookingId } })

    if (intent.status === "succeeded") {
      await models.Booking.update(
        { status: "CONFIRMED", payment_status: "PAID" },
        { where: { id: bookingId } }
      )
    }

    res.json({
      clientSecret: intent.client_secret,
      requiresAction: intent.status !== "succeeded",
      paymentStatus: intent.status,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Apple Pay charge failed" })
  }
}

const trim500 = (v) => (v == null ? "" : String(v).slice(0, 500));
const genRef = () => `IB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const isNum = (v) => /^\d+$/.test(String(v || ""));

const toDateOnly = (s) => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d)) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
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
      source = "PARTNER",
    } = req.body;

    const normalizedSource = String(source || "PARTNER").trim().toUpperCase();
    const isVault = normalizedSource === "VAULT";
    const referral = {
      influencerId: Number(req.user?.referredByInfluencerId) || null,
      code: req.user?.referredByCode || null,
    };

    if (!amount || !guestInfo?.fullName || !guestInfo?.email) {
      return res.status(400).json({ error: "amount, guestInfo.fullName y guestInfo.email son obligatorios" });
    }

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return res.status(400).json({ error: "amount debe ser numérico y mayor a 0" });
    }

    const checkInDO = toDateOnly(bookingData.checkIn);
    const checkOutDO = toDateOnly(bookingData.checkOut);
    if (!checkInDO || !checkOutDO) {
      return res.status(400).json({ error: "bookingData.checkIn y bookingData.checkOut son obligatorios/válidos" });
    }

    const hotelIdRaw = bookingData.localHotelId ?? bookingData.hotelId;
    const roomIdRaw = bookingData.roomId ?? bookingData.localRoomId;

    if (!isVault && (!isNum(hotelIdRaw) || !isNum(roomIdRaw))) {
      return res.status(400).json({ error: "hotelId y roomId numéricos son obligatorios para PARTNER" });
    }
    const hotel_id = isNum(hotelIdRaw) ? Number(hotelIdRaw) : null;
    const room_id = isNum(roomIdRaw) ? Number(roomIdRaw) : null;

    if (!isVault && room_id != null) {
      const room = await models.Room.findOne({ where: { id: room_id, hotel_id } });
      if (!room) {
        return res.status(400).json({ error: "Room no encontrada o no pertenece al hotel indicado" });
      }
    }

    const diffMillis = new Date(`${checkOutDO}T00:00:00Z`).getTime() - new Date(`${checkInDO}T00:00:00Z`).getTime();
    const computedNights = Number.isFinite(diffMillis) ? Math.max(1, Math.round(diffMillis / 86_400_000)) : 1;
    const nightsValue = Number.isFinite(Number(bookingData.nights)) && Number(bookingData.nights) > 0
      ? Number(bookingData.nights)
      : computedNights;

    const adultsRaw = Number(bookingData.adults ?? guestInfo.adults);
    const adultsCount = Number.isFinite(adultsRaw) && adultsRaw > 0 ? adultsRaw : 1;
    const childrenRaw = Number(bookingData.children);
    const childrenCount = Number.isFinite(childrenRaw) && childrenRaw >= 0 ? childrenRaw : 0;

    const currency3 = String(currency || "USD").slice(0, 3).toUpperCase();

    tx = await sequelize.transaction();

    const booking_ref = await generateUniqueBookingRef();

    const metaBase = (bookingData.meta && typeof bookingData.meta === "object") ? { ...bookingData.meta } : {};
    const existingSnapshot = (metaBase.snapshot && typeof metaBase.snapshot === "object") ? metaBase.snapshot : {};
    const metaVaultBase = (metaBase.vault && typeof metaBase.vault === "object") ? metaBase.vault : {};

    const metaSnapshot = {
      checkIn: bookingData.checkIn,
      checkOut: bookingData.checkOut,
      source: normalizedSource,
      hotelId: hotel_id,
      roomId: room_id,
      roomName: bookingData.roomName || bookingData.roomType || metaVaultBase.roomName || null,
    };

    const tenantDomain = String(req.headers["x-tenant-domain"] || req.headers["x-tenant"] || "").trim();

    const meta = {
      ...metaBase,
      channel: metaBase.channel || (isVault ? "vaults" : metaBase.channel),
      specialRequests: guestInfo.specialRequests || metaBase.specialRequests || "",
      origin: isVault ? "vault.create-payment-intent" : "partner-payment.create-payment-intent",
      snapshot: {
        ...existingSnapshot,
        ...metaSnapshot,
      },
      ...(req.body.discount ? { discount: req.body.discount } : {}),
      ...(referral.influencerId
        ? {
          referral: {
            influencerUserId: referral.influencerId,
            code: referral.code || null,
          },
        }
        : {}),
    };
    if (Object.prototype.hasOwnProperty.call(meta, "vault")) delete meta.vault;

    if (isVault) {
      const nightlyRaw = Number(bookingData.nightlyRate ?? metaVaultBase.nightlyRate);
      const nightlyRate = Number.isFinite(nightlyRaw) && nightlyRaw > 0
        ? nightlyRaw
        : Math.round((amountNumber / nightsValue) * 100) / 100;

      meta.vault = {
        hotelName: bookingData.hotelName || bookingData.propertyName || metaVaultBase.hotelName || null,
        hotelAddress: bookingData.hotelAddress || bookingData.location || metaVaultBase.hotelAddress || null,
        roomName: bookingData.roomName || bookingData.roomType || metaVaultBase.roomName || null,
        roomDescription: bookingData.roomDescription || metaVaultBase.roomDescription || null,
        roomImage: bookingData.roomImage || metaVaultBase.roomImage || null,
        ratePlan: bookingData.ratePlan || metaVaultBase.ratePlan || null,
        nights: nightsValue,
        nightlyRate,
        currency: currency3,
        totalAmount: amountNumber,
        guests: {
          adults: adultsCount,
          children: childrenCount,
        },
        roomsCount: Number.isFinite(Number(bookingData.rooms))
          ? Number(bookingData.rooms)
          : (Number.isFinite(Number(metaVaultBase.roomsCount)) ? Number(metaVaultBase.roomsCount) : 1),
        tenantDomain: tenantDomain || metaVaultBase.tenantDomain || null,
        contact: {
          email: guestInfo.email,
          phone: guestInfo.phone || null,
          fullName: guestInfo.fullName,
        },
      };
    }

    const booking = await models.Booking.create({
      booking_ref,
      user_id,
      discount_code_id,

      source: normalizedSource,
      inventory_type: isVault ? "MANUAL_HOTEL" : "LOCAL_HOTEL",
      inventory_id: hotel_id ? `hotel:${hotel_id}` : null,
      external_ref: isVault ? booking_ref : null,

      check_in: checkInDO,
      check_out: checkOutDO,
      nights: nightsValue,
      adults: adultsCount,
      children: childrenCount,
      influencer_user_id: referral.influencerId,

      guest_name: String(guestInfo.fullName || "").slice(0, 120),
      guest_email: String(guestInfo.email || "").slice(0, 150),
      guest_phone: String(guestInfo.phone || "").slice(0, 50),

      status: "PENDING",
      payment_status: "UNPAID",
      gross_price: amountNumber,
      net_cost: net_cost != null ? Number(net_cost) : null,
      currency: currency3,
      privacy_level: bookingData.privacyLevel || "ENTIRE_PLACE",

      payment_provider: "STRIPE",
      payment_intent_id: null,

      rate_expires_at: bookingData.rateExpiresAt || null,

      meta,
      inventory_snapshot: {
        hotelId: hotel_id,
        roomId: room_id,
        hotelName: bookingData.hotelName || null,
        roomName: bookingData.roomName || bookingData.roomType || null,
        location: bookingData.location || null,
      },
      guest_snapshot: {
        name: guestInfo.fullName,
        email: guestInfo.email,
        phone: guestInfo.phone || null,
        adults: adultsCount,
        children: childrenCount,
      },
      pricing_snapshot: {
        baseAmount: amountNumber,
        netCost: net_cost != null ? Number(net_cost) : null,
        currency: currency3,
        nights: nightsValue,
        rooms: Number.isFinite(Number(bookingData.rooms)) && Number(bookingData.rooms) > 0 ? Number(bookingData.rooms) : 1,
      },
    }, { transaction: tx });

    await models.StayHotel.create({
      stay_id: booking.id,
      hotel_id,
      room_id,
      board_code: bookingData.boardCode ?? null,
      cancellation_policy: bookingData.cancellationPolicy ?? null,
      rate_plan_name: bookingData.ratePlanName ?? null,
      room_name: bookingData.roomName ?? bookingData.roomType ?? null,
      room_snapshot: bookingData.roomSnapshot ?? null,
    }, { transaction: tx });

    const wantManualCapture =
      captureManual === true ||
      String(process.env.STRIPE_CAPTURE_MANUAL || "").toLowerCase() === "true";

    const metadata = {
      type: isVault ? "vault_booking" : "partner_booking",
      source: normalizedSource,
      bookingRef: booking_ref,
      stayId: String(booking.id),
      bookingId: String(booking.id), // compat
      guestName: trim500(guestInfo.fullName),
      guestEmail: trim500(guestInfo.email),
      checkIn: trim500(checkInDO),
      checkOut: trim500(checkOutDO),
    };
    if (hotel_id) metadata.hotelId = String(hotel_id);
    if (room_id) metadata.roomId = String(room_id);

    const description = isVault
      ? `Vault booking ${booking_ref} ${checkInDO}→${checkOutDO}`
      : `Partner booking H${hotel_id ?? "NA"} R${room_id ?? "NA"} ${checkInDO}→${checkOutDO}`;

    const paymentIntentPayload = {
      amount: Math.round(amountNumber * 100),
      currency: currency3.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description,
      metadata,
    };
    if (wantManualCapture) paymentIntentPayload.capture_method = "manual";

    const pi = await stripe.paymentIntents.create(paymentIntentPayload);

    await booking.update(
      { payment_intent_id: pi.id, payment_provider: "STRIPE" },
      { transaction: tx }
    );

    await tx.commit(); tx = null;

    // Emit real-time activity to Admin Dashboard
    emitAdminActivity({
      type: 'booking',
      user: { name: guestInfo.fullName || 'Guest' },
      action: 'started a new reservation for',
      location: booking.inventory_snapshot?.hotelName || 'Property',
      amount: amountNumber,
      status: 'PENDING',
      timestamp: new Date()
    });

    return res.json({
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      bookingRef: booking_ref,
      bookingId: booking.id,
      currency: currency3,
      amount: amountNumber,
      status: "PENDING_PAYMENT",
      captureManual: wantManualCapture,
    });
  } catch (err) {
    if (tx) {
      try { await tx.rollback(); } catch (_) { }
    }
    console.error("createPaymentIntent error:", err);
    return res.status(500).json({ error: err.message });
  }
};
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
    if (!booking && pi?.metadata) {
      const id = getStayIdFromMeta(pi.metadata);
      if (Number.isFinite(id) && id > 0) {
        booking = await models.Booking.findByPk(id);
      }
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

    // Enlazar influencer si el usuario lo tenía y no fue seteado en la booking
    try {
      if (!booking.influencer_user_id && booking.user_id) {
        const bookUser = await models.User.findByPk(booking.user_id, {
          attributes: ["id", "referred_by_influencer_id", "referred_by_code"],
        });
        if (bookUser?.referred_by_influencer_id) {
          await booking.update(
            {
              influencer_user_id: bookUser.referred_by_influencer_id,
              meta: {
                ...(booking.meta || {}),
                referral: {
                  ...(booking.meta?.referral || {}),
                  influencerUserId: bookUser.referred_by_influencer_id,
                  code: bookUser.referred_by_code || booking.meta?.referral?.code || null,
                },
              },
            },
            { silent: true }
          );
        }
      }
    } catch (e) {
      console.warn("(INF) No se pudo propagar influencer a booking:", e?.message || e);
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
        const vb = discount.validatedBy || {}; // { staff_id?, user_id? }
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
            user_id: !isStaffCode
              ? (Number.isFinite(Number(vb.user_id)) ? Number(vb.user_id) : null)
              : null,
            stay_id: booking.id,
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
          if (!dc.stay_id) updates.stay_id = booking.id;
          if (!dc.staff_id && vb.staff_id) updates.staff_id = Number(vb.staff_id);
          if (!dc.user_id && vb.user_id) updates.user_id = Number(vb.user_id);

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

        // Crear comisión para influencer si el código pertenece a un usuario (no staff)
        if (dc.user_id) {
          try {
            await recordInfluencerEvent({
              eventType: "booking",
              influencerUserId: dc.user_id,
              stayId: booking.id,
              nights: await ensureBookingNights(booking),
              currency: booking.currency || "USD",
            })
            await upgradeSignupBonusOnBooking({
              influencerUserId: dc.user_id,
              bookingUserId: booking.user_id,
            })
          } catch (e) {
            console.warn("(INF) No se pudo registrar evento de influencer (PARTNER):", e?.message || e)
          }
        }
      } catch (e) {
        console.warn("⚠️ No se pudo finalizar el descuento PARTNER:", e?.message || e);
      }
    }

    // Si la reserva tiene un influencer atribuido (sin descuento), crear la comisión
    if (booking.influencer_user_id) {
      try {
        await recordInfluencerEvent({
          eventType: "booking",
          influencerUserId: booking.influencer_user_id,
          stayId: booking.id,
          nights: await ensureBookingNights(booking),
          currency: booking.currency || "USD",
        })
        await upgradeSignupBonusOnBooking({
          influencerUserId: booking.influencer_user_id,
          bookingUserId: booking.user_id,
        })
      } catch (e) {
        console.warn("(INF) No se pudo registrar evento de influencer por referral:", e?.message || e)
      }
    }

    /* ─────────────────────────────────────────────────────────────
       Enviar mail con certificado PDF (sin attributes inválidos)
    ───────────────────────────────────────────────────────────── */
    try {
      const fullBooking = await models.Booking.findByPk(booking.id, {
        include: [
          { model: models.User },
          { model: models.Hotel },
        ],
      });
      const h = fullBooking?.Hotel || {};
      const bookingMeta = fullBooking?.meta && typeof fullBooking.meta === "object" ? fullBooking.meta : {};
      const vaultMeta = bookingMeta.vault && typeof bookingMeta.vault === "object" ? bookingMeta.vault : {};
      const guestsInfo = vaultMeta.guests && typeof vaultMeta.guests === "object" ? vaultMeta.guests : {};

      const hotelName = h?.name || h?.hotelName || vaultMeta.hotelName || (bookingMeta.snapshot && typeof bookingMeta.snapshot === "object" ? bookingMeta.snapshot.hotelName : null);
      const hotelAddress = [h?.address, h?.city, h?.country].filter(Boolean).join(", ") || vaultMeta.hotelAddress || null;
      const roomsCount = booking.rooms || (Number.isFinite(Number(vaultMeta.roomsCount)) ? Number(vaultMeta.roomsCount) : 1);

      const bookingEmailPayload = {
        id: booking.id,
        bookingCode: booking.external_ref || booking.id,
        guestName: booking.guest_name,
        guests: {
          adults: booking.adults ?? (Number.isFinite(Number(guestsInfo.adults)) ? Number(guestsInfo.adults) : 1),
          children: booking.children ?? (Number.isFinite(Number(guestsInfo.children)) ? Number(guestsInfo.children) : 0),
        },
        roomsCount,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        hotel: {
          name: hotelName,
          address: hotelAddress,
          phone: h?.phone || (vaultMeta.contact && vaultMeta.contact.phone) || null,
          country: h?.country || null,
          city: h?.city || null,
        },
        currency: booking.currency,
        totals: { total: booking.gross_price },
      };

      let vaultEmailBranding = null;
      if (booking.source === "VAULT") {
        try {
          vaultEmailBranding = await resolveVaultBranding({
            tenantDomain: vaultMeta.tenantDomain || vaultMeta.publicDomain || null,
            fallbackName: hotelName,
          });
          if (vaultEmailBranding) {
            const footerIntro = vaultEmailBranding.footerIntroText || (hotelName ? `We look forward to welcoming you to ${hotelName}.` : null);
            const headerTitle = vaultEmailBranding.headerTitle || hotelName || vaultEmailBranding.brandName;
            vaultEmailBranding = {
              ...vaultEmailBranding,
              footerIntroText: footerIntro || vaultEmailBranding.footerIntroText,
              headerTitle,
            };
          }
        } catch (brandingErr) {
          console.warn("(VAULT) Branding lookup failed:", brandingErr?.message || brandingErr);
        }
      }

      await sendBookingEmail(
        bookingEmailPayload,
        booking.guest_email,
        vaultEmailBranding ? { branding: vaultEmailBranding } : undefined
      );

      if (booking.source === "VAULT") {
        try {
          const notifyTo = process.env.VAULT_BOOKINGS_NOTIFY || "insiderbookings@insiderbookings.com";
          if (notifyTo) {
            const guestPhone = (vaultMeta.contact && vaultMeta.contact.phone) || booking.guest_phone || null;
            const contactLine = [booking.guest_email, guestPhone].filter(Boolean).join(" · ");
            const ms = (() => {
              try {
                return new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime();
              } catch (_) {
                return NaN;
              }
            })();
            const computedNights = Number.isFinite(ms) ? Math.max(1, Math.round(ms / 86_400_000)) : null;
            const nightsValue = Number.isFinite(Number(vaultMeta.nights)) ? Number(vaultMeta.nights) : computedNights;
            const nightsFragment = nightsValue ? ` (${nightsValue} noche${nightsValue === 1 ? "" : "s"})` : "";
            const amountTotal = Number(booking.gross_price ?? vaultMeta.totalAmount ?? 0);
            const amountDisplay = Number.isFinite(amountTotal) ? amountTotal.toFixed(2) : "0.00";
            const tenantDomain = vaultMeta.tenantDomain || null;
            const safe = (value) => (value == null || value === "" ? "-" : String(value));
            const subject = `[Vault] Nueva reserva ${booking.external_ref || booking.id}`;
            const html = `
              <h2 style="margin:0 0 12px;color:#0f172a;">Nueva reserva Vault confirmada</h2>
              <p style="margin:0 0 16px;color:#334155;">Se confirmó una nueva reserva originada en Vault.</p>
              <table style="border-collapse:collapse;width:100%;max-width:560px;font-size:14px;">
                <tbody>
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Booking</td><td style="padding:8px;border:1px solid #e2e8f0;">${safe(booking.external_ref || booking.id)}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Huésped</td><td style="padding:8px;border:1px solid #e2e8f0;">${safe(booking.guest_name)}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Contacto</td><td style="padding:8px;border:1px solid #e2e8f0;">${safe(contactLine)}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Fechas</td><td style="padding:8px;border:1px solid #e2e8f0;">${safe(booking.check_in)} → ${safe(booking.check_out)}${nightsFragment}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Habitación</td><td style="padding:8px;border:1px solid #e2e8f0;">${safe(vaultMeta.roomName)}${vaultMeta.ratePlan ? ` · ${safe(vaultMeta.ratePlan)}` : ""}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Hotel</td><td style="padding:8px;border:1px solid #e2e8f0;">${safe(hotelName)}${hotelAddress ? `<br>${safe(hotelAddress)}` : ""}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Importe</td><td style="padding:8px;border:1px solid #e2e8f0;">${booking.currency} ${amountDisplay}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Stripe Intent</td><td style="padding:8px;border:1px solid #e2e8f0;">${safe(booking.payment_intent_id)}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Tenant</td><td style="padding:8px;border:1px solid #e2e8f0;">${safe(tenantDomain)}</td></tr>
                </tbody>
              </table>
            `;
            await sendMail({ to: notifyTo, subject, html });
          }
        } catch (notifyErr) {
          console.warn("⚠️ No se pudo notificar la reserva Vault:", notifyErr?.message || notifyErr);
        }
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

/* ============================================================================
   3. HOME BOOKINGS - PAYMENT INTENT
============================================================================ */
export const createHomePaymentIntent = async (req, res) => {
  try {
    const { bookingId, captureMode } = req.body || {};
    const userId = Number(req.user?.id ?? 0);
    console.log("[payments] createHomePaymentIntent:start", {
      bookingId,
      userId,
      captureMode,
    });

    if (!bookingId) return res.status(400).json({ error: "bookingId is required" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const booking = await models.Booking.findOne({
      where: { id: bookingId },
      include: [{ model: models.StayHome, as: "homeStay" }],
    });

    if (!booking || String(booking.inventory_type).toUpperCase() !== "HOME") {
      console.warn("[payments] createHomePaymentIntent:not-found-or-invalid", {
        bookingId,
        found: Boolean(booking),
        inventoryType: booking?.inventory_type,
      });
      return res.status(404).json({ error: "Home booking not found" });
    }

    console.log("[payments] createHomePaymentIntent:booking", {
      bookingId: booking.id,
      status: booking.status,
      paymentStatus: booking.payment_status,
      grossPrice: booking.gross_price,
      currency: booking.currency,
    });

    if (booking.user_id && booking.user_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (String(booking.status).toUpperCase() === "CANCELLED") {
      return res.status(400).json({ error: "Booking is cancelled" });
    }

    if (String(booking.payment_status).toUpperCase() === "PAID") {
      return res.status(400).json({ error: "Booking is already paid" });
    }

    const amountNumber = Number(booking.gross_price ?? 0);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return res.status(400).json({ error: "Invalid booking amount" });
    }

    const currencyCode = String(booking.currency || "USD").trim().toUpperCase();
    const stripeCurrency = currencyCode.toLowerCase();
    const amountCents = Math.round(amountNumber * 100);

    const pricingSnapshot =
      booking.pricing_snapshot && typeof booking.pricing_snapshot === "object"
        ? booking.pricing_snapshot
        : {};
    const securityDepositRaw =
      booking.homeStay?.security_deposit ?? pricingSnapshot.securityDeposit ?? 0;
    const securityDeposit =
      Number.parseFloat(Number(securityDepositRaw ?? 0).toFixed(2)) || 0;
    const depositCents = securityDeposit > 0 ? Math.round(securityDeposit * 100) : 0;

    const captureMethod =
      captureMode === "manual"
        ? "manual"
        : depositCents > 0
          ? "manual"
          : "automatic";

    const metadata = {
      type: "home_booking",
      stayId: String(booking.id),
      bookingId: String(booking.id),
      bookingRef: booking.booking_ref || "",
      userId: booking.user_id ? String(booking.user_id) : "",
      homeId:
        booking.homeStay?.home_id != null ? String(booking.homeStay.home_id) : "",
      checkIn: booking.check_in || "",
      checkOut: booking.check_out || "",
      guestName: trim500(booking.guest_name || ""),
      guestEmail: trim500(booking.guest_email || ""),
      securityDeposit: depositCents ? securityDeposit.toFixed(2) : "0.00",
      captureMethod,
    };
    if (!metadata.userId) delete metadata.userId;
    if (!metadata.homeId) delete metadata.homeId;

    let paymentIntent = null;
    let reusedIntent = false;

    if (booking.payment_intent_id) {
      try {
        paymentIntent = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
      } catch (retrieveErr) {
        console.warn(
          "createHomePaymentIntent: unable to retrieve existing intent:",
          retrieveErr?.message || retrieveErr
        );
      }
    }

    if (paymentIntent) {
      if (paymentIntent.status === "succeeded") {
        await booking.update({
          payment_provider: "STRIPE",
          payment_status: "PAID",
          payment_intent_id: paymentIntent.id,
        });
        return res.json({
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          amount: amountNumber,
          amountCents,
          currency: currencyCode,
          depositAmount: securityDeposit,
          captureMethod: paymentIntent.capture_method,
          status: paymentIntent.status,
          paymentStatus: "PAID",
          reused: true,
        });
      }

      if (paymentIntent.status === "canceled") {
        paymentIntent = null;
      } else {
        const amountMismatch = paymentIntent.amount !== amountCents;
        const currencyMismatch = paymentIntent.currency !== stripeCurrency;
        const captureMismatch = paymentIntent.capture_method !== captureMethod;

        if (currencyMismatch || captureMismatch) {
          try {
            await stripe.paymentIntents.cancel(paymentIntent.id);
          } catch (cancelErr) {
            console.warn(
              "createHomePaymentIntent: unable to cancel mismatched intent:",
              cancelErr?.message || cancelErr
            );
          }
          paymentIntent = null;
        } else if (amountMismatch) {
          try {
            paymentIntent = await stripe.paymentIntents.update(paymentIntent.id, {
              amount: amountCents,
              metadata,
            });
            reusedIntent = true;
          } catch (updateErr) {
            console.warn(
              "createHomePaymentIntent: unable to update intent amount:",
              updateErr?.message || updateErr
            );
            try {
              await stripe.paymentIntents.cancel(paymentIntent.id);
            } catch (cancelErr) {
              console.warn(
                "createHomePaymentIntent: cancel after failed update:",
                cancelErr?.message || cancelErr
              );
            }
            paymentIntent = null;
          }
        } else {
          try {
            paymentIntent = await stripe.paymentIntents.update(paymentIntent.id, {
              metadata,
            });
            reusedIntent = true;
          } catch (metaErr) {
            console.warn(
              "createHomePaymentIntent: unable to refresh intent metadata:",
              metaErr?.message || metaErr
            );
          }
        }
      }
    }

    if (!paymentIntent) {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: stripeCurrency,
        capture_method: captureMethod,
        automatic_payment_methods: { enabled: true },
        metadata,
        description: `Home booking ${booking.booking_ref || booking.id}`,
        receipt_email: booking.guest_email || undefined,
      });
    }

    const nextStripeStatus = paymentIntent.status;
    let nextPaymentStatus = booking.payment_status;
    if (nextStripeStatus === "succeeded") {
      nextPaymentStatus = "PAID";
    } else if (nextStripeStatus === "requires_payment_method") {
      nextPaymentStatus = "UNPAID";
    } else if (booking.payment_status !== "PAID") {
      nextPaymentStatus = "PENDING";
    }

    const nextMeta =
      booking.meta && typeof booking.meta === "object" ? { ...booking.meta } : {};
    nextMeta.payment = {
      ...(typeof nextMeta.payment === "object" ? nextMeta.payment : {}),
      provider: "stripe",
      strategy: captureMethod,
      amount: Number(amountNumber.toFixed(2)),
      currency: currencyCode,
      securityDeposit,
      intentId: paymentIntent.id,
      intentStatus: paymentIntent.status,
      lastUpdatedAt: new Date().toISOString(),
    };

    const updates = {
      payment_provider: "STRIPE",
      payment_intent_id: paymentIntent.id,
      meta: nextMeta,
    };
    if (booking.payment_status !== nextPaymentStatus) {
      updates.payment_status = nextPaymentStatus;
    }
    await booking.update(updates);

    const responsePayload = {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: amountNumber,
      amountCents,
      currency: currencyCode,
      depositAmount: securityDeposit,
      captureMethod: paymentIntent.capture_method,
      status: paymentIntent.status,
      paymentStatus: updates.payment_status ?? booking.payment_status,
      reused: reusedIntent,
    };
    console.log("[payments] createHomePaymentIntent:response", {
      bookingId: booking.id,
      intentId: paymentIntent.id,
      stripeStatus: paymentIntent.status,
      paymentStatus: responsePayload.paymentStatus,
      reused: reusedIntent,
    });
    return res.json(responsePayload);
  } catch (error) {
    console.error("createHomePaymentIntent error:", error);
    return res.status(500).json({ error: "Unable to create home payment intent" });
  }
};
