import dayjs from "dayjs";
import { Op, col, fn } from "sequelize";
import models from "../models/index.js";
import { getCaseInsensitiveLikeOp } from "../utils/sequelizeHelpers.js";
import {
  PARTNER_CLAIM_STATUSES,
  PARTNER_EMAIL_SEQUENCE,
  PARTNER_PAYMENT_METHODS,
  PARTNER_SUBSCRIPTION_STATUSES,
  PARTNER_TRIAL_DAYS,
  getPartnerPlanByCode,
  getPartnerPlans,
  normalizePartnerPlanCode,
  resolvePartnerBadgePriority as resolveProgramBadgePriority,
  resolvePartnerProgramFromClaim,
  resolvePartnerStripePriceId,
} from "./partnerCatalog.service.js";
import {
  sendPartnerInternalInvoiceAlert,
  sendPartnerLifecycleEmail,
} from "./partnerEmail.service.js";
import {
  applyEffectivePartnerProfilesToHotelItems,
  getPartnerClaimsWithProfilesByHotelIds,
} from "./partnerHotelProfile.service.js";
import { buildPartnerTrialSimulationDates } from "./partnerTrialSimulation.service.js";

const iLikeOp = getCaseInsensitiveLikeOp();

const getStripeClient = async () => {
  const { default: Stripe } = await import("stripe");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });
};

const normalizePlanCode = (value) =>
  normalizePartnerPlanCode(value) || String(value || "").trim().toLowerCase();
const normalizePaymentMethod = (value) =>
  String(value || "").trim().toLowerCase() || PARTNER_PAYMENT_METHODS.card;
const toNow = () => new Date();
const PARTNER_REACH_WINDOW_DAYS = Math.max(
  30,
  Number(process.env.PARTNER_REACH_WINDOW_DAYS || 90),
);
const PARTNER_WEEKLY_WINDOW_DAYS = 7;

const PARTNER_DASHBOARD_HOTEL_ATTRIBUTES = Object.freeze([
  "hotel_id",
  "name",
  "city_name",
  "country_name",
  "address",
]);

const PARTNER_EMAIL_LOG_ATTRIBUTES = Object.freeze([
  "id",
  "email_key",
  "delivery_status",
  "sent_at",
]);

const normalizeCount = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric);
};

const toObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export const PARTNER_CLAIM_SOURCES = Object.freeze({
  verify: "verify",
  search: "search",
});

const normalizePartnerClaimSource = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === PARTNER_CLAIM_SOURCES.verify) return PARTNER_CLAIM_SOURCES.verify;
  if (
    [
      PARTNER_CLAIM_SOURCES.search,
      "manual",
      "hotel_search",
      "selection",
      "partners_web",
    ].includes(normalized)
  ) {
    return PARTNER_CLAIM_SOURCES.search;
  }
  return null;
};

