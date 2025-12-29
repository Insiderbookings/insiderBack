import { Op } from "sequelize";
import models from "../models/index.js";
import { sendPayout } from "../services/payoutProviders.js";

const normalizeCurrency = (value) => String(value || "USD").toUpperCase();
const toAmount = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
};
const toMillis = (value) => {
  if (!value) return 0;
  const parsed = new Date(value);
  const time = parsed.getTime();
  return Number.isNaN(time) ? 0 : time;
};

const eligibleWhere = (now) => ({
  [Op.or]: [
    { status: "eligible" },
    { status: "hold", hold_until: { [Op.lte]: now } },
  ],
});

const collectEligibleGroups = (rows, type, map) => {
  rows.forEach((row) => {
    const influencerId = Number(row.influencer_user_id);
    if (!influencerId) return;
    const amount = type === "event" ? toAmount(row.amount) : toAmount(row.commission_amount);
    if (!amount) return;
    const currency = normalizeCurrency(
      type === "event" ? row.currency : row.commission_currency
    );
    const key = `${influencerId}_${currency}`;
    const entry =
      map.get(key) ||
      {
        influencerId,
        currency,
        total: 0,
        commissionIds: [],
        eventIds: [],
      };
    entry.total += amount;
    if (type === "event") entry.eventIds.push(row.id);
    else entry.commissionIds.push(row.id);
    map.set(key, entry);
  });
};

export const getInfluencerPayouts = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [commissions, eventCommissions] = await Promise.all([
      models.InfluencerCommission.findAll({
        where: { influencer_user_id: userId },
        order: [["paid_at", "DESC"], ["created_at", "DESC"]],
        limit: 500,
      }),
      models.InfluencerEventCommission.findAll({
        where: { influencer_user_id: userId },
        order: [["paid_at", "DESC"], ["created_at", "DESC"]],
        limit: 500,
      }),
    ]);

    const paidGroups = new Map();
    const pendingGroups = new Map();

    const collectRow = (row, type) => {
      const amount = type === "event" ? toAmount(row.amount) : toAmount(row.commission_amount);
      if (!amount) return;
      const currency = normalizeCurrency(type === "event" ? row.currency : row.commission_currency);
      if (row.status === "paid") {
        const key = row.payout_batch_id || `paid_${type}_${row.id}`;
        const entry = paidGroups.get(key) || {
          id: key,
          label: "Stripe payout",
          period: null,
          status: "paid",
          currency,
          amount: 0,
          paidAt: null,
        };
        entry.amount += amount;
        const paidAt = row.paid_at || row.updated_at || null;
        if (paidAt && (!entry.paidAt || toMillis(paidAt) > toMillis(entry.paidAt))) {
          entry.paidAt = paidAt;
          entry.period = String(paidAt).slice(0, 10);
        }
        paidGroups.set(key, entry);
      } else if (["eligible", "hold"].includes(row.status)) {
        const key = `pending_${currency}`;
        const entry = pendingGroups.get(key) || {
          id: key,
          label: "Pending commissions",
          period: "Upcoming",
          status: "pending",
          currency,
          amount: 0,
        };
        entry.amount += amount;
        pendingGroups.set(key, entry);
      }
    };

    commissions.forEach((row) => collectRow(row, "commission"));
    eventCommissions.forEach((row) => collectRow(row, "event"));

    const paidList = Array.from(paidGroups.values()).sort(
      (a, b) => toMillis(b.paidAt) - toMillis(a.paidAt)
    );
    const pendingList = Array.from(pendingGroups.values());

    return res.json({ payouts: [...paidList, ...pendingList] });
  } catch (err) {
    console.error("getInfluencerPayouts error:", err);
    return res.status(500).json({ error: "Unable to load influencer payouts" });
  }
};

export const processInfluencerPayoutBatch = async ({ limit = 100 } = {}) => {
  const now = new Date();
  const batchId = `INFP-${Date.now().toString(36)}`;
  const groups = new Map();

  const [commissions, eventCommissions] = await Promise.all([
    models.InfluencerCommission.findAll({
      where: {
        ...eligibleWhere(now),
      },
      order: [["created_at", "ASC"]],
      limit: 2000,
    }),
    models.InfluencerEventCommission.findAll({
      where: {
        ...eligibleWhere(now),
      },
      order: [["created_at", "ASC"]],
      limit: 2000,
    }),
  ]);

  collectEligibleGroups(commissions, "commission", groups);
  collectEligibleGroups(eventCommissions, "event", groups);

  const groupList = Array.from(groups.values()).filter((g) => g.total > 0);
  const limitedGroups = groupList.slice(0, Number(limit) || 100);

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let totalAmount = 0;
  const payouts = [];

  for (const group of limitedGroups) {
    const account = await models.PayoutAccount.findOne({
      where: {
        user_id: group.influencerId,
        provider: "STRIPE",
        status: ["READY", "VERIFIED"],
      },
    });
    if (!account) {
      skipped += 1;
      continue;
    }

    const currency = group.currency;
    const amount = group.total;
    const batchKey = `${batchId}-${group.influencerId}-${currency}`;
    const item = { id: batchKey, currency };

    try {
      const payoutResult = await sendPayout({
        provider: account.provider,
        account,
        item,
        stay: { currency },
        amount,
      });

      const providerPayoutId = payoutResult?.providerPayoutId || batchKey;
      const updatePayload = {
        status: "paid",
        paid_at: new Date(),
        payout_batch_id: providerPayoutId,
      };

      if (group.commissionIds.length) {
        await models.InfluencerCommission.update(updatePayload, {
          where: {
            id: { [Op.in]: group.commissionIds },
            status: { [Op.in]: ["eligible", "hold"] },
          },
        });
      }
      if (group.eventIds.length) {
        await models.InfluencerEventCommission.update(updatePayload, {
          where: {
            id: { [Op.in]: group.eventIds },
            status: { [Op.in]: ["eligible", "hold"] },
          },
        });
      }

      processed += 1;
      totalAmount += amount;
      payouts.push({
        influencerId: group.influencerId,
        currency,
        amount,
        payoutId: providerPayoutId,
      });
    } catch (err) {
      failed += 1;
      console.error("[influencer-payout] failed", {
        influencerId: group.influencerId,
        currency,
        amount,
        error: err?.message || err,
      });
    }
  }

  return {
    batchId,
    processed,
    failed,
    skipped,
    totalAmount,
    totalGroups: groupList.length,
    payouts,
  };
};

export const runInfluencerPayoutBatch = async (req, res) => {
  const { limit = 100 } = req.body || {};
  const result = await processInfluencerPayoutBatch({ limit });
  return res.json(result);
};
