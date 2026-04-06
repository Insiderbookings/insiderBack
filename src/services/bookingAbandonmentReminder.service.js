import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
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
const REMINDER_LOG_TABLE = "booking_abandonment_reminder_log";
const REMINDER_LOG_STATUSES = {
  PENDING: "PENDING",
  SENT: "SENT",
};
const CHANNELS = {
  PUSH: "PUSH",
  EMAIL: "EMAIL",
};
const REMINDER_SWEEP_QUERY_LIMIT = 500;
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

const resolveSearchRooms = (flow) =>
  Array.isArray(flow?.search_context?.rooms) ? flow.search_context.rooms : [];

const normalizeChildAge = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const resolveChildrenAges = (flow) => {
  const childrenAges = [];
  resolveSearchRooms(flow).forEach((room) => {
    const rawChildren = room?.childrenAges ?? room?.children ?? room?.kids ?? [];
    if (!Array.isArray(rawChildren)) return;
    rawChildren.forEach((value) => {
      const normalized = normalizeChildAge(value);
      if (normalized != null) childrenAges.push(normalized);
    });
  });
  return childrenAges;
};

const resolveGuests = (flow) => {
  const rooms = resolveSearchRooms(flow);
  const childrenAges = resolveChildrenAges(flow);
  if (!rooms.length) return { adults: null, children: null, childrenAges };
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
  if (childrenAges.length > children) children = childrenAges.length;
  return { adults: adults || null, children: children || null, childrenAges };
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
  childrenAges: guests.childrenAges,
  passengerNationality: flow?.search_context?.passengerNationality || null,
  passengerCountryOfResidence: flow?.search_context?.passengerCountryOfResidence || null,
});

const buildHotelDetailUrl = ({ flow, hotelId }) => {
  const baseUrl = resolveClientUrl();
  if (!hotelId) return `${baseUrl}/explore`;
  const params = new URLSearchParams();
  const searchContext = flow?.search_context || {};
  const rooms = resolveSearchRooms(flow);
  const adults = rooms.reduce((sum, room) => {
    const parsed = Number(room?.adults ?? room?.adult ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? sum + parsed : sum;
  }, 0);
  const childrenAges = resolveChildrenAges(flow);
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

const buildReminderDeliveryKey = ({ flowId, userId, reminderKey, channel }) =>
  `${String(flowId || "").trim()}:${Number(userId || 0)}:${String(reminderKey || "").trim()}:${String(channel || "").trim().toUpperCase()}`;

const buildSentReminderFlowSubquery = ({ reminderKey, sentBefore = null }) => {
  const escape = (value) => sequelize.escape(value);
  const whereParts = [
    `reminder_key = ${escape(String(reminderKey || ""))}`,
    `status = ${escape(REMINDER_LOG_STATUSES.SENT)}`,
  ];
  if (sentBefore instanceof Date && !Number.isNaN(sentBefore.getTime())) {
    whereParts.push(`sent_at <= ${escape(sentBefore)}`);
  }
  return sequelize.literal(
    `(SELECT flow_id FROM ${REMINDER_LOG_TABLE} WHERE ${whereParts.join(" AND ")})`,
  );
};

const buildReminderSlotWhere = ({ slot, slotIndex, sweepStartedAt }) => {
  const where = {
    user_id: { [Op.ne]: null },
    status: { [Op.in]: Array.from(FLOW_ACTIVE_STATUSES) },
    updatedAt: { [Op.lte]: new Date(sweepStartedAt.getTime() - slot.delayMs) },
  };

  if (slotIndex === 0) {
    where.id = {
      [Op.notIn]: buildSentReminderFlowSubquery({ reminderKey: slot.key }),
    };
    return where;
  }

  const previousSlot = REMINDER_SLOTS[slotIndex - 1];
  where.id = {
    [Op.in]: buildSentReminderFlowSubquery({
      reminderKey: previousSlot.key,
      sentBefore: sweepStartedAt,
    }),
    [Op.notIn]: buildSentReminderFlowSubquery({ reminderKey: slot.key }),
  };
  return where;
};

const fetchCandidateFlowsForSlot = async ({ slot, slotIndex, sweepStartedAt }) =>
  models.BookingFlow.findAll({
    where: buildReminderSlotWhere({ slot, slotIndex, sweepStartedAt }),
    include: [
      {
        model: models.User,
        as: "user",
        required: false,
        attributes: ["id", "email"],
      },
    ],
    order: [["updatedAt", "ASC"]],
    limit: REMINDER_SWEEP_QUERY_LIMIT,
  });

export const runBookingAbandonmentReminderSweep = async () => {
  const sweepStartedAt = new Date();
  const stats = {
    scanned: 0,
    due: 0,
    sent: 0,
    skipped: 0,
    skippedAlreadySent: 0,
    skippedMissingDestination: 0,
    skippedCompleted: 0,
    failed: 0,
  };

  for (const [slotIndex, slot] of REMINDER_SLOTS.entries()) {
    const candidateFlows = await fetchCandidateFlowsForSlot({
      slot,
      slotIndex,
      sweepStartedAt,
    });
    stats.scanned += candidateFlows.length;
    if (!candidateFlows.length) continue;

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

      const lastActivityAt =
        flow.updatedAt instanceof Date ? flow.updatedAt : new Date(flow.updatedAt);
      if (!(lastActivityAt instanceof Date) || Number.isNaN(lastActivityAt.getTime())) {
        stats.skipped += 1;
        continue;
      }

      const dueAt = new Date(lastActivityAt.getTime() + slot.delayMs);
      if (sweepStartedAt < dueAt) {
        stats.skipped += 1;
        continue;
      }

      const hotelName = resolveHotelName(flow);
      const hotelId = resolveHotelId(flow);
      const clientType = normalizeClientType(flow?.search_context?.clientType);
      const channel = resolveReminderChannel(clientType);
      const deliveryKey = buildReminderDeliveryKey({
        flowId,
        userId,
        reminderKey: slot.key,
        channel,
      });
      const guests = resolveGuests(flow);
      const payload = buildReminderPayload({
        flow,
        reminderKey: slot.key,
        hotelName,
        hotelId,
        guests,
      });

      stats.due += 1;
      let claim = null;
      try {
        claim = await models.BookingAbandonmentReminderLog.create({
          flow_id: flow.id,
          user_id: userId,
          reminder_key: slot.key,
          channel,
          status: REMINDER_LOG_STATUSES.PENDING,
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          stats.skippedAlreadySent += 1;
          continue;
        }
        throw error;
      }

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
          status: REMINDER_LOG_STATUSES.SENT,
          sent_at: new Date(),
          payload,
          error_message: null,
        });
        stats.sent += 1;
      } catch (error) {
        await claim.destroy().catch(() => {});
        stats.failed += 1;
        console.warn("[booking-abandonment-reminder] delivery failed", {
          flowId,
          userId,
          reminderKey: slot.key,
          channel,
          deliveryKey,
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