export const getPartnerClaimReviewState = (claim) => {
  const meta = toObject(claim?.meta);
  const review = toObject(meta.review);
  const source =
    normalizePartnerClaimSource(review.source || meta.claimSource) ||
    (claim?.trial_started_at ? PARTNER_CLAIM_SOURCES.verify : PARTNER_CLAIM_SOURCES.search);
  const requiresManualApproval = Boolean(review.requiresManualApproval);
  const approvedAt = review.approvedAt || review.approved_at || null;
  const requestedAt = review.requestedAt || review.requested_at || claim?.claimed_at || null;
  const blocked = requiresManualApproval && !approvedAt;
  return {
    source,
    requiresManualApproval,
    approvedAt,
    requestedAt,
    approvedByUserId: review.approvedByUserId || review.approved_by_user_id || null,
    blocked,
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

const buildPartnerPerformanceSnapshot = ({
  trackedViews = 0,
  trackedViewsLast7Days = 0,
  travelersViewedToday = 0,
  favoritesCount = 0,
  manualViews = 0,
  socialViews = 0,
  clicks = 0,
  windowDays = PARTNER_REACH_WINDOW_DAYS,
} = {}) => {
  const safeTrackedViews = normalizeCount(trackedViews);
  const safeTrackedViewsLast7Days = normalizeCount(trackedViewsLast7Days);
  const safeTravelersViewedToday = normalizeCount(travelersViewedToday);
  const safeFavoritesCount = normalizeCount(favoritesCount);
  const safeManualViews = normalizeCount(manualViews);
  const safeSocialViews = normalizeCount(socialViews);
  const safeClicks = normalizeCount(clicks);
  const adminAddedViews = safeManualViews + safeSocialViews;

  return {
    bookingGptReach: {
      total: safeTrackedViews + adminAddedViews,
      trackedViews: safeTrackedViews,
      adminAddedViews,
      manualViews: safeManualViews,
      socialViews: safeSocialViews,
      last7Days: safeTrackedViewsLast7Days,
      windowDays: Math.max(7, Number(windowDays) || PARTNER_REACH_WINDOW_DAYS),
    },
    clicks: {
      total: safeClicks,
    },
    favorites: {
      total: safeFavoritesCount,
    },
    views: {
      today: safeTravelersViewedToday,
      last7Days: safeTrackedViewsLast7Days,
      windowDays: Math.max(7, Number(windowDays) || PARTNER_REACH_WINDOW_DAYS),
    },
    softPressure: {
      travelersViewedToday: safeTravelersViewedToday,
    },
  };
};

const resolvePartnerPerformanceAdjustments = (claim) => {
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

const getUtcStartOfDay = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const buildGroupedCountMap = (rows = [], keyField = "hotel_id") => {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = row?.[keyField] != null ? String(row[keyField]) : null;
    if (!key) return;
    map.set(key, normalizeCount(row?.count));
  });
  return map;
};

export const fetchPartnerPerformanceByHotelIds = async (
  hotelIds = [],
  claims = [],
  { now = new Date(), reachWindowDays = PARTNER_REACH_WINDOW_DAYS } = {},
) => {
  const targetIds = Array.from(
    new Set(
      (Array.isArray(hotelIds) ? hotelIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (!targetIds.length) return new Map();

  const claimMap =
    claims instanceof Map
      ? claims
      : new Map(
          (Array.isArray(claims) ? claims : [])
            .filter(Boolean)
            .map((claim) => [String(claim.hotel_id), claim]),
        );

  const safeWindowDays = Math.max(7, Number(reachWindowDays) || PARTNER_REACH_WINDOW_DAYS);
  const reachSince = new Date(now.getTime() - safeWindowDays * 24 * 60 * 60 * 1000);
  const weeklySince = new Date(now.getTime() - PARTNER_WEEKLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const todayStart = getUtcStartOfDay(now);

  const [reachRows, weeklyRows, todayRows, favoritesRows] = await Promise.all([
    models.HotelRecentView.findAll({
      attributes: ["hotel_id", [fn("COUNT", col("id")), "count"]],
      where: {
        hotel_id: { [Op.in]: targetIds },
        viewed_at: { [Op.gte]: reachSince },
      },
      group: ["hotel_id"],
      raw: true,
    }),
    models.HotelRecentView.findAll({
      attributes: ["hotel_id", [fn("COUNT", col("id")), "count"]],
      where: {
        hotel_id: { [Op.in]: targetIds },
        viewed_at: { [Op.gte]: weeklySince },
      },
      group: ["hotel_id"],
      raw: true,
    }),
    models.HotelRecentView.findAll({
      attributes: ["hotel_id", [fn("COUNT", col("id")), "count"]],
      where: {
        hotel_id: { [Op.in]: targetIds },
        viewed_at: { [Op.gte]: todayStart },
      },
      group: ["hotel_id"],
      raw: true,
    }),
    models.HotelFavorite.findAll({
      attributes: ["hotel_id", [fn("COUNT", col("id")), "count"]],
      where: {
        hotel_id: { [Op.in]: targetIds },
      },
      group: ["hotel_id"],
      raw: true,
    }),
  ]);

  const reachMap = buildGroupedCountMap(reachRows);
  const weeklyMap = buildGroupedCountMap(weeklyRows);
  const todayMap = buildGroupedCountMap(todayRows);
  const favoritesMap = buildGroupedCountMap(favoritesRows);
  const statsByHotelId = new Map();

  targetIds.forEach((hotelId) => {
    const claim = claimMap.get(String(hotelId)) || null;
    const adjustments = resolvePartnerPerformanceAdjustments(claim);
    statsByHotelId.set(
      String(hotelId),
      buildPartnerPerformanceSnapshot({
        trackedViews: reachMap.get(String(hotelId)) || 0,
        trackedViewsLast7Days: weeklyMap.get(String(hotelId)) || 0,
        travelersViewedToday: todayMap.get(String(hotelId)) || 0,
        favoritesCount: favoritesMap.get(String(hotelId)) || 0,
        manualViews: adjustments.manualViews,
        socialViews: adjustments.socialViews,
        clicks: adjustments.clicks,
        windowDays: safeWindowDays,
      }),
    );
  });

  return statsByHotelId;
};

export const hydratePartnerClaimsPerformance = async (claims = [], options = {}) => {
  const list = Array.isArray(claims) ? claims.filter(Boolean) : [];
  if (!list.length) return list;
  const statsByHotelId = await fetchPartnerPerformanceByHotelIds(
    list.map((claim) => claim?.hotel_id),
    list,
    options,
  );
  list.forEach((claim) => {
    claim.partnerPerformance =
      statsByHotelId.get(String(claim.hotel_id)) ||
      buildPartnerPerformanceSnapshot(resolvePartnerPerformanceAdjustments(claim));
  });
  return list;
};

const extractHotelId = (item) =>
  item?.id ??
  item?.hotel_id ??
  item?.hotelId ??
  item?.hotelCode ??
  item?.hotelDetails?.hotelCode ??
  item?.hotelDetails?.hotelId ??
  null;

const buildClaimInclude = ({
  includeHotel = true,
  hotelAttributes = PARTNER_DASHBOARD_HOTEL_ATTRIBUTES,
  includeEmailLogs = true,
  emailLogAttributes = PARTNER_EMAIL_LOG_ATTRIBUTES,
} = {}) => {
  const include = [];
  if (includeHotel) {
    include.push({
      model: models.WebbedsHotel,
      as: "hotel",
      required: false,
      attributes: Array.isArray(hotelAttributes) ? hotelAttributes : undefined,
    });
  }
  if (includeEmailLogs) {
    include.push({
      model: models.PartnerEmailLog,
      as: "emailLogs",
      required: false,
      attributes: Array.isArray(emailLogAttributes) ? emailLogAttributes : undefined,
    });
  }
  return include;
};

export const searchPartnerHotels = async ({ query, limit = 12 }) => {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];
  const rows = await models.WebbedsHotel.findAll({
    where: {
      name: { [iLikeOp]: `%${trimmed}%` },
    },
    attributes: [
      "hotel_id",
      "name",
      "city_name",
      "country_name",
      "address",
      "priority",
      "images",
    ],
    include: [
      {
        model: models.PartnerHotelClaim,
        as: "partnerClaim",
        required: false,
        attributes: ["id", "claim_status", "user_id", "trial_ends_at", "current_plan_code"],
      },
    ],
    order: [
      ["priority", "DESC"],
      ["name", "ASC"],
    ],
    limit: Math.max(1, Math.min(Number(limit) || 12, 20)),
  });

  return rows.map((row) => {
    const plain = row.get ? row.get({ plain: true }) : row;
    const cover =
      plain?.images?.hotelImages?.thumb ||
      (Array.isArray(plain?.images?.hotelImages?.image) && plain.images.hotelImages.image[0]?.url) ||
      null;
    const claim = plain.partnerClaim || null;
    return {
      hotelId: String(plain.hotel_id),
      name: plain.name,
      city: plain.city_name || null,
      country: plain.country_name || null,
      address: plain.address || null,
      image: cover,
      alreadyClaimed: Boolean(claim),
      claimStatus: claim?.claim_status || null,
    };
  });
};

export const ensurePartnerClaim = async ({
  hotelId,
  userId,
  contactName = null,
  contactEmail = null,
  contactPhone = null,
  claimSource = null,
  requiresManualApproval = false,
}) => {
  const resolvedHotelId = String(hotelId || "").trim();
  const resolvedUserId = Number(userId);
  if (!resolvedHotelId) {
    const error = new Error("hotelId is required");
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(resolvedUserId) || resolvedUserId <= 0) {
    const error = new Error("userId is required");
    error.status = 400;
    throw error;
  }

  const hotel = await models.WebbedsHotel.findByPk(resolvedHotelId, {
    attributes: ["hotel_id", "name", "city_name", "country_name", "address", "images"],
  });
  if (!hotel) {
    const error = new Error("Hotel not found");
    error.status = 404;
    throw error;
  }

  const existing = await models.PartnerHotelClaim.findOne({
    where: { hotel_id: resolvedHotelId },
    include: buildClaimInclude(),
  });

  const now = toNow();
  const normalizedSource =
    normalizePartnerClaimSource(claimSource) ||
    (requiresManualApproval ? PARTNER_CLAIM_SOURCES.search : PARTNER_CLAIM_SOURCES.verify);
  if (existing && Number(existing.user_id) !== resolvedUserId) {
    const error = new Error("This hotel is already claimed");
    error.status = 409;
    throw error;
  }

  if (existing) {
    const updates = {};
    const nextReviewState = getPartnerClaimReviewState(existing);
    const nextMeta = {
      ...toObject(existing.meta),
      review: {
        ...toObject(toObject(existing.meta).review),
        source: nextReviewState.source || normalizedSource,
        requestedAt: nextReviewState.requestedAt || existing.claimed_at || now,
        requiresManualApproval: nextReviewState.requiresManualApproval || Boolean(requiresManualApproval),
        approvedAt:
          nextReviewState.approvedAt ||
          (nextReviewState.requiresManualApproval || requiresManualApproval ? null : now.toISOString()),
        approvedByUserId: nextReviewState.approvedByUserId || null,
      },
    };
    if (contactName) updates.contact_name = contactName;
    if (contactEmail) updates.contact_email = String(contactEmail).trim().toLowerCase();
    if (contactPhone) updates.contact_phone = contactPhone;
    if (!existing.claimed_at) updates.claimed_at = now;
    if (!existing.trial_started_at && !nextReviewState.requiresManualApproval && !requiresManualApproval) {
      updates.trial_started_at = now;
    }
    if (!existing.trial_ends_at && !nextReviewState.requiresManualApproval && !requiresManualApproval) {
      updates.trial_ends_at = dayjs(now).add(PARTNER_TRIAL_DAYS, "day").toDate();
    }
    if (!existing.last_badge_activated_at && !nextReviewState.requiresManualApproval && !requiresManualApproval) {
      updates.last_badge_activated_at = now;
    }
    if (
      !existing.claim_status ||
      [PARTNER_CLAIM_STATUSES.cancelled, PARTNER_CLAIM_STATUSES.pendingReview].includes(existing.claim_status)
    ) {
      updates.claim_status =
        nextReviewState.requiresManualApproval || requiresManualApproval
          ? PARTNER_CLAIM_STATUSES.pendingReview
          : PARTNER_CLAIM_STATUSES.trialActive;
    }
    if (!existing.onboarding_step || existing.onboarding_step === "MANUAL_REVIEW_PENDING") {
      updates.onboarding_step =
        nextReviewState.requiresManualApproval || requiresManualApproval
          ? "MANUAL_REVIEW_PENDING"
          : "CLAIMED";
    }
    updates.meta = nextMeta;
    if (Object.keys(updates).length) await existing.update(updates);
    const refreshed = await models.PartnerHotelClaim.findByPk(existing.id, {
      include: buildClaimInclude(),
    });
    return { claim: refreshed, hotel, created: false };
  }

  const claim = await models.PartnerHotelClaim.create({
    hotel_id: resolvedHotelId,
    user_id: resolvedUserId,
    claim_status: requiresManualApproval
      ? PARTNER_CLAIM_STATUSES.pendingReview
      : PARTNER_CLAIM_STATUSES.trialActive,
    onboarding_step: requiresManualApproval ? "MANUAL_REVIEW_PENDING" : "CLAIMED",
    contact_name: contactName || null,
    contact_email: contactEmail ? String(contactEmail).trim().toLowerCase() : null,
    contact_phone: contactPhone || null,
    claimed_at: now,
    trial_started_at: requiresManualApproval ? null : now,
    trial_ends_at: requiresManualApproval ? null : dayjs(now).add(PARTNER_TRIAL_DAYS, "day").toDate(),
    last_badge_activated_at: requiresManualApproval ? null : now,
    meta: {
      review: {
        source: normalizedSource,
        requestedAt: now.toISOString(),
        requiresManualApproval: Boolean(requiresManualApproval),
        approvedAt: requiresManualApproval ? null : now.toISOString(),
        approvedByUserId: null,
      },
    },
  });

  const hydrated = await models.PartnerHotelClaim.findByPk(claim.id, {
    include: buildClaimInclude(),
  });
  return { claim: hydrated, hotel, created: true };
};

const getOrCreateStripeCustomer = async ({ claim, user, hotel }) => {
  const stripe = await getStripeClient();
  if (claim?.stripe_customer_id) {
    return {
      stripe,
      customerId: claim.stripe_customer_id,
    };
  }

  const customer = await stripe.customers.create({
    email: claim?.contact_email || user?.email || undefined,
    name: claim?.contact_name || user?.name || hotel?.name || undefined,
    metadata: {
      type: "partner_hotel",
      partnerClaimId: String(claim.id),
      hotelId: String(claim.hotel_id),
      userId: String(claim.user_id),
    },
  });

  await claim.update({ stripe_customer_id: customer.id });
  return { stripe, customerId: customer.id };
};

const buildSuccessUrl = ({ hotelId, success }) => {
  const base =
    success ||
    process.env.PARTNERS_CHECKOUT_SUCCESS_URL ||
    process.env.PARTNERS_CLIENT_URL ||
    process.env.CLIENT_URL ||
    "https://bookinggpt.app/partners";
  const url = new URL(base);
  if (hotelId) url.searchParams.set("hotelId", String(hotelId));
  url.searchParams.set("checkout", "success");
  return url.toString();
};

const buildCancelUrl = ({ hotelId, cancel }) => {
  const base =
    cancel ||
    process.env.PARTNERS_CHECKOUT_CANCEL_URL ||
    process.env.PARTNERS_CLIENT_URL ||
    process.env.CLIENT_URL ||
    "https://bookinggpt.app/partners";
  const url = new URL(base);
  if (hotelId) url.searchParams.set("hotelId", String(hotelId));
  url.searchParams.set("checkout", "cancelled");
  return url.toString();
};

export const activatePartnerClaimPlan = async ({
  claim,
  planCode,
  billingMethod,
  subscriptionId = null,
  priceId = null,
  invoiceId = null,
  nextBillingAt = null,
  subscriptionStatus = PARTNER_SUBSCRIPTION_STATUSES.active,
}) => {
  const plan = getPartnerPlanByCode(planCode);
  if (!claim || !plan) {
    const error = new Error("Invalid claim or plan");
    error.status = 400;
    throw error;
  }

  const updates = {
    claim_status: PARTNER_CLAIM_STATUSES.subscribed,
    onboarding_step: "PLAN_ACTIVE",
    current_plan_code: plan.code,
    pending_plan_code: null,
    billing_method: billingMethod || claim.billing_method || PARTNER_PAYMENT_METHODS.card,
    subscription_status: subscriptionStatus,
    subscription_started_at: claim.subscription_started_at || toNow(),
    next_billing_at:
      nextBillingAt ||
      claim.next_billing_at ||
      dayjs().add(PARTNER_TRIAL_DAYS, "day").toDate(),
    badge_removed_at: null,
    last_badge_activated_at: toNow(),
  };

  if (subscriptionId) updates.stripe_subscription_id = subscriptionId;
  if (priceId) updates.stripe_price_id = priceId;
  if (invoiceId) {
    updates.stripe_invoice_id = invoiceId;
    updates.invoice_paid_at = toNow();
  }

  await claim.update(updates);
  const refreshed = await models.PartnerHotelClaim.findByPk(claim.id, {
    include: buildClaimInclude(),
  });
  return refreshed;
};

export const createPartnerCardCheckout = async ({
  claim,
  user,
  planCode,
  successUrl = null,
  cancelUrl = null,
}) => {
  const plan = getPartnerPlanByCode(planCode);
  if (!plan) {
    const error = new Error("Invalid partner plan");
    error.status = 400;
    throw error;
  }
  const priceId = resolvePartnerStripePriceId(plan);
  if (!priceId) {
    const envKeys = Array.isArray(plan.stripePriceEnvs)
      ? plan.stripePriceEnvs.filter(Boolean)
      : [plan.stripePriceEnv].filter(Boolean);
    const error = new Error(
      `Missing partner Stripe price configuration for ${plan.code}${
        envKeys.length ? ` (${envKeys.join(" or ")})` : ""
      }`,
    );
    error.status = 500;
    throw error;
  }

  const hotel = claim?.hotel || (await models.WebbedsHotel.findByPk(claim.hotel_id));
  const { stripe, customerId } = await getOrCreateStripeCustomer({ claim, user, hotel });

  if (claim?.stripe_subscription_id && claim?.subscription_status === PARTNER_SUBSCRIPTION_STATUSES.active) {
    const subscription = await stripe.subscriptions.retrieve(claim.stripe_subscription_id);
    const subscriptionItemId = subscription?.items?.data?.[0]?.id || null;
    if (!subscriptionItemId) {
      const error = new Error("Could not resolve Stripe subscription item");
      error.status = 500;
      throw error;
    }
    const updated = await stripe.subscriptions.update(claim.stripe_subscription_id, {
      items: [{ id: subscriptionItemId, price: priceId }],
      metadata: {
        type: "partner_subscription",
        partnerClaimId: String(claim.id),
        hotelId: String(claim.hotel_id),
        userId: String(claim.user_id),
        planCode: plan.code,
      },
      cancel_at_period_end: false,
      proration_behavior: "none",
    });
    const refreshed = await activatePartnerClaimPlan({
      claim,
      planCode: plan.code,
      billingMethod: PARTNER_PAYMENT_METHODS.card,
      subscriptionId: updated.id,
      priceId,
      nextBillingAt: updated.current_period_end
        ? dayjs.unix(updated.current_period_end).toDate()
        : null,
      subscriptionStatus: updated.status || PARTNER_SUBSCRIPTION_STATUSES.active,
    });
    return { mode: "updated", claim: refreshed, url: null };
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: buildSuccessUrl({ hotelId: claim.hotel_id, success: successUrl }),
    cancel_url: buildCancelUrl({ hotelId: claim.hotel_id, cancel: cancelUrl }),
    metadata: {
      type: "partner_subscription",
      partnerClaimId: String(claim.id),
      hotelId: String(claim.hotel_id),
      userId: String(claim.user_id),
      planCode: plan.code,
    },
    subscription_data: {
      metadata: {
        type: "partner_subscription",
        partnerClaimId: String(claim.id),
        hotelId: String(claim.hotel_id),
        userId: String(claim.user_id),
        planCode: plan.code,
      },
    },
  });

  await claim.update({
    pending_plan_code: plan.code,
    billing_method: PARTNER_PAYMENT_METHODS.card,
    stripe_checkout_session_id: session.id,
    stripe_price_id: priceId,
  });

  return { mode: "checkout", claim, url: session.url || null };
};

export const requestPartnerInvoice = async ({
  claim,
  user,
  planCode,
  billingDetails = {},
}) => {
  const plan = getPartnerPlanByCode(planCode);
  if (!plan) {
    const error = new Error("Invalid partner plan");
    error.status = 400;
    throw error;
  }
  const hotel = claim?.hotel || (await models.WebbedsHotel.findByPk(claim.hotel_id));
  const { stripe, customerId } = await getOrCreateStripeCustomer({ claim, user, hotel });

  await stripe.invoiceItems.create({
    customer: customerId,
    currency: String(plan.currency || "USD").toLowerCase(),
    amount: Math.round(Number(plan.priceMonthly) * 100),
    description: `${plan.label} plan for ${hotel?.name || `hotel ${claim.hotel_id}`}`,
    metadata: {
      type: "partner_invoice",
      partnerClaimId: String(claim.id),
      hotelId: String(claim.hotel_id),
      userId: String(claim.user_id),
      planCode: plan.code,
    },
  });

  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: 7,
    metadata: {
      type: "partner_invoice",
      partnerClaimId: String(claim.id),
      hotelId: String(claim.hotel_id),
      userId: String(claim.user_id),
      planCode: plan.code,
    },
  });
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(finalized.id);

  await claim.update({
    pending_plan_code: plan.code,
    billing_method: PARTNER_PAYMENT_METHODS.invoice,
    claim_status: PARTNER_CLAIM_STATUSES.invoicePending,
    subscription_status: PARTNER_SUBSCRIPTION_STATUSES.pendingInvoice,
    stripe_invoice_id: finalized.id,
    invoice_requested_at: toNow(),
    billing_details: {
      ...(claim.billing_details && typeof claim.billing_details === "object" ? claim.billing_details : {}),
      ...billingDetails,
      customerId,
      requestedPlanCode: plan.code,
      invoiceHostedUrl: finalized.hosted_invoice_url || null,
    },
  });

  const refreshed = await models.PartnerHotelClaim.findByPk(claim.id, {
    include: buildClaimInclude(),
  });
  await sendPartnerInternalInvoiceAlert({
    claim: refreshed,
    hotel,
    billingDetails,
  });
  return {
    claim: refreshed,
    invoiceId: finalized.id,
    invoiceUrl: finalized.hosted_invoice_url || null,
  };
};

export const listPartnerClaimsForUser = async ({ userId, hotelId = null }) => {
  const where = {
    user_id: Number(userId),
  };
  if (hotelId) where.hotel_id = String(hotelId).trim();
  const claims = await models.PartnerHotelClaim.findAll({
    where,
    include: buildClaimInclude(),
    order: [["created_at", "ASC"]],
  });
  await hydratePartnerClaimsPerformance(claims);
  return claims;
};

const claimMatchesAdminQuery = (claim, query) => {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return true;
  const haystacks = [
    claim?.id,
    claim?.hotel_id,
    claim?.claim_status,
    claim?.contact_name,
    claim?.contact_email,
    claim?.contact_phone,
    claim?.hotel?.name,
    claim?.hotel?.city_name,
    claim?.hotel?.country_name,
    claim?.user?.id,
    claim?.user?.name,
    claim?.user?.email,
  ];
  return haystacks.some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
};

const buildAdminClaimSearchWhere = (query) => {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) return null;

  const likeQuery = `%${normalizedQuery}%`;
  const numericQuery = Number(normalizedQuery);
  const orClauses = [
    { claim_status: { [iLikeOp]: likeQuery } },
    { contact_name: { [iLikeOp]: likeQuery } },
    { contact_email: { [iLikeOp]: likeQuery } },
    { contact_phone: { [iLikeOp]: likeQuery } },
    { "$hotel.name$": { [iLikeOp]: likeQuery } },
    { "$hotel.city_name$": { [iLikeOp]: likeQuery } },
    { "$hotel.country_name$": { [iLikeOp]: likeQuery } },
    { "$user.name$": { [iLikeOp]: likeQuery } },
    { "$user.email$": { [iLikeOp]: likeQuery } },
  ];

  if (Number.isFinite(numericQuery) && numericQuery > 0) {
    orClauses.push(
      { id: Math.trunc(numericQuery) },
      { hotel_id: String(Math.trunc(numericQuery)) },
      { "$user.id$": Math.trunc(numericQuery) },
    );
  }

  return { [Op.or]: orClauses };
};

