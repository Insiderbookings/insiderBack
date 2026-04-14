import dayjs from "dayjs";
import { Op } from "sequelize";
import models from "../models/index.js";
import { getCaseInsensitiveLikeOp } from "../utils/sequelizeHelpers.js";

export const PARTNER_METRIC_EVENT_TYPES = Object.freeze({
  impression: "impression",
  click: "click",
});

export const PARTNER_METRIC_SURFACES = Object.freeze({
  explore: "explore",
  search: "search",
  map: "map",
  detail: "detail",
  email: "email",
});

export const PARTNER_METRIC_SOURCES = Object.freeze({
  inApp: "in_app",
  socialManual: "social_manual",
});

const iLikeOp = getCaseInsensitiveLikeOp();

const sanitizeText = (value, maxLength = 255) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

const normalizeEventType = (value) => sanitizeText(value, 32)?.toLowerCase() || null;
const normalizeSurface = (value) => sanitizeText(value, 32)?.toLowerCase() || null;
const normalizeSourceChannel = (value) =>
  sanitizeText(value, 32)?.toLowerCase() || PARTNER_METRIC_SOURCES.inApp;

const buildDefaultSurfaceSummary = () =>
  Object.values(PARTNER_METRIC_SURFACES).map((surface) => ({
    surface,
    label: surface.charAt(0).toUpperCase() + surface.slice(1),
    impressions: 0,
    clicks: 0,
  }));

const buildDefaultSummary = () => ({
  label: "BookingGPT Reach",
  subtext: "Travelers who saw your hotel across BookingGPT this week",
  value: 0,
  clicks: 0,
  automaticReach: 0,
  manualReach: 0,
  previousValue: 0,
  deltaPercent: null,
  sourceSummary:
    "In-app views tracked automatically plus manual social views added by admin weekly.",
  surfaceSummary: buildDefaultSurfaceSummary(),
});

const resolveMetricWindow = (now = new Date()) => {
  const end = dayjs(now).endOf("day");
  const start = end.subtract(6, "day").startOf("day");
  const previousEnd = start.subtract(1, "millisecond");
  const previousStart = start.subtract(7, "day").startOf("day");
  return {
    currentStart: start.toDate(),
    currentEnd: end.toDate(),
    previousStart: previousStart.toDate(),
    previousEnd: previousEnd.toDate(),
    currentStartKey: start.format("YYYY-MM-DD"),
    currentEndKey: end.format("YYYY-MM-DD"),
    previousStartKey: previousStart.format("YYYY-MM-DD"),
    previousEndKey: previousEnd.format("YYYY-MM-DD"),
  };
};

const overlapsPeriod = (periodStart, periodEnd, rangeStart, rangeEnd) => {
  const start = dayjs(periodStart);
  const end = dayjs(periodEnd);
  if (!start.isValid() || !end.isValid()) return false;
  return !end.isBefore(rangeStart, "day") && !start.isAfter(rangeEnd, "day");
};

const computeDeltaPercent = (currentValue, previousValue) => {
  if (!Number.isFinite(previousValue) || previousValue <= 0) return null;
  const delta = ((currentValue - previousValue) / previousValue) * 100;
  return Math.round(delta * 10) / 10;
};

const createSurfaceSummaryMap = () =>
  new Map(buildDefaultSurfaceSummary().map((item) => [item.surface, { ...item }]));

const resolveWindowSummary = ({
  eventRows = [],
  adjustmentRows = [],
  hotelId,
  rangeStart,
  rangeEnd,
}) => {
  const surfaceMap = createSurfaceSummaryMap();
  let automaticReach = 0;
  let manualReach = 0;
  let clicks = 0;

  eventRows.forEach((row) => {
    if (String(row.hotel_id) !== String(hotelId)) return;
    const createdAt = dayjs(row.created_at);
    if (!createdAt.isValid()) return;
    if (createdAt.isBefore(rangeStart) || createdAt.isAfter(rangeEnd)) return;

    const eventType = normalizeEventType(row.event_type);
    const surface = normalizeSurface(row.surface) || PARTNER_METRIC_SURFACES.explore;
    const surfaceEntry =
      surfaceMap.get(surface) ||
      { surface, label: surface.charAt(0).toUpperCase() + surface.slice(1), impressions: 0, clicks: 0 };

    if (eventType === PARTNER_METRIC_EVENT_TYPES.impression) {
      automaticReach += 1;
      surfaceEntry.impressions += 1;
    }
    if (eventType === PARTNER_METRIC_EVENT_TYPES.click) {
      clicks += 1;
      surfaceEntry.clicks += 1;
    }
    surfaceMap.set(surface, surfaceEntry);
  });

  adjustmentRows.forEach((row) => {
    if (String(row.hotel_id) !== String(hotelId)) return;
    const value = Number(row.value);
    if (!Number.isFinite(value)) return;
    if (overlapsPeriod(row.period_start, row.period_end, rangeStart.format("YYYY-MM-DD"), rangeEnd.format("YYYY-MM-DD"))) {
      manualReach += value;
    }
  });

  return {
    reach: automaticReach + manualReach,
    automaticReach,
    manualReach,
    clicks,
    surfaceSummary: Array.from(surfaceMap.values()).sort((a, b) => String(a.surface).localeCompare(String(b.surface))),
  };
};

