import dayjs from "dayjs";
import { Op } from "sequelize";
import models from "../models/index.js";
import { getCaseInsensitiveLikeOp } from "../utils/sequelizeHelpers.js";
import {
  buildPublicPartnerProfile,
  PARTNER_CLAIM_STATUSES,
  PARTNER_EMAIL_SEQUENCE,
  PARTNER_PAYMENT_METHODS,
  PARTNER_SUBSCRIPTION_STATUSES,
  PARTNER_TRIAL_DAYS,
  getPartnerBadgeByCode,
  getPartnerPlanByCode,
  getPartnerPlans,
  normalizePartnerProfileOverrides,
  resolvePartnerFeatureAccess,
  getStripePriceIdForPartnerPlan,
  resolvePartnerBadgePriority as resolveProgramBadgePriority,
  resolvePartnerProfileFromClaim,
  resolvePartnerProgramFromClaim,
} from "./partnerCatalog.service.js";
import {
  sendPartnerDestinationSpotlightEmail,
  sendPartnerHotelInquiryEmail,
  sendPartnerInternalInvoiceAlert,
  sendPartnerLifecycleEmail,
  sendPartnerMonthlyReportEmail,
} from "./partnerEmail.service.js";
import {
  attachPartnerAdvancedInsightsToClaims,
  attachPartnerMetricSummariesToClaims,
  getPartnerCompetitorInsights,
  getPartnerMonthlyReportSnapshot,
} from "./partnerMetrics.service.js";
import { buildPartnerMonthlyReportPdfBuffer } from "../helpers/partnerMonthlyReportPdf.js";

const iLikeOp = getCaseInsensitiveLikeOp();

const getStripeClient = async () => {
  const { default: Stripe } = await import("stripe");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });
};

const normalizePlanCode = (value) => String(value || "").trim().toLowerCase();
const normalizePaymentMethod = (value) =>
  String(value || "").trim().toLowerCase() || PARTNER_PAYMENT_METHODS.card;
const normalizeVerificationCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
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
  {
    model: models.PartnerInquiryLog,
    as: "inquiryLogs",
    required: false,
  },
];

const buildVerificationInclude = () => [
  {
    model: models.WebbedsHotel,
    as: "hotel",
    required: false,
  },
];

const loadPartnerClaimByHotelId = async (hotelId) => {
  const resolvedHotelId = String(hotelId || "").trim();
  if (!resolvedHotelId) return null;
  return models.PartnerHotelClaim.findOne({
    where: { hotel_id: resolvedHotelId },
    include: buildClaimInclude(),
  });
};

const PARTNER_PROFILE_EDIT_FIELDS = Object.freeze({
  description: "basicProfileEditable",
  amenities: "basicProfileEditable",
  photoUrls: "basicProfileEditable",
  publicContactEmail: "basicProfileEditable",
  publicContactPhone: "basicProfileEditable",
  specialOfferText: "specialOffersEditable",
  responseTimeCode: "responseTimeEditable",
  inquiryEnabled: "bookingInquiryEditable",
  inquiryEmail: "bookingInquiryEditable",
  inquiryPhone: "bookingInquiryEditable",
  inquiryCtaLabel: "bookingInquiryEditable",
  destinationEmailEnabled: "destinationEmailsEditable",
  reviewBoostEnabled: "reviewBoostEditable",
  googleReviewUrl: "reviewBoostEditable",
  upsellEnabled: "upsellEditable",
  upsellTitle: "upsellEditable",
  upsellDescription: "upsellEditable",
  upsellCtaLabel: "upsellEditable",
  upsellUrl: "upsellEditable",
});

const normalizeRecipientEmails = (value) => {
  const source = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,\n;]/)
        .map((entry) => entry.trim());
  return Array.from(
    new Set(
      source
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter((entry) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry)),
    ),
  );
};

const normalizeOptionalText = (value, maxLength = 160) => {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : null;
};

