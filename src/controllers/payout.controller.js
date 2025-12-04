import crypto from "crypto";
import models from "../models/index.js";
import { Op } from "sequelize";
import { sendPayout, getStripeClient } from "../services/payoutProviders.js";

const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value || "")).digest("hex");

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
  };
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
      payment_status: { [Op.in]: ["PAID", "REFUNDED"] },
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
    const amount = Number(stay.gross_price ?? 0);
    const currency = stay.currency || "USD";
    const scheduled_for = stay.check_out || stay.check_in || null;
    try {
      await models.PayoutItem.create({
        stay_id: stay.id,
        user_id: hostId,
        amount,
        currency,
        status: "PENDING",
        scheduled_for,
        metadata: {
          source: "auto-backfill",
          createdAt: new Date(),
          gross_price: stay.gross_price,
        },
      });
    } catch (_) {
      // ignore duplicates due to race
    }
  }
};

export const getPayoutAccount = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const account = await models.PayoutAccount.findOne({ where: { user_id: userId } });
  if (!account) return res.json({ status: "INCOMPLETE" });
  return res.json(maskAccount(account));
};

export const upsertPayoutAccount = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const {
    provider = "BANK",
    routingNumber,
    accountNumber,
    accountHolder,
    bankName,
    country = "US",
    currency = "USD",
    walletEmail,
    externalAccountId,
    externalCustomerId,
    brand,
  } = req.body || {};

  const providerNorm = String(provider || "BANK").toUpperCase();
  if (!["BANK", "STRIPE", "PAYPAL"].includes(providerNorm)) {
    return res.status(400).json({ error: "Invalid provider" });
  }

  const payload = {
    user_id: userId,
    provider: providerNorm,
    status: "READY",
    country,
    currency,
  };

  if (providerNorm === "BANK") {
    if (!routingNumber || !accountNumber || !accountHolder) {
      return res.status(400).json({ error: "Routing number, account number and holder name are required" });
    }
    payload.holder_name = accountHolder;
    payload.bank_name = bankName || null;
    payload.routing_last4 = String(routingNumber).slice(-4);
    payload.account_last4 = String(accountNumber).slice(-4);
    payload.metadata = {
      routingHash: hashValue(routingNumber),
      accountHash: hashValue(accountNumber),
    };
  } else if (providerNorm === "STRIPE") {
    if (!externalAccountId && !externalCustomerId) {
      return res.status(400).json({ error: "externalAccountId or externalCustomerId is required for Stripe" });
    }
    payload.external_account_id = externalAccountId || null;
    payload.external_customer_id = externalCustomerId || null;
    payload.brand = brand || null;
  } else if (providerNorm === "PAYPAL") {
    if (!walletEmail) {
      return res.status(400).json({ error: "walletEmail is required for PayPal" });
    }
    payload.wallet_email = walletEmail.toLowerCase();
    payload.external_account_id = externalAccountId || payload.wallet_email;
  }

  const [record] = await models.PayoutAccount.upsert(payload, { returning: true });
  return res.json(maskAccount(record));
};

export const listHostPayouts = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

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

  const serialize = (item) => {
    const plain = item.toJSON();
    const home = plain.stay?.homeStay?.home;
    return {
      id: plain.id,
      stayId: plain.stay_id,
      amount: Number(plain.amount || 0),
      currency: plain.currency,
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
  items.forEach((it) => {
    const view = serialize(it);
    if (view.status === "PAID") paid.push(view);
    else upcoming.push(view);
  });

  return res.json({ upcoming, paid });
};

const PLATFORM_FEE_PCT = 0.03;

const computeNetForStay = (stay) => {
  const gross = Number(stay.gross_price ?? 0);
  const fee = Math.max(0, gross * PLATFORM_FEE_PCT);
  const net = Math.max(0, gross - fee);
  return { gross, net, fee };
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
      where: { user_id: hostId, status: ["READY", "VERIFIED"] },
    });
    if (!account) continue;

    const { net, gross, fee } = computeNetForStay(stay);

    await models.PayoutItem.upsert({
      stay_id: stay.id,
      user_id: hostId,
      amount: net,
      currency: stay.currency || "USD",
      status: "PAID",
      paid_at: new Date(),
      scheduled_for: stay.check_out || stay.check_in || null,
      metadata: {
        gross_price: gross,
        platform_fee_pct: PLATFORM_FEE_PCT,
        fee_amount: fee,
        mode: "mock",
      },
    });
    processed += 1;
    totalNet += net;
  }

  return res.json({ processed, totalNet, totalEligible: eligibleStays.length });
};

