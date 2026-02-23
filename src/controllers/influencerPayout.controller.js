import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
import { sendPayout } from "../services/payoutProviders.js";
import { isInfluencerIdentityVerified } from "../utils/influencerOnboarding.js";

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

const READY_PAYOUT_ACCOUNT_STATUSES = ["READY", "VERIFIED"];
const CLAIMABLE_EVENT_STATUSES = ["eligible", "hold"];
const CLAIMABLE_PAYOUT_BATCH_WHERE = {
  [Op.or]: [{ payout_batch_id: null }, { payout_batch_id: "" }],
};

const normalizeEventIds = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
};

const normalizeLimit = (value, fallback = 100) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 500);
};

const eligibleWhere = (now) => ({
  [Op.or]: [
    { status: "eligible" },
    { status: "hold", hold_until: { [Op.lte]: now } },
  ],
});

const buildEligibleClaimWhere = ({ now, eventIds = null }) => ({
  [Op.and]: [
    eligibleWhere(now),
    CLAIMABLE_PAYOUT_BATCH_WHERE,
    ...(Array.isArray(eventIds) && eventIds.length ? [{ id: { [Op.in]: eventIds } }] : []),
  ],
});

const buildClaimToken = ({ batchId, influencerId, currency, index }) =>
  `INFC-${batchId}-${influencerId}-${currency}-${index}`.slice(0, 40);

const claimCommissionRows = async ({ claimToken, eventIds, now }) => {
  if (!eventIds.length) return [];

  return sequelize.transaction(async (transaction) => {
    const [claimedCount] = await models.InfluencerEventCommission.update(
      { payout_batch_id: claimToken },
      {
        where: buildEligibleClaimWhere({ now, eventIds }),
        transaction,
      }
    );
    if (!claimedCount) return [];

    return models.InfluencerEventCommission.findAll({
      where: {
        payout_batch_id: claimToken,
        status: { [Op.in]: CLAIMABLE_EVENT_STATUSES },
      },
      transaction,
    });
  });
};

const releaseClaimToken = async (claimToken) =>
  models.InfluencerEventCommission.update(
    { payout_batch_id: null },
    {
      where: {
        payout_batch_id: claimToken,
        status: { [Op.in]: CLAIMABLE_EVENT_STATUSES },
      },
    }
  );

const shouldReleaseClaimAfterSendError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || error?.raw?.code || "").toLowerCase();
  const type = String(error?.type || error?.raw?.type || "").toLowerCase();

  if (message.includes("missing stripe connected account id")) return true;
  if (message.includes("invalid amount")) return true;
  if (message.includes("provider") && message.includes("not integrated")) return true;
  if (type.includes("invalid_request")) return true;
  if (code.includes("parameter")) return true;

  // Ambiguous transport/provider failures keep the claim to avoid duplicate payouts.
  return false;
};

const collectEligibleGroups = (rows, map) => {
  rows.forEach((row) => {
    const influencerId = Number(row.influencer_user_id);
    if (!influencerId) return;
    const amount = toAmount(row.amount);
    if (!amount) return;
    const currency = normalizeCurrency(row.currency);
    const key = `${influencerId}_${currency}`;
    const entry =
      map.get(key) ||
      {
        influencerId,
        currency,
        total: 0,
        eventIds: [],
      };
    entry.total += amount;
    entry.eventIds.push(row.id);
    map.set(key, entry);
  });
};

