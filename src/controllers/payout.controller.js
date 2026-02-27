import models from "../models/index.js";
import { Op } from "sequelize";
import { sendPayout, getStripeClient } from "../services/payoutProviders.js";
import { createCurrencyConverter } from "../services/currency.service.js";
import { computeHomeFinancialsFromStay } from "../utils/homePricing.js";

const DEFAULT_GRACE_HOURS = 72;
const DEFAULT_STRIPE_COUNTRY = "US";
const DEFAULT_BATCH_REPORT_CURRENCY = String(process.env.PAYOUT_BATCH_REPORT_CURRENCY || "USD").trim().toUpperCase();
const CLAIMABLE_PAYOUT_STATUSES = ["PENDING", "QUEUED"];
const READY_PAYOUT_ACCOUNT_STATUSES = ["READY", "VERIFIED"];
const UPCOMING_PAYOUT_STATUSES = ["PENDING", "QUEUED", "PROCESSING", "ON_HOLD"];
const DEFAULT_CONNECT_RETURN_URL = "https://bookinggpt.app/payout/complete";
const DEFAULT_CONNECT_REFRESH_URL = "https://bookinggpt.app/payout/refresh";

const getGraceHours = () => {
  const raw = Number(process.env.PAYOUT_GRACE_HOURS || DEFAULT_GRACE_HOURS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_GRACE_HOURS;
};

const resolveEligibleDate = (now = new Date()) => {
  const graceHours = getGraceHours();
  const eligible = new Date(now.getTime() - graceHours * 60 * 60 * 1000);
  return eligible.toISOString().slice(0, 10);
};

const normalizeStripeConnectRedirectUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    const protocol = String(parsed.protocol || "").toLowerCase();
    if (protocol !== "https:" && protocol !== "http:") return null;
    if (isProd && protocol !== "https:") return null;

    const host = String(parsed.hostname || "").toLowerCase();
    const isBookingHost =
      host === "bookinggpt.app" ||
      host.endsWith(".bookinggpt.app") ||
      host === "insiderbookings.com" ||
      host.endsWith(".insiderbookings.com");
    const isLocalHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

    if (!isBookingHost && !(!isProd && isLocalHost)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const resolveStripeConnectUrls = (req) => {
  const defaultRefresh =
    process.env.STRIPE_CONNECT_REFRESH_URL ||
    process.env.CLIENT_URL ||
    DEFAULT_CONNECT_REFRESH_URL;
  const defaultReturn =
    process.env.STRIPE_CONNECT_RETURN_URL ||
    process.env.CLIENT_URL ||
    DEFAULT_CONNECT_RETURN_URL;

  const refreshUrl =
    normalizeStripeConnectRedirectUrl(req.body?.refreshUrl) ||
    normalizeStripeConnectRedirectUrl(defaultRefresh) ||
    DEFAULT_CONNECT_REFRESH_URL;
  const returnUrl =
    normalizeStripeConnectRedirectUrl(req.body?.returnUrl) ||
    normalizeStripeConnectRedirectUrl(defaultReturn) ||
    DEFAULT_CONNECT_RETURN_URL;

  return { refreshUrl, returnUrl };
};

export const isValidDateOnly = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
};

export const normalizePayoutBatchLimit = (value, fallback = 100, max = 1000) => {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(raw)));
};

export const resolvePayoutCutoffDate = (rawCutoffDate) => {
  const raw = rawCutoffDate == null ? "" : String(rawCutoffDate).trim();
  if (!raw) return resolveEligibleDate();
  if (!isValidDateOnly(raw)) {
    throw new Error("cutoffDate must be YYYY-MM-DD");
  }
  return raw;
};

const resolveStripeStatus = (account) => {
  if (!account) return "INCOMPLETE";
  const transfersActive = account.capabilities?.transfers === "active";
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const chargesEnabled = Boolean(account.charges_enabled);
  if (transfersActive && payoutsEnabled && chargesEnabled) return "VERIFIED";
  if (transfersActive) return "READY";
  if (account.details_submitted) return "PENDING";
  return "INCOMPLETE";
};

