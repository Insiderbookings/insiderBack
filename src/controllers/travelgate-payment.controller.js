// src/controllers/travelgate-payment.controller.js
import dotenv from "dotenv"
import crypto from "crypto"
import Stripe from "stripe"
import { sendBookingEmail } from "../emailTemplates/booking-email.js"
import sendMagicLink from "../services/sendMagicLink.js"
import models, { sequelize } from "../models/index.js"
import { bookTGX, quoteTGX } from "../providers/travelgate/services/booking.service.js"
import { normalizeTGXBookingID } from "../utils/normalizeBookingId.tgx.js"
import { getMarkup } from "../utils/markup.js"

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

/**
 * Merge vault meta/channel into a base meta object using optional X-Tenant-Domain header.
 * Non-breaking: if header is missing or tenant not found, it simply returns baseMeta.
 */
async function enrichVaultMeta(req, baseMeta = {}) {
  try {
    const out = { ...(baseMeta || {}) }
    const existingVault = (out.vaultMeta && typeof out.vaultMeta === 'object') ? out.vaultMeta : {}
    const host = String(req.headers['x-tenant-domain'] || req.query?.host || '').trim().toLowerCase()

    if (host) {
      // Resolve tenant by panel_domain first, then public_domain
      let t = await models.WcTenant.findOne({ where: { panel_domain: host } })
      if (!t) t = await models.WcTenant.findOne({ where: { public_domain: host } })
      if (t) {
        out.vaultMeta = {
          ...existingVault,
          tenantId: t.id,
          publicDomain: t.public_domain,
          panelDomain: t.panel_domain,
        }
        if (!out.channel) out.channel = 'vaults'
      }
    }

    return out
  } catch (_) {
    return baseMeta || {}
  }
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

const moneyRound = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

const getRoleFromReq = (req) => {
  const sources = {
    query: req.query?.user_role,
    header: req.headers["x-user-role"],
    userRole: req.user?.role,
    userRoleId: req.user?.role_id,
  }
  const raw =
    sources.query ??
    sources.header ??
    sources.userRole ??
    sources.userRoleId
  const n = Number(raw)
  // ⬇️ default guest (0) en vez de 1
  return Number.isFinite(n) ? n : 0
  return Number.isFinite(n) ? n : 0
}

const applyMarkup = (amount, pct) => {
  const n = Number(amount)
  if (!Number.isFinite(n)) return null
  return moneyRound(n * (1 + pct))
}

/* ╔══════════════════════════════════════════════════════════════════════════╗
   ║  CREAR PAYMENT INTENT PARA TRAVELGATEX BOOKING                           ║
   ╚══════════════════════════════════════════════════════════════════════════╝ */
/* ╔══════════════════════════════════════════════════════════════════════════╗
   ║  CREAR PAYMENT INTENT PARA TRAVELGATEX BOOKING  (con DEBUG detallado)    ║
   ╚══════════════════════════════════════════════════════════════════════════╝ */
export const createTravelgatePaymentIntent = async (req, res) => {
  // ── helpers de debug ──────────────────────────────────────────────────────
  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const TAG = `[tgx-payment][createPI][${reqId}]`
  const dbg  = (...a) => console.log(TAG, ...a)
  const warn = (...a) => console.warn(TAG, ...a)
  const err  = (...a) => console.error(TAG, ...a)
  const preview = (s, n = 80) =>
    typeof s === "string" ? `${s.slice(0, n)}${s.length > n ? "…": ""}` : s

  // 🔒 Opción A: NO mutar req.body al sanitizar (copia independiente de guestInfo)
  const safeBody = (() => {
    const gi = { ...(req.body?.guestInfo || {}) } // copia separada
    if (gi.email) gi.email = "[redacted]"
    if (gi.phone) gi.phone = "[redacted]"

    const b = {
      ...(req.body || {}),
      guestInfo: gi, // no comparte referencia con req.body.guestInfo
    }

    if (b.rateKey) b.rateKey = preview(b.rateKey, 80)
    if (b.optionRefId) b.optionRefId = preview(b.optionRefId, 80)
    if (b.searchOptionRefId) b.searchOptionRefId = preview(b.searchOptionRefId, 80)
    if (b.quoteOptionRefId) b.quoteOptionRefId = preview(b.quoteOptionRefId, 80)
    return b
  })()

  dbg("⇢ Incoming request body (sanitized):", safeBody)
  dbg("⇢ Headers (role hints):", {
    "x-user-role": req.headers["x-user-role"],
    "query.user_role": req.query?.user_role,
  })
  dbg("Sanity email (should be real, not redacted):", req.body?.guestInfo?.email)

  // helper para responder 400 con más contexto (incluye reqId)
  const badReq = (code, payload = {}) => {
    const out = { error: code, reqId, ...payload }
    warn("↩️ 400:", out)
    return res.status(400).json(out)
  }

  let tx
  try {
    const {
      amount, // optional: if absent, server computes expected amount
      currency = "EUR",
      guestInfo = {},
      bookingData = {},
      user_id = null,
      discount_code_id = null,
      // optional: discount object validated by /api/discounts/validate
      // shape: { active: true, code, percentage?, specialDiscountPrice?, validatedBy? }
      discount = null,
      source = "TGX",
      captureManual, // opcional desde FE
    } = req.body

    // ✅ Normalizar: aceptamos varios alias de option id
    const idRaw =
      req.body.searchOptionRefId ||
      req.body.optionRefId ||
      req.body.quoteOptionRefId ||
      req.body.rateKey ||
      null

    if (!idRaw || !guestInfo) {
      return badReq("MISSING_PARAMS", {
        message:
          "searchOptionRefId (or optionRefId, quoteOptionRefId, rateKey), and guestInfo are required",
        debug: {
          hasAnyOptionId: Boolean(idRaw),
          hasGuestInfo: Boolean(guestInfo),
        },
      })
    }

    const searchOptionRefId = idRaw
    dbg("✓ Using option id:", preview(searchOptionRefId, 120))

    const checkInDO  = toDateOnly?.(bookingData.checkIn)  || toDateOnly?.(new Date(bookingData.checkIn))  || null
    const checkOutDO = toDateOnly?.(bookingData.checkOut) || toDateOnly?.(new Date(bookingData.checkOut)) || null
    const currency3  = String(currency || "EUR").slice(0, 3).toUpperCase()

    const tgxHotelCode = bookingData.tgxHotelCode || bookingData.hotelCode || bookingData.hotelId
    const localHotelId = bookingData.localHotelId || null

    const roomIdRaw = bookingData.roomId ?? null
    const roomIdFK  = isNumeric(roomIdRaw) ? Number(roomIdRaw) : null

    dbg("⇢ Booking snapshot:", {
      checkIn: bookingData.checkIn,
      checkOut: bookingData.checkOut,
      checkInDO, checkOutDO, currency3,
      tgxHotelCode, localHotelId, roomIdRaw, roomIdFK,
      sourceFE: source, paymentType: bookingData.paymentType,
    })

    if (!checkInDO || !checkOutDO) {
      return badReq("INVALID_DATES", {
        message: "bookingData.checkIn and bookingData.checkOut are required/valid",
        debug: { checkIn: bookingData.checkIn, checkOut: bookingData.checkOut }
      })
    }


    // Guest email double-entry check (if FE provided emailConfirm)
    if (
      guestInfo?.emailConfirm &&
      String(guestInfo.emailConfirm).trim().toLowerCase() !== String(guestInfo.email || '').trim().toLowerCase()
    ) {
      return badReq("EMAIL_MISMATCH", { message: "Emails do not match" })
    }

    // Resolve or create user by guest email (associate booking to account)
    let resolvedUserId = user_id || null
    const normalizedEmail = (guestInfo?.email || '').trim().toLowerCase()
    if (!resolvedUserId && normalizedEmail) {
      try {
        const existing = await models.User.findOne({ where: { email: normalizedEmail } })
        if (existing) {
          resolvedUserId = existing.id
        } else {
          const displayName = String(guestInfo?.fullName || normalizedEmail).slice(0, 100)
          const created = await models.User.create({
            name : displayName,
            email: normalizedEmail,
            phone: guestInfo?.phone || null,
            role : 0,
          })
          resolvedUserId = created.id
          try { await sendMagicLink(created) } catch (e) { console.warn("Failed to send magic link:", e?.message || e) }
        }
      } catch (e) {
        console.warn("User resolve/create failed:", e?.message || e)
      }
    }

    // ── Rol / Markup ────────────────────────────────────────────────────────
    const roleNum = getRoleFromReq?.(req)


    // ── Settings para TGX y Quote ───────────────────────────────────────────
    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 60000,
      testMode: process.env.NODE_ENV !== "production",
    }
    dbg("⇢ Quote settings:", settings)

    // ── Quote a TGX ─────────────────────────────────────────────────────────
    let quote
    try {
      console.time(`${TAG} quoteTGX`)
      quote = await quoteTGX(searchOptionRefId, settings)
      console.timeEnd(`${TAG} quoteTGX`)
    } catch (e) {
      const msg = String(e?.message || e || "")
      if (msg.toLowerCase().includes("search optionid expected")) {
        return badReq("WRONG_OPTION_ID_TYPE", {
          message: "Expected SEARCH optionRefId (from search), not QUOTE optionRefId.",
          tip: "Guardá el optionRefId que te devuelve la búsqueda y usalo acá. El de la QUOTE no sirve para volver a cotizar.",
          debug: { receivedIdSample: preview(searchOptionRefId, 80) }
        })
      }
      err("❌ Quote error:", e)
      return badReq("QUOTE_FAILED", { message: "Could not verify price", detail: msg })
    }

    const quoteOptionRefId = quote?.optionRefId
    const netRaw = quote?.price?.net
    dbg("✓ Quote result (mini):", {
      optionRefId: preview(quoteOptionRefId, 80),
      price: { net: netRaw, currency: quote?.price?.currency, tax: quote?.price?.tax }
    })

    if (!quoteOptionRefId) {
      return badReq("QUOTE_WITHOUT_OPTION_ID", { message: "Invalid quote without optionRefId" })
    }

    const verifiedNet = moneyRound(Number(netRaw))
    if (!Number.isFinite(verifiedNet)) {
      return badReq("INVALID_NET_FROM_SUPPLIER", { message: "Invalid net price from supplier", debug: { net: netRaw } })
    }

    const rolePct = getMarkup(roleNum, verifiedNet)
    const computedGross   = applyMarkup(verifiedNet, rolePct)
    const requestedAmountRaw = amount != null ? Number(amount) : NaN
    const requestedAmount = Number.isFinite(requestedAmountRaw) && requestedAmountRaw > 0
      ? moneyRound(requestedAmountRaw)
      : null

    // If a discount is present, compute expected amount with discount
    let expectedToCharge = computedGross
    if (discount && discount.active === true) {
      const pct = Number(discount.percentage)
      const sp  = discount.specialDiscountPrice != null ? Number(discount.specialDiscountPrice) : null

      if (Number.isFinite(sp) && sp > 0) {
        // Special fixed final price (major units)
        expectedToCharge = moneyRound(sp)
      } else if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
        // Percentage discount over public price (computedGross)
        expectedToCharge = moneyRound(computedGross * (1 - pct / 100))
      }
    }

    const delta           = requestedAmount != null ? Math.abs(expectedToCharge - requestedAmount) : 0

    // Tabla rápida para la cabeza:
    console.table({
      [`${TAG} PRICE_CHECK`]: "values",
      verifiedNet,
      rolePct,
      computedGross,
      ...(discount ? { discountPct: Number(discount.percentage) || null, specialDiscountPrice: discount.specialDiscountPrice ?? null } : {}),
      expectedToCharge,
      requestedAmount,
      delta
    })

    // If client sent amount, validate it; otherwise, proceed using expectedToCharge
    if (requestedAmount != null) {
      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
        return badReq("INVALID_REQUESTED_AMOUNT", { message: "Amount must be a positive number", debug: { amount } })
      }
      // estrictos pero con d=0.01 para redondeo
      if (delta > 0.01) {
        return badReq("AMOUNT_MISMATCH", {
          message: "Amount mismatch with current price",
          debug: {
            expected: expectedToCharge,
            received: requestedAmount,
            net: verifiedNet,
            roleNum,
            rolePct,
            discount: discount || null,
            delta
          }
        })
      }
    }

    const finalAmount  = expectedToCharge
    const finalNetCost = verifiedNet
    dbg("✓ Final amounts:", { finalAmount, finalNetCost, currency3 })

    const isTGX = (source === "TGX" || bookingData.source === "TGX")
    let booking_hotel_id = null
    let booking_tgx_hotel_id = null

    tx = await sequelize.transaction()
    dbg("⇢ Opened SQL transaction")

    if (isTGX) {
      dbg("⇢ ensureTGXHotel for", { tgxHotelCode })
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
    dbg("⇢ Creating Booking:", {
      booking_ref, booking_hotel_id, booking_tgx_hotel_id, roomIdFK,
      checkInDO, checkOutDO, currency3, finalAmount, finalNetCost
    })

    const booking = await Booking.create(
      {
        booking_ref,
        user_id: resolvedUserId || null,
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
        gross_price: finalAmount,
        net_cost: finalNetCost,
        currency: currency3,

        payment_provider: "STRIPE",
        payment_intent_id: null,

        rate_expires_at: bookingData.rateExpiresAt || null,

        meta: await enrichVaultMeta(req, {
          specialRequests: guestInfo.specialRequests || "",
          origin: "tgx-payment.create-payment-intent",
          snapshot: {
            checkIn: bookingData.checkIn,
            CheckOut: bookingData.checkOut,
            source,
            tgxHotelCode,
            hotelName: bookingData.hotelName || null,
            location: bookingData.location || null,
          },
          ...((bookingData.meta && typeof bookingData.meta === "object") ? bookingData.meta : {}),
          ...(discount ? { discount } : {}),
        }),
      },
      { transaction: tx }
    )

    dbg("✓ Booking created:", { id: booking.id, booking_ref })

    await TGXMeta.create(
      {
        stay_id: booking.id,
        option_id: String(quoteOptionRefId),
        access: bookingData.access ? String(bookingData.access) : null,
        access_code: bookingData.access || null,
        room_code: bookingData.roomCode ? String(bookingData.roomCode) : null,
        board_code: bookingData.boardCode ? String(bookingData.boardCode) : null,
        cancellation_policy: bookingData.cancellationPolicy || null,
        token: bookingData.token || null,
        meta: {
          roomIdRaw,
          tgxHotelCode,
          hotelName: bookingData.hotelName || null,
          location: bookingData.location || null,
          paymentType: bookingData.paymentType || null,
          searchOptionRefId, // guardamos lo que realmente usamos
        },
      },
      { transaction: tx }
    )
    dbg("✓ TGXMeta created for booking", { stay_id: booking.id })

    const metadata = {
      type: "travelgate_booking",
      bookingRef: booking_ref,
      stayId: String(booking.id),
      bookingId: String(booking.id),
      tgxRefHash: sha32(quoteOptionRefId),
      guestName: trim500(guestInfo.fullName),
      guestEmail: trim500(guestInfo.email),
      guestPhone: trim500(guestInfo.phone),
      checkIn: trim500(checkInDO),
      CheckOut: trim500(checkOutDO),
      hotelId: trim500(booking_hotel_id ?? ""),
      tgxHotelId: trim500(booking_tgx_hotel_id ?? ""),
      tgxHotelCode: trim500(tgxHotelCode ?? ""),
      roomId: trim500(roomIdFK ?? roomIdRaw ?? ""),
    }

    const wantManualCapture =
      captureManual === true || String(process.env.STRIPE_CAPTURE_MANUAL || "").toLowerCase() === "true"

    const paymentIntentPayload = {
      amount: Math.round(finalAmount * 100),
      currency: currency3.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: `Hotel ${tgxHotelCode || booking_hotel_id || "N/A"} ${checkInDO}→${checkOutDO}`,
      metadata,
    }
    if (wantManualCapture) paymentIntentPayload.capture_method = "manual"

    dbg("⇢ Creating Stripe PI with payload:", paymentIntentPayload)

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentPayload)

    dbg("✓ Stripe PI created:", {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      capture_method: paymentIntent.capture_method,
    })

    await booking.update(
      { payment_intent_id: paymentIntent.id, payment_provider: "STRIPE" },
      { transaction: tx }
    )
    dbg("✓ Booking updated with PI:", { stay_id: booking.id, payment_intent_id: paymentIntent.id })

    await tx.commit()
    dbg("✓ Transaction committed")

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      bookingRef: booking_ref,
      bookingId: booking.id,
      currency: currency3,
      amount: finalAmount,
      status: "PENDING_PAYMENT",
      captureManual: wantManualCapture,
      reqId,
    })
  } catch (error) {
    if (tx) { try { await tx.rollback(); warn("↩️ Transaction rolled back due to error") } catch (_) {} }
    err("❌ Error creating payment intent:", error)
    return res.status(500).json({ error: error.message, reqId })
  }
}