export const listPartnerClaimsForAdmin = async ({
  query = "",
  status = null,
  limit = 120,
} = {}) => {
  const where = {};
  const normalizedStatus = String(status || "").trim().toUpperCase();
  if (normalizedStatus) {
    where.claim_status = normalizedStatus;
  }
  const searchWhere = buildAdminClaimSearchWhere(query);
  const finalWhere = searchWhere
    ? {
        [Op.and]: [where, searchWhere],
      }
    : where;

  const claims = await models.PartnerHotelClaim.findAll({
    where: finalWhere,
    include: [
      ...buildClaimInclude(),
      {
        model: models.User,
        as: "user",
        required: false,
        attributes: ["id", "name", "email", "role"],
      },
    ],
    subQuery: false,
    order: [["updated_at", "DESC"], ["id", "DESC"]],
    limit: Math.max(1, Math.min(Number(limit) || 120, 250)),
  });

  await hydratePartnerClaimsPerformance(claims);
  return claims.filter((claim) => claimMatchesAdminQuery(claim, query));
};

const buildEmailTimeline = (claim) => {
  const sentMap = new Map(
    (Array.isArray(claim?.emailLogs) ? claim.emailLogs : []).map((entry) => [entry.email_key, entry]),
  );
  return PARTNER_EMAIL_SEQUENCE.map((step) => ({
    key: step.key,
    day: step.day,
    subject: step.subject,
    preview: step.preview,
    sent: String(sentMap.get(step.key)?.delivery_status || "").toUpperCase() === "SENT",
    deliveryStatus: sentMap.get(step.key)?.delivery_status || null,
    sentAt: sentMap.get(step.key)?.sent_at || null,
    manualCall: step.day >= 27,
  }));
};

