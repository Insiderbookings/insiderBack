import dayjs from "dayjs";
import { Op } from "sequelize";
import models from "../models/index.js";
import { getCaseInsensitiveLikeOp } from "../utils/sequelizeHelpers.js";
import {
  PARTNER_CLAIM_STATUSES,
  PARTNER_EMAIL_SEQUENCE,
  PARTNER_PAYMENT_METHODS,
  PARTNER_SUBSCRIPTION_STATUSES,
  PARTNER_TRIAL_DAYS,
  getPartnerBadgeByCode,
  getPartnerPlanByCode,
  getPartnerPlans,
  resolvePartnerBadgePriority as resolveProgramBadgePriority,
  resolvePartnerProgramFromClaim,
} from "./partnerCatalog.service.js";
import {
  sendPartnerInternalInvoiceAlert,
  sendPartnerLifecycleEmail,
} from "./partnerEmail.service.js";

const iLikeOp = getCaseInsensitiveLikeOp();

const getStripeClient = async () => {
  const { default: Stripe } = await import("stripe");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });
};

const normalizePlanCode = (value) => String(value || "").trim().toLowerCase();
const normalizePaymentMethod = (value) =>
  String(value || "").trim().toLowerCase() || PARTNER_PAYMENT_METHODS.card;
const toNow = () => new Date();

const extractHotelId = (item) =>
  item?.id ??
  item?.hotel_id ??
  item?.hotelId ??
  item?.hotelCode ??
  item?.hotelDetails?.hotelCode ??
  item?.hotelDetails?.hotelId ??
  null;

const buildClaimInclude = () => [
  {
    model: models.WebbedsHotel,
    as: "hotel",
    required: false,
  },
  {
    model: models.PartnerEmailLog,
    as: "emailLogs",
    required: false,
  },
];

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
  if (existing && Number(existing.user_id) !== resolvedUserId) {
    const error = new Error("This hotel is already claimed");
    error.status = 409;
    throw error;
  }

  if (existing) {
    const updates = {};
    if (contactName) updates.contact_name = contactName;
    if (contactEmail) updates.contact_email = String(contactEmail).trim().toLowerCase();
    if (contactPhone) updates.contact_phone = contactPhone;
    if (!existing.claimed_at) updates.claimed_at = now;
    if (!existing.trial_started_at) updates.trial_started_at = now;
    if (!existing.trial_ends_at) updates.trial_ends_at = dayjs(now).add(PARTNER_TRIAL_DAYS, "day").toDate();
    if (!existing.claim_status || existing.claim_status === PARTNER_CLAIM_STATUSES.cancelled) {
      updates.claim_status = PARTNER_CLAIM_STATUSES.trialActive;
    }
    if (Object.keys(updates).length) await existing.update(updates);
    const refreshed = await models.PartnerHotelClaim.findByPk(existing.id, {
      include: buildClaimInclude(),
    });
    return { claim: refreshed, hotel, created: false };
  }

  const claim = await models.PartnerHotelClaim.create({
    hotel_id: resolvedHotelId,
    user_id: resolvedUserId,
    claim_status: PARTNER_CLAIM_STATUSES.trialActive,
    onboarding_step: "CLAIMED",
    contact_name: contactName || null,
    contact_email: contactEmail ? String(contactEmail).trim().toLowerCase() : null,
    contact_phone: contactPhone || null,
    claimed_at: now,
    trial_started_at: now,
    trial_ends_at: dayjs(now).add(PARTNER_TRIAL_DAYS, "day").toDate(),
    last_badge_activated_at: now,
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
  const priceId = process.env[plan.stripePriceEnv];
  if (!priceId) {
    const error = new Error(`Missing ${plan.stripePriceEnv}`);
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
  return claims;
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
    sent: Boolean(sentMap.has(step.key)),
    sentAt: sentMap.get(step.key)?.sent_at || null,
    manualCall: step.day >= 27,
  }));
};

export const buildPartnerDashboardPayload = (claim) => {
  const program = resolvePartnerProgramFromClaim(claim);
  const hotel = claim?.hotel || null;
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
    partnerProgram: program,
    plans: getPartnerPlans(),
    emailTimeline: buildEmailTimeline(claim),
    invoicePending:
      String(claim.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.invoicePending,
    canChoosePlan: Boolean(program?.trialActive || claim?.claim_status === PARTNER_CLAIM_STATUSES.expired),
    subscription: {
      billingMethod: claim.billing_method || null,
      stripeCustomerId: claim.stripe_customer_id || null,
      stripeSubscriptionId: claim.stripe_subscription_id || null,
      stripeInvoiceId: claim.stripe_invoice_id || null,
      currentPlanCode: claim.current_plan_code || null,
      pendingPlanCode: claim.pending_plan_code || null,
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

  const claims = await models.PartnerHotelClaim.findAll({
    where: {
      hotel_id: { [Op.in]: hotelIds },
    },
    include: [{ model: models.WebbedsHotel, as: "hotel", required: false }],
  });

  const claimMap = new Map(
    claims.map((claim) => [String(claim.hotel_id), resolvePartnerProgramFromClaim(claim)]),
  );

  return (Array.isArray(items) ? items : []).map((item) => {
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

export const logPartnerEmail = async ({ claim, emailKey, scheduleDay = null, meta = null }) => {
  const existing = await models.PartnerEmailLog.findOne({
    where: { claim_id: claim.id, email_key: emailKey },
  });
  if (existing) return existing;
  return models.PartnerEmailLog.create({
    claim_id: claim.id,
    hotel_id: claim.hotel_id,
    user_id: claim.user_id,
    email_key: emailKey,
    schedule_day: scheduleDay,
    delivery_status: "SENT",
    sent_at: toNow(),
    meta,
  });
};

export const sendPartnerSequenceEmailIfDue = async ({ claim, hotel, step, now = new Date() }) => {
  const ageDays = resolvePartnerProgramFromClaim(claim, now)?.ageDays;
  if (!Number.isFinite(ageDays) || ageDays < step.day) return { skipped: true, reason: "not-due" };
  if (findEmailLog(claim, step.key)) return { skipped: true, reason: "already-sent" };

  const program = resolvePartnerProgramFromClaim(claim, now);
  if (step.stopWhenSubscribed && program?.claimStatus === PARTNER_CLAIM_STATUSES.subscribed) {
    return { skipped: true, reason: "already-subscribed" };
  }

  await sendPartnerLifecycleEmail({ claim, hotel, emailKey: step.key });
  const log = await logPartnerEmail({
    claim,
    emailKey: step.key,
    scheduleDay: step.day,
    meta: { automated: true },
  });
  if (Array.isArray(claim.emailLogs)) claim.emailLogs.push(log);
  return { skipped: false };
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

export const runPartnerLifecycleSweep = async ({ now = new Date() } = {}) => {
  const claims = await models.PartnerHotelClaim.findAll({
    include: buildClaimInclude(),
    order: [["id", "ASC"]],
  });

  let processed = 0;
  let emailsSent = 0;
  let badgesRemoved = 0;

  for (const claim of claims) {
    processed += 1;
    const previousStatus = claim.claim_status;
    await updateClaimStateBeforeEmails(claim, now);
    if (
      previousStatus !== PARTNER_CLAIM_STATUSES.expired &&
      claim.claim_status === PARTNER_CLAIM_STATUSES.expired
    ) {
      badgesRemoved += 1;
    }

    const program = resolvePartnerProgramFromClaim(claim, now);
    if (program?.claimStatus === PARTNER_CLAIM_STATUSES.subscribed) continue;

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
    processed,
    emailsSent,
    badgesRemoved,
  };
};