/* ╔══════════════════════════════════════════════════════════════════════════╗
   ║  CONFIRMAR PAGO Y PROCESAR BOOKING CON TRAVELGATEX (SIN VCC)            ║
   ╚══════════════════════════════════════════════════════════════════════════╝ */
export const confirmPaymentAndBook = async (req, res) => {
  try {
    const { paymentIntentId, bookingRef, captureManual, discount } = req.body;
    if (!paymentIntentId && !bookingRef) {
      return res.status(400).json({ error: "paymentIntentId or bookingRef is required" });
    }

    const wantManualCapture =
      captureManual === true ||
      String(process.env.STRIPE_CAPTURE_MANUAL || "").toLowerCase() === "true";

    // Retrieve PI if provided
    const pi = paymentIntentId ? await stripe.paymentIntents.retrieve(paymentIntentId) : null;

    // Validate PI status for chosen capture flow
    if (pi) {
      if (wantManualCapture) {
        if (!["requires_capture", "succeeded"].includes(pi.status)) {
          return res.status(400).json({ error: "Payment not authorized for capture", status: pi.status });
        }
      } else {
        if (pi.status !== "succeeded") {
          return res.status(400).json({ error: "Payment not completed", status: pi.status });
        }
      }
    }

    // Find booking by PI or internal ref (traer TGX meta)
    let booking = null;
    if (paymentIntentId) {
      booking = await models.Booking.findOne({
        where: { payment_intent_id: paymentIntentId },
        include: [{ model: models.TGXMeta, as: "tgxMeta" }],
      });
    }
    if (!booking && bookingRef) {
      booking = await models.Booking.findOne({
        where: { booking_ref: bookingRef },
        include: [{ model: models.TGXMeta, as: "tgxMeta" }],
      });
    }
    if (!booking) {
      return res.status(404).json({ error: "Booking not found for provided identifiers" });
    }

    // Attach booking to existing/auto-created user by email if not linked yet
    try {
      if (!booking.user_id && booking.guest_email) {
        const normalizedEmail = String(booking.guest_email).trim().toLowerCase()
        let user = await models.User.findOne({ where: { email: normalizedEmail } })
        if (!user) {
          const displayName = String(booking.guest_name || normalizedEmail).slice(0, 100)
          user = await models.User.create({ name: displayName, email: normalizedEmail, phone: booking.guest_phone || null, role: 0 })
          try { await sendMagicLink(user) } catch (e) { console.warn("Failed to send magic link:", e?.message || e) }
        }
        if (user && user.id) {
          await booking.update({ user_id: user.id })
        }
      }
    } catch (e) {
      console.warn("Booking user attach failed:", e?.message || e)
    }

    // Idempotency
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

    // Need TGX option to book
    if (!booking.tgxMeta?.option_id) {
      return res.status(400).json({ error: "Missing TGX option_id to proceed with booking" });
    }

    // Holder & paxes
    const holderName = booking.guest_name?.split(" ")[0] || booking.guest_name || "Guest";
    const holderSurname = booking.guest_name?.split(" ").slice(1).join(" ") || "Guest";

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
    ];

    // TGX booking input
    const bookingInput = {
      optionRefId: booking.tgxMeta.option_id,
      clientReference: booking.booking_ref || `BK-${Date.now()}`,
      holder: { name: holderName, surname: holderSurname },
      rooms: [{ occupancyRefId: 1, paxes }],
      remarks: booking.meta?.specialRequests
        ? `${String(booking.meta.specialRequests).slice(0, 240)}`
        : "",
    };
    if (booking.guest_email) {
      bookingInput.remarks = bookingInput.remarks
        ? `${bookingInput.remarks}\nGuest email: ${booking.guest_email}`
        : `Guest email: ${booking.guest_email}`;
    }

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 60000,
      testMode: process.env.NODE_ENV !== "production",
      auditTransactions: true,
    };

    // Book en TGX
    let tgxBooking;
    try {
      tgxBooking = await bookTGX(bookingInput, settings);
    } catch (bookErr) {
      // Si TGX booking falla y la captura es manual, cancelo el PI autorizado
      if (wantManualCapture && pi && pi.status === "requires_capture") {
        try {
          await stripe.paymentIntents.cancel(pi.id, { cancellation_reason: "failed_booking" });
        } catch (cancelErr) {
          console.warn("⚠️ Could not cancel PaymentIntent after book failure:", cancelErr?.message || cancelErr);
        }
      }
      throw bookErr;
    }

    console.log(tgxBooking, "log de booking tgx");

    // Persist TGX references & price snapshot
    const ref = tgxBooking?.reference || {};
    const price = tgxBooking?.price || {};
    const cancelPolicy = tgxBooking?.cancelPolicy || null;

    if (!ref.bookingID) {
      console.error("❌ BOOK without bookingID in reference. Cannot cancel later.");
      throw new Error("Book returned without bookingID");
    }

    // ⬇️ Normalizamos el bookingID de TGX antes de persistir
    const normalizedRefId = normalizeTGXBookingID(ref.bookingID);

    await booking.update({
      status: tgxBooking?.status === "OK" ? "CONFIRMED" : "PENDING",
      payment_status: wantManualCapture ? booking.payment_status : "PAID",
      external_ref: normalizedRefId, // ⬅️ normalizado
      booked_at: new Date(),
    });

    await booking.tgxMeta.update({
      reference_booking_id: normalizedRefId,            // ⬅️ normalizado
      reference_client:     ref.client || null,
      reference_supplier:   ref.supplier || null,
      reference_hotel:      ref.hotel || null,
      book_status:          tgxBooking?.status || null,
      price_currency:       price?.currency || null,
      price_net:            price?.net ?? null,
      price_gross:          price?.gross ?? null,
      cancellation_policy:  cancelPolicy || null,
      // Mantener el access_code previo si existe (no lo sobrescribimos)
      access_code:          booking.tgxMeta?.access_code ?? null,
      hotel: tgxBooking?.hotel ? {
        hotelCode:   tgxBooking.hotel.hotelCode,
        hotelName:   tgxBooking.hotel.hotelName,
        boardCode:   tgxBooking.hotel.boardCode,
        start:       tgxBooking.hotel.start,
        end:         tgxBooking.hotel.end,
        bookingDate: tgxBooking.hotel.bookingDate || null,
      } : null,
      rooms: tgxBooking?.hotel?.rooms || null,
    });

    // Capture (manual flow)
    let captureResult = null;
    if (wantManualCapture && pi && pi.status === "requires_capture") {
      try {
        captureResult = await stripe.paymentIntents.capture(pi.id);
        await booking.update({ payment_status: "PAID" });
      } catch (capErr) {
        console.error("❌ Error capturing payment after Book OK:", capErr);
      }
    }

    /* ─────────────────────────────────────────────────────────────
       Finalize discount usage AFTER booking success
    ───────────────────────────────────────────────────────────── */
    if (discount?.active) {
      try {
        const raw = (discount.code || "").toString().trim().toUpperCase();
        const vb  = discount.validatedBy || {};
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
              discount_code_id: dc.id,
            },
          },
        });

        // Crear comisión para influencer si el código pertenece a un usuario (no staff)
        if (dc.user_id) {
          try {
            const rateEnv = Number(process.env.INFLUENCER_COMMISSION_PCT)
            const ratePct = Number.isFinite(rateEnv) && rateEnv > 0 ? rateEnv : 15
            // Cap en USD, convertir a moneda de la reserva si hay tasa disponible
            const capUsdEnv  = Number(process.env.INFLUENCER_COMMISSION_CAP_USD)
            const capUsd     = Number.isFinite(capUsdEnv) && capUsdEnv > 0 ? capUsdEnv : 5
            let capAmt = capUsd
            try {
              const ratesStr = process.env.FX_USD_RATES || '{}'
              const rates = JSON.parse(ratesStr)
              const r = Number(rates[(booking.currency || 'USD').toUpperCase()])
              if (Number.isFinite(r) && r > 0) capAmt = capUsd * r
            } catch {}
            const holdDaysEnv = Number(process.env.INFLUENCER_HOLD_DAYS)
            const holdDays = Number.isFinite(holdDaysEnv) && holdDaysEnv >= 0 ? holdDaysEnv : 3

            const gross = Number(booking.gross_price || 0)
            const net   = booking.net_cost != null ? Number(booking.net_cost) : null
            const markup = net != null ? Math.max(0, gross - Number(net)) : null
            const base   = markup != null ? markup : gross
            const baseType = markup != null ? "markup" : "gross"

            const rawCommission = base * (ratePct / 100)
            const commissionAmount = moneyRound(Math.min(rawCommission, capAmt))
            const currency = booking.currency || "EUR"

            // hold_until = check_out + holdDays (solo si INFLUENCER_USE_HOLD=true)
            let holdUntil = null
            try {
              const co = booking.check_out ? new Date(booking.check_out) : null
              if (co && !isNaN(co)) {
                co.setDate(co.getDate() + holdDays)
                holdUntil = co
              }
            } catch {}
            const useHold = String(process.env.INFLUENCER_USE_HOLD || '').toLowerCase() === 'true'

            await models.InfluencerCommission.findOrCreate({
              where: { stay_id: booking.id },
              defaults: {
                influencer_user_id: dc.user_id,
                stay_id: booking.id,
                discount_code_id: dc.id,
                commission_base: baseType,
                commission_rate_pct: ratePct,
                commission_amount: commissionAmount,
                commission_currency: currency,
                status: useHold && holdUntil ? "hold" : "eligible",
                hold_until: holdUntil,
              },
            })
          } catch (e) {
            console.warn("(INF) No se pudo crear InfluencerCommission:", e?.message || e)
          }
        }
      } catch (e) {
        console.warn("⚠️ No se pudo finalizar el descuento TGX:", e?.message || e);
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

        const h = fullBooking?.Hotel || null;
        const metaLoc = fullBooking?.meta?.location || {};

        const tgxHotel = h
          ? {
              name   : h.name || h.hotelName,
              address: h.address || [h.city, h.country].filter(Boolean).join(", "),
              city   : h.city || metaLoc.city || undefined,
              country: h.country || metaLoc.country || undefined,
              phone  : h.phone || metaLoc.phone || "-",
            }
          : {
              name   : (tgxBooking?.hotel?.hotelName) || metaLoc.name || "Hotel",
              address: metaLoc.address || [metaLoc.city, metaLoc.country].filter(Boolean).join(", ") || "",
              city   : metaLoc.city || undefined,
              country: metaLoc.country || undefined,
              phone  : metaLoc.phone || "-",
            };

        await sendBookingEmail(
          {
            id: booking.id,
            // Show our internal booking reference (short) instead of long supplier id
            bookingCode: booking.booking_ref || booking.id,
            guestName: booking.guest_name,
            guests: { adults: booking.adults, children: booking.children },
            roomsCount: booking.rooms || 1,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            hotel: tgxHotel,
            country: tgxHotel.country || undefined,
            currency: booking.currency,
            totals: { total: booking.gross_price },
          },
          booking.guest_email
        );
      } catch (mailErr) {
        console.warn("⚠️ No se pudo enviar el mail de confirmación (tgx):", mailErr?.message || mailErr);
      }

    return res.json({
      success: true,
      paymentIntentId: booking.payment_intent_id,
      paymentCaptured: wantManualCapture ? (captureResult?.status === "succeeded") : true,
      bookingData: tgxBooking,
      paymentAmount: Number(booking.gross_price),
      currency: booking.currency,
    });
  } catch (error) {
    console.error("❌ Error confirming payment and booking:", error);
    return res.status(500).json({ error: error.message });
  }
};


