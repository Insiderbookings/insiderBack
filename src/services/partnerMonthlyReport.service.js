import { Op, col, fn } from "sequelize";
import models from "../models/index.js";
import {
  buildPartnerMonthlyReportFilename,
  bufferPartnerMonthlyReportPdf,
  formatPartnerMonthlyReportDateLabel,
  formatPartnerMonthlyReportShortDate,
} from "../helpers/partnerMonthlyReportPdf.js";
import { resolvePartnerProgramFromClaim } from "./partnerCatalog.service.js";
import { resolvePartnerInquiryConfiguration } from "./partnerInquiry.service.js";
import { buildPartnerHotelProfileAssociation } from "./partnerHotelProfileSchema.service.js";
import { sendPartnerMonthlyReportEmail } from "./partnerEmail.service.js";

export const PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES = Object.freeze({
  pending: "PENDING",
  sent: "SENT",
  failed: "FAILED",
  skipped: "SKIPPED",
});

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;
const REPORT_HISTORY_LIMIT = 6;

const normalizeCount = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric);
};

const normalizeEmail = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
};

const toObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const formatCount = (value) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(normalizeCount(value));

const buildMonthKey = (year, monthIndex) =>
  `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}`;

const parseMonthKey = (value) => {
  const normalized = String(value || "").trim();
  if (!MONTH_KEY_PATTERN.test(normalized)) return null;
  const year = Number(normalized.slice(0, 4));
  const monthIndex = Number(normalized.slice(5, 7)) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }
  return {
    key: normalized,
    year,
    monthIndex,
  };
};

const toMonthRange = (monthKey) => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  const start = new Date(Date.UTC(parsed.year, parsed.monthIndex, 1));
  const end = new Date(Date.UTC(parsed.year, parsed.monthIndex + 1, 1));
  const previousKey = parsed.monthIndex === 0
    ? buildMonthKey(parsed.year - 1, 11)
    : buildMonthKey(parsed.year, parsed.monthIndex - 1);
  return {
    ...parsed,
    start,
    end,
    monthStartDateOnly: `${parsed.key}-01`,
    label: formatPartnerMonthlyReportDateLabel(start),
    previousKey,
  };
};

const getLatestClosedMonthKey = (now = new Date()) => {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  if (monthIndex === 0) return buildMonthKey(year - 1, 11);
  return buildMonthKey(year, monthIndex - 1);
};

export const resolvePartnerMonthlyReportMonth = (
  value,
  { now = new Date(), fallbackToLatestClosed = true } = {},
) => {
  const parsed = parseMonthKey(value);
  if (parsed) return parsed.key;
  return fallbackToLatestClosed ? getLatestClosedMonthKey(now) : null;
};

export const formatPartnerMonthlyReportMonthLabel = (value) => {
  const range = toMonthRange(resolvePartnerMonthlyReportMonth(value, { fallbackToLatestClosed: false }));
  return range?.label || null;
};

export const buildPartnerMonthlyReportComparison = (current, previous) => {
  const safeCurrent = normalizeCount(current);
  const safePrevious = normalizeCount(previous);
  const delta = safeCurrent - safePrevious;
  let direction = "flat";
  if (safePrevious <= 0 && safeCurrent > 0) {
    direction = "new";
  } else if (delta > 0) {
    direction = "up";
  } else if (delta < 0) {
    direction = "down";
  }
  const percentage =
    safePrevious > 0 ? Math.round((Math.abs(delta) / safePrevious) * 100) : safeCurrent > 0 ? 100 : 0;
  return {
    current: safeCurrent,
    previous: safePrevious,
    delta,
    direction,
    percentage,
  };
};

const readNestedMetaNumber = (source, path = []) => {
  let current = source;
  for (const segment of path) {
    if (!current || typeof current !== "object") return null;
    current = current[segment];
  }
  const numeric = Number(current);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
};

const readFirstMetaNumber = (sources = [], paths = []) => {
  for (const source of sources) {
    for (const path of paths) {
      const found = readNestedMetaNumber(source, path);
      if (found != null) return found;
    }
  }
  return 0;
};