const mapSummaryFromBuckets = ({ eventRows = [], adjustmentRows = [], hotelId, now = new Date() }) => {
  const summary = buildDefaultSummary();
  const window = resolveMetricWindow(now);
  const currentSurfaceMap = new Map(
    buildDefaultSurfaceSummary().map((item) => [item.surface, { ...item }]),
  );

  let previousAutomaticReach = 0;
  let previousClicks = 0;
  let previousManualReach = 0;

  eventRows.forEach((row) => {
    const rowHotelId = String(row.hotel_id);
    if (rowHotelId !== String(hotelId)) return;
    const createdAt = dayjs(row.created_at);
    if (!createdAt.isValid()) return;

    const eventType = normalizeEventType(row.event_type);
    const surface = normalizeSurface(row.surface) || PARTNER_METRIC_SURFACES.explore;
    const surfaceEntry =
      currentSurfaceMap.get(surface) ||
      { surface, label: surface.charAt(0).toUpperCase() + surface.slice(1), impressions: 0, clicks: 0 };
    const inCurrent =
      !createdAt.isBefore(window.currentStart) &&
      !createdAt.isAfter(window.currentEnd);
    const inPrevious =
      !createdAt.isBefore(window.previousStart) &&
      !createdAt.isAfter(window.previousEnd);

    if (inCurrent) {
      if (eventType === PARTNER_METRIC_EVENT_TYPES.impression) {
        surfaceEntry.impressions += 1;
        summary.automaticReach += 1;
      }
      if (eventType === PARTNER_METRIC_EVENT_TYPES.click) {
        surfaceEntry.clicks += 1;
        summary.clicks += 1;
      }
      currentSurfaceMap.set(surface, surfaceEntry);
    }

    if (inPrevious) {
      if (eventType === PARTNER_METRIC_EVENT_TYPES.impression) previousAutomaticReach += 1;
      if (eventType === PARTNER_METRIC_EVENT_TYPES.click) previousClicks += 1;
    }
  });

  adjustmentRows.forEach((row) => {
    const rowHotelId = String(row.hotel_id);
    if (rowHotelId !== String(hotelId)) return;
    const value = Number(row.value);
    if (!Number.isFinite(value)) return;
    if (
      overlapsPeriod(row.period_start, row.period_end, window.currentStartKey, window.currentEndKey)
    ) {
      summary.manualReach += value;
    }
    if (
      overlapsPeriod(row.period_start, row.period_end, window.previousStartKey, window.previousEndKey)
    ) {
      previousManualReach += value;
    }
  });

  summary.value = summary.automaticReach + summary.manualReach;
  summary.previousValue = previousAutomaticReach + previousManualReach;
  summary.deltaPercent = computeDeltaPercent(summary.value, summary.previousValue);
  summary.surfaceSummary = Array.from(currentSurfaceMap.values()).sort((a, b) =>
    String(a.surface).localeCompare(String(b.surface)),
  );
  if (!summary.value && !summary.clicks && !summary.manualReach && !summary.automaticReach) {
    summary.previousValue = previousAutomaticReach + previousManualReach;
    summary.deltaPercent = computeDeltaPercent(summary.value, summary.previousValue);
  }
  void previousClicks;
  return summary;
};