export const buildPartnerDashboardPayload = (claim) => {
  const program = resolvePartnerProgramFromClaim(claim);
  const hotel = claim?.hotel || null;
  const review = getPartnerClaimReviewState(claim);
  const performance =
    claim?.partnerPerformance || buildPartnerPerformanceSnapshot(resolvePartnerPerformanceAdjustments(claim));
  return {
    claimId: claim.id,
    hotelId: claim.hotel_id != null ? String(claim.hotel_id) : null,
    hotel: hotel
      ? {
          hotelId: hotel.hotel_id != null ? String(hotel.hotel_id) : null,
          name: hotel.name,
          city: hotel.city_name || null,
          country: hotel.country_name || null,
          address: hotel.address || null,
        }
      : null,
    contact: {
      name: claim.contact_name || null,
      email: claim.contact_email || null,
      phone: claim.contact_phone || null,
    },
    claimStatus: claim.claim_status,
    onboardingStep: claim.onboarding_step || null,
    review: {
      source: review.source,
      requestedAt: review.requestedAt,
      approvedAt: review.approvedAt,
      requiresManualApproval: review.requiresManualApproval,
      blocked: review.blocked,
      managementEnabled: !review.blocked,
    },
    partnerProgram: program,
    plans: getPartnerPlans(),
    emailTimeline: buildEmailTimeline(claim),
    invoicePending:
      String(claim.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.invoicePending,
    canChoosePlan: !review.blocked && Boolean(program?.trialActive || claim?.claim_status === PARTNER_CLAIM_STATUSES.expired),
    performance,
    subscription: {
      billingMethod: claim.billing_method || null,
      stripeCustomerId: claim.stripe_customer_id || null,
      stripeSubscriptionId: claim.stripe_subscription_id || null,
      stripeInvoiceId: claim.stripe_invoice_id || null,
      currentPlanCode: normalizePartnerPlanCode(claim.current_plan_code) || null,
      currentPlanLegacyCode: claim.current_plan_code || null,
      pendingPlanCode: normalizePartnerPlanCode(claim.pending_plan_code) || null,
      pendingPlanLegacyCode: claim.pending_plan_code || null,
      nextBillingAt: claim.next_billing_at || null,
      invoiceRequestedAt: claim.invoice_requested_at || null,
      invoicePaidAt: claim.invoice_paid_at || null,
    },
  };
};

export const attachPartnerProgramToHotelItems = async (items = []) => {
  const hotelIds = Array.from(
    new Set(
      (Array.isArray(items) ? items : [])
        .map((item) => extractHotelId(item))
        .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
        .map((value) => String(value).trim()),
    ),
  );
  if (!hotelIds.length) return Array.isArray(items) ? items : [];

  const claims = await getPartnerClaimsWithProfilesByHotelIds(hotelIds);

  const claimMap = new Map(
    claims.map((claim) => [String(claim.hotel_id), resolvePartnerProgramFromClaim(claim)]),
  );

  const enriched = (Array.isArray(items) ? items : []).map((item) => {
    const hotelId = extractHotelId(item);
    if (hotelId == null) return item;
    const partnerProgram = claimMap.get(String(hotelId));
    if (!partnerProgram) return item;

    const nextHotelDetails =
      item?.hotelDetails && typeof item.hotelDetails === "object"
        ? {
            ...item.hotelDetails,
            partnerProgram,
          }
        : item?.hotelDetails;

    return {
      ...item,
      badge: partnerProgram.badgeLabel || item?.badge || null,
      badgeColorHex: partnerProgram.badgeColorHex || item?.badgeColorHex || null,
      partnerProgram,
      hotelDetails: nextHotelDetails,
    };
  });

  const withProfiles = await applyEffectivePartnerProfilesToHotelItems(enriched, claims);
  const claimedHotelIds = claims.map((claim) => String(claim.hotel_id));
  if (!claimedHotelIds.length) return withProfiles;
  const statsByHotelId = await fetchPartnerPerformanceByHotelIds(claimedHotelIds, claims);

  return withProfiles.map((item) => {
    const hotelId = extractHotelId(item);
    if (hotelId == null) return item;
    const performance = statsByHotelId.get(String(hotelId));
    if (!performance) return item;

    const nextHotelDetails =
      item?.hotelDetails && typeof item.hotelDetails === "object"
        ? {
            ...item.hotelDetails,
            bookingGptReach: performance.bookingGptReach,
            softPressure: performance.softPressure,
            partnerPerformance: performance,
          }
        : item?.hotelDetails;

    return {
      ...item,
      bookingGptReach: performance.bookingGptReach,
      softPressure: performance.softPressure,
      partnerPerformance: performance,
      hotelDetails: nextHotelDetails,
    };
  });
};

export const comparePartnerAwareHotelItems = (a, b, fallbackCompare) => {
  const badgeDiff = resolveProgramBadgePriority(b) - resolveProgramBadgePriority(a);
  if (badgeDiff !== 0) return badgeDiff;
  return typeof fallbackCompare === "function" ? fallbackCompare(a, b) : 0;
};

const updateClaimStateBeforeEmails = async (claim, now = new Date()) => {
  const trialEndsAt = claim?.trial_ends_at ? dayjs(claim.trial_ends_at) : null;
  const subscriptionStatus = String(claim?.subscription_status || "").toLowerCase();
  const claimStatus = String(claim?.claim_status || "").toUpperCase();
  const isSubscribed =
    claimStatus === PARTNER_CLAIM_STATUSES.subscribed ||
    [PARTNER_SUBSCRIPTION_STATUSES.active, PARTNER_SUBSCRIPTION_STATUSES.trialing].includes(
      subscriptionStatus,
    );
  if (isSubscribed) return claim;

  if (trialEndsAt && dayjs(now).isAfter(trialEndsAt) && claimStatus !== PARTNER_CLAIM_STATUSES.expired) {
    await claim.update({
      claim_status:
        claimStatus === PARTNER_CLAIM_STATUSES.invoicePending
          ? PARTNER_CLAIM_STATUSES.invoicePending
          : PARTNER_CLAIM_STATUSES.expired,
      badge_removed_at: claim.badge_removed_at || now,
    });
    return claim;
  }

  if (
    trialEndsAt &&
    dayjs(now).isAfter(trialEndsAt.subtract(5, "day")) &&
    [PARTNER_CLAIM_STATUSES.trialActive, PARTNER_CLAIM_STATUSES.paymentDue].includes(claimStatus)
  ) {
    await claim.update({ claim_status: PARTNER_CLAIM_STATUSES.trialEnding });
  }
  return claim;
};

const findEmailLog = (claim, emailKey) =>
  (Array.isArray(claim?.emailLogs) ? claim.emailLogs : []).find((entry) => entry.email_key === emailKey) || null;

const syncEmailLogOnClaim = (claim, log) => {
  if (!claim || !log || !Array.isArray(claim.emailLogs)) return;
  const nextLogs = claim.emailLogs.filter((entry) => entry.email_key !== log.email_key);
  nextLogs.push(log);
  claim.emailLogs = nextLogs;
  claim.setDataValue("emailLogs", nextLogs);
};

export const logPartnerEmail = async ({
  claim,
  emailKey,
  scheduleDay = null,
  deliveryStatus = "SENT",
  meta = null,
}) => {
  const existing = await models.PartnerEmailLog.findOne({
    where: { claim_id: claim.id, email_key: emailKey },
    paranoid: false,
  });
  const payload = {
    claim_id: claim.id,
    hotel_id: claim.hotel_id,
    user_id: claim.user_id,
    email_key: emailKey,
    schedule_day: scheduleDay,
    delivery_status: deliveryStatus,
    sent_at: toNow(),
    meta,
  };
  if (existing) {
    const deletedAt = existing.deleted_at || existing.deletedAt || null;
    if (deletedAt && typeof existing.restore === "function") {
      await existing.restore();
    }
    await existing.update(payload);
    syncEmailLogOnClaim(claim, existing);
    return existing;
  }
  const created = await models.PartnerEmailLog.create(payload);
  syncEmailLogOnClaim(claim, created);
  return created;
};

export const sendPartnerSequenceEmailIfDue = async ({ claim, hotel, step, now = new Date() }) => {
  const ageDays = resolvePartnerProgramFromClaim(claim, now)?.ageDays;
  if (!Number.isFinite(ageDays) || ageDays < step.day) return { skipped: true, reason: "not-due" };
  const existingLog = findEmailLog(claim, step.key);
  if (String(existingLog?.delivery_status || "").toUpperCase() === "SENT") {
    return { skipped: true, reason: "already-sent" };
  }

  const program = resolvePartnerProgramFromClaim(claim, now);
  if (step.stopWhenSubscribed && program?.claimStatus === PARTNER_CLAIM_STATUSES.subscribed) {
    return { skipped: true, reason: "already-subscribed" };
  }

  try {
    const deliveryResult = await sendPartnerLifecycleEmail({ claim, hotel, emailKey: step.key });
    if (deliveryResult?.skipped) {
      return {
        skipped: true,
        reason: deliveryResult.reason || "delivery-skipped",
      };
    }
    await logPartnerEmail({
      claim,
      emailKey: step.key,
      scheduleDay: step.day,
      deliveryStatus: "SENT",
      meta: { automated: true },
    });
    return { skipped: false };
  } catch (error) {
    await logPartnerEmail({
      claim,
      emailKey: step.key,
      scheduleDay: step.day,
      deliveryStatus: "FAILED",
      meta: {
        automated: true,
        errorMessage: String(error?.message || "Email delivery failed"),
      },
    }).catch(() => {});
    throw error;
  }
};

export const sendPartnerPlanConfirmationEmail = async ({ claim }) => {
  const hotel = claim?.hotel || (await models.WebbedsHotel.findByPk(claim.hotel_id));
  await sendPartnerLifecycleEmail({
    claim,
    hotel,
    emailKey: "plan_confirmation",
  });
};

export const sendPartnerInvoiceRequestedEmail = async ({ claim }) => {
  const hotel = claim?.hotel || (await models.WebbedsHotel.findByPk(claim.hotel_id));
  await sendPartnerLifecycleEmail({
    claim,
    hotel,
    emailKey: "invoice_requested",
  });
};

export const handlePartnerStripeEvent = async ({ eventType, object }) => {
  const meta = object?.metadata && typeof object.metadata === "object" ? object.metadata : {};
  const type = String(meta.type || "").trim().toLowerCase();
  if (!type.startsWith("partner_")) return { handled: false };

  const claimId = Number(meta.partnerClaimId || meta.partner_claim_id || 0);
  if (!claimId) return { handled: false };

  const claim = await models.PartnerHotelClaim.findByPk(claimId, {
    include: buildClaimInclude(),
  });
  if (!claim) return { handled: false };

  if (eventType === "checkout.session.completed" && type === "partner_subscription") {
    const stripe = await getStripeClient();
    const subscriptionId = object?.subscription || null;
    const planCode = normalizePlanCode(meta.planCode);
    let nextBillingAt = null;
    let subscriptionStatus = PARTNER_SUBSCRIPTION_STATUSES.active;
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(String(subscriptionId));
      nextBillingAt = subscription?.current_period_end
        ? dayjs.unix(subscription.current_period_end).toDate()
        : null;
      subscriptionStatus = subscription?.status || subscriptionStatus;
    }
    const refreshed = await activatePartnerClaimPlan({
      claim,
      planCode,
      billingMethod: PARTNER_PAYMENT_METHODS.card,
      subscriptionId,
      priceId: claim.stripe_price_id || null,
      nextBillingAt,
      subscriptionStatus,
    });
    await sendPartnerPlanConfirmationEmail({ claim: refreshed });
    return { handled: true, claimId };
  }

  if (eventType === "invoice.paid" && type === "partner_invoice") {
    const planCode = normalizePlanCode(meta.planCode || claim.pending_plan_code || claim.current_plan_code);
    const refreshed = await activatePartnerClaimPlan({
      claim,
      planCode,
      billingMethod: PARTNER_PAYMENT_METHODS.invoice,
      invoiceId: object?.id || null,
      nextBillingAt: dayjs().add(PARTNER_TRIAL_DAYS, "day").toDate(),
      subscriptionStatus: PARTNER_SUBSCRIPTION_STATUSES.active,
    });
    await sendPartnerPlanConfirmationEmail({ claim: refreshed });
    return { handled: true, claimId };
  }

  if (eventType === "invoice.payment_failed") {
    await claim.update({
      claim_status: PARTNER_CLAIM_STATUSES.paymentDue,
      subscription_status: PARTNER_SUBSCRIPTION_STATUSES.pastDue,
    });
    return { handled: true, claimId };
  }

  if (
    eventType === "customer.subscription.deleted" ||
    eventType === "customer.subscription.updated"
  ) {
    const status = String(object?.status || "").toLowerCase();
    const updates = {
      subscription_status: status,
    };
    if (status === PARTNER_SUBSCRIPTION_STATUSES.cancelled) {
      updates.claim_status = PARTNER_CLAIM_STATUSES.expired;
      updates.badge_removed_at = toNow();
    }
    await claim.update(updates);
    return { handled: true, claimId };
  }

  return { handled: false };
};