const resolvePartnerPerformanceSnapshotMeta = (claim) => {
  const meta = toObject(claim?.meta);
  const sources = [
    toObject(meta.partnerPerformance),
    toObject(meta.performance),
    toObject(meta.bookingGptReach),
    toObject(meta.reach),
    meta,
  ];

  const manualViews = readFirstMetaNumber(sources, [
    ["manualViews"],
    ["manual_views"],
    ["adminAddedViews"],
    ["admin_added_views"],
    ["manualReach"],
    ["manual_reach"],
  ]);
  const socialViews = readFirstMetaNumber(sources, [
    ["socialViews"],
    ["social_views"],
    ["socialReach"],
    ["social_reach"],
  ]);
  const directClicks = readFirstMetaNumber(sources, [
    ["clicks"],
    ["click_total"],
    ["totalClicks"],
    ["total_clicks"],
  ]);
  const manualClicks = readFirstMetaNumber(sources, [
    ["manualClicks"],
    ["manual_clicks"],
  ]);
  const socialClicks = readFirstMetaNumber(sources, [
    ["socialClicks"],
    ["social_clicks"],
  ]);
  const destinationEmailClicks = readFirstMetaNumber(sources, [
    ["destinationEmailClicks"],
    ["destination_email_clicks"],
  ]);

  return {
    manualViews,
    socialViews,
    clicks: directClicks || manualClicks + socialClicks + destinationEmailClicks,
  };
};

const buildInquiryStatusCountMap = (rows = []) =>
  new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [
      String(row?.delivery_status || "").trim().toUpperCase(),
      normalizeCount(row?.count),
    ]),
  );

const resolvePartnerMonthlyReportDeliveryDetail = (report) => {
  const status = String(report?.delivery_status || "").trim().toUpperCase();
  if (status === PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.sent) {
    return report?.delivered_to_email
      ? `Sent to ${report.delivered_to_email}`
      : "Sent to the partner contact email";
  }
  if (status === PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.failed) {
    return report?.delivery_error || "Email delivery failed";
  }
  if (status === PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.skipped) {
    return report?.delivery_error || "Generated without email delivery";
  }
  return "Generated and ready for download";
};

const serializePartnerMonthlyReport = (report) => {
  const metrics = toObject(report?.metrics);
  const summary = toObject(report?.summary);
  return {
    reportId: Number(report?.id || 0) || null,
    reportMonth: report?.report_month ? String(report.report_month).slice(0, 7) : null,
    reportMonthLabel: metrics.reportMonthLabel || null,
    generatedAt: report?.generated_at || null,
    sentAt: report?.sent_at || null,
    deliveredToEmail: report?.delivered_to_email || null,
    deliveryStatus: report?.delivery_status || PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.pending,
    deliveryDetail: resolvePartnerMonthlyReportDeliveryDetail(report),
    lastDownloadedAt: report?.last_downloaded_at || null,
    headline: summary.headline || null,
    highlights: Array.isArray(summary.highlights) ? summary.highlights : [],
    nextActions: Array.isArray(summary.nextActions) ? summary.nextActions : [],
    partialMonthNote: summary.partialMonthNote || null,
    metrics: {
      trackedViews: normalizeCount(metrics?.visibility?.trackedViews?.current),
      trackedViewsPrevious: normalizeCount(metrics?.visibility?.trackedViews?.previous),
      trackedViewsChange: metrics?.visibility?.trackedViews || buildPartnerMonthlyReportComparison(0, 0),
      favoritesAdded: normalizeCount(metrics?.favorites?.newThisMonth?.current),
      favoritesAddedPrevious: normalizeCount(metrics?.favorites?.newThisMonth?.previous),
      inquiriesTotal: normalizeCount(metrics?.inquiries?.total?.current),
      inquiriesDelivered: normalizeCount(metrics?.inquiries?.delivered),
      inquiryDeliveryIssues: normalizeCount(metrics?.inquiries?.deliveryIssues),
      clicksSnapshot: normalizeCount(metrics?.visibility?.clicksSnapshot),
      profileCompletionPercent: normalizeCount(metrics?.profile?.completionPercent),
      inquiryReady: Boolean(metrics?.profile?.inquiryReady),
      specialOffersEnabled: Boolean(metrics?.profile?.specialOffersEnabled),
    },
  };
};

