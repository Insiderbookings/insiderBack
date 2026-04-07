import models from "../models/index.js";
import { convertCurrency } from "../services/currency.service.js";
import {
  resolveHotelCanonicalPricing,
  resolveHotelPricingRole,
} from "../utils/hotelPricing.js";
import { previewReferralCreditForBooking } from "../services/referralCredit.service.js";
import {
  getSummary,
  isGuestWalletHotelsEnabled,
  listTransactions,
  previewHotelUse,
} from "../services/guestWallet.service.js";

const roundCurrency = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number.parseFloat(numeric.toFixed(2));
};

const isPrivilegedUser = (user) => {
  const role = Number(user?.role);
  return role === 1 || role === 100;
};

const resolveHotelBookingPricingRole = (user) => resolveHotelPricingRole(user);

const resolveCanonicalPublicBookingAmount = ({ flow, providerAmount, pricingRole }) => {
  const providerBase = roundCurrency(providerAmount);
  const snapshotMinimumSellingRaw = Number(flow?.pricing_snapshot_priced?.minimumSelling);
  const selectedMinimumSellingRaw = Number(flow?.selected_offer?.minimumSelling);
  const minimumSellingRaw = Number.isFinite(snapshotMinimumSellingRaw)
    ? snapshotMinimumSellingRaw
    : Number.isFinite(selectedMinimumSellingRaw)
      ? selectedMinimumSellingRaw
      : null;
  return resolveHotelCanonicalPricing({
    providerAmount: providerBase,
    minimumSelling: minimumSellingRaw,
    pricingRole,
  });
};

const convertAmountForCurrency = async (amount, currency) => {
  const normalizedCurrency = String(currency || "USD").trim().toUpperCase() || "USD";
  const safeAmount = roundCurrency(amount);
  if (normalizedCurrency === "USD") return safeAmount;
  const converted = await convertCurrency(safeAmount, normalizedCurrency);
  return roundCurrency(converted?.amount);
};

const resolveHotelWalletPricing = async ({ flow, user, displayCurrency = "USD" }) => {
  const pricedAmount =
    Number(flow?.pricing_snapshot_priced?.price) ||
    Number(flow?.pricing_snapshot_preauth?.price) ||
    null;
  if (!Number.isFinite(pricedAmount) || pricedAmount <= 0) {
    throw Object.assign(new Error("Flow pricing unavailable"), { status: 409 });
  }

  const providerAmountUsd = roundCurrency(pricedAmount);
  const publicPricingRole = resolveHotelBookingPricingRole(user);
  const {
    publicMarkedAmount,
    minimumSelling,
    effectiveAmount,
  } = resolveCanonicalPublicBookingAmount({
    flow,
    providerAmount: providerAmountUsd,
    pricingRole: publicPricingRole,
  });

  const publicAmountUsd = roundCurrency(effectiveAmount ?? publicMarkedAmount ?? providerAmountUsd);
  const minimumSellingUsd = roundCurrency(minimumSelling ?? 0);
  const providerAmountDisplay = await convertAmountForCurrency(providerAmountUsd, displayCurrency);
  const publicAmountDisplay = await convertAmountForCurrency(publicAmountUsd, displayCurrency);
  const minimumSellingDisplay = await convertAmountForCurrency(minimumSellingUsd, displayCurrency);
  const referralCredit = await previewReferralCreditForBooking({
    userId: user?.id,
    providerTotalAmount: providerAmountDisplay,
    publicTotalAmount: publicAmountDisplay,
    minimumSellingAmount: minimumSellingDisplay,
    currency: displayCurrency,
  });
  const totalBeforeWalletUsd = roundCurrency(
    Math.max(0, publicAmountUsd - Number(referralCredit?.appliedUsd || 0))
  );

  return {
    providerAmountUsd,
    publicAmountUsd,
    publicMarkedAmount: publicAmountDisplay,
    minimumSelling: minimumSellingUsd,
    minimumSellingDisplay: minimumSellingDisplay ?? 0,
    effectiveAmount: publicAmountDisplay,
    totalBeforeWalletUsd,
    referralCredit,
  };
};

const requireFlowAccess = async ({ flowId, user }) => {
  const flow = await models.BookingFlow.findByPk(flowId);
  if (!flow) {
    throw Object.assign(new Error("Flow not found"), { status: 404 });
  }
  if (!isPrivilegedUser(user) && (!flow.user_id || Number(flow.user_id) !== Number(user?.id))) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  return flow;
};

export const getGuestWalletSummary = async (req, res, next) => {
  try {
    const summary = await getSummary({ userId: req.user.id, releaseDue: true });
    return res.json(summary);
  } catch (error) {
    next(error);
  }
};

export const getGuestWalletTransactions = async (req, res, next) => {
  try {
    const { cursor = null, limit = 20 } = req.query || {};
    const result = await listTransactions({
      userId: req.user.id,
      cursor,
      limit,
    });
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

export const previewGuestWalletForHotel = async (req, res, next) => {
  try {
    if (!isGuestWalletHotelsEnabled()) {
      return res.json({
        enabled: false,
        flowId: req.body?.flowId || null,
        availableUsd: 0,
        availableMinor: 0,
        appliedUsd: 0,
        appliedMinor: 0,
        appliedDisplay: null,
        remainingChargeDisplay: null,
        minimumSellingDisplay: null,
        blockedByMinimumSelling: true,
        pendingRewardUsd: 0,
      });
    }

    const flowId = req.body?.flowId;
    if (!flowId) {
      return res.status(400).json({ error: "Missing flowId" });
    }

    const flow = await requireFlowAccess({ flowId, user: req.user });
    const displayCurrency =
      String(req.body?.currency || flow?.pricing_snapshot_priced?.currency || "USD")
        .trim()
        .toUpperCase() || "USD";
    const pricing = await resolveHotelWalletPricing({
      flow,
      user: req.user,
      displayCurrency,
    });
    const preview = await previewHotelUse({
      userId: req.user.id,
      publicTotalUsd: pricing.totalBeforeWalletUsd,
      minimumSellingUsd: pricing.minimumSelling,
      displayCurrency,
      flowId,
    });
    return res.json({
      ...preview,
      referralCredit: pricing.referralCredit,
    });
  } catch (error) {
    next(error);
  }
};

export default {
  getGuestWalletSummary,
  getGuestWalletTransactions,
  previewGuestWalletForHotel,
  resolveHotelWalletPricing,
};