export const runPartnerLifecycleForClaim = async ({ claim, now = new Date() }) => {
  if (!claim) {
    return {
      processed: 0,
      emailsSent: 0,
      badgesRemoved: 0,
    };
  }

  const previousStatus = claim.claim_status;
  await updateClaimStateBeforeEmails(claim, now);

  let emailsSent = 0;
  const badgesRemoved =
    previousStatus !== PARTNER_CLAIM_STATUSES.expired &&
    claim.claim_status === PARTNER_CLAIM_STATUSES.expired
      ? 1
      : 0;

  await hydratePartnerClaimsPerformance([claim], { now });

  const program = resolvePartnerProgramFromClaim(claim, now);
  if (program?.claimStatus !== PARTNER_CLAIM_STATUSES.subscribed) {
    for (const step of PARTNER_EMAIL_SEQUENCE) {
      const result = await sendPartnerSequenceEmailIfDue({
        claim,
        hotel: claim.hotel,
        step,
        now,
      });
      if (!result.skipped) emailsSent += 1;
    }
  }

  return {
    processed: 1,
    emailsSent,
    badgesRemoved,
    claim,
  };
};

export const buildPartnerAdminClaimPayload = (claim) => {
  const payload = buildPartnerDashboardPayload(claim);
  return {
    ...payload,
    claimedAt: claim?.claimed_at || null,
    trialStartedAt: claim?.trial_started_at || null,
    trialEndsAt: claim?.trial_ends_at || null,
    updatedAt: claim?.updated_at || null,
    owner: claim?.user
      ? {
          userId: Number(claim.user.id || 0) || null,
          name: claim.user.name || null,
          email: claim.user.email || null,
          role: claim.user.role ?? null,
        }
      : null,
  };
};