const ensureClaimReportContext = async (claim) => {
  if (!claim?.id) return null;
  if (claim.hotel && Object.prototype.hasOwnProperty.call(claim, "hotelProfile")) {
    return claim;
  }
  return models.PartnerHotelClaim.findByPk(claim.id, {
    include: [
      {
        model: models.WebbedsHotel,
        as: "hotel",
        required: false,
      },
      {
        model: models.User,
        as: "user",
        required: false,
        attributes: ["id", "name", "email"],
      },
      await buildPartnerHotelProfileAssociation(),
    ],
  });
};

const assertPartnerMonthlyReportCapability = (partnerProgram) => {
  if (partnerProgram?.capabilities?.monthlyPdfReport) return;
  const error = new Error("Monthly PDF reports are only available in the Featured plan.");
  error.status = 403;
  throw error;
};

const buildPeriodWindowNote = ({ claim, monthRange }) => {
  const claimedAt = claim?.claimed_at ? new Date(claim.claimed_at) : null;
  if (!(claimedAt instanceof Date) || Number.isNaN(claimedAt.getTime())) return null;
  if (claimedAt < monthRange.start || claimedAt >= monthRange.end) return null;
  return `This report covers a partial month because the partner claim went live on ${formatPartnerMonthlyReportShortDate(claimedAt)}.`;
};

export const buildPartnerMonthlyReportSummary = ({
  claim,
  monthRange,
  metrics,
  partnerProgram = null,
} = {}) => {
  const trackedViews = normalizeCount(metrics?.visibility?.trackedViews?.current);
  const trackedDelta = normalizeCount(metrics?.visibility?.trackedViews?.delta);
  const favoritesAdded = normalizeCount(metrics?.favorites?.newThisMonth?.current);
  const inquiriesTotal = normalizeCount(metrics?.inquiries?.total?.current);
  const delivered = normalizeCount(metrics?.inquiries?.delivered);
  const deliveryIssues = normalizeCount(metrics?.inquiries?.deliveryIssues);
  const inquiryReady = Boolean(metrics?.profile?.inquiryReady);
  const profileCompletionPercent = normalizeCount(metrics?.profile?.completionPercent);
  const specialOffersEnabled = Boolean(metrics?.profile?.specialOffersEnabled);

  let headline = `${monthRange?.label || "Monthly"} visibility summary`;
  if (inquiriesTotal > 0 && delivered > 0) {
    headline = "Traveler attention turned into direct hotel leads.";
  } else if (trackedViews >= 250 && trackedDelta >= 0) {
    headline = "The hotel stayed visible in BookingGPT and kept momentum during the month.";
  } else if (trackedViews > 0) {
    headline = "Visibility is building, but there is still room to convert attention into leads.";
  } else {
    headline = "This month was mostly about setup rather than measurable traveler demand.";
  }

  const highlights = [
    `${formatCount(trackedViews)} tracked views were recorded in ${monthRange?.label || "the reporting month"}.`,
    inquiriesTotal > 0
      ? `${formatCount(inquiriesTotal)} traveler inquiries were submitted, and ${formatCount(delivered)} reached the hotel inbox.`
      : "No traveler inquiries were submitted during this reporting month.",
    favoritesAdded > 0
      ? `${formatCount(favoritesAdded)} new favorites were added by travelers.`
      : "Favorite growth was quiet during this reporting month.",
  ];

  if (deliveryIssues > 0) {
    highlights.push(`${formatCount(deliveryIssues)} inquiry deliveries need attention so future leads are not lost.`);
  }

  const nextActions = [];
  if (partnerProgram?.capabilities?.bookingInquiry && !inquiryReady) {
    nextActions.push(
      "Complete the inquiry routing setup so travelers can contact the hotel directly from BookingGPT.",
    );
  }
  if (partnerProgram?.capabilities?.specialOffers && !specialOffersEnabled) {
    nextActions.push(
      "Activate a live special offer so the listing gives travelers a clearer reason to reach out or book.",
    );
  }
  if (profileCompletionPercent < 80) {
    nextActions.push(
      "Fill the remaining profile fields to strengthen the public story before the next reporting cycle.",
    );
  }
  if (!nextActions.length && trackedViews > 0 && !inquiriesTotal) {
    nextActions.push(
      "Keep the current visibility live and strengthen the public message so attention converts into direct traveler intent.",
    );
  }
  if (!nextActions.length) {
    nextActions.push(
      "Keep the listing current and compare the next monthly report to see whether visibility keeps compounding.",
    );
  }

  return {
    headline,
    highlights,
    nextActions,
    partialMonthNote: buildPeriodWindowNote({ claim, monthRange }),
  };
};

