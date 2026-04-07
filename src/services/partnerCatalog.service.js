import dayjs from "dayjs";

export const PARTNER_TRIAL_DAYS = 30;
export const PARTNER_PRICE_DISCLOSURE_DAY = 25;

export const PARTNER_BADGES = Object.freeze({
  verified: {
    code: "verified",
    label: "Verified",
    color: "Green",
    hex: "#22C55E",
    priority: 1,
  },
  preferred: {
    code: "preferred",
    label: "Preferred",
    color: "Blue",
    hex: "#1877F2",
    priority: 2,
  },
  featured: {
    code: "featured",
    label: "Featured",
    color: "Purple",
    hex: "#7B2FBE",
    priority: 3,
  },
});

export const PARTNER_PLANS = Object.freeze({
  starter: {
    code: "starter",
    label: "Starter",
    priceMonthly: 49,
    currency: "USD",
    badgeCode: "verified",
    billingMode: "subscription",
    stripePriceEnv: "STRIPE_PARTNER_PRICE_STARTER",
  },
  pro: {
    code: "pro",
    label: "Pro",
    priceMonthly: 99,
    currency: "USD",
    badgeCode: "preferred",
    billingMode: "subscription",
    stripePriceEnv: "STRIPE_PARTNER_PRICE_PRO",
  },
  elite: {
    code: "elite",
    label: "Elite",
    priceMonthly: 249,
    currency: "USD",
    badgeCode: "featured",
    billingMode: "subscription",
    stripePriceEnv: "STRIPE_PARTNER_PRICE_ELITE",
  },
});

export const PARTNER_EMAIL_SEQUENCE = Object.freeze([
  {
    key: "day_1_welcome",
    day: 1,
    subject: "Your Featured badge is live on BookingGPT",
    preview: "Welcome. Your Featured badge is live. Here is your dashboard link.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_7_report",
    day: 7,
    subject: "Week 1 report for your BookingGPT trial",
    preview: "Week 1 report. Your views and clicks this week.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_14_report",
    day: 14,
    subject: "Week 2 report for your BookingGPT trial",
    preview: "Week 2 report. Your views and clicks this week.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_15_midpoint",
    day: 15,
    subject: "You are halfway through your trial",
    preview: "You are halfway through your trial. Here is what you have gotten so far.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_21_report",
    day: 21,
    subject: "Week 3 report for your BookingGPT trial",
    preview: "Week 3 report. Your views and clicks this week.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_25_choose_plan",
    day: 25,
    subject: "Your trial ends in 5 days",
    preview: "Choose your plan to keep your badge.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_27_urgent",
    day: 27,
    subject: "3 days left before your badge disappears",
    preview: "Your badge disappears soon. A manual call is scheduled too.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_28_final_warning",
    day: 28,
    subject: "Tomorrow your badge disappears",
    preview: "Last chance before removal. A second call attempt is scheduled too.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_30_removed",
    day: 30,
    subject: "Your badge has been removed",
    preview: "Restore it here. A third call attempt is scheduled too.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_32_restore",
    day: 32,
    subject: "Your hotel is still on BookingGPT without a badge",
    preview: "Restore it to get visibility back.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_37_last_message",
    day: 37,
    subject: "Final message about restoring your badge",
    preview: "Last call and final message before we stop follow-ups.",
    stopWhenSubscribed: true,
  },
]);

export const PARTNER_PAYMENT_METHODS = Object.freeze({
  card: "card",
  invoice: "invoice",
});

export const PARTNER_CLAIM_STATUSES = Object.freeze({
  trialActive: "TRIAL_ACTIVE",
  trialEnding: "TRIAL_ENDING",
  paymentDue: "PAYMENT_DUE",
  subscribed: "SUBSCRIBED",
  invoicePending: "INVOICE_PENDING",
  expired: "EXPIRED",
  cancelled: "CANCELLED",
});

export const PARTNER_SUBSCRIPTION_STATUSES = Object.freeze({
  active: "active",
  trialing: "trialing",
  pastDue: "past_due",
  unpaid: "unpaid",
  cancelled: "canceled",
  incomplete: "incomplete",
  pendingInvoice: "pending_invoice",
});

export const getPartnerPlanByCode = (code) =>
  PARTNER_PLANS[String(code || "").trim().toLowerCase()] || null;

export const getPartnerBadgeByCode = (code) =>
  PARTNER_BADGES[String(code || "").trim().toLowerCase()] || null;

