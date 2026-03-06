import { Op } from "sequelize";
import Stripe from "stripe";
import models, { sequelize } from "../models/index.js";
import { finalizeBookingAfterPayment } from "../controllers/payment.controller.js";

const DEFAULT_TTL_MINUTES = 30;
const DEFAULT_LIMIT = 200;
const DEFAULT_RECONCILIATION_MIN_AGE_MINUTES = 10;
const DEFAULT_RECONCILIATION_CANCEL_AFTER_HOURS = 24;
const STRIPE_PENDING_RETRYABLE_STATUSES = new Set([
  "requires_action",
  "requires_confirmation",
  "requires_capture",
  "processing",
]);
const STRIPE_PENDING_FAILED_STATUSES = new Set([
  "requires_payment_method",
  "canceled",
]);

let stripeClient = null;
const getStripeClient = () => {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient = new Stripe(key, { apiVersion: "2022-11-15" });
  return stripeClient;
};

const enumerateStayDates = (from, to) => {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return [];
  const dates = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const limit = new Date(end);
  limit.setUTCHours(0, 0, 0, 0);
  while (cursor < limit) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const releaseHomeCalendarHold = async ({ booking, transaction }) => {
  const stayHome = await models.StayHome.findOne({
    where: { stay_id: booking.id },
    transaction,
  });
  const homeIdValue =
    stayHome?.home_id ??
    (booking.inventory_id ? Number.parseInt(booking.inventory_id, 10) : null);
  const stayDates = enumerateStayDates(booking.check_in, booking.check_out);
  if (!homeIdValue || stayDates.length === 0) return;

  const calendarEntries = await models.HomeCalendar.findAll({
    where: {
      home_id: homeIdValue,
      date: stayDates,
    },
    transaction,
  });

  for (const entry of calendarEntries) {
    const noteMatches =
      typeof entry.note === "string" &&
      entry.note.toUpperCase() === `BOOKING:${String(booking.id).toUpperCase()}`;
    if (!noteMatches) continue;
    if (entry.price_override == null) {
      await entry.destroy({ transaction });
    } else {
      await entry.update(
        {
          status: "AVAILABLE",
          note: null,
          source: entry.source === "PLATFORM" ? "PLATFORM" : entry.source,
        },
        { transaction }
      );
    }
  }
};

export const expirePendingBookings = async () => {
  const ttlMinutes = Number(process.env.HOME_BOOKING_PENDING_TTL_MINUTES || DEFAULT_TTL_MINUTES);
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
    console.log("[booking-cleanup] disabled: HOME_BOOKING_PENDING_TTL_MINUTES invalid");
    return { scanned: 0, expired: 0 };
  }

  const limit = Number(process.env.HOME_BOOKING_PENDING_SWEEP_LIMIT || DEFAULT_LIMIT);
  const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000);
  const today = new Date().toISOString().slice(0, 10);

  const bookings = await models.Booking.findAll({
    where: {
      status: "PENDING",
      payment_status: { [Op.in]: ["UNPAID", "PENDING"] },
      [Op.or]: [
        // HOME holds should expire quickly after creation to release calendar.
        {
          inventory_type: "HOME",
          createdAt: { [Op.lte]: cutoff },
        },
        // Any unpaid pending booking becomes invalid after check-in date.
        {
          check_in: { [Op.lt]: today },
        },
      ],
    },
    order: [["createdAt", "ASC"]],
    limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
  });

  let expired = 0;
  for (const booking of bookings) {
    let didExpire = false;
    try {
      await sequelize.transaction(async (tx) => {
        const fresh = await models.Booking.findByPk(booking.id, {
          transaction: tx,
          lock: tx.LOCK.UPDATE,
        });
        if (!fresh) return;
        if (String(fresh.status || "").toUpperCase() !== "PENDING") return;
        if (String(fresh.payment_status || "").toUpperCase() === "PAID") return;

        const checkInKey = String(fresh.check_in || "").slice(0, 10);
        const checkInPassed = Boolean(checkInKey) && checkInKey < today;
        const isHomeHoldTimeout =
          String(fresh.inventory_type || "").toUpperCase() === "HOME" &&
          fresh.createdAt &&
          new Date(fresh.createdAt).getTime() <= cutoff.getTime();
        if (!checkInPassed && !isHomeHoldTimeout) return;

        const meta =
          fresh.meta && typeof fresh.meta === "object" ? { ...fresh.meta } : {};
        meta.expired = {
          reason: checkInPassed ? "check_in_passed_unpaid" : "payment_timeout",
          at: new Date().toISOString(),
        };

        await fresh.update(
          {
            status: "CANCELLED",
            payment_status: "UNPAID",
            active: false,
            cancelled_at: new Date(),
            meta,
          },
          { transaction: tx }
        );

        if (String(fresh.inventory_type || "").toUpperCase() === "HOME") {
          await releaseHomeCalendarHold({ booking: fresh, transaction: tx });
        }
        didExpire = true;
      });
      if (didExpire) expired += 1;
    } catch (err) {
      console.warn("[booking-cleanup] booking expire failed:", err?.message || err);
    }
  }

  return { scanned: bookings.length, expired };
};