export const getInfluencerPayouts = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const eventCommissions = await models.InfluencerEventCommission.findAll({
      where: { influencer_user_id: userId },
      order: [["paid_at", "DESC"], ["created_at", "DESC"]],
      limit: 500,
    });

    const paidGroups = new Map();
    const pendingGroups = new Map();

    const collectRow = (row) => {
      const amount = toAmount(row.amount);
      if (!amount) return;
      const currency = normalizeCurrency(row.currency);
      if (row.status === "paid") {
        const key = row.payout_batch_id || `paid_event_${row.id}`;
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

    eventCommissions.forEach((row) => collectRow(row));

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

export const processInfluencerPayoutBatch = async ({ limit = 100, eventIds = null } = {}) => {
  const now = new Date();
  const batchId = `INFP-${Date.now().toString(36)}`;
  const groups = new Map();
  const normalizedEventIds = normalizeEventIds(eventIds);

  const eventCommissions = await models.InfluencerEventCommission.findAll({
    where: buildEligibleClaimWhere({
      now,
      eventIds: normalizedEventIds.length ? normalizedEventIds : null,
    }),
    order: [["created_at", "ASC"]],
    limit: 2000,
  });

  collectEligibleGroups(eventCommissions, groups);

  const groupList = Array.from(groups.values()).filter((g) => g.total > 0);
  const limitedGroups = groupList.slice(0, normalizeLimit(limit, 100));
  const influencerIds = Array.from(
    new Set(limitedGroups.map((group) => Number(group.influencerId)).filter((id) => id > 0))
  );
  const identityRows = influencerIds.length && models.GuestProfile
    ? await models.GuestProfile.findAll({
        where: { user_id: { [Op.in]: influencerIds } },
        attributes: ["user_id", "identity_verified", "metadata"],
      })
    : [];
  const identityByInfluencerId = new Map();
  identityRows.forEach((row) => {
    const plain = row.get ? row.get({ plain: true }) : row;
    identityByInfluencerId.set(Number(plain.user_id), isInfluencerIdentityVerified(plain));
  });

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let identityBlocked = 0;
  let stuckClaims = 0;
  let totalAmount = 0;
  const payouts = [];

  for (let index = 0; index < limitedGroups.length; index += 1) {
    const group = limitedGroups[index];
    if (!identityByInfluencerId.get(Number(group.influencerId))) {
      identityBlocked += 1;
      skipped += 1;
      continue;
    }
    const account = await models.PayoutAccount.findOne({
      where: {
        user_id: group.influencerId,
        provider: "STRIPE",
        status: { [Op.in]: READY_PAYOUT_ACCOUNT_STATUSES },
      },
    });
    if (!account) {
      skipped += 1;
      continue;
    }

    const currency = group.currency;
    const claimToken = buildClaimToken({
      batchId,
      influencerId: group.influencerId,
      currency,
      index,
    });

    const claimedRows = await claimCommissionRows({
      claimToken,
      eventIds: group.eventIds,
      now,
    });
    if (!claimedRows.length) {
      skipped += 1;
      continue;
    }

    const claimedIds = claimedRows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    const amount = claimedRows.reduce((sum, row) => sum + toAmount(row.amount), 0);
    if (!amount || !claimedIds.length) {
      await releaseClaimToken(claimToken);
      skipped += 1;
      continue;
    }

    const batchKey = `${batchId}-${group.influencerId}-${currency}`;
    const item = { id: batchKey, currency };

    let payoutResult = null;
    try {
      payoutResult = await sendPayout({
        provider: account.provider,
        account,
        item,
        stay: { currency },
        amount,
        idempotencyKey: claimToken,
      });
    } catch (err) {
      failed += 1;
      console.error("[influencer-payout] failed", {
        influencerId: group.influencerId,
        currency,
        amount,
        claimToken,
        error: err?.message || err,
      });
      if (shouldReleaseClaimAfterSendError(err)) {
        try {
          await releaseClaimToken(claimToken);
        } catch (releaseErr) {
          stuckClaims += 1;
          console.error("[influencer-payout] failed to release claim", {
            claimToken,
            error: releaseErr?.message || releaseErr,
          });
        }
      } else {
        stuckClaims += 1;
        console.error("[influencer-payout] claim retained after ambiguous send failure", {
          claimToken,
          error: err?.message || err,
        });
      }
      continue;
    }

    const providerPayoutId = payoutResult?.providerPayoutId || batchKey;
    const updatePayload = {
      status: "paid",
      paid_at: new Date(),
      payout_batch_id: providerPayoutId,
    };

    try {
      const [updatedCount] = await models.InfluencerEventCommission.update(updatePayload, {
        where: {
          id: { [Op.in]: claimedIds },
          payout_batch_id: claimToken,
          status: { [Op.in]: CLAIMABLE_EVENT_STATUSES },
        },
      });

      if (updatedCount !== claimedIds.length) {
        stuckClaims += 1;
        console.error("[influencer-payout] partial paid update", {
          claimToken,
          influencerId: group.influencerId,
          expected: claimedIds.length,
          updated: updatedCount,
        });
      }
    } catch (err) {
      failed += 1;
      stuckClaims += 1;
      console.error("[influencer-payout] payout sent but commission update failed", {
        influencerId: group.influencerId,
        currency,
        amount,
        claimToken,
        payoutId: providerPayoutId,
        error: err?.message || err,
      });
      continue;
    }

    processed += 1;
    totalAmount += amount;
    payouts.push({
      influencerId: group.influencerId,
      currency,
      amount,
      payoutId: providerPayoutId,
    });
  }

  return {
    batchId,
    processed,
    failed,
    skipped,
    identityBlocked,
    stuckClaims,
    totalAmount,
    totalGroups: groupList.length,
    payouts,
  };
};

export const runInfluencerPayoutBatch = async (req, res) => {
  const { limit = 100, eventIds, ids } = req.body || {};
  const normalizedEventIds = normalizeEventIds(eventIds || ids);
  const result = await processInfluencerPayoutBatch({
    limit,
    eventIds: normalizedEventIds.length ? normalizedEventIds : null,
  });
  return res.json(result);
};