const buildDestinationEmailHotelPreview = (claim) => {
  const hotel = claim?.hotel || {};
  const partnerProgram = resolvePartnerProgramFromClaim(claim);
  const partnerProfile = resolvePartnerProfileFromClaim(claim);
  const badge = getPartnerBadgeByCode(partnerProgram?.badgeCode);
  return {
    hotelId: hotel?.hotel_id != null ? String(hotel.hotel_id) : String(claim?.hotel_id || ""),
    name: hotel?.name || "Hotel partner",
    city: hotel?.city_name || null,
    country: hotel?.country_name || null,
    address: hotel?.address || null,
    imageUrl: Array.isArray(hotel?.images) && hotel.images[0]?.url ? hotel.images[0].url : null,
    partnerProgram: {
      planCode: partnerProgram?.planCode || null,
      planLabel: partnerProgram?.planLabel || null,
      badgeCode: partnerProgram?.badgeCode || null,
      badgeLabel: badge?.label || partnerProgram?.badgeLabel || null,
      badgeColorHex: badge?.hex || partnerProgram?.badgeColorHex || null,
      statusLabel: partnerProgram?.statusLabel || null,
    },
    partnerProfile: {
      responseTimeLabel: partnerProfile?.responseTimeLabel || null,
      specialOfferText: partnerProfile?.specialOfferText || null,
      inquiryEnabled: Boolean(partnerProfile?.inquiryEnabled),
      destinationEmailEnabled: Boolean(partnerProfile?.destinationEmailEnabled),
      destinationEmailCity: partnerProfile?.destinationEmailCity || null,
      reviewBoostEnabled: Boolean(partnerProfile?.reviewBoostEnabled),
    },
  };
};

const generateVerificationCodeCandidate = () => {
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `VRF${digits}${letter}`;
};

const ensureUniqueVerificationCode = async () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = generateVerificationCodeCandidate();
    const existing = await models.PartnerHotelVerificationCode.findOne({
      where: { verification_code: candidate },
      attributes: ["id"],
    });
    if (!existing) return candidate;
  }

  const error = new Error("Could not generate a unique verification code");
  error.status = 500;
  throw error;
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

export const ensurePartnerVerificationCode = async ({
  hotelId,
  generatedByUserId = null,
}) => {
  const resolvedHotelId = String(hotelId || "").trim();
  if (!resolvedHotelId) {
    const error = new Error("hotelId is required");
    error.status = 400;
    throw error;
  }

  const hotel = await models.WebbedsHotel.findByPk(resolvedHotelId, {
    attributes: ["hotel_id", "name", "city_name", "country_name", "address"],
  });
  if (!hotel) {
    const error = new Error("Hotel not found");
    error.status = 404;
    throw error;
  }

  const existing = await models.PartnerHotelVerificationCode.findOne({
    where: { hotel_id: resolvedHotelId },
    include: buildVerificationInclude(),
  });
  if (existing) return existing;

  return models.PartnerHotelVerificationCode.create({
    hotel_id: resolvedHotelId,
    verification_code: await ensureUniqueVerificationCode(),
    generated_by_user_id:
      Number.isFinite(Number(generatedByUserId)) && Number(generatedByUserId) > 0
        ? Number(generatedByUserId)
        : null,
    generated_at: toNow(),
  });
};

