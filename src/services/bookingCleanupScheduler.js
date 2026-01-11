import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";

const DEFAULT_TTL_MINUTES = 30;
const DEFAULT_TICK_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 200;

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

const expirePendingHomeBookings = async () => {
  const ttlMinutes = Number(process.env.HOME_BOOKING_PENDING_TTL_MINUTES || DEFAULT_TTL_MINUTES);
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
    console.log("[booking-cleanup] disabled: HOME_BOOKING_PENDING_TTL_MINUTES invalid");
    return { scanned: 0, expired: 0 };
  }

  const limit = Number(process.env.HOME_BOOKING_PENDING_SWEEP_LIMIT || DEFAULT_LIMIT);
  const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000);

  const bookings = await models.Booking.findAll({
    where: {
      inventory_type: "HOME",
      status: "PENDING",
      payment_status: { [Op.in]: ["UNPAID", "PENDING"] },
      createdAt: { [Op.lte]: cutoff },
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

        const meta =
          fresh.meta && typeof fresh.meta === "object" ? { ...fresh.meta } : {};
        meta.expired = {
          reason: "payment_timeout",
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

        await releaseHomeCalendarHold({ booking: fresh, transaction: tx });
        didExpire = true;
      });
      if (didExpire) expired += 1;
    } catch (err) {
      console.warn("[booking-cleanup] booking expire failed:", err?.message || err);
    }
  }

  return { scanned: bookings.length, expired };
};

export const startBookingCleanupScheduler = () => {
  const enabled =
    String(process.env.HOME_BOOKING_PENDING_SWEEP_ENABLED || "true").toLowerCase() === "true";
  if (!enabled) {
    console.log("[booking-cleanup] disabled by HOME_BOOKING_PENDING_SWEEP_ENABLED");
    return;
  }

  const tickMs = Number(process.env.HOME_BOOKING_PENDING_SWEEP_TICK_MS || DEFAULT_TICK_MS);
  console.log("[booking-cleanup] started", {
    ttlMinutes: Number(process.env.HOME_BOOKING_PENDING_TTL_MINUTES || DEFAULT_TTL_MINUTES),
    tickMs,
  });

  setInterval(() => {
    expirePendingHomeBookings().catch((err) => {
      console.error("[booking-cleanup] sweep error:", err?.message || err);
    });
  }, Number.isFinite(tickMs) && tickMs > 0 ? tickMs : DEFAULT_TICK_MS);

  expirePendingHomeBookings().catch((err) => {
    console.error("[booking-cleanup] initial sweep error:", err?.message || err);
  });
};

export default {
  startBookingCleanupScheduler,
};
