import { Op } from "sequelize";
import models from "../models/index.js";
import { sendMail } from "../helpers/mailer.js";
import { sendPushToUser } from "./pushNotifications.service.js";
import { getBookingAbandonmentEmailTemplate } from "../emailTemplates/booking-abandonment-email.js";

const FLOW_ACTIVE_STATUSES = new Set([
  "BLOCKED",
  "SAVED",
  "PRICED",
  "PREAUTHED",
]);
const BOOKING_FINAL_STATUSES = new Set(["CONFIRMED", "COMPLETED"]);
const FLOW_CLIENT_TYPES = {
  WEB: "WEB",
  MOBILE: "MOBILE",
  UNKNOWN: "UNKNOWN",
};
const CHANNELS = {
  PUSH: "PUSH",
  EMAIL: "EMAIL",
};
const toDelayMinutes = (value, fallbackMinutes) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMinutes;
};
const FIRST_REMINDER_DELAY_MINUTES = toDelayMinutes(
  process.env.BOOKING_ABANDONMENT_FIRST_DELAY_MINUTES,
  120,
);
const SECOND_REMINDER_DELAY_MINUTES = toDelayMinutes(
  process.env.BOOKING_ABANDONMENT_SECOND_DELAY_MINUTES,
  1440,
);
const REMINDER_SLOTS = [
  {
    key: "abandoned_2h",
    delayMs: FIRST_REMINDER_DELAY_MINUTES * 60 * 1000,
    title: "Still thinking about your stay?",
    pushBody: (hotelName) =>
      `Still thinking about ${hotelName}? Rates may change soon. Book now.`,
    emailSubject: (hotelName) => `Still thinking about ${hotelName}?`,
    emailLabel: "Your selected stay is still available for now, but rates may change soon.",
  },
  {
    key: "abandoned_24h",
    delayMs: SECOND_REMINDER_DELAY_MINUTES * 60 * 1000,
    title: "Your hotel is still waiting",
    pushBody: (hotelName) =>
      `Your stay at ${hotelName} is still pending. Finish your booking before prices change.`,
    emailSubject: (hotelName) => `Complete your booking for ${hotelName}`,
    emailLabel: "It looks like you left before finishing your booking. If you are still interested, continue now.",
  },
];

const normalizeClientType = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "web") return FLOW_CLIENT_TYPES.WEB;
  if (normalized === "mobile" || normalized === "app" || normalized === "ios" || normalized === "android") {
    return FLOW_CLIENT_TYPES.MOBILE;
  }
  return FLOW_CLIENT_TYPES.UNKNOWN;
};

const resolveReminderChannel = (clientType) =>
  clientType === FLOW_CLIENT_TYPES.WEB ? CHANNELS.EMAIL : CHANNELS.PUSH;

const isUniqueConstraintError = (error) =>
  String(error?.name || "").toLowerCase().includes("uniqueconstraint");

const resolveClientUrl = () => {
  const candidates = [
    process.env.CLIENT_URL,
    process.env.WEBAPP_URL,
    process.env.FRONTEND_URL,
  ];
  const url = candidates.find((value) => value && String(value).trim().length > 0);
  if (!url) return "https://app.insiderbookings.com";
  return String(url).replace(/\/$/, "");
};

const resolveHotelName = (flow) => {
  const searchContext = flow?.search_context || {};
  const selectedOffer = flow?.selected_offer || {};
  return (
    String(
      selectedOffer.hotelName ||
        searchContext.hotelName ||
        searchContext.hotel_name ||
        "your hotel",
    ).trim() || "your hotel"
  );
};

const resolveHotelId = (flow) => {
  const searchContext = flow?.search_context || {};
  const selectedOffer = flow?.selected_offer || {};
  const hotelId = selectedOffer.hotelId || searchContext.hotelId || searchContext.productId || null;
  return hotelId == null ? null : String(hotelId).trim() || null;
};