const buildStripeMetadata = (account) => {
  if (!account) return {};
  return {
    stripe: {
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      capabilities: account.capabilities || null,
      requirements: account.requirements || null,
      disabledReason: account.requirements?.disabled_reason || account.disabled_reason || null,
      updatedAt: new Date().toISOString(),
    },
  };
};

const maskAccount = (account) => {
  if (!account) return null;
  return {
    provider: account.provider || "BANK",
    status: account.status,
    holderName: account.holder_name || null,
    bankName: account.bank_name || null,
    country: account.country || null,
    currency: account.currency || null,
    routingLast4: account.routing_last4 || null,
    accountLast4: account.account_last4 || null,
    walletEmail: account.wallet_email || null,
    brand: account.brand || null,
    updatedAt: account.updatedAt || account.updated_at || null,
    stripe: account.provider === "STRIPE" ? account.metadata?.stripe || null : null,
  };
};

const syncStripeAccount = async (account) => {
  if (!account || account.provider !== "STRIPE") return account;
  const stripeAccountId = account.external_customer_id || account.external_account_id;
  if (!stripeAccountId) return account;
  const stripe = await getStripeClient();
  if (!stripe) return account;

  const stripeAccount = await stripe.accounts.retrieve(stripeAccountId);
  const status = resolveStripeStatus(stripeAccount);
  const metadata = {
    ...(account.metadata || {}),
    ...buildStripeMetadata(stripeAccount),
  };
  await account.update({ status, metadata });
  return account;
};

const ensurePayoutItemsForHost = async (hostId) => {
  if (!hostId) return;

  const existing = await models.PayoutItem.findAll({
    attributes: ["stay_id"],
    where: { user_id: hostId },
  });
  const existingIds = new Set(existing.map((r) => r.stay_id));

  const stays = await models.Stay.findAll({
    where: {
      inventory_type: "HOME",
      status: "COMPLETED",
      payment_status: "PAID",
      id: { [Op.notIn]: Array.from(existingIds) },
    },
    include: [
      {
        model: models.StayHome,
        as: "homeStay",
        required: true,
        where: { host_id: hostId },
      },
    ],
  });

  for (const stay of stays) {
    const financials = computeHomeFinancialsFromStay(stay);
    const currency = financials.currency || stay.currency || "USD";
    const scheduled_for = stay.check_out || stay.check_in || null;
    try {
      await models.PayoutItem.create({
        stay_id: stay.id,
        user_id: hostId,
        amount: financials.hostPayout,
        currency,
        status: "PENDING",
        scheduled_for,
        metadata: {
          source: "auto-backfill",
          createdAt: new Date(),
          pricing_model: financials.model,
          guest_total: financials.guestTotal,
          gross_price: financials.hostSubtotal,
          fee_amount: financials.hostServiceFee,
          platform_markup_amount: financials.platformMarkupAmount,
          effective_platform_revenue: financials.effectivePlatformRevenue,
        },
      });
    } catch (_) {
      // ignore duplicates due to race
    }
  }
};

const backfillPayoutItems = async (cutoffDate) => {
  if (!cutoffDate) return;
  const stays = await models.Stay.findAll({
    where: {
      inventory_type: "HOME",
      status: "COMPLETED",
      payment_status: "PAID",
      check_out: { [Op.lte]: cutoffDate },
    },
    include: [
      {
        model: models.StayHome,
        as: "homeStay",
        required: true,
        attributes: ["host_id"],
      },
    ],
  });

  const payload = stays
    .map((stay) => {
      const hostId = stay.homeStay?.host_id;
      if (!hostId) return null;
      const financials = computeHomeFinancialsFromStay(stay);
      return {
        stay_id: stay.id,
        user_id: hostId,
        amount: financials.hostPayout,
        currency: financials.currency || stay.currency || "USD",
        status: "PENDING",
        scheduled_for: stay.check_out || stay.check_in || null,
        metadata: {
          source: "batch-backfill",
          createdAt: new Date(),
          pricing_model: financials.model,
          guest_total: financials.guestTotal,
          gross_price: financials.hostSubtotal,
          fee_amount: financials.hostServiceFee,
          platform_markup_amount: financials.platformMarkupAmount,
          effective_platform_revenue: financials.effectivePlatformRevenue,
        },
      };
    })
    .filter(Boolean);

  if (!payload.length) return;
  try {
    await models.PayoutItem.bulkCreate(payload, { ignoreDuplicates: true });
  } catch (_) {
    for (const item of payload) {
      try {
        await models.PayoutItem.create(item);
      } catch (err) {
        if (!String(err?.name || "").includes("SequelizeUniqueConstraintError")) {
          console.warn("[payout-backfill] create failed", err?.message || err);
        }
      }
    }
  }
};