export const getPartnerPlans = () =>
  Object.values(PARTNER_PLANS).map((plan) => ({
    ...plan,
    badge: getPartnerBadgeByCode(plan.badgeCode),
    stripePriceId: process.env[plan.stripePriceEnv] || null,
  }));

const normalizeDate = (value) => {
  const date = dayjs(value);
  return date.isValid() ? date : null;
};

export const getPartnerClaimAgeDays = (claim, now = new Date()) => {
  const startedAt = normalizeDate(claim?.trial_started_at || claim?.claimed_at);
  if (!startedAt) return null;
  return dayjs(now).startOf("day").diff(startedAt.startOf("day"), "day") + 1;
};

export const resolvePartnerProgramFromClaim = (claim, now = new Date()) => {
  if (!claim) return null;
  const ageDays = getPartnerClaimAgeDays(claim, now);
  const trialEndsAt = normalizeDate(claim?.trial_ends_at);
  const hasActiveSubscription =
    String(claim?.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.subscribed ||
    [PARTNER_SUBSCRIPTION_STATUSES.active, PARTNER_SUBSCRIPTION_STATUSES.trialing].includes(
      String(claim?.subscription_status || "").toLowerCase(),
    );
  const pendingInvoice =
    String(claim?.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.invoicePending;

  const currentPlan = getPartnerPlanByCode(claim?.current_plan_code);
  const pendingPlan = getPartnerPlanByCode(claim?.pending_plan_code);
  const trialIsActive = Boolean(
    !hasActiveSubscription &&
      trialEndsAt &&
      dayjs(now).isBefore(trialEndsAt.add(1, "second")),
  );

  let badge = null;
  let plan = currentPlan;
  let statusLabel = "No badge";

  if (trialIsActive) {
    badge = getPartnerBadgeByCode("featured");
    plan = getPartnerPlanByCode("elite");
    statusLabel = "Trial active";
  } else if (hasActiveSubscription && currentPlan) {
    badge = getPartnerBadgeByCode(currentPlan.badgeCode);
    statusLabel = "Subscribed";
  } else if (pendingInvoice && pendingPlan) {
    badge = null;
    plan = pendingPlan;
    statusLabel = "Invoice pending";
  } else if (String(claim?.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.expired) {
    badge = null;
    statusLabel = "Badge removed";
  }

  const trialDaysLeft =
    trialEndsAt && trialIsActive
      ? Math.max(0, trialEndsAt.endOf("day").diff(dayjs(now), "day"))
      : 0;

  return {
    claimId: claim.id,
    hotelId: claim.hotel_id != null ? String(claim.hotel_id) : null,
    claimStatus: claim.claim_status || null,
    subscriptionStatus: claim.subscription_status || null,
    statusLabel,
    badgeCode: badge?.code || null,
    badgeLabel: badge?.label || null,
    badgeColorHex: badge?.hex || null,
    badgePriority: badge?.priority || 0,
    planCode: plan?.code || null,
    planLabel: plan?.label || null,
    priceMonthly: plan?.priceMonthly ?? null,
    currency: plan?.currency || "USD",
    trialActive: trialIsActive,
    trialStartedAt: claim.trial_started_at || claim.claimed_at || null,
    trialEndsAt: claim.trial_ends_at || null,
    trialDaysLeft,
    ageDays,
    priceVisible: Boolean(ageDays != null && ageDays >= PARTNER_PRICE_DISCLOSURE_DAY),
    nextBillingAt: claim.next_billing_at || null,
    invoiceRequestedAt: claim.invoice_requested_at || null,
    invoicePaidAt: claim.invoice_paid_at || null,
    billingMethod: claim.billing_method || null,
    pendingPlanCode: pendingPlan?.code || null,
    pendingPlanLabel: pendingPlan?.label || null,
  };
};

export const resolvePartnerBadgePriority = (item) => {
  const direct = Number(item?.partnerProgram?.badgePriority);
  if (Number.isFinite(direct)) return direct;
  const nested = Number(item?.hotelDetails?.partnerProgram?.badgePriority);
  if (Number.isFinite(nested)) return nested;
  const badgeKey =
    item?.partnerProgram?.badgeCode ||
    item?.hotelDetails?.partnerProgram?.badgeCode ||
    String(item?.badge || "").trim().toLowerCase();
  return getPartnerBadgeByCode(badgeKey)?.priority || 0;
};