export const approvePendingPartnerClaim = async ({
  claim,
  approvedByUserId = null,
  now = new Date(),
} = {}) => {
  if (!claim) {
    const error = new Error("Partner claim not found");
    error.status = 404;
    throw error;
  }

  const reviewState = getPartnerClaimReviewState(claim);
  if (!reviewState.blocked && String(claim.claim_status || "").toUpperCase() !== PARTNER_CLAIM_STATUSES.pendingReview) {
    const refreshed = await models.PartnerHotelClaim.findByPk(claim.id, {
      include: buildClaimInclude(),
    });
    return refreshed;
  }

  const nextMeta = {
    ...toObject(claim.meta),
    review: {
      ...toObject(toObject(claim.meta).review),
      source: reviewState.source || PARTNER_CLAIM_SOURCES.search,
      requestedAt: reviewState.requestedAt || claim.claimed_at || now,
      requiresManualApproval: false,
      approvedAt: now.toISOString(),
      approvedByUserId: Number(approvedByUserId || 0) || null,
    },
  };

  await claim.update({
    claim_status: PARTNER_CLAIM_STATUSES.trialActive,
    onboarding_step: "CLAIMED",
    trial_started_at: claim.trial_started_at || now,
    trial_ends_at: claim.trial_ends_at || dayjs(now).add(PARTNER_TRIAL_DAYS, "day").toDate(),
    last_badge_activated_at: claim.last_badge_activated_at || now,
    badge_removed_at: null,
    meta: nextMeta,
  });

  const refreshed = await models.PartnerHotelClaim.findByPk(claim.id, {
    include: buildClaimInclude(),
  });

  const hotel = refreshed?.hotel || (await models.WebbedsHotel.findByPk(refreshed.hotel_id));
  const welcomeAlreadySent = Array.isArray(refreshed?.emailLogs)
    ? refreshed.emailLogs.some((entry) => entry.email_key === "day_1_welcome")
    : false;
  if (!welcomeAlreadySent) {
    await sendPartnerSequenceEmailIfDue({
      claim: refreshed,
      hotel,
      step: { key: "day_1_welcome", day: 1, stopWhenSubscribed: true },
      now,
    }).catch(() => {});
  }

  return refreshed;
};