export const trackPartnerMetricEvent = async ({
  hotelId,
  userId = null,
  sessionId = null,
  dedupeKey = null,
  eventType,
  surface,
  placement = null,
  sourceChannel = PARTNER_METRIC_SOURCES.inApp,
  pagePath = null,
  referrer = null,
  meta = null,
}) => {
  const normalizedHotelId = sanitizeText(hotelId, 64);
  const normalizedEventType = normalizeEventType(eventType);
  const normalizedSurface = normalizeSurface(surface);
  const normalizedSourceChannel = normalizeSourceChannel(sourceChannel);

  if (!normalizedHotelId) {
    const error = new Error("hotelId is required");
    error.status = 400;
    throw error;
  }
  if (!Object.values(PARTNER_METRIC_EVENT_TYPES).includes(normalizedEventType)) {
    const error = new Error("Invalid eventType");
    error.status = 400;
    throw error;
  }
  if (!Object.values(PARTNER_METRIC_SURFACES).includes(normalizedSurface)) {
    const error = new Error("Invalid surface");
    error.status = 400;
    throw error;
  }

  const claim = await models.PartnerHotelClaim.findOne({
    where: { hotel_id: normalizedHotelId },
    attributes: ["id", "hotel_id"],
  });
  if (!claim) return { tracked: false, reason: "claim-not-found" };

  try {
    const event = await models.PartnerMetricEvent.create({
      claim_id: claim.id,
      hotel_id: claim.hotel_id,
      user_id: Number.isFinite(Number(userId)) && Number(userId) > 0 ? Number(userId) : null,
      session_id: sanitizeText(sessionId, 120),
      dedupe_key: sanitizeText(dedupeKey, 191),
      event_type: normalizedEventType,
      surface: normalizedSurface,
      placement: sanitizeText(placement, 64),
      source_channel: normalizedSourceChannel,
      page_path: sanitizeText(pagePath, 255),
      referrer: sanitizeText(referrer, 255),
      meta: meta && typeof meta === "object" ? meta : null,
    });
    return { tracked: true, event };
  } catch (error) {
    if (error?.name === "SequelizeUniqueConstraintError" && sanitizeText(dedupeKey, 191)) {
      return { tracked: false, reason: "duplicate" };
    }
    throw error;
  }
};

export const attachPartnerMetricSummariesToClaims = async (claims = [], { now = new Date() } = {}) => {
  const list = Array.isArray(claims) ? claims.filter(Boolean) : [];
  if (!list.length) return list;

  const hotelIds = Array.from(
    new Set(
      list
        .map((claim) => claim?.hotel_id ?? claim?.hotelId)
        .filter((value) => value != null)
        .map((value) => String(value)),
    ),
  );
  if (!hotelIds.length) return list;

  const window = resolveMetricWindow(now);
  const [eventRows, adjustmentRows] = await Promise.all([
    models.PartnerMetricEvent.findAll({
      where: {
        hotel_id: { [Op.in]: hotelIds },
        created_at: { [Op.gte]: window.previousStart },
      },
      attributes: ["hotel_id", "event_type", "surface", "created_at"],
      order: [["created_at", "DESC"]],
    }),
    models.PartnerMetricAdjustment.findAll({
      where: {
        hotel_id: { [Op.in]: hotelIds },
        metric_type: "bookinggpt_reach",
        period_end: { [Op.gte]: window.previousStartKey },
        period_start: { [Op.lte]: window.currentEndKey },
      },
      attributes: ["hotel_id", "period_start", "period_end", "value"],
      order: [["created_at", "DESC"]],
    }),
  ]);

  const summaryMap = new Map(
    hotelIds.map((hotelId) => [
      String(hotelId),
      mapSummaryFromBuckets({ eventRows, adjustmentRows, hotelId, now }),
    ]),
  );

  list.forEach((claim) => {
    const hotelId = claim?.hotel_id ?? claim?.hotelId;
    const summary = summaryMap.get(String(hotelId)) || buildDefaultSummary();
    if (typeof claim?.setDataValue === "function") {
      claim.setDataValue("partnerMetricsSummary", summary);
    } else {
      claim.partnerMetricsSummary = summary;
    }
  });

  return list;
};

export const createPartnerMetricAdjustment = async ({
  hotelId,
  value,
  note = null,
  periodStart,
  periodEnd,
  enteredByUserId = null,
  source = PARTNER_METRIC_SOURCES.socialManual,
  meta = null,
}) => {
  const normalizedHotelId = sanitizeText(hotelId, 64);
  const numericValue = Number(value);
  if (!normalizedHotelId) {
    const error = new Error("hotelId is required");
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    const error = new Error("value must be a positive number");
    error.status = 400;
    throw error;
  }
  const start = dayjs(periodStart);
  const end = dayjs(periodEnd || periodStart);
  if (!start.isValid() || !end.isValid()) {
    const error = new Error("periodStart and periodEnd are required");
    error.status = 400;
    throw error;
  }
  if (end.isBefore(start, "day")) {
    const error = new Error("periodEnd cannot be before periodStart");
    error.status = 400;
    throw error;
  }

  const claim = await models.PartnerHotelClaim.findOne({
    where: { hotel_id: normalizedHotelId },
    attributes: ["id", "hotel_id"],
  });
  if (!claim) {
    const error = new Error("Partner claim not found");
    error.status = 404;
    throw error;
  }

  return models.PartnerMetricAdjustment.create({
    claim_id: claim.id,
    hotel_id: claim.hotel_id,
    entered_by_user_id:
      Number.isFinite(Number(enteredByUserId)) && Number(enteredByUserId) > 0
        ? Number(enteredByUserId)
        : null,
    metric_type: "bookinggpt_reach",
    source: sanitizeText(source, 32)?.toLowerCase() || PARTNER_METRIC_SOURCES.socialManual,
    period_start: start.format("YYYY-MM-DD"),
    period_end: end.format("YYYY-MM-DD"),
    value: Math.round(numericValue),
    note: sanitizeText(note, 2000),
    meta: meta && typeof meta === "object" ? meta : null,
  });
};