const canGeneratePartnerMonthlyReportForClaim = ({ claim, monthRange } = {}) => {
  if (!claim?.id || !monthRange?.end) return false;
  if (!claim?.claimed_at) return true;
  const claimedAt = new Date(claim.claimed_at);
  if (Number.isNaN(claimedAt.getTime())) return true;
  return claimedAt < monthRange.end;
};

const buildPartnerMonthlyReportMetrics = async ({ claim, monthRange }) => {
  const previousRange = toMonthRange(monthRange?.previousKey);
  const adjustmentSnapshot = resolvePartnerPerformanceSnapshotMeta(claim);
  const partnerProgram = resolvePartnerProgramFromClaim(claim);
  const inquiryConfig = resolvePartnerInquiryConfiguration({
    claim,
    profile: claim?.hotelProfile,
    partnerProgram,
  });

  const buildDateRange = (start, end) => ({
    [Op.gte]: start,
    [Op.lt]: end,
  });

  const [
    trackedViewsCurrent,
    trackedViewsPrevious,
    favoritesCurrent,
    favoritesPrevious,
    favoritesTotal,
    inquiriesCurrent,
    inquiriesPrevious,
    inquiriesTotalToDate,
    inquiryStatusRows,
  ] = await Promise.all([
    models.HotelRecentView.count({
      where: {
        hotel_id: claim.hotel_id,
        viewed_at: buildDateRange(monthRange.start, monthRange.end),
      },
    }),
    previousRange
      ? models.HotelRecentView.count({
          where: {
            hotel_id: claim.hotel_id,
            viewed_at: buildDateRange(previousRange.start, previousRange.end),
          },
        })
      : 0,
    models.HotelFavorite.count({
      where: {
        hotel_id: claim.hotel_id,
        created_at: buildDateRange(monthRange.start, monthRange.end),
      },
    }),
    previousRange
      ? models.HotelFavorite.count({
          where: {
            hotel_id: claim.hotel_id,
            created_at: buildDateRange(previousRange.start, previousRange.end),
          },
        })
      : 0,
    models.HotelFavorite.count({
      where: {
        hotel_id: claim.hotel_id,
      },
    }),
    models.PartnerHotelInquiry.count({
      where: {
        claim_id: claim.id,
        created_at: buildDateRange(monthRange.start, monthRange.end),
      },
    }),
    previousRange
      ? models.PartnerHotelInquiry.count({
          where: {
            claim_id: claim.id,
            created_at: buildDateRange(previousRange.start, previousRange.end),
          },
        })
      : 0,
    models.PartnerHotelInquiry.count({
      where: {
        claim_id: claim.id,
      },
    }),
    models.PartnerHotelInquiry.findAll({
      attributes: ["delivery_status", [fn("COUNT", col("id")), "count"]],
      where: {
        claim_id: claim.id,
        created_at: buildDateRange(monthRange.start, monthRange.end),
      },
      group: ["delivery_status"],
      raw: true,
    }),
  ]);

  const inquiryStatusCounts = buildInquiryStatusCountMap(inquiryStatusRows);

  return {
    reportMonth: monthRange.key,
    reportMonthLabel: monthRange.label,
    reportMonthStart: monthRange.monthStartDateOnly,
    previousReportMonth: previousRange?.key || null,
    previousReportMonthLabel: previousRange?.label || null,
    visibility: {
      trackedViews: buildPartnerMonthlyReportComparison(trackedViewsCurrent, trackedViewsPrevious),
      manualViewsSnapshot: normalizeCount(adjustmentSnapshot.manualViews),
      socialViewsSnapshot: normalizeCount(adjustmentSnapshot.socialViews),
      adminAddedViewsSnapshot:
        normalizeCount(adjustmentSnapshot.manualViews) + normalizeCount(adjustmentSnapshot.socialViews),
      clicksSnapshot: normalizeCount(adjustmentSnapshot.clicks),
    },
    favorites: {
      newThisMonth: buildPartnerMonthlyReportComparison(favoritesCurrent, favoritesPrevious),
      totalToDate: normalizeCount(favoritesTotal),
    },
    inquiries: {
      total: buildPartnerMonthlyReportComparison(inquiriesCurrent, inquiriesPrevious),
      totalToDate: normalizeCount(inquiriesTotalToDate),
      delivered: normalizeCount(
        inquiryStatusCounts.get(PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.sent) || 0,
      ),
      deliveryIssues: normalizeCount(
        inquiryStatusCounts.get(PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.failed) || 0,
      ),
      pending: normalizeCount(
        inquiryStatusCounts.get(PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.pending) || 0,
      ),
    },
    profile: {
      completionPercent: normalizeCount(claim?.hotelProfile?.profile_completion),
      inquiryReady: Boolean(inquiryConfig.ready),
      inquiryEnabled: Boolean(inquiryConfig.enabled),
      specialOffersEnabled: Boolean(claim?.hotelProfile?.special_offers_enabled),
    },
  };
};