const resolveGuests = (flow) => {
  const rooms = Array.isArray(flow?.search_context?.rooms) ? flow.search_context.rooms : [];
  if (!rooms.length) return { adults: null, children: null };
  let adults = 0;
  let children = 0;
  rooms.forEach((room) => {
    const roomAdults = Number(room?.adults ?? room?.adult ?? 0);
    if (Number.isFinite(roomAdults) && roomAdults > 0) adults += roomAdults;
    const roomChildren = room?.children ?? room?.childrenAges ?? room?.kids ?? [];
    if (Array.isArray(roomChildren)) {
      children += roomChildren.length;
      return;
    }
    const parsed = Number(roomChildren);
    if (Number.isFinite(parsed) && parsed > 0) children += parsed;
  });
  return { adults: adults || null, children: children || null };
};

const buildReminderPayload = ({ flow, reminderKey, hotelName, hotelId, guests }) => ({
  type: "BOOKING_ABANDONMENT",
  reminderKey,
  flowId: flow.id,
  hotelId,
  hotelName,
  checkIn: flow?.search_context?.fromDate || null,
  checkOut: flow?.search_context?.toDate || null,
  adults: guests.adults,
  children: guests.children,
  passengerNationality: flow?.search_context?.passengerNationality || null,
  passengerCountryOfResidence: flow?.search_context?.passengerCountryOfResidence || null,
});

