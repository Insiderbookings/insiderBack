import models from "../models/index.js";
import { convertCurrency, createCurrencyConverter } from "./currency.service.js";

const REFERRAL_CREDIT_USD = 50;
const REFERRAL_CREDIT_USAGE_RATE = 0.1;
const REFERRAL_CREDIT_EXPIRY_MONTHS = 12;
const MINOR_FACTOR = 100;

const roundCurrency = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number.parseFloat(numeric.toFixed(2));
};

const toMinor = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(0, Math.round(numeric * MINOR_FACTOR));
};

const fromMinor = (value) => roundCurrency(Number(value || 0) / MINOR_FACTOR);

const normalizeCurrency = (value, fallback = "USD") =>
  String(value || fallback || "USD").trim().toUpperCase() || "USD";

const normalizeCode = (value) => String(value || "").trim().toUpperCase();

const addMonths = (date, months) => {
  const output = new Date(date);
  output.setMonth(output.getMonth() + months);
  return output;
};

const formatCurrencyLabel = (amount, currency = "USD") => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;
  const normalizedCurrency = normalizeCurrency(currency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${normalizedCurrency}`;
  }
};

const toCurrencyFromUsd = async (usdAmount, currency) => {
  const normalizedCurrency = normalizeCurrency(currency);
  if (normalizedCurrency === "USD") return roundCurrency(usdAmount);
  const converted = await convertCurrency(usdAmount, normalizedCurrency);
  return roundCurrency(converted?.amount);
};

const toUsdFromCurrency = async (amount, currency) => {
  const normalizedCurrency = normalizeCurrency(currency);
  if (normalizedCurrency === "USD") return roundCurrency(amount);
  const converter = createCurrencyConverter("USD");
  return roundCurrency(await converter.convert(amount, normalizedCurrency));
};

const getReferralCreditState = (user) => {
  if (!user) return null;
  const totalMinor = Math.max(0, Math.round(Number(user.referral_credit_total_minor || 0)));
  const availableMinor = Math.max(0, Math.round(Number(user.referral_credit_available_minor || 0)));
  const usedMinor = Math.max(0, Math.round(Number(user.referral_credit_used_minor || 0)));
  const grantedAt = user.referral_credit_granted_at || null;
  const expiresAt = user.referral_credit_expires_at || null;
  const sourceInfluencerId = user.referral_credit_source_influencer_id ?? null;
  const sourceCode = user.referral_credit_source_code ?? null;
  const now = Date.now();
  const expiryTime = expiresAt ? new Date(expiresAt).getTime() : null;
  const expired = Number.isFinite(expiryTime) ? expiryTime <= now : false;
  return {
    totalMinor,
    availableMinor,
    usedMinor,
    grantedAt,
    expiresAt,
    sourceInfluencerId,
    sourceCode,
    expired,
    active: availableMinor > 0 && !expired,
  };
};

const buildZeroPreview = async ({ currency, publicTotalAmount, minimumSellingAmount, providerTotalAmount }) => {
  const normalizedCurrency = normalizeCurrency(currency);
  const safeProvider = roundCurrency(providerTotalAmount);
  const safePublic = roundCurrency(publicTotalAmount);
  const safeMinimumSelling = roundCurrency(minimumSellingAmount);
  const safePublicUsd = await toUsdFromCurrency(safePublic, normalizedCurrency);
  const safeMinimumSellingUsd = await toUsdFromCurrency(safeMinimumSelling, normalizedCurrency);
  return {
    enabled: true,
    apply: false,
    providerAmount: safeProvider,
    publicAmount: safePublic,
    minimumSellingAmount: safeMinimumSelling,
    availableMinor: 0,
    availableUsd: 0,
    availableDisplay: formatCurrencyLabel(0, normalizedCurrency),
    capUsd: 0,
    capDisplay: formatCurrencyLabel(0, normalizedCurrency),
    appliedMinor: 0,
    appliedUsd: 0,
    appliedDisplay: formatCurrencyLabel(0, normalizedCurrency),
    remainingChargeUsd: safePublicUsd,
    remainingChargeDisplay: formatCurrencyLabel(safePublic, normalizedCurrency),
    minimumSellingUsd: safeMinimumSellingUsd,
    minimumSellingDisplay: formatCurrencyLabel(safeMinimumSelling, normalizedCurrency),
    blockedByMinimumSelling: safePublic <= safeMinimumSelling,
    expired: false,
    grantedAt: null,
    expiresAt: null,
    sourceInfluencerId: null,
    sourceCode: null,
    currency: normalizedCurrency,
  };
};

const buildReferralCreditPreview = async ({
  user,
  providerTotalAmount,
  publicTotalAmount,
  minimumSellingAmount = 0,
  currency = "USD",
}) => {
  const normalizedCurrency = normalizeCurrency(currency);
  const providerAmount = roundCurrency(providerTotalAmount);
  const publicAmount = roundCurrency(publicTotalAmount);
  const minimumSelling = roundCurrency(minimumSellingAmount);
  const state = getReferralCreditState(user);
  if (!state || !state.active) {
    return buildZeroPreview({
      currency: normalizedCurrency,
      publicTotalAmount: publicAmount,
      minimumSellingAmount: minimumSelling,
      providerTotalAmount: providerAmount,
    });
  }

  const availableUsd = fromMinor(state.availableMinor);
  const availableDisplay = await toCurrencyFromUsd(availableUsd, normalizedCurrency);
  const providerCapDisplay = roundCurrency(Math.max(0, providerAmount * REFERRAL_CREDIT_USAGE_RATE));
  const totalReductionAvailable = roundCurrency(Math.max(0, publicAmount - minimumSelling));
  const appliedDisplay = roundCurrency(
    Math.max(0, Math.min(availableDisplay, providerCapDisplay, totalReductionAvailable))
  );
  const appliedUsd = await toUsdFromCurrency(appliedDisplay, normalizedCurrency);
  const providerCapUsd = await toUsdFromCurrency(providerCapDisplay, normalizedCurrency);
  const remainingChargeDisplayAmount = roundCurrency(Math.max(0, publicAmount - appliedDisplay));
  const remainingChargeUsd = await toUsdFromCurrency(remainingChargeDisplayAmount, normalizedCurrency);
  const minimumSellingUsd = await toUsdFromCurrency(minimumSelling, normalizedCurrency);

  return {
    enabled: true,
    apply: appliedDisplay > 0,
    providerAmount: providerAmount,
    publicAmount: publicAmount,
    minimumSellingAmount: minimumSelling,
    availableMinor: state.availableMinor,
    availableUsd: availableUsd,
    availableDisplay: formatCurrencyLabel(availableDisplay, normalizedCurrency),
    capUsd: providerCapUsd,
    capDisplay: formatCurrencyLabel(providerCapDisplay, normalizedCurrency),
    appliedMinor: toMinor(appliedUsd),
    appliedUsd: appliedUsd,
    appliedDisplay: formatCurrencyLabel(appliedDisplay, normalizedCurrency),
    remainingChargeUsd: remainingChargeUsd,
    remainingChargeDisplay: formatCurrencyLabel(remainingChargeDisplayAmount, normalizedCurrency),
    minimumSellingUsd: minimumSellingUsd,
    minimumSellingDisplay: formatCurrencyLabel(minimumSelling, normalizedCurrency),
    blockedByMinimumSelling: totalReductionAvailable <= 0,
    expired: state.expired,
    grantedAt: state.grantedAt ?? null,
    expiresAt: state.expiresAt ?? null,
    sourceInfluencerId: state.sourceInfluencerId ?? null,
    sourceCode: state.sourceCode ?? null,
    currency: normalizedCurrency,
  };
};

const loadReferralCreditUser = async ({ userId, transaction = null, lock = false }) => {
  if (!models.User || !userId) return null;
  const attributes = [
    "id",
    "referral_credit_total_minor",
    "referral_credit_available_minor",
    "referral_credit_used_minor",
    "referral_credit_granted_at",
    "referral_credit_expires_at",
    "referral_credit_source_influencer_id",
    "referral_credit_source_code",
  ];
  return models.User.findByPk(userId, {
    attributes,
    transaction,
    ...(lock ? { lock: transaction?.LOCK?.UPDATE } : {}),
  });
};

export const grantReferralCreditForUser = async ({
  userId,
  influencerUserId = null,
  referralCode = null,
  transaction = null,
  amountUsd = REFERRAL_CREDIT_USD,
} = {}) => {
  if (!models.User || !userId) return null;
  const user = await loadReferralCreditUser({ userId, transaction, lock: Boolean(transaction) });
  if (!user) return null;

  const state = getReferralCreditState(user);
  if (state && (state.totalMinor > 0 || state.availableMinor > 0 || state.grantedAt)) {
    return {
      granted: false,
      alreadyGranted: true,
      state,
      user,
    };
  }

  const amountMinor = toMinor(amountUsd);
  const now = new Date();
  const [updatedCount] = await models.User.update(
    {
      referral_credit_total_minor: amountMinor,
      referral_credit_available_minor: amountMinor,
      referral_credit_used_minor: 0,
      referral_credit_granted_at: now,
      referral_credit_expires_at: addMonths(now, REFERRAL_CREDIT_EXPIRY_MONTHS),
      referral_credit_source_influencer_id: influencerUserId || null,
      referral_credit_source_code: normalizeCode(referralCode) || null,
    },
    {
      where: { id: user.id },
      transaction,
    }
  );

  if (!updatedCount) {
    return {
      granted: false,
      alreadyGranted: false,
      amountMinor: 0,
      state,
      user,
    };
  }

  const refreshedUser = await loadReferralCreditUser({
    userId,
    transaction,
    lock: Boolean(transaction),
  });

  return {
    granted: true,
    alreadyGranted: false,
    amountMinor,
    state: getReferralCreditState(
      refreshedUser?.get ? refreshedUser.get({ plain: true }) : refreshedUser || user
    ),
    user: refreshedUser || user,
  };
};

export const resolveReferralCreditSummaryForUser = (user) => {
  const state = getReferralCreditState(user);
  if (!state || (!state.totalMinor && !state.availableMinor && !state.grantedAt)) return null;
  return {
    totalMinor: state.totalMinor,
    availableMinor: state.availableMinor,
    usedMinor: state.usedMinor,
    totalUsd: fromMinor(state.totalMinor),
    availableUsd: fromMinor(state.availableMinor),
    usedUsd: fromMinor(state.usedMinor),
    value: formatCurrencyLabel(fromMinor(state.availableMinor)),
    description: state.expiresAt
      ? `Expires ${new Date(state.expiresAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}`
      : "Referral credit balance",
    variant: state.active ? "is-credit" : "is-expired",
    active: state.active,
    expired: state.expired,
    grantedAt: state.grantedAt ?? null,
    expiresAt: state.expiresAt ?? null,
    sourceInfluencerId: state.sourceInfluencerId ?? null,
    sourceCode: state.sourceCode ?? null,
  };
};

export const previewReferralCreditForBooking = async ({
  userId,
  providerTotalAmount,
  publicTotalAmount,
  minimumSellingAmount = 0,
  currency = "USD",
  transaction = null,
} = {}) => {
  if (!models.User || !userId) {
    return buildZeroPreview({
      currency,
      publicTotalAmount,
      minimumSellingAmount,
      providerTotalAmount,
    });
  }

  const user = await loadReferralCreditUser({ userId, transaction, lock: false });
  if (!user) {
    return buildZeroPreview({
      currency,
      publicTotalAmount,
      minimumSellingAmount,
      providerTotalAmount,
    });
  }

  return buildReferralCreditPreview({
    user,
    providerTotalAmount,
    publicTotalAmount,
    minimumSellingAmount,
    currency,
  });
};

export const reserveReferralCreditForBooking = async ({
  userId,
  providerTotalAmount,
  publicTotalAmount,
  minimumSellingAmount = 0,
  currency = "USD",
  bookingId = null,
  bookingRef = null,
  transaction,
}) => {
  if (!models.User || !userId) {
    return buildZeroPreview({
      currency,
      publicTotalAmount,
      minimumSellingAmount,
      providerTotalAmount,
    });
  }

  const user = await loadReferralCreditUser({ userId, transaction, lock: true });
  if (!user) {
    return buildZeroPreview({
      currency,
      publicTotalAmount,
      minimumSellingAmount,
      providerTotalAmount,
    });
  }

  const preview = await buildReferralCreditPreview({
    user,
    providerTotalAmount,
    publicTotalAmount,
    minimumSellingAmount,
    currency,
  });

  if (!preview.apply || preview.appliedMinor <= 0) {
    return preview;
  }

  const currentAvailable = Math.max(0, Math.round(Number(user.referral_credit_available_minor || 0)));
  const currentUsed = Math.max(0, Math.round(Number(user.referral_credit_used_minor || 0)));
  const appliedUsdMinor = Math.max(0, Math.round(Number(preview.appliedMinor || 0)));
  const nextAvailable = Math.max(0, currentAvailable - appliedUsdMinor);
  const nextUsed = currentUsed + appliedUsdMinor;
  const nextAvailableUsd = fromMinor(nextAvailable);
  const nextAvailableDisplayAmount = await toCurrencyFromUsd(nextAvailableUsd, currency);

  await user.update(
    {
      referral_credit_available_minor: nextAvailable,
      referral_credit_used_minor: nextUsed,
    },
    { transaction }
  );

  return {
    ...preview,
    reserved: true,
    bookingId: bookingId || null,
    bookingRef: bookingRef || null,
    availableMinor: nextAvailable,
    availableUsd: nextAvailableUsd,
    availableDisplay: formatCurrencyLabel(nextAvailableDisplayAmount, normalizeCurrency(currency)),
    usedMinor: nextUsed,
    appliedMinor: appliedUsdMinor,
    appliedUsd: fromMinor(appliedUsdMinor),
  };
};

export const restoreReferralCreditForBooking = async ({ booking, transaction = null } = {}) => {
  if (!booking || !models.User) return null;
  const snapshot = booking.pricing_snapshot || {};
  const meta = booking.meta || {};
  const referralCreditRaw =
    snapshot.referralCredit ??
    snapshot.referral_credit ??
    meta.referralCredit ??
    meta.referral_credit ??
    null;
  if (!referralCreditRaw || typeof referralCreditRaw !== "object") return null;
  if (String(referralCreditRaw.status || "").toLowerCase() === "restored") return referralCreditRaw;
  const appliedMinor = Math.max(
    0,
    Math.round(Number(referralCreditRaw.appliedMinor ?? toMinor(referralCreditRaw.appliedUsd) ?? 0))
  );
  if (!appliedMinor) return referralCreditRaw;

  const userId = Number(booking.user_id);
  if (!userId) return referralCreditRaw;
  const user = await loadReferralCreditUser({ userId, transaction, lock: Boolean(transaction) });
  if (!user) return referralCreditRaw;

  const currentAvailable = Math.max(0, Math.round(Number(user.referral_credit_available_minor || 0)));
  const currentUsed = Math.max(0, Math.round(Number(user.referral_credit_used_minor || 0)));
  await user.update(
    {
      referral_credit_available_minor: currentAvailable + appliedMinor,
      referral_credit_used_minor: Math.max(0, currentUsed - appliedMinor),
    },
    { transaction }
  );

  const restored = {
    ...referralCreditRaw,
    status: "restored",
    restoredAt: new Date().toISOString(),
  };

  if (snapshot.referralCredit) snapshot.referralCredit = restored;
  if (snapshot.referral_credit) snapshot.referral_credit = restored;
  if (meta.referralCredit) meta.referralCredit = restored;
  if (meta.referral_credit) meta.referral_credit = restored;

  await booking.update(
    {
      pricing_snapshot: snapshot,
      meta,
    },
    { transaction }
  );

  return restored;
};

export default {
  grantReferralCreditForUser,
  previewReferralCreditForBooking,
  resolveReferralCreditSummaryForUser,
  reserveReferralCreditForBooking,
  restoreReferralCreditForBooking,
};