const buildEligiblePayoutItemsQuery = ({ cutoff, limit = 100, itemIds = null } = {}) => {
  const where = {
    status: { [Op.in]: CLAIMABLE_PAYOUT_STATUSES },
    scheduled_for: { [Op.lte]: cutoff },
  };

  const normalizedItemIds = Array.isArray(itemIds)
    ? [...new Set(itemIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))]
    : [];

  if (normalizedItemIds.length) where.id = { [Op.in]: normalizedItemIds };

  const query = {
    where,
    include: [
      {
        model: models.Stay,
        as: "stay",
        required: true,
        where: {
          inventory_type: "HOME",
          status: "COMPLETED",
          payment_status: "PAID",
        },
        include: [
          {
            model: models.StayHome,
            as: "homeStay",
            required: true,
            include: [
              { model: models.Home, as: "home", required: false, attributes: ["id", "title"] },
            ],
          },
        ],
      },
    ],
    order: [["scheduled_for", "ASC"], ["id", "ASC"]],
  };

  if (!normalizedItemIds.length) {
    query.limit = normalizePayoutBatchLimit(limit, 100, 1000);
  }

  return { query, normalizedItemIds };
};

const resolveItemPayoutReadiness = ({ hostId, account }) => {
  if (!hostId) {
    return { state: "FAILED", reason: "Missing host ownership on stay" };
  }
  if (!account) {
    return { state: "ON_HOLD", reason: "Host payout account is not configured" };
  }

  const provider = String(account.provider || "").toUpperCase();
  if (provider !== "STRIPE") {
    return { state: "ON_HOLD", reason: `Payout provider ${provider || "UNKNOWN"} is not supported` };
  }

  const status = String(account.status || "").toUpperCase();
  if (!READY_PAYOUT_ACCOUNT_STATUSES.includes(status)) {
    return { state: "ON_HOLD", reason: `Payout account status ${status || "UNKNOWN"} is not ready` };
  }

  return { state: "READY", reason: null };
};

const incrementReasonCounter = (bucket, reason) => {
  const key = String(reason || "Unknown").trim() || "Unknown";
  bucket[key] = Number(bucket[key] || 0) + 1;
};