const findPartnerMonthlyReportForClaim = async ({ claimId, reportMonth }) => {
  if (!claimId || !reportMonth) return null;
  return models.PartnerMonthlyReport.findOne({
    where: {
      claim_id: claimId,
      report_month: `${reportMonth}-01`,
    },
  });
};

const createPartnerMonthlyReportForClaim = async ({ claim, reportMonth, now = new Date() }) => {
  const monthRange = toMonthRange(reportMonth);
  if (!monthRange || !canGeneratePartnerMonthlyReportForClaim({ claim, monthRange })) return null;

  const metrics = await buildPartnerMonthlyReportMetrics({ claim, monthRange });
  const partnerProgram = resolvePartnerProgramFromClaim(claim, now);
  const summary = buildPartnerMonthlyReportSummary({
    claim,
    monthRange,
    metrics,
    partnerProgram: partnerProgram?.capabilities ? partnerProgram : null,
  });

  return models.PartnerMonthlyReport.create({
    claim_id: claim.id,
    hotel_id: claim.hotel_id,
    report_month: monthRange.monthStartDateOnly,
    generated_at: now,
    delivery_status: PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.pending,
    delivered_to_email: normalizeEmail(claim?.contact_email || claim?.user?.email || null),
    metrics,
    summary,
    meta: {
      generatedBy: "partner-monthly-report-service",
    },
  });
};

const ensurePartnerMonthlyReportRecord = async ({
  claim,
  reportMonth,
  now = new Date(),
} = {}) => {
  const resolvedMonth = resolvePartnerMonthlyReportMonth(reportMonth, { now });
  if (!resolvedMonth) return null;
  const existing = await findPartnerMonthlyReportForClaim({
    claimId: claim?.id,
    reportMonth: resolvedMonth,
  });
  if (existing) return existing;
  return createPartnerMonthlyReportForClaim({
    claim,
    reportMonth: resolvedMonth,
    now,
  });
};

const deliverPartnerMonthlyReport = async ({ claim, report, now = new Date() } = {}) => {
  const destinationEmail = normalizeEmail(
    report?.delivered_to_email || claim?.contact_email || claim?.user?.email || null,
  );
  if (!destinationEmail) {
    await report.update({
      delivery_status: PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.skipped,
      delivered_to_email: null,
      delivery_error: "Missing partner contact email for monthly report delivery.",
    });
    return {
      skipped: true,
      reason: "missing-contact-email",
      report,
    };
  }

  const pdfBuffer = await bufferPartnerMonthlyReportPdf({
    claim,
    hotel: claim?.hotel,
    report,
  });

  await sendPartnerMonthlyReportEmail({
    claim,
    hotel: claim?.hotel,
    report,
    pdfBuffer,
    destinationEmail,
  });

  await report.update({
    delivery_status: PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.sent,
    sent_at: now,
    delivered_to_email: destinationEmail,
    delivery_error: null,
  });

  return {
    skipped: false,
    sent: true,
    report,
  };
};