export const verifyPartnerHotelCode = async ({
  verificationCode,
  userId,
  contactName = null,
  contactEmail = null,
  contactPhone = null,
}) => {
  const normalizedCode = normalizeVerificationCode(verificationCode);
  if (!normalizedCode) {
    const error = new Error("verificationCode is required");
    error.status = 400;
    throw error;
  }

  const codeEntry = await models.PartnerHotelVerificationCode.findOne({
    where: { verification_code: normalizedCode },
    include: buildVerificationInclude(),
  });
  if (!codeEntry) {
    const error = new Error("Invalid verification code");
    error.status = 404;
    throw error;
  }

  const result = await ensurePartnerClaim({
    hotelId: codeEntry.hotel_id,
    userId,
    contactName,
    contactEmail,
    contactPhone,
  });

  await codeEntry.update({
    used_at: toNow(),
    used_by_user_id: Number(userId),
  });

  return {
    ...result,
    verificationCode: codeEntry.verification_code,
  };
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

  const nextMeta =
    claim.meta && typeof claim.meta === "object"
      ? { ...claim.meta }
      : {};
  if (nextMeta.subscriptionCancellation) delete nextMeta.subscriptionCancellation;

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
    meta: nextMeta,
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
  const priceId = getStripePriceIdForPartnerPlan(plan);
  if (!priceId) {
    const error = new Error(`Missing Stripe price id for ${plan.code}`);
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

export const listPartnerDestinationEmailCandidates = async ({
  city,
  country = null,
  limit = 6,
}) => {
  const normalizedCity = String(city || "").trim();
  const normalizedCountry = String(country || "").trim();
  if (!normalizedCity) {
    const error = new Error("city is required");
    error.status = 400;
    throw error;
  }

  const claims = await models.PartnerHotelClaim.findAll({
    include: [
      {
        model: models.WebbedsHotel,
        as: "hotel",
        required: true,
        where: {
          city_name: { [iLikeOp]: normalizedCity },
          ...(normalizedCountry ? { country_name: { [iLikeOp]: normalizedCountry } } : {}),
        },
      },
      {
        model: models.PartnerEmailLog,
        as: "emailLogs",
        required: false,
      },
    ],
    order: [["updated_at", "DESC"]],
  });

  const eligible = claims
    .filter((claim) => {
      const access = resolvePartnerFeatureAccess(claim);
      const profile = resolvePartnerProfileFromClaim(claim);
      const status = String(claim?.claim_status || "").toUpperCase();
      return (
        access.destinationEmailsVisible &&
        profile.destinationEmailEnabled &&
        profile.destinationEmailEligible &&
        ![PARTNER_CLAIM_STATUSES.cancelled, PARTNER_CLAIM_STATUSES.expired].includes(status)
      );
    })
    .sort((left, right) => {
      const badgePriorityDiff =
        Number(resolvePartnerProgramFromClaim(right)?.badgePriority || 0) -
        Number(resolvePartnerProgramFromClaim(left)?.badgePriority || 0);
      if (badgePriorityDiff !== 0) return badgePriorityDiff;
      return String(left?.hotel?.name || "").localeCompare(String(right?.hotel?.name || ""));
    })
    .slice(0, Math.max(1, Math.min(Number(limit) || 6, 12)));

  return eligible.map((claim) => buildDestinationEmailHotelPreview(claim));
};

export const sendPartnerDestinationEmailTest = async ({
  city,
  country = null,
  recipients,
  subject = null,
  intro = null,
  limit = 6,
  triggeredByUser = null,
}) => {
  const normalizedCity = String(city || "").trim();
  const normalizedCountry = String(country || "").trim();
  const recipientList = normalizeRecipientEmails(recipients);
  if (!recipientList.length) {
    const error = new Error("At least one recipient email is required");
    error.status = 400;
    throw error;
  }

  const hotels = await listPartnerDestinationEmailCandidates({
    city: normalizedCity,
    country: normalizedCountry,
    limit,
  });
  if (!hotels.length) {
    const error = new Error("No eligible partner hotels were found for that destination");
    error.status = 404;
    throw error;
  }

  await sendPartnerDestinationSpotlightEmail({
    city,
    country,
    recipients: recipientList,
    hotels,
    subject: normalizeOptionalText(subject, 120),
    intro: normalizeOptionalText(intro, 240),
    triggeredByUser,
  });

  return {
    city: normalizedCity,
    country: normalizedCountry || null,
    recipients: recipientList,
    hotels,
  };
};

export const generatePartnerMonthlyReport = async ({
  claim,
  now = new Date(),
  month = null,
}) => {
  if (!claim) {
    const error = new Error("Partner claim not found");
    error.status = 404;
    throw error;
  }

  const monthlyReport = await getPartnerMonthlyReportSnapshot({ claim, month, now });
  const competitorInsights = await getPartnerCompetitorInsights({ claim, now });
  const pdfBuffer = await buildPartnerMonthlyReportPdfBuffer({
    claim,
    monthlyReport,
    competitorInsights,
  });

  return {
    monthlyReport,
    competitorInsights,
    pdfBuffer,
    filename: `bookinggpt-partner-report-${String(claim.hotel_id)}-${monthlyReport?.monthKey || dayjs(now).format("YYYY-MM")}.pdf`,
  };
};

export const listPartnerClaimsForUser = async ({ userId, userEmail = null, hotelId = null }) => {
  const normalizedUserId = Number(userId);
  const normalizedEmail = String(userEmail || "").trim().toLowerCase();
  const ownershipScopes = [];
  if (Number.isFinite(normalizedUserId) && normalizedUserId > 0) {
    ownershipScopes.push({ user_id: normalizedUserId });
  }
  if (normalizedEmail) {
    ownershipScopes.push({ contact_email: normalizedEmail });
  }
  if (!ownershipScopes.length) return [];

  const where = {
    [Op.or]: ownershipScopes,
  };
  if (hotelId) where.hotel_id = String(hotelId).trim();
  const claims = await models.PartnerHotelClaim.findAll({
    where,
    include: buildClaimInclude(),
    order: [["created_at", "ASC"]],
  });
  await attachPartnerMetricSummariesToClaims(claims);
  await attachPartnerAdvancedInsightsToClaims(claims);
  return claims;
};

export const updatePartnerClaimProfile = async ({ claim, updates = {}, now = new Date() }) => {
  if (!claim) {
    const error = new Error("Partner claim not found");
    error.status = 404;
    throw error;
  }

  const requestedKeys = Object.keys(PARTNER_PROFILE_EDIT_FIELDS).filter((key) =>
    Object.prototype.hasOwnProperty.call(updates, key),
  );
  if (!requestedKeys.length) {
    const error = new Error("No editable profile fields were provided");
    error.status = 400;
    throw error;
  }

  const access = resolvePartnerFeatureAccess(claim, now);
  for (const key of requestedKeys) {
    const capabilityKey = PARTNER_PROFILE_EDIT_FIELDS[key];
    if (!access?.[capabilityKey]) {
      const error = new Error(`Current partner tier cannot edit ${key}`);
      error.status = 403;
      throw error;
    }
  }

  const profileOverrides = normalizePartnerProfileOverrides(updates, claim.profile_overrides);
  const effectiveInquiryEmail =
    profileOverrides.inquiryEmail ||
    (claim?.contact_email ? String(claim.contact_email).trim().toLowerCase() : null);
  if (profileOverrides.inquiryEnabled && !effectiveInquiryEmail) {
    const error = new Error("Inquiry email is required before enabling booking inquiries");
    error.status = 400;
    throw error;
  }
  if (profileOverrides.reviewBoostEnabled && !profileOverrides.googleReviewUrl) {
    const error = new Error("Google review URL is required before enabling review boost");
    error.status = 400;
    throw error;
  }
  if (profileOverrides.upsellEnabled && !profileOverrides.upsellUrl) {
    const error = new Error("Upsell URL is required before enabling upsell");
    error.status = 400;
    throw error;
  }

  await claim.update({
    profile_overrides: profileOverrides,
    onboarding_step: claim.onboarding_step || "CLAIMED",
  });

  await claim.reload({ include: buildClaimInclude() });
  return claim;
};

export const submitPartnerHotelInquiry = async ({
  hotelId,
  travelerName,
  travelerEmail,
  travelerPhone = null,
  message,
  checkIn = null,
  checkOut = null,
  sourceSurface = null,
}) => {
  const resolvedHotelId = String(hotelId || "").trim();
  const normalizedName = String(travelerName || "").trim();
  const normalizedEmail = String(travelerEmail || "").trim().toLowerCase();
  const normalizedPhone = String(travelerPhone || "").trim() || null;
  const normalizedMessage = String(message || "").trim();
  const normalizedCheckIn = checkIn ? String(checkIn).trim() : null;
  const normalizedCheckOut = checkOut ? String(checkOut).trim() : null;
  const normalizedSurface = sourceSurface ? String(sourceSurface).trim().toLowerCase() : null;

  if (!resolvedHotelId) {
    const error = new Error("hotelId is required");
    error.status = 400;
    throw error;
  }
  if (!normalizedName || !normalizedEmail || !normalizedMessage) {
    const error = new Error("travelerName, travelerEmail and message are required");
    error.status = 400;
    throw error;
  }

  const claim = await loadPartnerClaimByHotelId(resolvedHotelId);
  if (!claim) {
    const error = new Error("Partner claim not found");
    error.status = 404;
    throw error;
  }

  const partnerProfile = resolvePartnerProfileFromClaim(claim);
  if (!partnerProfile?.features?.bookingInquiryVisible || !partnerProfile?.inquiryEnabled) {
    const error = new Error("Booking inquiries are not enabled for this hotel");
    error.status = 409;
    throw error;
  }

  const hotel = claim?.hotel || (await models.WebbedsHotel.findByPk(claim.hotel_id));
  await sendPartnerHotelInquiryEmail({
    claim,
    hotel,
    partnerProfile,
    traveler: {
      name: normalizedName,
      email: normalizedEmail,
      phone: normalizedPhone,
      message: normalizedMessage,
      checkIn: normalizedCheckIn,
      checkOut: normalizedCheckOut,
      sourceSurface: normalizedSurface,
    },
  });

  const inquiryLog = await models.PartnerInquiryLog.create({
    claim_id: claim.id,
    hotel_id: claim.hotel_id,
    traveler_name: normalizedName,
    traveler_email: normalizedEmail,
    traveler_phone: normalizedPhone,
    message: normalizedMessage,
    check_in: normalizedCheckIn,
    check_out: normalizedCheckOut,
    source_surface: normalizedSurface,
    meta: {
      destinationEmail: partnerProfile?.inquiryEmail || claim?.contact_email || null,
    },
  });

  return {
    sent: true,
    hotelId: resolvedHotelId,
    id: inquiryLog.id,
    createdAt: inquiryLog.created_at || new Date(),
  };
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

const buildCurrentExperience = (claim) => {
  const program = resolvePartnerProgramFromClaim(claim);
  const activePlan =
    getPartnerPlanByCode(program?.planCode) ||
    getPartnerPlanByCode(claim?.current_plan_code) ||
    getPartnerPlanByCode(claim?.pending_plan_code) ||
    getPartnerPlanByCode("featured");

  return {
    trialActive: Boolean(program?.trialActive),
    tierLabel: program?.trialActive ? "Featured trial" : activePlan?.label || "Partner plan",
    features: Array.isArray(activePlan?.features) ? activePlan.features : [],
  };
};

const buildReachSummary = (claim) => {
  const metrics =
    claim?.partnerMetricsSummary && typeof claim.partnerMetricsSummary === "object"
      ? claim.partnerMetricsSummary
      : null;
  const meta = claim?.meta && typeof claim.meta === "object" ? claim.meta : {};
  const dashboardMetrics =
    meta.dashboardMetrics && typeof meta.dashboardMetrics === "object" ? meta.dashboardMetrics : {};

  return {
    label: metrics?.label || "BookingGPT Reach",
    subtext: metrics?.subtext || "Travelers who saw your hotel across BookingGPT this week",
    value: Number.isFinite(Number(metrics?.value))
      ? Number(metrics.value)
      : Number.isFinite(Number(dashboardMetrics.bookinggptReachThisWeek))
        ? Number(dashboardMetrics.bookinggptReachThisWeek)
        : null,
    clicks: Number.isFinite(Number(metrics?.clicks))
      ? Number(metrics.clicks)
      : Number.isFinite(Number(dashboardMetrics.clicksThisWeek))
        ? Number(dashboardMetrics.clicksThisWeek)
        : null,
    automaticReach: Number.isFinite(Number(metrics?.automaticReach))
      ? Number(metrics.automaticReach)
      : null,
    manualReach: Number.isFinite(Number(metrics?.manualReach))
      ? Number(metrics.manualReach)
      : null,
    previousValue: Number.isFinite(Number(metrics?.previousValue))
      ? Number(metrics.previousValue)
      : null,
    deltaPercent: Number.isFinite(Number(metrics?.deltaPercent))
      ? Number(metrics.deltaPercent)
      : null,
    surfaceSummary: Array.isArray(metrics?.surfaceSummary) ? metrics.surfaceSummary : [],
    sourceSummary:
      metrics?.sourceSummary ||
      "In-app views tracked automatically plus manual social views added by admin weekly.",
  };
};

export const hydratePartnerDashboardClaims = async (claims = [], { now = new Date() } = {}) => {
  await attachPartnerMetricSummariesToClaims(claims, { now });
  await attachPartnerAdvancedInsightsToClaims(claims, { now });
  return claims;
};

export const hydrateSinglePartnerDashboardClaim = async (claim, { now = new Date() } = {}) => {
  if (!claim) return claim;
  await attachPartnerMetricSummariesToClaims([claim], { now });
  await attachPartnerAdvancedInsightsToClaims([claim], { now });
  return claim;
};

const buildOnboardingChecklist = (claim) => {
  const program = resolvePartnerProgramFromClaim(claim);
  const trialEndsAt = program?.trialEndsAt || null;
  const partnerProfile = resolvePartnerProfileFromClaim(claim);
  const featureAccess = partnerProfile?.features || {};

  return [
    {
      key: "badge-live",
      label: program?.trialActive
        ? "Your Featured badge is already live."
        : "Your active badge is reflected on the hotel card.",
      complete: Boolean(program?.badgeCode),
    },
    {
      key: "reach",
      label: "BookingGPT Reach is the visibility metric shown in your partner dashboard.",
      complete: true,
    },
    {
      key: "pricing",
      label: program?.priceVisible
        ? "Pricing is unlocked. You can choose Verified, Preferred or Featured."
        : "Pricing unlocks on day 25 of the trial.",
      complete: Boolean(program?.priceVisible),
    },
    {
      key: "listing-tools",
      label: featureAccess.fullProfileEditorEditable
        ? "Listing controls are available for response time, booking inquiry and special offers."
        : "Upgrade to Preferred or Featured to unlock listing controls.",
      complete: Boolean(featureAccess.fullProfileEditorEditable),
    },
    {
      key: "destination-emails",
      label: featureAccess.destinationEmailsEditable
        ? partnerProfile?.destinationEmailEligible
          ? `This hotel is eligible for destination email spotlights in ${partnerProfile.destinationEmailCity}.`
          : "Destination email placement is unlocked. Add a destination-ready city to activate it."
        : "Upgrade to Preferred or Featured to include this hotel in destination email campaigns.",
      complete: Boolean(featureAccess.destinationEmailsEditable && partnerProfile?.destinationEmailEligible),
    },
    {
      key: "review-boost",
      label: featureAccess.reviewBoostEditable
        ? partnerProfile?.reviewBoostEnabled
          ? "Review boost is active with a Google review link for post-stay reminders."
          : "Featured can enable review boost once the Google review URL is configured."
        : "Upgrade to Featured to unlock post-stay review boost.",
      complete: Boolean(featureAccess.reviewBoostEditable && partnerProfile?.reviewBoostEnabled),
    },
    {
      key: "trial-window",
      label: trialEndsAt
        ? `Trial window ends on ${dayjs(trialEndsAt).format("MMM D, YYYY")}.`
        : "Trial end date will appear here once the claim is active.",
      complete: Boolean(trialEndsAt),
    },
  ];
};

export const buildPartnerDashboardPayload = (claim) => {
  const program = resolvePartnerProgramFromClaim(claim);
  const partnerProfile = resolvePartnerProfileFromClaim(claim);
  const hotel = claim?.hotel || null;
  const cancellationMeta =
    claim?.meta && typeof claim.meta === "object" ? claim.meta.subscriptionCancellation || null : null;
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
    currentExperience: buildCurrentExperience(claim),
    reach: buildReachSummary(claim),
    partnerProfile,
    monthlyReport: claim?.partnerMonthlyReport || null,
    competitorInsights: claim?.partnerCompetitorInsights || null,
    destinationEmail: {
      enabled: Boolean(partnerProfile?.destinationEmailEnabled),
      eligible: Boolean(partnerProfile?.destinationEmailEligible),
      city: partnerProfile?.destinationEmailCity || hotel?.city_name || null,
      country: hotel?.country_name || null,
    },
    reviewBoost: {
      enabled: Boolean(partnerProfile?.reviewBoostEnabled),
      googleReviewUrl: partnerProfile?.googleReviewUrl || null,
    },
    onboardingChecklist: buildOnboardingChecklist(claim),
    emailTimeline: buildEmailTimeline(claim),
    inquiries: Array.isArray(claim?.inquiryLogs)
      ? [...claim.inquiryLogs]
          .sort((left, right) => new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime())
          .slice(0, 10)
          .map((entry) => ({
            id: entry.id,
            travelerName: entry.traveler_name || null,
            travelerEmail: entry.traveler_email || null,
            travelerPhone: entry.traveler_phone || null,
            message: entry.message || "",
            checkIn: entry.check_in || null,
            checkOut: entry.check_out || null,
            sourceSurface: entry.source_surface || null,
            createdAt: entry.created_at || null,
          }))
      : [],
    invoicePending:
      String(claim.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.invoicePending,
    canChoosePlan: Boolean(
      program?.trialActive ||
        claim?.claim_status === PARTNER_CLAIM_STATUSES.expired ||
        claim?.claim_status === PARTNER_CLAIM_STATUSES.cancelled ||
        claim?.claim_status === PARTNER_CLAIM_STATUSES.subscribed
    ),
    canCancel:
      claim?.claim_status === PARTNER_CLAIM_STATUSES.trialActive ||
      claim?.claim_status === PARTNER_CLAIM_STATUSES.trialEnding ||
      claim?.claim_status === PARTNER_CLAIM_STATUSES.subscribed ||
      claim?.claim_status === PARTNER_CLAIM_STATUSES.invoicePending,
    subscription: {
      billingMethod: claim.billing_method || null,
      stripeCustomerId: claim.stripe_customer_id || null,
      stripeSubscriptionId: claim.stripe_subscription_id || null,
      stripeInvoiceId: claim.stripe_invoice_id || null,
      currentPlanCode: getPartnerPlanByCode(claim.current_plan_code)?.code || null,
      pendingPlanCode: getPartnerPlanByCode(claim.pending_plan_code)?.code || null,
      nextBillingAt: claim.next_billing_at || null,
      invoiceRequestedAt: claim.invoice_requested_at || null,
      invoicePaidAt: claim.invoice_paid_at || null,
      cancelScheduled: Boolean(cancellationMeta?.cancelAtPeriodEnd),
      cancelEffectiveAt: cancellationMeta?.effectiveAt || null,
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
    claims.map((claim) => [
      String(claim.hotel_id),
      {
        partnerProgram: resolvePartnerProgramFromClaim(claim),
        partnerProfile: buildPublicPartnerProfile(claim),
      },
    ]),
  );

  return (Array.isArray(items) ? items : []).map((item) => {
    const hotelId = extractHotelId(item);
    if (hotelId == null) return item;
    const resolvedPartner = claimMap.get(String(hotelId));
    const partnerProgram = resolvedPartner?.partnerProgram || null;
    const partnerProfile = resolvedPartner?.partnerProfile || null;
    if (!partnerProgram) return item;
    const profilePhotos = Array.isArray(partnerProfile?.photoUrls) ? partnerProfile.photoUrls.filter(Boolean) : [];
    const primaryPhoto = profilePhotos[0] || null;
    const profileAmenities = Array.isArray(partnerProfile?.amenities) ? partnerProfile.amenities.filter(Boolean) : [];

    const nextHotelDetails =
      item?.hotelDetails && typeof item.hotelDetails === "object"
        ? {
            ...item.hotelDetails,
            image: primaryPhoto || item.hotelDetails?.image || null,
            photo: primaryPhoto || item.hotelDetails?.photo || null,
            photos: profilePhotos.length ? profilePhotos : item.hotelDetails?.photos,
            images: profilePhotos.length ? profilePhotos : item.hotelDetails?.images,
            description: partnerProfile?.description || item.hotelDetails?.description || null,
            shortDescription: partnerProfile?.description || item.hotelDetails?.shortDescription || null,
            amenities: profileAmenities.length ? profileAmenities : item.hotelDetails?.amenities,
            hotelPhone: partnerProfile?.publicContactPhone || item.hotelDetails?.hotelPhone || null,
            hotel_phone: partnerProfile?.publicContactPhone || item.hotelDetails?.hotel_phone || null,
            partnerProgram,
            partnerProfile,
          }
        : item?.hotelDetails;

    return {
      ...item,
      image: primaryPhoto || item?.image || null,
      photo: primaryPhoto || item?.photo || null,
      coverImage: primaryPhoto || item?.coverImage || null,
      photos: profilePhotos.length ? profilePhotos : item?.photos,
      images: profilePhotos.length ? profilePhotos : item?.images,
      description: partnerProfile?.description || item?.description || null,
      shortDescription: partnerProfile?.description || item?.shortDescription || null,
      amenities: profileAmenities.length ? profileAmenities : item?.amenities,
      hotelPhone: partnerProfile?.publicContactPhone || item?.hotelPhone || null,
      hotel_phone: partnerProfile?.publicContactPhone || item?.hotel_phone || null,
      badge: partnerProgram.badgeLabel || item?.badge || null,
      badgeColorHex: partnerProgram.badgeColorHex || item?.badgeColorHex || null,
      partnerProgram,
      partnerProfile,
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
  if (claimStatus === PARTNER_CLAIM_STATUSES.cancelled) return claim;
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

export const cancelPartnerClaimOrSubscription = async ({
  claim,
  reason = "dashboard_request",
}) => {
  if (!claim) {
    const error = new Error("Partner claim not found");
    error.status = 404;
    throw error;
  }

  const now = toNow();
  const meta =
    claim.meta && typeof claim.meta === "object"
      ? { ...claim.meta }
      : {};

  if (
    claim.stripe_subscription_id &&
    [PARTNER_SUBSCRIPTION_STATUSES.active, PARTNER_SUBSCRIPTION_STATUSES.trialing].includes(
      String(claim.subscription_status || "").toLowerCase(),
    )
  ) {
    const stripe = await getStripeClient();
    const subscription = await stripe.subscriptions.update(claim.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    await claim.update({
      cancelled_at: now,
      meta: {
        ...meta,
        subscriptionCancellation: {
          cancelAtPeriodEnd: true,
          requestedAt: now.toISOString(),
          effectiveAt: subscription?.current_period_end
            ? dayjs.unix(subscription.current_period_end).toISOString()
            : claim.next_billing_at || null,
          reason,
        },
      },
      next_billing_at: subscription?.current_period_end
        ? dayjs.unix(subscription.current_period_end).toDate()
        : claim.next_billing_at,
      subscription_status: subscription?.status || claim.subscription_status,
    });
  } else if (claim.claim_status === PARTNER_CLAIM_STATUSES.invoicePending) {
    const stripe = await getStripeClient();
    if (claim.stripe_invoice_id) {
      try {
        await stripe.invoices.voidInvoice(claim.stripe_invoice_id);
      } catch {
        // Best-effort for MVP.
      }
    }

    await claim.update({
      claim_status: PARTNER_CLAIM_STATUSES.cancelled,
      subscription_status: PARTNER_SUBSCRIPTION_STATUSES.cancelled,
      pending_plan_code: null,
      billing_method: null,
      badge_removed_at: now,
      cancelled_at: now,
      meta: {
        ...meta,
        subscriptionCancellation: {
          cancelAtPeriodEnd: false,
          requestedAt: now.toISOString(),
          effectiveAt: now.toISOString(),
          reason,
        },
      },
    });
  } else {
    await claim.update({
      claim_status: PARTNER_CLAIM_STATUSES.cancelled,
      subscription_status:
        claim.subscription_status || PARTNER_SUBSCRIPTION_STATUSES.cancelled,
      badge_removed_at: now,
      cancelled_at: now,
      meta: {
        ...meta,
        subscriptionCancellation: {
          cancelAtPeriodEnd: false,
          requestedAt: now.toISOString(),
          effectiveAt: now.toISOString(),
          reason,
        },
      },
    });
  }

  return models.PartnerHotelClaim.findByPk(claim.id, {
    include: buildClaimInclude(),
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
    const cancelAtPeriodEnd = Boolean(object?.cancel_at_period_end);
    const meta =
      claim.meta && typeof claim.meta === "object"
        ? { ...claim.meta }
        : {};
    const updates = {
      subscription_status: status,
    };
    if (cancelAtPeriodEnd) {
      updates.meta = {
        ...meta,
        subscriptionCancellation: {
          cancelAtPeriodEnd: true,
          requestedAt:
            meta.subscriptionCancellation?.requestedAt || toNow().toISOString(),
          effectiveAt: object?.current_period_end
            ? dayjs.unix(object.current_period_end).toISOString()
            : claim.next_billing_at || null,
          reason: meta.subscriptionCancellation?.reason || "stripe_update",
        },
      };
      updates.next_billing_at = object?.current_period_end
        ? dayjs.unix(object.current_period_end).toDate()
        : claim.next_billing_at;
    } else if (meta.subscriptionCancellation) {
      delete meta.subscriptionCancellation;
      updates.meta = meta;
    }
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
  let monthlyReportsSent = 0;
  const isMonthlyReportDay = dayjs(now).date() === 1;

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
    if (
      program?.claimStatus === PARTNER_CLAIM_STATUSES.subscribed ||
      program?.claimStatus === PARTNER_CLAIM_STATUSES.cancelled
    ) continue;

    for (const step of PARTNER_EMAIL_SEQUENCE) {
      const result = await sendPartnerSequenceEmailIfDue({
        claim,
        hotel: claim.hotel,
        step,
        now,
      });
      if (!result.skipped) emailsSent += 1;
    }

    const activePlan = getPartnerPlanByCode(claim.current_plan_code);
    if (
      isMonthlyReportDay &&
      String(claim.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.subscribed &&
      activePlan?.code === "featured"
    ) {
      const monthKey = dayjs(now).subtract(1, "month").format("YYYY-MM");
      const emailKey = `monthly_report_${monthKey}`;
      if (!findEmailLog(claim, emailKey)) {
        try {
          const report = await generatePartnerMonthlyReport({ claim, now, month: monthKey });
          await sendPartnerMonthlyReportEmail({
            claim,
            monthlyReport: report.monthlyReport,
            competitorInsights: report.competitorInsights,
            pdfBuffer: report.pdfBuffer,
            filename: report.filename,
          });
          const log = await logPartnerEmail({
            claim,
            emailKey,
            scheduleDay: null,
            meta: { automated: true, type: "monthly_report", monthKey },
          });
          if (Array.isArray(claim.emailLogs)) claim.emailLogs.push(log);
          monthlyReportsSent += 1;
        } catch (error) {
          console.warn("[partner-lifecycle] monthly report send failed", {
            claimId: claim.id,
            hotelId: claim.hotel_id,
            error: String(error?.message || error),
          });
        }
      }
    }
  }

  return {
    processed,
    emailsSent,
    badgesRemoved,
    monthlyReportsSent,
  };
};