export const runPendingStripeReconciliationSweep = async () => {
  const stripe = getStripeClient();
  if (!stripe) {
    console.log("[booking-reconcile] disabled: STRIPE_SECRET_KEY missing");
    return {
      scanned: 0,
      checked: 0,
      confirmed: 0,
      cancelled: 0,
      keptPending: 0,
      skipped: 0,
      errors: 0,
    };
  }

  const limit = Number(process.env.STRIPE_PENDING_RECONCILIATION_LIMIT || DEFAULT_LIMIT);
  const minAgeMinutes = Number(
    process.env.STRIPE_PENDING_RECONCILIATION_MIN_AGE_MINUTES || DEFAULT_RECONCILIATION_MIN_AGE_MINUTES
  );
  const cancelAfterHours = Number(
    process.env.STRIPE_PENDING_RECONCILIATION_CANCEL_AFTER_HOURS || DEFAULT_RECONCILIATION_CANCEL_AFTER_HOURS
  );
  const minAgeCutoff = new Date(
    Date.now() -
      (Number.isFinite(minAgeMinutes) && minAgeMinutes >= 0
        ? minAgeMinutes
        : DEFAULT_RECONCILIATION_MIN_AGE_MINUTES) *
        60 *
        1000
  );
  const maxAgeHours = Number.isFinite(cancelAfterHours) && cancelAfterHours > 0
    ? cancelAfterHours
    : DEFAULT_RECONCILIATION_CANCEL_AFTER_HOURS;

  const candidates = await models.Booking.findAll({
    where: {
      status: "PENDING",
      payment_status: { [Op.in]: ["UNPAID", "PENDING"] },
      payment_intent_id: { [Op.ne]: null },
      createdAt: { [Op.lte]: minAgeCutoff },
    },
    order: [["createdAt", "ASC"]],
    limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
  });

  const stats = {
    scanned: candidates.length,
    checked: 0,
    confirmed: 0,
    cancelled: 0,
    keptPending: 0,
    skipped: 0,
    errors: 0,
  };

  for (const booking of candidates) {
    const paymentIntentId = String(booking.payment_intent_id || "").trim();
    if (!paymentIntentId) {
      stats.skipped += 1;
      continue;
    }

    let intent = null;
    let stripeStatus = "unknown";
    try {
      intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      stripeStatus = String(intent?.status || "").toLowerCase();
      stats.checked += 1;
    } catch (err) {
      const code = String(err?.code || "").toLowerCase();
      const statusCode = Number(err?.statusCode || err?.status || 0);
      if (code === "resource_missing" || statusCode === 404) {
        stripeStatus = "not_found";
      } else {
        stats.errors += 1;
        console.warn("[booking-reconcile] stripe retrieve failed:", {
          bookingId: booking.id,
          paymentIntentId,
          message: err?.message || String(err),
        });
        continue;
      }
    }

    const createdAtMs = booking.createdAt ? new Date(booking.createdAt).getTime() : Date.now();
    const ageHours = Math.max(0, (Date.now() - createdAtMs) / 36e5);
    const isSucceeded = stripeStatus === "succeeded";
    const isDefinitiveFailed = STRIPE_PENDING_FAILED_STATUSES.has(stripeStatus);
    const isRetryable = STRIPE_PENDING_RETRYABLE_STATUSES.has(stripeStatus);
    const shouldTimeoutCancel = !isSucceeded && ageHours >= maxAgeHours;

    let action = "keep_pending";
    if (isSucceeded) action = "confirm_paid";
    else if (isDefinitiveFailed || shouldTimeoutCancel) action = "cancel_unpaid";
    else if (!isRetryable && stripeStatus !== "unknown") action = "keep_pending";

    let finalAction = "none";
    try {
      await sequelize.transaction(async (tx) => {
        const fresh = await models.Booking.findByPk(booking.id, {
          transaction: tx,
          lock: tx.LOCK.UPDATE,
        });
        if (!fresh) return;
        if (String(fresh.status || "").toUpperCase() !== "PENDING") return;
        if (String(fresh.payment_status || "").toUpperCase() === "PAID") return;
        if (String(fresh.payment_intent_id || "").trim() !== paymentIntentId) return;

        const meta = fresh.meta && typeof fresh.meta === "object" ? { ...fresh.meta } : {};
        const paymentMeta =
          meta.payment && typeof meta.payment === "object" ? { ...meta.payment } : {};
        const prevReconcile =
          paymentMeta.reconciliation && typeof paymentMeta.reconciliation === "object"
            ? { ...paymentMeta.reconciliation }
            : {};
        const attempts = Number(prevReconcile.attempts || 0) + 1;
        paymentMeta.reconciliation = {
          attempts,
          lastCheckedAt: new Date().toISOString(),
          stripeStatus,
          paymentIntentId,
          by: "scheduler",
        };
        meta.payment = paymentMeta;

        if (action === "confirm_paid") {
          await fresh.update(
            {
              status: "CONFIRMED",
              payment_status: "PAID",
              payment_provider: fresh.payment_provider || "STRIPE",
              payment_intent_id: intent?.id || paymentIntentId,
              booked_at: fresh.booked_at || new Date(),
              meta,
            },
            { transaction: tx }
          );
          finalAction = "confirm_paid";
          return;
        }

        if (action === "cancel_unpaid") {
          meta.expired = {
            reason: isDefinitiveFailed
              ? "payment_reconciliation_failed"
              : "payment_reconciliation_timeout",
            stripeStatus,
            at: new Date().toISOString(),
            maxAgeHours,
          };
          await fresh.update(
            {
              status: "CANCELLED",
              payment_status: "UNPAID",
              active: false,
              cancelled_at: new Date(),
              meta,
            },
            { transaction: tx }
          );
          if (String(fresh.inventory_type || "").toUpperCase() === "HOME") {
            await releaseHomeCalendarHold({ booking: fresh, transaction: tx });
          }
          finalAction = "cancel_unpaid";
          return;
        }

        // Keep tracking pending state for observability.
        if (String(fresh.payment_status || "").toUpperCase() !== "PENDING") {
          await fresh.update({ payment_status: "PENDING", meta }, { transaction: tx });
        } else {
          await fresh.update({ meta }, { transaction: tx });
        }
        finalAction = "keep_pending";
      });

      if (finalAction === "confirm_paid") {
        stats.confirmed += 1;
        try {
          await finalizeBookingAfterPayment({ bookingId: booking.id });
        } catch (err) {
          console.warn("[booking-reconcile] finalize after payment failed:", {
            bookingId: booking.id,
            message: err?.message || String(err),
          });
        }
      } else if (finalAction === "cancel_unpaid") {
        stats.cancelled += 1;
      } else if (finalAction === "keep_pending") {
        stats.keptPending += 1;
      } else {
        stats.skipped += 1;
      }
    } catch (err) {
      stats.errors += 1;
      console.warn("[booking-reconcile] transaction failed:", {
        bookingId: booking.id,
        paymentIntentId,
        message: err?.message || String(err),
      });
    }
  }

  return stats;
};

export default {
  expirePendingBookings,
  runPendingStripeReconciliationSweep,
};
