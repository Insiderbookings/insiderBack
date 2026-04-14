import { Op } from "sequelize";
import models from "../models/index.js";
import { sendPushToUser } from "./pushNotifications.service.js";
import { getCoverImage } from "../utils/homeMapper.js";
import { resolvePartnerProfileFromClaim } from "./partnerCatalog.service.js";

const REVIEW_WINDOW_DAYS = Number(process.env.REVIEW_WINDOW_DAYS || 30);
const REMINDER_CHANNEL = "PUSH";
const REMINDER_BASE_HOUR = Number(process.env.REVIEW_REMINDER_BASE_HOUR || 12);
const REMINDER_BASE_MINUTE = Number(process.env.REVIEW_REMINDER_BASE_MINUTE || 30);
const REMINDER_QUIET_HOUR_START = Number(process.env.REVIEW_REMINDER_QUIET_HOUR_START || 9);
const REMINDER_QUIET_HOUR_END = Number(process.env.REVIEW_REMINDER_QUIET_HOUR_END || 21);
const REVIEW_STATUS_PUBLISHED = "PUBLISHED";

const ALLOWED_GUEST_STATUSES = new Set(["CONFIRMED", "COMPLETED"]);
const HOME_INVENTORY_TYPE = "HOME";
const HOTEL_INVENTORY_TYPES = new Set(["WEBBEDS_HOTEL", "LOCAL_HOTEL", "MANUAL_HOTEL"]);
const FALLBACK_TIMEZONE = "UTC";

const toInventoryType = (value) => String(value || "").trim().toUpperCase();
const isHomeInventory = (value) => toInventoryType(value) === HOME_INVENTORY_TYPE;
const isHotelInventory = (value) => HOTEL_INVENTORY_TYPES.has(toInventoryType(value));

const toInventoryIdString = (value) => {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const parseDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const dateOnly = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(dateOnly.getTime()) ? null : dateOnly;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isDateReached = (value, now = new Date()) => {
  const date = parseDateValue(value);
  if (!date) return false;
  return now >= date;
};

const isWithinReviewWindow = (referenceDate, now = new Date()) => {
  if (REVIEW_WINDOW_DAYS <= 0) return true;
  const checkOutDate = parseDateValue(referenceDate);
  if (!checkOutDate) return true;
  const limit = new Date(checkOutDate);
  limit.setDate(limit.getDate() + REVIEW_WINDOW_DAYS);
  return now <= limit;
};

const isUniqueConstraintError = (error) =>
  String(error?.name || "").toLowerCase().includes("uniqueconstraint");

const normalizeTimeZone = (value) => {
  const candidate = String(value || "").trim();
  if (!candidate) return null;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return null;
  }
};

const getLocalHour = (date, timeZone) => {
  const normalized = normalizeTimeZone(timeZone) || FALLBACK_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalized,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hourPart = parts.find((part) => part.type === "hour");
  const hour = Number(hourPart?.value);
  return Number.isFinite(hour) ? hour : null;
};

const isWithinQuietHours = (date, timeZone) => {
  const hour = getLocalHour(date, timeZone);
  if (!Number.isFinite(hour)) return true;
  return hour >= REMINDER_QUIET_HOUR_START && hour < REMINDER_QUIET_HOUR_END;
};

const buildReminderSchedule = (checkOutDate) => {
  const parsedCheckOut = parseDateValue(checkOutDate);
  if (!parsedCheckOut) return [];

  const base = new Date(parsedCheckOut.getTime());
  base.setUTCHours(REMINDER_BASE_HOUR, REMINDER_BASE_MINUTE, 0, 0);
  const slots = [
    { key: "checkout_plus_30m", dueAt: base },
    { key: "checkout_plus_24h", dueAt: new Date(base.getTime() + 24 * 60 * 60 * 1000) },
    { key: "checkout_plus_72h", dueAt: new Date(base.getTime() + 72 * 60 * 60 * 1000) },
  ];

  if (REVIEW_WINDOW_DAYS > 3) {
    const finalSlot = new Date(base.getTime() + (REVIEW_WINDOW_DAYS * 24 - 72) * 60 * 60 * 1000);
    const hasEquivalent = slots.some((slot) => Math.abs(slot.dueAt.getTime() - finalSlot.getTime()) < 60 * 60 * 1000);
    if (!hasEquivalent) {
      slots.push({ key: "window_close_minus_72h", dueAt: finalSlot });
    }
  }

  return slots;
};

const resolveHomeSummary = (booking) => {
  const home = booking?.homeStay?.home || {};
  const homeTitle =
    home?.title ||
    booking?.inventory_snapshot?.title ||
    (booking?.homeStay?.home_id ? `Home #${booking.homeStay.home_id}` : "your stay");
  return {
    title: homeTitle,
    city: home?.address?.city ?? null,
    country: home?.address?.country ?? null,
    image: getCoverImage(home) ?? null,
  };
};