export const previewPayoutBatch = async ({ limit = 100, cutoffDate, itemIds = null } = {}) => {
  const cutoff = cutoffDate || resolveEligibleDate();
  const parsedLimit = normalizePayoutBatchLimit(limit, 100, 1000);
  const batchCurrencyConverter = createCurrencyConverter(DEFAULT_BATCH_REPORT_CURRENCY);

  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    await backfillPayoutItems(cutoff);
  }

  const { query, normalizedItemIds } = buildEligiblePayoutItemsQuery({
    cutoff,
    limit: parsedLimit,
    itemIds,
  });
  const items = await models.PayoutItem.findAll(query);

  const hostIds = [
    ...new Set(
      items
        .map((item) => Number(item?.stay?.homeStay?.host_id || item?.user_id || 0))
        .filter((hostId) => Number.isFinite(hostId) && hostId > 0)
    ),
  ];

  const accounts = hostIds.length
    ? await models.PayoutAccount.findAll({
        where: { user_id: { [Op.in]: hostIds } },
      })
    : [];
  const accountByHostId = new Map(accounts.map((account) => [Number(account.user_id), account]));

  let readyCount = 0;
  let onHoldCount = 0;
  let failedCount = 0;
  let readyAmountInBatchCurrency = 0;
  const readyAmountByCurrency = {};
  const onHoldReasonCounts = {};
  const failedReasonCounts = {};
  const serializedItems = [];
  const readyItemIds = [];

  for (const item of items) {
    const stay = item.stay;
    const hostId = Number(stay?.homeStay?.host_id || item.user_id || 0) || null;
    const account = hostId ? accountByHostId.get(hostId) || null : null;
    const readiness = resolveItemPayoutReadiness({ hostId, account });
    const financials = computeHomeFinancialsFromStay(stay);
    const net = financials.hostPayout;
    const gross = financials.hostSubtotal;
    const fee = financials.hostServiceFee;
    const currency = String(financials.currency || stay?.currency || item.currency || "USD").toUpperCase();

    if (readiness.state === "READY") {
      readyCount += 1;
      readyItemIds.push(item.id);
      readyAmountByCurrency[currency] = Number(readyAmountByCurrency[currency] || 0) + net;
      readyAmountInBatchCurrency += await batchCurrencyConverter.convert(net, currency);
    } else if (readiness.state === "ON_HOLD") {
      onHoldCount += 1;
      incrementReasonCounter(onHoldReasonCounts, readiness.reason);
    } else {
      failedCount += 1;
      incrementReasonCounter(failedReasonCounts, readiness.reason);
    }

    serializedItems.push({
      itemId: item.id,
      stayId: item.stay_id,
      hostId,
      scheduledFor: item.scheduled_for,
      payoutStatus: item.status,
      readiness: readiness.state,
      reason: readiness.reason,
      amount: net,
      currency,
      grossAmount: gross,
      platformFeeAmount: fee,
      home: stay?.homeStay?.home
        ? {
            id: stay.homeStay.home.id,
            title: stay.homeStay.home.title,
          }
        : null,
      payoutAccount: account
        ? {
            provider: account.provider,
            status: account.status,
            accountId: account.id,
          }
        : null,
    });
  }

  const sortedReadyByCurrency = Object.keys(readyAmountByCurrency)
    .sort()
    .reduce((acc, code) => {
      acc[code] = Number(readyAmountByCurrency[code] || 0);
      return acc;
    }, {});

  return {
    summary: {
      cutoffDate: cutoff,
      limit: parsedLimit,
      source: normalizedItemIds.length ? "item_ids" : "cutoff_limit",
      totalCandidates: items.length,
      readyCount,
      onHoldCount,
      failedCount,
      readyAmountByCurrency: sortedReadyByCurrency,
      readyAmountBatchCurrency: Number(readyAmountInBatchCurrency || 0),
      batchCurrency: DEFAULT_BATCH_REPORT_CURRENCY,
      reasonBreakdown: {
        onHold: onHoldReasonCounts,
        failed: failedReasonCounts,
      },
      requestedItemIds: normalizedItemIds,
    },
    itemIds: readyItemIds,
    items: serializedItems,
  };
};

export const getPayoutAccount = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  let account = await models.PayoutAccount.findOne({ where: { user_id: userId } });
  const syncStripeOnRead = String(process.env.STRIPE_CONNECT_SYNC_ON_READ || "false").toLowerCase() === "true";
  if (account && account.provider === "STRIPE" && syncStripeOnRead) {
    account = await syncStripeAccount(account);
  }
  if (!account) return res.json({ status: "INCOMPLETE" });
  return res.json(maskAccount(account));
};