const buildHotelDetailUrl = ({ flow, hotelId }) => {
  const baseUrl = resolveClientUrl();
  if (!hotelId) return `${baseUrl}/explore`;
  const params = new URLSearchParams();
  const searchContext = flow?.search_context || {};
  const rooms = Array.isArray(searchContext.rooms) ? searchContext.rooms : [];
  const adults = rooms.reduce((sum, room) => {
    const parsed = Number(room?.adults ?? room?.adult ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? sum + parsed : sum;
  }, 0);
  const childrenAges = rooms.flatMap((room) => {
    const raw = room?.children ?? room?.childrenAges ?? room?.kids ?? [];
    if (Array.isArray(raw)) return raw;
    return [];
  });
  if (searchContext.fromDate) params.set("checkIn", String(searchContext.fromDate));
  if (searchContext.toDate) params.set("checkOut", String(searchContext.toDate));
  if (adults > 0) params.set("adults", String(adults));
  if (childrenAges.length) params.set("childrenAges", childrenAges.join("-"));
  if (searchContext.passengerNationality) {
    params.set("nationality", String(searchContext.passengerNationality));
  }
  if (searchContext.passengerCountryOfResidence) {
    params.set("residence", String(searchContext.passengerCountryOfResidence));
  }
  params.set("autoCheckRates", "1");
  return `${baseUrl}/hotels/${encodeURIComponent(String(hotelId))}?${params.toString()}`;
};

export const runBookingAbandonmentReminderSweep = async () => {
  const now = new Date();
  const minDelayMs = Math.min(...REMINDER_SLOTS.map((slot) => slot.delayMs));
  const candidateThreshold = new Date(now.getTime() - minDelayMs);

  const candidateFlows = await models.BookingFlow.findAll({
    where: {
      user_id: { [Op.ne]: null },
      status: { [Op.in]: Array.from(FLOW_ACTIVE_STATUSES) },
      updatedAt: { [Op.lte]: candidateThreshold },
    },
    include: [
      {
        model: models.User,
        as: "user",
        required: false,
        attributes: ["id", "email"],
      },
    ],
    order: [["updatedAt", "ASC"]],
    limit: 500,
  });

  const stats = {
    scanned: candidateFlows.length,
    due: 0,
    sent: 0,
    skipped: 0,
    skippedAlreadySent: 0,
    skippedMissingDestination: 0,
    skippedCompleted: 0,
    failed: 0,
  };

  if (!candidateFlows.length) return stats;

  const flowIds = candidateFlows.map((flow) => flow.id);
  const completedBookings = await models.Booking.findAll({
    where: {
      flow_id: { [Op.in]: flowIds },
      status: { [Op.in]: Array.from(BOOKING_FINAL_STATUSES) },
    },
    attributes: ["flow_id"],
  });
  const completedFlowIds = new Set(
    completedBookings
      .map((booking) => String(booking.flow_id || "").trim())
      .filter(Boolean),
  );

  const existingLogs = await models.BookingAbandonmentReminderLog.findAll({
    where: {
      flow_id: { [Op.in]: flowIds },
      status: "SENT",
    },
    attributes: ["flow_id", "user_id", "reminder_key", "channel"],
  });
  const sentLogMap = new Set(
    existingLogs.map(
      (log) =>
        `${String(log.flow_id || "").trim()}:${Number(log.user_id || 0)}:${String(log.reminder_key || "").trim()}:${String(log.channel || "").trim().toUpperCase()}`,
    ),
  );

  for (const flow of candidateFlows) {
    const flowId = String(flow.id || "").trim();
    const userId = Number(flow.user_id || 0);
    if (!flowId || !userId) {
      stats.skipped += 1;
      continue;
    }
    if (completedFlowIds.has(flowId)) {
      stats.skippedCompleted += 1;
      continue;
    }

    const lastActivityAt = flow.updatedAt instanceof Date ? flow.updatedAt : new Date(flow.updatedAt);
    if (!(lastActivityAt instanceof Date) || Number.isNaN(lastActivityAt.getTime())) {
      stats.skipped += 1;
      continue;
    }

    const hotelName = resolveHotelName(flow);
    const hotelId = resolveHotelId(flow);
    const clientType = normalizeClientType(flow?.search_context?.clientType);
    const channel = resolveReminderChannel(clientType);
    const guests = resolveGuests(flow);
    const payloadBase = buildReminderPayload({
      flow,
      reminderKey: null,
      hotelName,
      hotelId,
      guests,
    });

    for (const slot of REMINDER_SLOTS) {
      const dueAt = new Date(lastActivityAt.getTime() + slot.delayMs);
      if (now < dueAt) continue;

      const deliveryKey = `${flowId}:${userId}:${slot.key}:${channel}`;
      if (sentLogMap.has(deliveryKey)) {
        stats.skippedAlreadySent += 1;
        continue;
      }

      stats.due += 1;
      let claim = null;
      try {
        claim = await models.BookingAbandonmentReminderLog.create({
          flow_id: flow.id,
          user_id: userId,
          reminder_key: slot.key,
          channel,
          status: "PENDING",
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          stats.skippedAlreadySent += 1;
          sentLogMap.add(deliveryKey);
          continue;
        }
        throw error;
      }

      const payload = { ...payloadBase, reminderKey: slot.key };
      try {
        if (channel === CHANNELS.EMAIL) {
          const email = String(flow?.user?.email || "").trim();
          if (!email) {
            await claim.destroy().catch(() => {});
            stats.skippedMissingDestination += 1;
            continue;
          }

          await sendMail({
            to: email,
            subject: slot.emailSubject(hotelName),
            html: getBookingAbandonmentEmailTemplate({
              hotelName,
              reminderLabel: slot.emailLabel,
              ctaUrl: buildHotelDetailUrl({ flow, hotelId }),
              checkIn: payload.checkIn,
              checkOut: payload.checkOut,
              guests,
            }),
          });
        } else {
          const pushSummary = await sendPushToUser({
            userId,
            title: slot.title,
            body: slot.pushBody(hotelName),
            data: payload,
            debug: true,
          });
          if (pushSummary?.reason === "NO_TOKENS" || Number(pushSummary?.okCount || 0) <= 0) {
            await claim.destroy().catch(() => {});
            stats.skippedMissingDestination += 1;
            continue;
          }
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
        console.warn("[booking-abandonment-reminder] delivery failed", {
          flowId,
          userId,
          reminderKey: slot.key,
          channel,
          error: String(error?.message || error),
        });
      }
    }
  }

  return stats;
};

export default {
  runBookingAbandonmentReminderSweep,
};