const resolveHotelSummary = (booking) => {
  const snapshotHotel = booking?.inventory_snapshot?.hotel || {};
  const stayHotel = booking?.hotelStay || {};
  const localHotel = stayHotel?.hotel || {};
  const webbedsHotel = stayHotel?.webbedsHotel || {};
  const title =
    snapshotHotel?.name ||
    booking?.inventory_snapshot?.hotelName ||
    localHotel?.name ||
    webbedsHotel?.name ||
    booking?.hotel_name ||
    "your hotel stay";
  return {
    title,
    city:
      snapshotHotel?.city ||
      booking?.inventory_snapshot?.city ||
      localHotel?.city ||
      webbedsHotel?.city_name ||
      null,
    country:
      snapshotHotel?.country ||
      booking?.inventory_snapshot?.country ||
      localHotel?.country ||
      webbedsHotel?.country_name ||
      null,
    image:
      snapshotHotel?.image ||
      snapshotHotel?.coverImage ||
      booking?.inventory_snapshot?.hotelImage ||
      localHotel?.image ||
      null,
    inventoryId:
      toInventoryIdString(booking?.inventory_id) ||
      toInventoryIdString(stayHotel?.webbeds_hotel_id) ||
      toInventoryIdString(stayHotel?.hotel_id),
  };
};

const resolveReviewTimeZone = (booking) =>
  normalizeTimeZone(
    booking?.meta?.reviewTimezone ||
      booking?.meta?.timeZone ||
      booking?.inventory_snapshot?.timeZone ||
      booking?.inventory_snapshot?.timezone ||
      booking?.inventory_snapshot?.hotel?.timeZone ||
      booking?.inventory_snapshot?.hotel?.timezone
  ) || FALLBACK_TIMEZONE;

const resolveReviewBoostMeta = (booking) => {
  const claim =
    booking?.hotelStay?.webbedsHotel?.partnerClaim ||
    booking?.hotelStay?.hotel?.partnerClaim ||
    null;
  if (!claim) return null;
  const profile = resolvePartnerProfileFromClaim(claim);
  if (!profile?.reviewBoostEnabled || !profile?.googleReviewUrl) return null;
  return {
    enabled: true,
    externalReviewUrl: profile.googleReviewUrl,
    provider: "google",
  };
};

const buildPushContent = ({ inventoryType, summary, reviewBoost = null }) => {
  if (inventoryType === HOME_INVENTORY_TYPE) {
    return {
      title: "Leave a review",
      body: `How was your stay at ${summary.title}?`,
    };
  }
  return {
    title: reviewBoost?.enabled ? "Review your hotel stay on Google" : "Review your hotel stay",
    body: reviewBoost?.enabled
      ? `Share your stay at ${summary.title} on Google.`
      : `Tell us about your stay at ${summary.title}.`,
  };
};

const buildReminderPayload = ({
  booking,
  reminderKey,
  inventoryType,
  summary,
  inventoryId,
  reviewBoost = null,
}) => ({
  type: "REVIEW_REMINDER",
  reviewRole: "GUEST",
  reminderKey,
  bookingId: booking.id,
  inventoryType,
  inventoryId: inventoryId || toInventoryIdString(booking.inventory_id),
  stayTitle: summary.title,
  stayCity: summary.city,
  stayCountry: summary.country,
  stayImage: summary.image,
  checkIn: booking.check_in,
  checkOut: booking.check_out,
  externalReviewUrl: reviewBoost?.externalReviewUrl || null,
  externalReviewProvider: reviewBoost?.provider || null,
});