export const upsertPayoutAccount = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const {
    provider = "STRIPE",
    country = "US",
    currency = "USD",
    externalAccountId,
    externalCustomerId,
    brand,
  } = req.body || {};

  const providerNorm = String(provider || "STRIPE").toUpperCase();
  if (providerNorm !== "STRIPE") {
    return res.status(400).json({ error: "Only STRIPE payout provider is currently supported." });
  }

  if (!externalAccountId && !externalCustomerId) {
    return res.status(400).json({ error: "externalAccountId or externalCustomerId is required for Stripe" });
  }

  const payload = {
    user_id: userId,
    provider: "STRIPE",
    status: "READY",
    country: String(country || DEFAULT_STRIPE_COUNTRY).trim().toUpperCase().slice(0, 2) || DEFAULT_STRIPE_COUNTRY,
    currency: String(currency || "USD").trim().toUpperCase().slice(0, 3) || "USD",
    external_account_id: externalAccountId || null,
    external_customer_id: externalCustomerId || null,
    brand: brand || null,
  };

  const [record] = await models.PayoutAccount.upsert(payload, { returning: true });
  return res.json(maskAccount(record));
};

export const listHostPayouts = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const requestedCurrency = String(req.query?.currency || "USD").trim().toUpperCase();
  const currencyConverter = createCurrencyConverter(requestedCurrency);
  const displayCurrency = currencyConverter.targetCurrency;

  await ensurePayoutItemsForHost(userId);

  const items = await models.PayoutItem.findAll({
    where: { user_id: userId },
    include: [
      {
        model: models.Stay,
        as: "stay",
        required: false,
        include: [
          {
            model: models.StayHome,
            as: "homeStay",
            required: false,
            include: [
              { model: models.Home, as: "home", required: false, attributes: ["id", "title"] },
            ],
          },
        ],
      },
    ],
    order: [["scheduled_for", "DESC"], ["id", "DESC"]],
  });

  const serialize = async (item) => {
    const plain = item.toJSON();
    if (!plain.stay?.homeStay) return null;
    const stayHostId = Number(plain.stay.homeStay.host_id || 0);
    if (!stayHostId || stayHostId !== userId) return null;
    const home = plain.stay?.homeStay?.home;
    const sourceCurrency = String(plain.currency || plain.stay?.currency || "USD").toUpperCase();
    const sourceAmount = Number(plain.amount || 0);
    const amount = await currencyConverter.convert(sourceAmount, sourceCurrency);
    return {
      id: plain.id,
      stayId: plain.stay_id,
      amount,
      currency: displayCurrency,
      sourceAmount,
      sourceCurrency,
      status: plain.status,
      scheduledFor: plain.scheduled_for,
      paidAt: plain.paid_at,
    home: home
      ? {
          id: home.id,
          title: home.title,
        }
        : null,
      date: plain.scheduled_for || plain.paid_at || null,
    };
  };

  const paid = [];
  const upcoming = [];
  const failed = [];
  for (const it of items) {
    const view = await serialize(it);
    if (!view) continue;
    if (view.status === "PAID") paid.push(view);
    else if (view.status === "FAILED") failed.push(view);
    else if (UPCOMING_PAYOUT_STATUSES.includes(String(view.status || "").toUpperCase())) upcoming.push(view);
    else upcoming.push(view);
  }

  return res.json({ currency: displayCurrency, upcoming, paid, failed });
};

export const runMockPayouts = async (_req, res) => {
  const eligibleStays = await models.Stay.findAll({
    where: {
      inventory_type: "HOME",
      status: "COMPLETED",
      payment_status: "PAID",
    },
    include: [
      {
        model: models.StayHome,
        as: "homeStay",
        required: true,
      },
    ],
  });

  let processed = 0;
  let totalNet = 0;
  for (const stay of eligibleStays) {
    const hostId = stay.homeStay?.host_id;
    if (!hostId) continue;

    const account = await models.PayoutAccount.findOne({
      where: { user_id: hostId, status: { [Op.in]: ["READY", "VERIFIED"] } },
    });
    if (!account) continue;

    const financials = computeHomeFinancialsFromStay(stay);

    await models.PayoutItem.upsert({
      stay_id: stay.id,
      user_id: hostId,
      amount: financials.hostPayout,
      currency: financials.currency || stay.currency || "USD",
      status: "PAID",
      paid_at: new Date(),
      scheduled_for: stay.check_out || stay.check_in || null,
      metadata: {
        pricing_model: financials.model,
        guest_total: financials.guestTotal,
        gross_price: financials.hostSubtotal,
        fee_amount: financials.hostServiceFee,
        platform_markup_amount: financials.platformMarkupAmount,
        effective_platform_revenue: financials.effectivePlatformRevenue,
        mode: "mock",
      },
    });
    processed += 1;
    totalNet += financials.hostPayout;
  }

  return res.json({ processed, totalNet, totalEligible: eligibleStays.length });
};