export const simulatePartnerClaimTrial = async ({
  claimId,
  targetDay,
  resetEmailTimeline = false,
  runLifecycle = true,
  now = new Date(),
} = {}) => {
  const resolvedClaimId = Number(claimId);
  if (!Number.isFinite(resolvedClaimId) || resolvedClaimId <= 0) {
    const error = new Error("claimId is required");
    error.status = 400;
    throw error;
  }

  const claim = await models.PartnerHotelClaim.findByPk(resolvedClaimId, {
    include: buildClaimInclude(),
  });
  if (!claim) {
    const error = new Error("Partner claim not found");
    error.status = 404;
    throw error;
  }

  const claimStatus = String(claim.claim_status || "").toUpperCase();
  const subscriptionStatus = String(claim.subscription_status || "").toLowerCase();
  const billingLocked =
    claimStatus === PARTNER_CLAIM_STATUSES.subscribed ||
    claimStatus === PARTNER_CLAIM_STATUSES.invoicePending ||
    [
      PARTNER_SUBSCRIPTION_STATUSES.active,
      PARTNER_SUBSCRIPTION_STATUSES.trialing,
      PARTNER_SUBSCRIPTION_STATUSES.pendingInvoice,
    ].includes(subscriptionStatus);
  if (billingLocked) {
    const error = new Error(
      "This claim is already in a paid subscription or invoice flow. Use a trial claim to simulate lifecycle days.",
    );
    error.status = 409;
    throw error;
  }

  const simulation = buildPartnerTrialSimulationDates({
    now,
    targetDay,
    trialDays: PARTNER_TRIAL_DAYS,
  });

  await claim.update({
    claimed_at: simulation.claimedAt,
    trial_started_at: simulation.trialStartedAt,
    trial_ends_at: simulation.trialEndsAt,
    claim_status: PARTNER_CLAIM_STATUSES.trialActive,
    badge_removed_at: null,
    last_badge_activated_at: now,
  });

  if (resetEmailTimeline) {
    await models.PartnerEmailLog.destroy({
      where: { claim_id: claim.id },
      force: true,
    });
    claim.setDataValue("emailLogs", []);
    claim.emailLogs = [];
  }

  let lifecycleResult = {
    processed: 0,
    emailsSent: 0,
    badgesRemoved: 0,
  };
  if (runLifecycle) {
    lifecycleResult = await runPartnerLifecycleForClaim({ claim, now });
  }

  await hydratePartnerClaimsPerformance([claim], { now });

  return {
    claim,
    simulation: {
      targetDay: simulation.targetDay,
      simulatedNow: now,
      resetEmailTimeline: Boolean(resetEmailTimeline),
      runLifecycle: Boolean(runLifecycle),
    },
    lifecycle: {
      processed: lifecycleResult.processed,
      emailsSent: lifecycleResult.emailsSent,
      badgesRemoved: lifecycleResult.badgesRemoved,
    },
  };
};

export const runPartnerLifecycleSweep = async ({ now = new Date() } = {}) => {
  const claims = await models.PartnerHotelClaim.findAll({
    include: buildClaimInclude(),
    order: [["id", "ASC"]],
  });

  let processed = 0;
  let emailsSent = 0;
  let badgesRemoved = 0;
  const failures = [];

  for (const claim of claims) {
    try {
      const result = await runPartnerLifecycleForClaim({ claim, now });
      processed += result.processed;
      emailsSent += result.emailsSent;
      badgesRemoved += result.badgesRemoved;
    } catch (error) {
      failures.push({
        claimId: claim.id,
        hotelId: claim.hotel_id != null ? String(claim.hotel_id) : null,
        message: String(error?.message || "Partner lifecycle sweep failed"),
      });
    }
  }

  return {
    processed,
    emailsSent,
    badgesRemoved,
    failedClaims: failures.length,
    failures,
  };
};
