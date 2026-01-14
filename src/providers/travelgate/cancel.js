import { cancelTGX } from "./services/booking.service.js"
import models from "../../models/index.js"
import { sendCancellationEmail } from "../../emailTemplates/cancel-email.js"
import { downgradeSignupBonusOnBookingCancel } from "../../services/referralRewards.service.js"

export const cancel = async (req, res, next) => {
  console.log(req.body)
  try {
    const { bookingID, bookingRef, id } = req.body || {};
    if (!bookingID && !bookingRef && !id) {
      return res.status(400).json({ error: "bookingID, bookingRef or id is required" });
    }

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 10000,
      testMode: true,
      auditTransactions: true,
    };

    // 1) Buscar la reserva local (por id | booking_ref | external_ref)
    let bk = null;
    if (id) {
      bk = await models.Booking.findOne({
        where: { id },
        include: [{ model: models.TGXMeta, as: "tgxMeta" }],
      });
    }
    if (!bk && bookingRef) {
      bk = await models.Booking.findOne({
        where: { booking_ref: bookingRef },
        include: [{ model: models.TGXMeta, as: "tgxMeta" }],
      });
    }
    if (!bk && bookingID) {
      bk = await models.Booking.findOne({
        where: { external_ref: bookingID.trim() },
        include: [{ model: models.TGXMeta, as: "tgxMeta" }],
      });
    }
    if (!bk) {
      return res.status(404).json({ error: "Local booking not found" });
    }

    // Idempotencia
    if (bk.status === "CANCELLED") {
      return res.json({
        ok: true,
        alreadyCancelled: true,
        bookingId: bk.id,
        localStatus: bk.status,
        payment_status: bk.payment_status,
      });
    }

    // 2) Construir input FORMATO 2 para TGX
    const accessCode = bk.tgxMeta?.access_code || bk.tgxMeta?.access || process.env.TGX_DEFAULT_ACCESS || "2";
    if (!accessCode) {
      return res.status(400).json({ error: "Missing access code for cancellation" });
    }
    const hotelCode = bk.tgxMeta?.hotel_code || bk.tgxMeta?.hotel?.hotelCode || String(bk.tgxMeta?.reference_hotel || "1");
    const refSupplier = bk.tgxMeta?.reference_supplier;
    const refClient = bk.tgxMeta?.reference_client;

    if (!refSupplier || !refClient) {
      return res.status(400).json({ 
        error: "Missing supplier reference or client reference for cancellation. Cannot proceed with format 2." 
      });
    }

    const tgxInput = {
      accessCode: accessCode,
      hotelCode: hotelCode,
      reference: {
        supplier: refSupplier,
        client: refClient
      }
    };

    console.log("🎯 Cancelling with format 2:", tgxInput);

    // 3) Cancelar en TGX
    const { cancellation, warnings = [] } = await cancelTGX(tgxInput, settings);

    // 4) Actualizar local
    const newPaymentStatus = bk.payment_status === "PAID" ? "REFUNDED" : bk.payment_status;
    await bk.update({
      status: "CANCELLED",
      payment_status: newPaymentStatus,
      cancelled_at: new Date(),
      meta: {
        ...(bk.meta || {}),
        tgxCancel: {
          at: new Date().toISOString(),
          via: "api/tgx/cancel",
          warnings,
          tgxCancellation: cancellation || null,
          cancelFormat: "format2",
        },
      },
    });

    // 4.0-bis) Revertir comisión de influencer si aplica y no fue pagada
    try {
      const rows = await models.InfluencerEventCommission.findAll({ where: { stay_id: bk.id } })
      for (const row of rows) {
        if (row.status !== "paid") {
          await row.update({ status: "reversed", reversal_reason: "tgx_cancel" })
        }
      }
    } catch (e) {
      console.warn("(INF) Could not reverse influencer event commission on TGX cancel:", e?.message || e)
    }

    const wasPaid = bk.payment_status === "PAID"
    const influencerId =
      Number(bk.influencer_user_id) || Number(bk.meta?.referral?.influencerUserId) || null
    if (wasPaid && influencerId && bk.user_id) {
      try {
        await models.sequelize.transaction((tx) =>
          downgradeSignupBonusOnBookingCancel({
            influencerUserId: influencerId,
            bookingUserId: bk.user_id,
            cancelledBookingId: bk.id,
            transaction: tx,
          })
        )
      } catch (e) {
        console.warn("(INF) Could not downgrade signup bonus on TGX cancel:", e?.message || e)
      }
    }

    // 4.1) Guardar cancelReference si lo tenés en el modelo
    if (bk.tgxMeta && cancellation?.cancelReference && bk.tgxMeta.update) {
      await bk.tgxMeta.update({ cancel_reference: cancellation.cancelReference });
    }

    // 5) Email de cancelación al huésped (best-effort)
    try {
      const bookingForEmail = {
        id: bk.id,
        bookingCode: bk.booking_ref || bk.id,
        guestName: bk.guest_name,
        guests: { adults: bk.adults, children: bk.children },
        roomsCount: 1,
        checkIn: bk.check_in,
        checkOut: bk.check_out,
        hotel: { name: bk.tgxMeta?.hotel?.hotelName || bk.meta?.snapshot?.hotelName || 'Hotel' },
        currency: bk.currency || 'USD',
        totals: { total: Number(bk.gross_price || 0) },
      }
      const lang = (bk.meta?.language || process.env.DEFAULT_LANG || 'en')
      const policy = bk.tgxMeta?.cancellation_policy || null
      await sendCancellationEmail({ booking: bookingForEmail, toEmail: bk.guest_email, lang, policy, refund: {} })
    } catch (mailErr) {
      console.warn("(mail) Could not send cancellation email:", mailErr?.message || mailErr)
    }

    // 6) Responder
    return res.json({
      ok: true,
      bookingId: bk.id,
      localStatus: "CANCELLED",
      payment_status: newPaymentStatus,
      tgx: {
        status:    cancellation?.status || null,
        reference: cancellation?.reference || null,
        booking:   cancellation?.booking || null,
        warnings,
      },
    });
  } catch (err) {
    if (err?.response?.errors) {
      console.error("Cancel GraphQL errors:", JSON.stringify(err.response.errors, null, 2));
    }
    next(err);
  }
}