export const processPayoutBatch = async ({ limit = 100, cutoffDate, itemIds = null } = {}) => {
  const cutoff = cutoffDate || resolveEligibleDate();
  const parsedLimit = normalizePayoutBatchLimit(limit, 100, 1000);
  const batchCurrency = DEFAULT_BATCH_REPORT_CURRENCY;
  const batchCurrencyConverter = createCurrencyConverter(batchCurrency);

  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    await backfillPayoutItems(cutoff);
  }

  const { query, normalizedItemIds } = buildEligiblePayoutItemsQuery({
    cutoff,
    limit: parsedLimit,
    itemIds,
  });
  const items = await models.PayoutItem.findAll(query);

  if (!items.length) {
    return {
      message: normalizedItemIds.length ? "No eligible approved items" : "No pending items",
      processed: 0,
      batchId: null,
      totalItemsFetched: 0,
      totalItemsRequested: normalizedItemIds.length || null,
    };
  }

  const claimedItems = [];
  for (const item of items) {
    const [claimed] = await models.PayoutItem.update(
      { status: "PROCESSING", failure_reason: null },
      {
        where: {
          id: item.id,
          status: { [Op.in]: CLAIMABLE_PAYOUT_STATUSES },
        },
      }
    );
    if (claimed === 1) claimedItems.push(item);
  }

  if (!claimedItems.length) {
    return {
      message: "No pending items claimed",
      processed: 0,
      batchId: null,
      totalItemsFetched: items.length,
      totalItemsRequested: normalizedItemIds.length || null,
    };
  }

  const batch = await models.PayoutBatch.create({
    currency: batchCurrency,
    total_amount: 0,
    status: "PROCESSING",
  });

  let total = 0;
  let processed = 0;
  let failed = 0;
  let onHold = 0;

  for (const item of claimedItems) {
    const stay = item.stay;
    const hostId = stay?.homeStay?.host_id;
    if (!hostId) {
      await item.update({
        payout_batch_id: batch.id,
        status: "FAILED",
        failure_reason: "Missing host ownership on stay",
      });
      failed += 1;
      continue;
    }

    const account = await models.PayoutAccount.findOne({
      where: { user_id: hostId },
    });
    const readiness = resolveItemPayoutReadiness({ hostId, account });
    if (readiness.state !== "READY") {
      await item.update({
        payout_batch_id: batch.id,
        status: readiness.state === "FAILED" ? "FAILED" : "ON_HOLD",
        failure_reason: readiness.reason || "Payout account not ready for provider STRIPE",
      });
      if (readiness.state === "FAILED") failed += 1;
      else onHold += 1;
      continue;
    }

    const financials = computeHomeFinancialsFromStay(stay);
    const net = financials.hostPayout;
    const stayCurrency = String(financials.currency || stay.currency || item.currency || "USD").toUpperCase();
    const payoutIdempotencyKey = String(item.metadata?.provider_idempotency_key || `host_payout_item_${item.id}`);

    await item.update({
      amount: net,
      currency: stayCurrency,
      payout_batch_id: batch.id,
      status: "PROCESSING",
      metadata: {
        ...(item.metadata || {}),
        pricing_model: financials.model,
        guest_total: financials.guestTotal,
        gross_price: financials.hostSubtotal,
        fee_amount: financials.hostServiceFee,
        platform_markup_amount: financials.platformMarkupAmount,
        effective_platform_revenue: financials.effectivePlatformRevenue,
        provider: account.provider,
        batch_mode: "process",
        provider_idempotency_key: payoutIdempotencyKey,
      },
    });

    try {
      const payoutResult = await sendPayout({
        provider: account.provider,
        account,
        item,
        stay,
        amount: net,
        idempotencyKey: payoutIdempotencyKey,
      });

      await item.update({
        status: payoutResult.status || "PAID",
        paid_at: payoutResult.paidAt || new Date(),
        failure_reason: null,
        metadata: {
          ...(item.metadata || {}),
          provider_payout_id: payoutResult.providerPayoutId || null,
          provider_response: payoutResult.raw || null,
        },
      });
      total += await batchCurrencyConverter.convert(net, stayCurrency);
      processed += 1;
    } catch (err) {
      await item.update({
        status: "FAILED",
        failure_reason: err?.message || "Payout failed",
      });
      failed += 1;
    }
  }

  await batch.update({
    total_amount: total,
    status: failed ? "FAILED" : processed ? "PAID" : "PENDING",
    processed_at: new Date(),
  });

  return {
    batchId: batch.id,
    processed,
    failed,
    onHold,
    totalAmount: total,
    batchCurrency,
    totalItemsFetched: items.length,
    totalItemsClaimed: claimedItems.length,
    totalItemsRequested: normalizedItemIds.length || null,
  };
};

