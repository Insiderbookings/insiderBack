// src/controllers/travelgate-payment.controller.js
import dotenv from "dotenv"
import crypto from "crypto"
import Stripe from "stripe"
import { sendBookingEmail } from "../emailTemplates/booking-email.js"
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
      captureManual, // opcional desde FE
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
          paymentType: bookingData.paymentType || null
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

    const wantManualCapture =
      captureManual === true || String(process.env.STRIPE_CAPTURE_MANUAL || "").toLowerCase() === "true"

    const paymentIntentPayload = {
      amount: Math.round(Number(amount) * 100),
      currency: currency3.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: `Hotel ${tgxHotelCode || booking_hotel_id || "N/A"} ${checkInDO}→${checkOutDO}`,
      metadata,
    }
    if (wantManualCapture) paymentIntentPayload.capture_method = "manual"

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentPayload)

    await booking.update(
      { payment_intent_id: paymentIntent.id, payment_provider: "STRIPE" },
      { transaction: tx }
    )

    await tx.commit()
    tx = null

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      bookingRef: booking_ref,
      bookingId: booking.id,
      currency: currency3,
      amount: Number(amount),
      status: "PENDING_PAYMENT",
      captureManual: wantManualCapture,
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

    // Persist TGX references & price snapshot
    const ref = tgxBooking?.reference || {};
    const price = tgxBooking?.price || {};
    const cancelPolicy = tgxBooking?.cancelPolicy || null;

    if (!ref.bookingID) {
      console.error("❌ BOOK without bookingID in reference. Cannot cancel later.");
      throw new Error("Book returned without bookingID");
    }

    await booking.update({
      status: tgxBooking?.status === "OK" ? "CONFIRMED" : "PENDING",
      payment_status: wantManualCapture ? booking.payment_status : "PAID",
      external_ref: ref.bookingID,
      booked_at: new Date(),
    });

    await booking.tgxMeta.update({
      reference_booking_id: ref.bookingID,
      reference_client:     ref.client || null,
      reference_supplier:   ref.supplier || null,
      reference_hotel:      ref.hotel || null,
      book_status:          tgxBooking?.status || null,
      price_currency:       price?.currency || null,
      price_net:            price?.net ?? null,
      price_gross:          price?.gross ?? null,
      cancellation_policy:  cancelPolicy || null,
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
              discount_code_id: dc.id,
            },
          },
        });
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
          { model: models.User },  // ⬅️ sin attributes
          { model: models.Hotel }, // ⬅️ sin attributes
        ],
      });

      const h = fullBooking?.Hotel || null;

      const tgxHotel =
        h
          ? {
              name   : h.name || h.hotelName,
              address: [h.address, h.city, h.country].filter(Boolean).join(", "),
              phone  : h.phone || "-",
            }
          : (tgxBooking?.hotel
              ? {
                  name   : tgxBooking.hotel.hotelName || tgxBooking.hotel.hotelCode || "Hotel",
                  address: [tgxBooking.hotel.city, tgxBooking.hotel.country].filter(Boolean).join(", "),
                  phone  : "-",
                }
              : { name: "Hotel", address: "", phone: "-" });

      // PDF
      const { default: PDFDocument } = await import("pdfkit");
      const chunks = [];
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      doc.on("data", (c) => chunks.push(c));
      const pdfDone = new Promise((resolve) => doc.on("end", resolve));

      doc.fontSize(18).text("Booking Certificate", { align: "center" }).moveDown(0.5);
      doc.fontSize(12)
        .text(`Booking ID: ${tgxBooking?.reference?.bookingID || booking.external_ref || booking.id}`)
        .text(`Status: ${tgxBooking?.status || booking.status}`)
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
        .text(`Name:    ${tgxHotel.name}`)
        .text(`Address: ${tgxHotel.address || "-"}`)
        .text(`Phone:   ${tgxHotel.phone || "-"}`)
        .moveDown();

      doc.fontSize(14).text("Stay", { underline: true }).moveDown(0.3);
      doc.fontSize(12)
        .text(`Check-in:  ${booking.check_in}`)
        .text(`Check-out: ${booking.check_out}`)
        .text(`Guests:    ${Number(booking.adults || 1)} adult(s)${Number(booking.children||0)>0 ? `, ${booking.children} child(ren)` : ""}`)
        .moveDown();

      const paidTotal = Number(booking.gross_price);
      doc.fontSize(14).text("Payment", { underline: true }).moveDown(0.3);
      doc.fontSize(12)
        .text(`Total:    ${booking.currency} ${paidTotal.toFixed(2)}`)
        .text(`Provider: ${booking.payment_provider || "STRIPE"}`)
        .text(`Intent:   ${booking.payment_intent_id || "-"}`)
        .moveDown();

      doc.moveDown(1).fontSize(10).text("This certificate confirms your reservation.", { align: "center" });

      doc.end();
      await pdfDone;
      const pdfBuffer = Buffer.concat(chunks);

      // Mail
      const { default: nodemailer } = await import("nodemailer");
      const host   = process.env.SMTP_HOST;
      const port   = Number(process.env.SMTP_PORT || 587);
      const user   = process.env.SMTP_USER;
      const pass   = process.env.SMTP_PASS;
      const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;

      if (!host || !user || !pass) {
        console.warn("⚠️ SMTP no configurado, se omite envío de e-mail (tgx).");
      } else {
        const transporter = nodemailer.createTransport({ host, port, secure, pool: true, auth: { user, pass } });

        await transporter.sendMail({
          from   : process.env.MAIL_FROM || "no-reply@insiderbookings.com",
          to     : booking.guest_email,
          subject: `Booking confirmation • ${tgxHotel.name}`,
          html   : `
            <h2>Your booking is confirmed</h2>
            <p><b>Booking ID:</b> ${tgxBooking?.reference?.bookingID || booking.external_ref || booking.id}</p>
            <p><b>Guest:</b> ${booking.guest_name} &lt;${booking.guest_email}&gt;</p>
            <p><b>Hotel:</b> ${tgxHotel.name}</p>
            <p><b>Address:</b> ${tgxHotel.address || "-"}</p>
            <p><b>Check-in:</b> ${booking.check_in} &nbsp;|&nbsp; <b>Check-out:</b> ${booking.check_out}</p>
            <p><b>Total:</b> ${booking.currency} ${paidTotal.toFixed(2)}</p>
          `,
          attachments: [
            {
              filename: `BookingCertificate-${tgxBooking?.reference?.bookingID || booking.external_ref || booking.id}.pdf`,
              content : pdfBuffer,
            },
          ],
        });
      }
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

    // Creamos la fila Booking local (sin Stripe). payment_provider NONE/CARD_ON_FILE
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
      optionRefId,
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
    console.log("🎯 Creating TravelgateX booking (with card, guarantee). optionRefId:", optionRefId)

    const tgxBooking = await bookTGX(input, settings)

    const ref = tgxBooking?.reference || {}
    const price = tgxBooking?.price || {}
    const cancelPolicy = tgxBooking?.cancelPolicy || null

    await booking.update({
      status: tgxBooking?.status === "OK" ? "CONFIRMED" : "PENDING",
      payment_status: "UNPAID", // seguimos sin cobrar
      external_ref: ref.bookingID || booking.external_ref,
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
      hotel: tgxBooking?.hotel ? {
        hotelCode: tgxBooking.hotel.hotelCode,
        hotelName: tgxBooking.hotel.hotelName,
        boardCode: tgxBooking.hotel.boardCode,
        start: tgxBooking.hotel.start,
        end:   tgxBooking.hotel.end,
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