export const getPartnerMonthlyReportOverviewForClaim = async ({
  claim,
  now = new Date(),
} = {}) => {
  const resolvedClaim = await ensureClaimReportContext(claim);
  if (!resolvedClaim) {
    const error = new Error("Partner claim not found");
    error.status = 404;
    throw error;
  }

  const partnerProgram = resolvePartnerProgramFromClaim(resolvedClaim, now);
  assertPartnerMonthlyReportCapability(partnerProgram);
  const latestClosedMonth = getLatestClosedMonthKey(now);

  await ensurePartnerMonthlyReportRecord({
    claim: resolvedClaim,
    reportMonth: latestClosedMonth,
    now,
  });

  const rows = await models.PartnerMonthlyReport.findAll({
    where: {
      claim_id: resolvedClaim.id,
    },
    order: [["report_month", "DESC"], ["id", "DESC"]],
    limit: REPORT_HISTORY_LIMIT,
  });

  return {
    capabilityEnabled: true,
    recommendedReportMonth: latestClosedMonth,
    recommendedReportMonthLabel: formatPartnerMonthlyReportMonthLabel(latestClosedMonth),
    items: rows.map((row) => serializePartnerMonthlyReport(row)),
  };
};

export const getPartnerMonthlyReportPdfDownloadForClaim = async ({
  claim,
  reportMonth = null,
  now = new Date(),
} = {}) => {
  const resolvedClaim = await ensureClaimReportContext(claim);
  if (!resolvedClaim) {
    const error = new Error("Partner claim not found");
    error.status = 404;
    throw error;
  }

  const resolvedMonth = resolvePartnerMonthlyReportMonth(reportMonth, { now });
  const partnerProgram = resolvePartnerProgramFromClaim(resolvedClaim, now);
  assertPartnerMonthlyReportCapability(partnerProgram);
  let report = await findPartnerMonthlyReportForClaim({
    claimId: resolvedClaim.id,
    reportMonth: resolvedMonth,
  });

  if (!report) {
    report = await ensurePartnerMonthlyReportRecord({
      claim: resolvedClaim,
      reportMonth: resolvedMonth,
      now,
    });
  }

  if (!report) {
    const error = new Error("Monthly report not found");
    error.status = 404;
    throw error;
  }

  const pdfBuffer = await bufferPartnerMonthlyReportPdf({
    claim: resolvedClaim,
    hotel: resolvedClaim.hotel,
    report,
  });
  await report.update({
    last_downloaded_at: now,
  });

  return {
    buffer: pdfBuffer,
    filename: buildPartnerMonthlyReportFilename({
      hotelId: resolvedClaim.hotel_id,
      reportMonth: resolvedMonth,
    }),
    report,
  };
};

export const sendPartnerMonthlyReportIfDueForClaim = async ({
  claim,
  now = new Date(),
} = {}) => {
  const resolvedClaim = await ensureClaimReportContext(claim);
  if (!resolvedClaim) {
    return {
      skipped: true,
      reason: "missing-claim",
    };
  }

  const partnerProgram = resolvePartnerProgramFromClaim(resolvedClaim, now);
  if (!partnerProgram?.capabilities?.monthlyPdfReport) {
    return {
      skipped: true,
      reason: "capability-disabled",
    };
  }

  const report = await ensurePartnerMonthlyReportRecord({
    claim: resolvedClaim,
    reportMonth: getLatestClosedMonthKey(now),
    now,
  });

  if (!report) {
    return {
      skipped: true,
      reason: "no-report-window",
    };
  }

  const deliveryStatus = String(report.delivery_status || "").trim().toUpperCase();
  if (deliveryStatus === PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.sent) {
    return {
      skipped: true,
      reason: "already-sent",
      report,
    };
  }

  try {
    return await deliverPartnerMonthlyReport({
      claim: resolvedClaim,
      report,
      now,
    });
  } catch (error) {
    await report.update({
      delivery_status: PARTNER_MONTHLY_REPORT_DELIVERY_STATUSES.failed,
      delivered_to_email: normalizeEmail(resolvedClaim?.contact_email || resolvedClaim?.user?.email || null),
      delivery_error: String(error?.message || "Monthly report email delivery failed"),
    });
    return {
      skipped: false,
      sent: false,
      error,
      report,
    };
  }
};
