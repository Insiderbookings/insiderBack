// src/controllers/travelgate-payment.controller.js
import dotenv from "dotenv"
import crypto from "crypto"
import Stripe from "stripe"

import models, { sequelize } from "../models/index.js"
import { bookTGX } from "../services/tgx.booking.service.js"

dotenv.config()

const { Booking, TGXMeta, TgxHotel } = models

/* ───────────────── Stripe ───────────────── */
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("🛑 Falta STRIPE_SECRET_KEY en .env")
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" })

/* ───────────────── Helpers ───────────────── */
const trim500 = (v) => (v == null ? "" : String(v).slice(0, 500))
const sha32 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 32)
const genRef = () => `IB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const isNumeric = (v) => /^\d+$/.test(String(v || ""))

const toDateOnly = (s) => {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d)) return null
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

async function generateUniqueBookingRef() {
  for (let i = 0; i < 5; i++) {
    const ref = genRef()
    const exists = await Booking.findOne({ where: { booking_ref: ref } })
    if (!exists) return ref
  }
  return `${genRef()}-${Math.random().toString(36).slice(2, 4)}`
}

/**
 * Intenta vincular el hotel TGX sólo si el modelo TgxHotel tiene la columna 'code'.
 * Si no existe esa columna (o el modelo), devuelve null para evitar romper la tx.
 */
async function ensureTGXHotel(tgxHotelCode, snapshot = {}, tx) {
  try {
    if (!TgxHotel || !tgxHotelCode) return null

    // Verifica que el modelo tenga el atributo 'code'
    const hasCode = !!TgxHotel.rawAttributes?.code
    if (!hasCode) {
      // No hay columna 'code' en el modelo → saltamos el mapping
      console.warn("(TGX) TgxHotel no tiene columna 'code'; se omite findOrCreate")
      return null
    }

    // Filtra defaults sólo a columnas existentes para evitar warnings
    const defaults = {}
    const attrs = TgxHotel.rawAttributes
    const maybeSet = (field, value) => {
      if (value != null && Object.prototype.hasOwnProperty.call(attrs, field)) {
        defaults[field] = value
      }
    }

    maybeSet("code", String(tgxHotelCode))
    maybeSet("name", snapshot.name || null)
    maybeSet("country", snapshot.country || null)
    maybeSet("city", snapshot.city || null)
    maybeSet("address", snapshot.address || null)
    maybeSet("meta", snapshot.meta || null)

    const [row] = await TgxHotel.findOrCreate({
      where: { code: String(tgxHotelCode) },
      defaults,
      transaction: tx,
    })

    return row?.id || null
  } catch (e) {
    console.warn("(TGX) ensureTGXHotel falló, se continúa sin tgx_hotel_id:", e?.message || e)
    return null
  }
}

/* ╔══════════════════════════════════════════════════════════════════════════╗
   ║  CREAR PAYMENT INTENT PARA TRAVELGATEX BOOKING                           ║
   ╚══════════════════════════════════════════════════════════════════════════╝ */
export const createTravelgatePaymentIntent = async (req, res) => {
  console.log(req.body)
  let tx
  try {
    const {
      amount,
      currency = "EUR",
      optionRefId,
      guestInfo = {},
      bookingData = {},
      user_id = null,
      discount_code_id = null,
      net_cost = null,
      source = "TGX",
    } = req.body

    if (!amount || !optionRefId || !guestInfo) {
      return res.status(400).json({ error: "amount, optionRefId, and guestInfo are required" })
    }

    const checkInDO  = toDateOnly(bookingData.checkIn)
    const checkOutDO = toDateOnly(bookingData.checkOut)
    const currency3  = String(currency || "EUR").slice(0, 3).toUpperCase()

    const tgxHotelCode = bookingData.tgxHotelCode || bookingData.hotelCode || bookingData.hotelId
    const localHotelId = bookingData.localHotelId || null

    const roomIdRaw = bookingData.roomId ?? null
    const roomIdFK  = isNumeric(roomIdRaw) ? Number(roomIdRaw) : null

    if (!checkInDO || !checkOutDO) {
      return res.status(400).json({ error: "bookingData.checkIn and bookingData.checkOut are required/valid" })
    }

    const isTGX = (source === "TGX" || bookingData.source === "TGX")
    let booking_hotel_id = null
    let booking_tgx_hotel_id = null

    tx = await sequelize.transaction()

    if (isTGX) {
      booking_tgx_hotel_id = await ensureTGXHotel(
        tgxHotelCode,
        {
          name   : bookingData.hotelName || null,
          country: bookingData.location?.country || null,
          city   : bookingData.location?.city || null,
          address: bookingData.location?.address || null,
          meta   : { tgxHotelCode, location: bookingData.location || null },
        },
        tx
      )
    } else if (localHotelId && isNumeric(localHotelId)) {
      booking_hotel_id = Number(localHotelId)
    } else if (isNumeric(bookingData.hotelId)) {
      booking_hotel_id = Number(bookingData.hotelId)
    }

    const booking_ref = await generateUniqueBookingRef()

    const booking = await Booking.create(
      {
        booking_ref,
        user_id: user_id || null,
        hotel_id: booking_hotel_id,
        tgx_hotel_id: booking_tgx_hotel_id,
        room_id: roomIdFK,
        discount_code_id: discount_code_id || null,

        source,
        external_ref: null,

        check_in: checkInDO,
        check_out: checkOutDO,
        adults: Number(bookingData.adults || 1),
        children: Number(bookingData.children || 0),

        guest_name: String(guestInfo.fullName || "").slice(0, 120),
        guest_email: String(guestInfo.email || "").slice(0, 150),
        guest_phone: String(guestInfo.phone || "").slice(0, 50),

        status: "PENDING",
        payment_status: "UNPAID",
        gross_price: Number(amount),
        net_cost: net_cost != null ? Number(net_cost) : null,
        currency: currency3,

        payment_provider: "STRIPE",
        payment_intent_id: null,

        rate_expires_at: bookingData.rateExpiresAt || null,

        meta: {
          specialRequests: guestInfo.specialRequests || "",
          origin: "tgx-payment.create-payment-intent",
          snapshot: {
            checkIn: bookingData.checkIn,
            checkOut: bookingData.checkOut,
            source,
            tgxHotelCode,
            hotelName: bookingData.hotelName || null,
            location: bookingData.location || null,
          },
          ...((bookingData.meta && typeof bookingData.meta === "object") ? bookingData.meta : {}),
        },
      },
      { transaction: tx }
    )

    await TGXMeta.create(
      {
        booking_id: booking.id,
        option_id: String(optionRefId),
        access: bookingData.access ? String(bookingData.access) : null,
        room_code: bookingData.roomCode ? String(bookingData.roomCode) : null,
        board_code: bookingData.boardCode ? String(bookingData.boardCode) : null,
        cancellation_policy: bookingData.cancellationPolicy || null,
        token: bookingData.token || null,
        meta: {
          roomIdRaw,
          tgxHotelCode,
          hotelName: bookingData.hotelName || null,
          location: bookingData.location || null,
        },
      },
      { transaction: tx }
    )

    const metadata = {
      type: "travelgate_booking",
      bookingRef: booking_ref,
      booking_id: String(booking.id),
      tgxRefHash: sha32(optionRefId),
      guestName: trim500(guestInfo.fullName),
      guestEmail: trim500(guestInfo.email),
      guestPhone: trim500(guestInfo.phone),
      checkIn: trim500(checkInDO),
      checkOut: trim500(checkOutDO),
      hotelId: trim500(booking_hotel_id ?? ""),
      tgxHotelId: trim500(booking_tgx_hotel_id ?? ""),
      tgxHotelCode: trim500(tgxHotelCode ?? ""),
      roomId: trim500(roomIdFK ?? roomIdRaw ?? ""),
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount) * 100),
      currency: currency3.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: `Hotel ${tgxHotelCode || booking_hotel_id || "N/A"} ${checkInDO}→${checkOutDO}`,
      metadata,
    })

    await booking.update(
      { payment_intent_id: paymentIntent.id, payment_provider: "STRIPE" },
      { transaction: tx }
    )

    await tx.commit()
    tx = null

    console.log("✅ Payment Intent created:", paymentIntent.id, "bookingRef:", booking_ref)

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      bookingRef: booking_ref,
      bookingId: booking.id,
      currency: currency3,
      amount: Number(amount),
      status: "PENDING_PAYMENT",
    })
  } catch (error) {
    if (tx) { try { await tx.rollback() } catch (_) {} }
    console.error("❌ Error creating payment intent:", error)
    return res.status(500).json({ error: error.message })
  }
}

/* ╔══════════════════════════════════════════════════════════════════════════╗
   ║  CONFIRMAR PAGO Y PROCESAR BOOKING CON TRAVELGATEX (SIN VCC)            ║
   ╚══════════════════════════════════════════════════════════════════════════╝ */
export const confirmPaymentAndBook = async (req, res) => {
  try {
    const { paymentIntentId, bookingRef } = req.body
    if (!paymentIntentId && !bookingRef) {
      return res.status(400).json({ error: "paymentIntentId or bookingRef is required" })
    }

    const pi = paymentIntentId ? await stripe.paymentIntents.retrieve(paymentIntentId) : null
    if (pi && pi.status !== "succeeded") {
      return res.status(400).json({ error: "Payment not completed", status: pi.status })
    }

    let booking = null
    if (paymentIntentId) {
      booking = await Booking.findOne({
        where: { payment_intent_id: paymentIntentId },
        include: [{ model: TGXMeta, as: "tgxMeta" }],
      })
    }
    if (!booking && bookingRef) {
      booking = await Booking.findOne({
        where: { booking_ref: bookingRef },
        include: [{ model: TGXMeta, as: "tgxMeta" }],
      })
    }
    if (!booking) {
      return res.status(404).json({ error: "Booking not found for provided identifiers" })
    }

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
      })
    }

    if (!booking.tgxMeta?.option_id) {
      return res.status(400).json({ error: "Missing TGX option_id to proceed with booking" })
    }

    const holderName = booking.guest_name?.split(" ")[0] || booking.guest_name || "Guest"
    const holderSurname = booking.guest_name?.split(" ").slice(1).join(" ") || "Guest"

    const paxes = [
      ...Array.from({ length: Math.max(1, Number(booking.adults || 1)) }, () => ({
        name: holderName,
        surname: holderSurname,
        age: 30,
      })),
      ...Array.from({ length: Number(booking.children || 0) }, () => ({
        name: "Child",
        surname: holderSurname,
        age: 8,
      })),
    ]

    const bookingInput = {
      optionRefId: booking.tgxMeta.option_id,
      clientReference: booking.booking_ref || `BK-${Date.now()}`,
      holder: { name: holderName, surname: holderSurname, email: booking.guest_email },
      rooms: [{ occupancyRefId: 1, paxes }],
      remarks: booking.meta?.specialRequests ? String(booking.meta.specialRequests).slice(0, 250) : "",
    }

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 60000,
      testMode: process.env.NODE_ENV !== "production",
    }

    console.log("🎯 Creating TravelgateX booking (no VCC)")
    const tgx = await bookTGX(bookingInput, settings)

    await booking.update({
      status: "CONFIRMED",
      payment_status: "PAID",
      external_ref: tgx?.bookingID || tgx?.locator || booking.external_ref,
      booked_at: new Date(),
    })

    return res.json({
      success: true,
      paymentIntentId: booking.payment_intent_id,
      bookingData: tgx,
      paymentAmount: Number(booking.gross_price),
      currency: booking.currency,
    })
  } catch (error) {
    console.error("❌ Error confirming payment and booking:", error)
    return res.status(500).json({ error: error.message })
  }
}

/* ╔══════════════════════════════════════════════════════════════════════════╗
   ║  WEBHOOK HANDLER ESPECÍFICO PARA TRAVELGATEX                             ║
   ╚══════════════════════════════════════════════════════════════════════════╝ */
export const handleTravelgateWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"]
  let event

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error("⚠️ Webhook signature failed:", err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object
    if (paymentIntent.metadata?.type === "travelgate_booking") {
      console.log("🎯 TravelgateX payment succeeded:", paymentIntent.id, "bookingRef:", paymentIntent.metadata.bookingRef)
    }
  }

  return res.json({ received: true })
}