export const runReviewReminderSweep = async () => {
  const now = new Date();
  const candidateBookings = await models.Booking.findAll({
    where: {
      status: { [Op.in]: Array.from(ALLOWED_GUEST_STATUSES) },
      inventory_type: { [Op.in]: [HOME_INVENTORY_TYPE, ...Array.from(HOTEL_INVENTORY_TYPES)] },
    },
    include: [
      {
        model: models.StayHome,
        as: "homeStay",
        required: false,
        include: [
          {
            model: models.Home,
            as: "home",
            attributes: ["id", "title"],
            required: false,
            include: [
              {
                model: models.HomeAddress,
                as: "address",
                attributes: ["city", "country", "state"],
                required: false,
              },
              {
                model: models.HomeMedia,
                as: "media",
                attributes: ["url", "is_cover", "order"],
                required: false,
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
            required: false,
            attributes: ["id", "name", "city", "country", "image"],
          },
          {
            model: models.WebbedsHotel,
            as: "webbedsHotel",
            required: false,
            attributes: ["hotel_id", "name", "city_name", "country_name"],
            include: [
              {
                model: models.PartnerHotelClaim,
                as: "partnerClaim",
                required: false,
                attributes: [
                  "id",
                  "hotel_id",
                  "claim_status",
                  "current_plan_code",
                  "pending_plan_code",
                  "subscription_status",
                  "trial_ends_at",
                  "trial_started_at",
                  "claimed_at",
                  "profile_overrides",
                ],
              },
            ],
          },
        ],
      },
    ],
    order: [["check_out", "DESC"]],
    limit: 500,
  });

  const stats = {
    scanned: candidateBookings.length,
    due: 0,
    sent: 0,
    skipped: 0,
    skippedNoToken: 0,
    skippedAlreadySent: 0,
    failed: 0,
  };

  if (!candidateBookings.length) return stats;

  const bookingIds = candidateBookings.map((booking) => booking.id);

  const existingReviews = await models.Review.findAll({
    where: {
      stay_id: { [Op.in]: bookingIds },
      author_type: "GUEST",
      status: REVIEW_STATUS_PUBLISHED,
    },
    attributes: ["stay_id", "author_id"],
  });
  const reviewedMap = new Set(
    existingReviews.map((review) => `${Number(review.stay_id)}:${Number(review.author_id)}`)
  );

  const existingLogs = await models.ReviewReminderLog.findAll({
    where: {
      booking_id: { [Op.in]: bookingIds },
      channel: REMINDER_CHANNEL,
      status: "SENT",
    },
    attributes: ["booking_id", "user_id", "reminder_key"],
  });
  const sentLogMap = new Set(
    existingLogs.map(
      (log) =>
        `${Number(log.booking_id)}:${Number(log.user_id)}:${String(log.reminder_key || "").trim()}:${REMINDER_CHANNEL}`
    )
  );

  for (const booking of candidateBookings) {
    const userId = Number(booking?.user_id || 0);
    if (!userId) {
      stats.skipped += 1;
      continue;
    }
    if (!isDateReached(booking.check_out, now)) {
      stats.skipped += 1;
      continue;
    }
    if (!isWithinReviewWindow(booking.check_out, now)) {
      stats.skipped += 1;
      continue;
    }

    const reviewKey = `${Number(booking.id)}:${userId}`;
    if (reviewedMap.has(reviewKey)) {
      stats.skipped += 1;
      continue;
    }

    const inventoryType = toInventoryType(booking.inventory_type);
    if (!isHomeInventory(inventoryType) && !isHotelInventory(inventoryType)) {
      stats.skipped += 1;
      continue;
    }

    const summary = isHomeInventory(inventoryType)
      ? resolveHomeSummary(booking)
      : resolveHotelSummary(booking);
    const reviewBoost = isHotelInventory(inventoryType) ? resolveReviewBoostMeta(booking) : null;
    const inventoryId = isHomeInventory(inventoryType)
      ? toInventoryIdString(booking.inventory_id)
      : summary.inventoryId;
    const timezone = resolveReviewTimeZone(booking);

    const schedule = buildReminderSchedule(booking.check_out);
    for (const slot of schedule) {
      const reminderKey = `guest_${slot.key}`;
      const deliveryKey = `${Number(booking.id)}:${userId}:${reminderKey}:${REMINDER_CHANNEL}`;
      if (sentLogMap.has(deliveryKey)) {
        stats.skippedAlreadySent += 1;
        continue;
      }
      if (now < slot.dueAt) continue;
      if (!isWithinReviewWindow(booking.check_out, slot.dueAt)) continue;
      if (!isWithinQuietHours(now, timezone)) continue;

      stats.due += 1;

      let claim = null;
      try {
        claim = await models.ReviewReminderLog.create({
          booking_id: booking.id,
          user_id: userId,
          reminder_key: reminderKey,
          channel: REMINDER_CHANNEL,
          inventory_type: inventoryType || null,
          inventory_id: inventoryId || null,
          status: "PENDING",
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          sentLogMap.add(deliveryKey);
          stats.skippedAlreadySent += 1;
          continue;
        }
        throw error;
      }

      const pushCopy = buildPushContent({ inventoryType, summary, reviewBoost });
      const payload = buildReminderPayload({
        booking,
        reminderKey,
        inventoryType,
        summary,
        inventoryId,
        reviewBoost,
      });

      try {
        const pushSummary = await sendPushToUser({
          userId,
          title: pushCopy.title,
          body: pushCopy.body,
          data: payload,
          debug: true,
        });

        if (pushSummary?.reason === "NO_TOKENS" || Number(pushSummary?.okCount || 0) <= 0) {
          await claim.destroy();
          stats.skippedNoToken += 1;
          continue;
        }

        await claim.update({
          status: "SENT",
          sent_at: new Date(),
          payload,
          error_message: null,
        });
        sentLogMap.add(deliveryKey);
        stats.sent += 1;
      } catch (error) {
        await claim.destroy().catch(() => {});
        stats.failed += 1;
        console.warn("[review-reminder] push failed", {
          bookingId: booking.id,
          userId,
          reminderKey,
          error: String(error?.message || error),
        });
      }
    }
  }

  return stats;
};

export default {
  runReviewReminderSweep,
};