export const runPayoutBatch = async (req, res) => {
  const { limit = 100, cutoffDate, itemIds } = req.body || {};
  let cutoff = null;
  try {
    cutoff = resolvePayoutCutoffDate(cutoffDate);
  } catch (error) {
    return res.status(400).json({ error: error?.message || "cutoffDate must be YYYY-MM-DD" });
  }
  const result = await processPayoutBatch({
    limit: normalizePayoutBatchLimit(limit, 100, 1000),
    cutoffDate: cutoff,
    itemIds: Array.isArray(itemIds) ? itemIds : null,
  });
  return res.json(result);
};

export const createStripeOnboardingLink = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const stripe = await getStripeClient();
  if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

  const { refreshUrl, returnUrl } = resolveStripeConnectUrls(req);
  const country = String(req.body?.country || process.env.STRIPE_CONNECT_DEFAULT_COUNTRY || DEFAULT_STRIPE_COUNTRY).toUpperCase();

  let account = await models.PayoutAccount.findOne({ where: { user_id: userId, provider: "STRIPE" } });

  if (!account || !account.external_customer_id) {
    const stripeAccount = await stripe.accounts.create({
      type: "express",
      country,
      capabilities: { transfers: { requested: true } },
      business_type: "individual",
    });

    const status = resolveStripeStatus(stripeAccount);
    const metadata = buildStripeMetadata(stripeAccount);
    [account] = await models.PayoutAccount.upsert(
      {
        user_id: userId,
        provider: "STRIPE",
        status,
        external_customer_id: stripeAccount.id,
        currency: "USD",
        country,
        metadata,
      },
      { returning: true }
    );
  } else {
    account = await syncStripeAccount(account);
  }

  const acctId = account.external_customer_id;
  const link = await stripe.accountLinks.create({
    account: acctId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return res.json({ url: link.url, accountId: acctId });
};

export const createStripeAccountUpdateLink = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const stripe = await getStripeClient();
  if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

  let account = await models.PayoutAccount.findOne({ where: { user_id: userId, provider: "STRIPE" } });
  if (!account || !account.external_customer_id) {
    return res.status(404).json({ error: "Stripe payout account not found" });
  }

  account = await syncStripeAccount(account);
  const { refreshUrl, returnUrl } = resolveStripeConnectUrls(req);

  const link = await stripe.accountLinks.create({
    account: account.external_customer_id,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_update",
  });

  return res.json({ url: link.url, accountId: account.external_customer_id });
};

export const refreshStripeAccountStatus = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const account = await models.PayoutAccount.findOne({ where: { user_id: userId, provider: "STRIPE" } });
  if (!account) return res.status(404).json({ error: "Stripe payout account not found" });

  const updated = await syncStripeAccount(account);
  return res.json(maskAccount(updated));
};

export const createPayoneerOnboardingLink = async (_req, res) => {
  return res.status(501).json({ error: "Payoneer onboarding not configured yet." });
};