export const runPayoutBatch = async (req, res) => {
  const { limit = 100 } = req.body || {};

  const items = await models.PayoutItem.findAll({
    where: { status: { [Op.in]: ["PENDING", "QUEUED"] } },
    include: [
      {
        model: models.Stay,
        as: "stay",
        required: true,
        include: [{ model: models.StayHome, as: "homeStay", required: true }],
      },
    ],
    order: [["scheduled_for", "ASC"], ["id", "ASC"]],
    limit: Number(limit),
  });

  if (!items.length) {
    return res.json({ message: "No pending items", processed: 0, batchId: null });
  }

  const batch = await models.PayoutBatch.create({
    currency: "USD",
    total_amount: 0,
    status: "PROCESSING",
  });

  let total = 0;
  let processed = 0;
  let failed = 0;

  for (const item of items) {
    const stay = item.stay;
    const hostId = stay?.homeStay?.host_id;
    if (!hostId) continue;

    const account = await models.PayoutAccount.findOne({
      where: { user_id: hostId, status: ["READY", "VERIFIED"] },
    });
    if (!account) continue;

    const { net, gross, fee } = computeNetForStay(stay);

    await item.update({
      amount: net,
      currency: stay.currency || "USD",
      payout_batch_id: batch.id,
      status: "PROCESSING",
      metadata: {
        ...(item.metadata || {}),
        gross_price: gross,
        platform_fee_pct: PLATFORM_FEE_PCT,
        fee_amount: fee,
        provider: account.provider,
        batch_mode: "process",
      },
    });

    try {
      const payoutResult = await sendPayout({
        provider: account.provider,
        account,
        item,
        stay,
        amount: net,
      });

      await item.update({
        status: payoutResult.status || "PAID",
        paid_at: payoutResult.paidAt || new Date(),
        metadata: {
          ...(item.metadata || {}),
          provider_payout_id: payoutResult.providerPayoutId || null,
          provider_response: payoutResult.raw || null,
        },
      });
      total += net;
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
    status: failed ? "FAILED" : "PAID",
    processed_at: new Date(),
  });

  return res.json({
    batchId: batch.id,
    processed,
    failed,
    totalAmount: total,
    totalItemsFetched: items.length,
  });
};

export const createStripeOnboardingLink = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const stripe = await getStripeClient();
  if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

  const refreshUrl = process.env.STRIPE_CONNECT_REFRESH_URL || process.env.CLIENT_URL || "https://example.com/reauth";
  const returnUrl = process.env.STRIPE_CONNECT_RETURN_URL || process.env.CLIENT_URL || "https://example.com/return";

  let account = await models.PayoutAccount.findOne({ where: { user_id: userId, provider: "STRIPE" } });

  if (!account || !account.external_customer_id) {
    const stripeAccount = await stripe.accounts.create({
      type: "express",
      country: "US",
      capabilities: { transfers: { requested: true } },
      business_type: "individual",
    });

    [account] = await models.PayoutAccount.upsert(
      {
        user_id: userId,
        provider: "STRIPE",
        status: "PENDING",
        external_customer_id: stripeAccount.id,
        currency: "USD",
        country: "US",
      },
      { returning: true }
    );
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