export const listPartnerMetricAdjustments = async ({ hotelId, limit = 12 }) => {
  const normalizedHotelId = sanitizeText(hotelId, 64);
  if (!normalizedHotelId) {
    const error = new Error("hotelId is required");
    error.status = 400;
    throw error;
  }
  return models.PartnerMetricAdjustment.findAll({
    where: {
      hotel_id: normalizedHotelId,
      metric_type: "bookinggpt_reach",
    },
    include: [
      {
        model: models.User,
        as: "enteredBy",
        required: false,
        attributes: ["id", "name", "email"],
      },
    ],
    order: [["created_at", "DESC"]],
    limit: Math.max(1, Math.min(Number(limit) || 12, 50)),
  });
};

export const getPartnerMonthlyReportSnapshot = async ({
  claim,
  month = null,
  now = new Date(),
}) => {
  if (!claim?.hotel_id) return null;
  const referenceMonth = month ? dayjs(`${month}-01`) : dayjs(now).startOf("month");
  const currentMonth = referenceMonth.isValid() ? referenceMonth.startOf("month") : dayjs(now).startOf("month");
  const previousMonth = currentMonth.subtract(1, "month");
  const currentStart = currentMonth.startOf("month");
  const currentEnd = currentMonth.endOf("month");
  const previousStart = previousMonth.startOf("month");
  const previousEnd = previousMonth.endOf("month");

  const [eventRows, adjustmentRows] = await Promise.all([
    models.PartnerMetricEvent.findAll({
      where: {
        hotel_id: String(claim.hotel_id),
        created_at: { [Op.gte]: previousStart.toDate(), [Op.lte]: currentEnd.toDate() },
      },
      attributes: ["hotel_id", "event_type", "surface", "created_at"],
      order: [["created_at", "DESC"]],
    }),
    models.PartnerMetricAdjustment.findAll({
      where: {
        hotel_id: String(claim.hotel_id),
        metric_type: "bookinggpt_reach",
        period_end: { [Op.gte]: previousStart.format("YYYY-MM-DD") },
        period_start: { [Op.lte]: currentEnd.format("YYYY-MM-DD") },
      },
      attributes: ["hotel_id", "period_start", "period_end", "value"],
      order: [["created_at", "DESC"]],
    }),
  ]);

  const currentSummary = resolveWindowSummary({
    eventRows,
    adjustmentRows,
    hotelId: claim.hotel_id,
    rangeStart: currentStart,
    rangeEnd: currentEnd,
  });
  const previousSummary = resolveWindowSummary({
    eventRows,
    adjustmentRows,
    hotelId: claim.hotel_id,
    rangeStart: previousStart,
    rangeEnd: previousEnd,
  });

  return {
    monthKey: currentMonth.format("YYYY-MM"),
    monthLabel: currentMonth.format("MMMM YYYY"),
    reach: currentSummary.reach,
    clicks: currentSummary.clicks,
    automaticReach: currentSummary.automaticReach,
    manualReach: currentSummary.manualReach,
    ctrPercent: currentSummary.reach > 0 ? Math.round((currentSummary.clicks / currentSummary.reach) * 1000) / 10 : null,
    previousReach: previousSummary.reach,
    previousClicks: previousSummary.clicks,
    previousCtrPercent:
      previousSummary.reach > 0 ? Math.round((previousSummary.clicks / previousSummary.reach) * 1000) / 10 : null,
    reachDeltaPercent: computeDeltaPercent(currentSummary.reach, previousSummary.reach),
    clicksDeltaPercent: computeDeltaPercent(currentSummary.clicks, previousSummary.clicks),
    surfaceSummary: currentSummary.surfaceSummary,
  };
};