/* ╔══════════════════════════════════════════════════════════════════════════╗
   ║  BOOKING TGX EN MODELOS DIRECT/CARD_*  (ENVÍA TARJETA AL PROVEEDOR)     ║
   ╚══════════════════════════════════════════════════════════════════════════╝ */
/**
 * POST /api/tgx-payment/book-with-card
 * Body esperado (ejemplo):
 * {
 *   "optionRefId": "...",
 *   "guestInfo": { "fullName": "...", "email": "...", "phone": "..." },
 *   "bookingData": { checkIn, checkOut, adults, children, tgxHotelCode, ... },
 *   "paymentType": "DIRECT" | "CARD_CHECK_IN" | "CARD_BOOKING",
 *   "paymentCard": {
 *      "type": "VI|MC|AX|... (TGX type)",
 *      "holder": { "name": "John", "surname": "Doe" },
 *      "number": "4111111111111111",
 *      "CVC": "123",
 *      "expire": { "month": 9, "year": 2028 },
 *      "isVCC": false,
 *      "virtualCreditCard": { ... opcional ... },
 *      "threeDomainSecurity": { ... opcional ... }
 *   }
 * }
 *
 * Nota: NO se persiste PAN/CVC. Se valida mínimamente y se envía directo a TGX.
 */
export const bookWithCard = async (req, res) => {

  console.log("aqui")
  let tx
  try {
    const {
      optionRefId,
      guestInfo = {},
      bookingData = {},
      paymentType = "DIRECT",
      paymentCard = {},
      user_id = null,
      discount_code_id = null,
      source = "TGX",
      net_cost = null,
      amount = null,      // opcional: si quieres guardar un precio estimado (no se cobra aquí)
      currency = "EUR",   // idem
    } = req.body

    if (!optionRefId) return res.status(400).json({ error: "optionRefId is required" })
    if (guestInfo?.emailConfirm && String(guestInfo.emailConfirm).trim().toLowerCase() !== String(guestInfo.email || "").trim().toLowerCase()) {
      return res.status(400).json({ error: "Emails do not match" })
    }
    if (!paymentCard?.number || !paymentCard?.CVC || !paymentCard?.expire?.month || !paymentCard?.expire?.year) {
      return res.status(400).json({ error: "Incomplete paymentCard data" })
    }

    const checkInDO  = toDateOnly(bookingData.checkIn)
    const checkOutDO = toDateOnly(bookingData.checkOut)
    if (!checkInDO || !checkOutDO) {
      return res.status(400).json({ error: "bookingData.checkIn and bookingData.checkOut are required/valid" })
    }

    const currency3 = String(currency || "EUR").slice(0, 3).toUpperCase()
    const tgxHotelCode = bookingData.tgxHotelCode || bookingData.hotelCode || bookingData.hotelId
    const localHotelId = bookingData.localHotelId || null
    const roomIdRaw = bookingData.roomId ?? null
    const roomIdFK  = isNumeric(roomIdRaw) ? Number(roomIdRaw) : null

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

    // Resolve or create user by guest email (associate booking to account)
    let resolvedUserId = user_id || null
    try {
      const normalizedEmail = String(guestInfo?.email || "").trim().toLowerCase()
      if (!resolvedUserId && normalizedEmail) {
        let user = await models.User.findOne({ where: { email: normalizedEmail } })
        if (!user) {
          const displayName = String(guestInfo?.fullName || normalizedEmail).slice(0, 100)
          user = await models.User.create({ name: displayName, email: normalizedEmail, phone: guestInfo?.phone || null, role: 0 })
          try { await sendMagicLink(user) } catch (e) { console.warn("Failed to send magic link:", e?.message || e) }
        }
        if (user) resolvedUserId = user.id
      }
    } catch (e) { console.warn("User resolve/create failed:", e?.message || e) }

    // Creamos la fila Booking local (sin Stripe). payment_provider NONE/CARD_ON_FILE
    const booking_ref = await generateUniqueBookingRef()
    const booking = await Booking.create(
      {
        booking_ref,
        user_id: resolvedUserId || null,
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
        payment_status: "UNPAID", // garantía: no cobramos ahora
        gross_price: amount != null ? Number(amount) : null,
        net_cost: net_cost != null ? Number(net_cost) : null,
        currency: currency3,

        payment_provider: "CARD_ON_FILE",
        payment_intent_id: null,

        rate_expires_at: bookingData.rateExpiresAt || null,

        meta: {
          specialRequests: guestInfo.specialRequests || "",
          origin: "tgx-payment.book-with-card",
          snapshot: {
            checkIn: bookingData.checkIn,
            checkOut: bookingData.checkOut,
            source,
            tgxHotelCode,
            hotelName: bookingData.hotelName || null,
            location: bookingData.location || null,
            paymentType,
          },
          // 🚫 No guardamos PAN/CVC
          ...((bookingData.meta && typeof bookingData.meta === "object") ? bookingData.meta : {}),
        },
      },
      { transaction: tx }
    )

    // Enrich meta with vault tenant info if header present (non-breaking)
    try {
      await booking.update({ meta: await enrichVaultMeta(req, booking.meta) }, { transaction: tx })
    } catch (_) {}

    const tgxMeta = await TGXMeta.create(
      {
        stay_id: booking.id,
        option_id: String(optionRefId),
        access: bookingData.access ? String(bookingData.access) : null,
        access_code: bookingData.access || null,
        room_code: bookingData.roomCode ? String(bookingData.roomCode) : null,
        board_code: bookingData.boardCode ? String(bookingData.boardCode) : null,
        cancellation_policy: bookingData.cancellationPolicy || null,
        token: bookingData.token || null,
        meta: {
          roomIdRaw,
          tgxHotelCode,
          hotelName: bookingData.hotelName || null,
          location: bookingData.location || null,
          paymentType: paymentType || null
        },
      },
      { transaction: tx }
    )

    // Armado de holder/paxes y remarks
    const holderName = (guestInfo.fullName || "Guest").split(" ")[0]
    const holderSurname = (guestInfo.fullName || "Guest").split(" ").slice(1).join(" ") || "Guest"
    const paxes = [
      ...Array.from({ length: Math.max(1, Number(booking.adults || bookingData.adults || 1)) }, () => ({
        name: holderName,
        surname: holderSurname,
        age: 30,
      })),
      ...Array.from({ length: Number(booking.children || bookingData.children || 0) }, () => ({
        name: "Child",
        surname: holderSurname,
        age: 8,
      })),
    ]

    const input = {
      optionRefId: tgxMeta.option_id,
      clientReference: booking.booking_ref,
      holder: { name: holderName, surname: holderSurname }, // email en remarks
      rooms: [{ occupancyRefId: 1, paxes }],
      remarks: guestInfo.specialRequests ? String(guestInfo.specialRequests).slice(0, 240) : "",
      // **Clave:** adjuntamos la tarjeta para garantía/posible cobro por el proveedor
      paymentCard: {
        type: paymentCard.type, // VI/MC/AX... (según doc TGX)
        holder: {
          name: paymentCard.holder?.name || holderName,
          surname: paymentCard.holder?.surname || holderSurname,
        },
        number: String(paymentCard.number),
        CVC: String(paymentCard.CVC),
        expire: {
          month: Number(paymentCard.expire?.month),
          year: Number(paymentCard.expire?.year),
        },
        ...(paymentCard.isVCC != null ? { isVCC: Boolean(paymentCard.isVCC) } : {}),
        ...(paymentCard.virtualCreditCard ? { virtualCreditCard: paymentCard.virtualCreditCard } : {}),
        ...(paymentCard.threeDomainSecurity ? { threeDomainSecurity: paymentCard.threeDomainSecurity } : {}),
      },
    }

    if (guestInfo.email) {
      input.remarks = input.remarks
        ? `${input.remarks}\nGuest email: ${guestInfo.email}`
        : `Guest email: ${guestInfo.email}`
    }

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 60000,
      testMode: process.env.NODE_ENV !== "production",
      auditTransactions: true,
    }

    // ⚠️ Nunca loguees PAN/CVC
    console.log("🎯 Creating TravelgateX booking (with card, guarantee). optionRefId:", tgxMeta.option_id)

    const tgxBooking = await bookTGX(input, settings)

    const ref = tgxBooking?.reference || {}
    const price = tgxBooking?.price || {}
    const cancelPolicy = tgxBooking?.cancelPolicy || null

    await booking.update({
      status: tgxBooking?.status === "OK" ? "CONFIRMED" : "PENDING",
      payment_status: "UNPAID", // seguimos sin cobrar
      external_ref: ref.bookingID ? normalizeTGXBookingID(ref.bookingID) : booking.external_ref, // ⬅️ normalizado
      booked_at: new Date(),
    }, { transaction: tx })

    await booking.reload({ include: [{ model: TGXMeta, as: "tgxMeta" }], transaction: tx })

    await booking.tgxMeta.update({
      reference_client:   ref.client || null,
      reference_supplier: ref.supplier || null,
      reference_hotel:    ref.hotel || null,
      book_status:        tgxBooking?.status || null,
      price_currency:     price?.currency || null,
      price_net:          price?.net ?? null,
      price_gross:        price?.gross ?? null,
      cancellation_policy: cancelPolicy || null,
      access_code:        bookingData.access || booking.tgxMeta.access_code || null,
      hotel: tgxBooking?.hotel ? {
        hotelCode: tgxBooking.hotel.hotelCode,
        hotelName: tgxBooking.hotel.hotelName,
        boardCode: tgxBooking.hotel.boardCode,
        start:     tgxBooking.hotel.start,
        end:       tgxBooking.hotel.end,
        bookingDate: tgxBooking.hotel.bookingDate || null,
      } : null,
      rooms: tgxBooking?.hotel?.rooms || null,
    }, { transaction: tx })

    await tx.commit()
    tx = null

    // Respuesta
    return res.json({
      success: true,
      bookingRef: booking.booking_ref,
      bookingId: booking.id,
      bookingData: tgxBooking,
      paymentType,
      paymentAmount: 0, // no cobramos aquí
      currency: currency3,
    })
  } catch (error) {
    if (tx) { try { await tx.rollback() } catch (_) {} }
    console.error("❌ Error in book-with-card:", error)
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