export const getPartnerCompetitorInsights = async ({ claim, now = new Date() }) => {
  const city = String(claim?.hotel?.city_name || "").trim();
  if (!city || !claim?.hotel_id) {
    return {
      city: city || null,
      cohortSize: 0,
      averageReach: null,
      averageClicks: null,
      averageCtrPercent: null,
      reachVsCityPercent: null,
      clicksVsCityPercent: null,
      hotelRankInCity: null,
    };
  }

  const cityClaims = await models.PartnerHotelClaim.findAll({
    include: [
      {
        model: models.WebbedsHotel,
        as: "hotel",
        required: true,
        where: { city_name: { [iLikeOp]: city } },
      },
    ],
  });
  const hotelIds = cityClaims.map((entry) => String(entry.hotel_id));
  if (!hotelIds.length) {
    return {
      city,
      cohortSize: 0,
      averageReach: null,
      averageClicks: null,
      averageCtrPercent: null,
      reachVsCityPercent: null,
      clicksVsCityPercent: null,
      hotelRankInCity: null,
    };
  }

  const windowEnd = dayjs(now).endOf("day");
  const windowStart = windowEnd.subtract(29, "day").startOf("day");
  const [eventRows, adjustmentRows] = await Promise.all([
    models.PartnerMetricEvent.findAll({
      where: {
        hotel_id: { [Op.in]: hotelIds },
        created_at: { [Op.gte]: windowStart.toDate(), [Op.lte]: windowEnd.toDate() },
      },
      attributes: ["hotel_id", "event_type", "surface", "created_at"],
    }),
    models.PartnerMetricAdjustment.findAll({
      where: {
        hotel_id: { [Op.in]: hotelIds },
        metric_type: "bookinggpt_reach",
        period_end: { [Op.gte]: windowStart.format("YYYY-MM-DD") },
        period_start: { [Op.lte]: windowEnd.format("YYYY-MM-DD") },
      },
      attributes: ["hotel_id", "period_start", "period_end", "value"],
    }),
  ]);

  const cohort = cityClaims.map((entry) => {
    const summary = resolveWindowSummary({
      eventRows,
      adjustmentRows,
      hotelId: entry.hotel_id,
      rangeStart: windowStart,
      rangeEnd: windowEnd,
    });
    return {
      hotelId: String(entry.hotel_id),
      reach: summary.reach,
      clicks: summary.clicks,
      ctrPercent: summary.reach > 0 ? Math.round((summary.clicks / summary.reach) * 1000) / 10 : null,
    };
  });

  const averageReach = cohort.length ? Math.round(cohort.reduce((sum, item) => sum + item.reach, 0) / cohort.length) : null;
  const averageClicks = cohort.length ? Math.round(cohort.reduce((sum, item) => sum + item.clicks, 0) / cohort.length) : null;
  const ctrValues = cohort.map((item) => item.ctrPercent).filter((value) => Number.isFinite(value));
  const averageCtrPercent = ctrValues.length ? Math.round((ctrValues.reduce((sum, value) => sum + value, 0) / ctrValues.length) * 10) / 10 : null;
  const sortedByReach = [...cohort].sort((left, right) => right.reach - left.reach);
  const self = cohort.find((item) => item.hotelId === String(claim.hotel_id)) || null;
  const hotelRankInCity = self ? sortedByReach.findIndex((item) => item.hotelId === self.hotelId) + 1 : null;

  return {
    city,
    cohortSize: cohort.length,
    averageReach,
    averageClicks,
    averageCtrPercent,
    reachVsCityPercent:
      self && Number.isFinite(averageReach) && averageReach > 0
        ? Math.round((((self.reach - averageReach) / averageReach) * 100) * 10) / 10
        : null,
    clicksVsCityPercent:
      self && Number.isFinite(averageClicks) && averageClicks > 0
        ? Math.round((((self.clicks - averageClicks) / averageClicks) * 100) * 10) / 10
        : null,
    hotelRankInCity,
    lookbackDays: 30,
  };
};

export const attachPartnerAdvancedInsightsToClaims = async (claims = [], { now = new Date() } = {}) => {
  const list = Array.isArray(claims) ? claims.filter(Boolean) : [];
  if (!list.length) return list;

  for (const claim of list) {
    const [monthlyReport, competitorInsights] = await Promise.all([
      getPartnerMonthlyReportSnapshot({ claim, now }).catch(() => null),
      getPartnerCompetitorInsights({ claim, now }).catch(() => null),
    ]);
    if (typeof claim?.setDataValue === "function") {
      claim.setDataValue("partnerMonthlyReport", monthlyReport);
      claim.setDataValue("partnerCompetitorInsights", competitorInsights);
    } else {
      claim.partnerMonthlyReport = monthlyReport;
      claim.partnerCompetitorInsights = competitorInsights;
    }
  }

  return list;
};
