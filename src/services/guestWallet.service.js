import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
import { convertCurrency } from "./currency.service.js";

const WALLET_CURRENCY = "USD";
const MINOR_FACTOR = 100;
const DEFAULT_TRANSACTION_PAGE_SIZE = 20;
const MAX_TRANSACTION_PAGE_SIZE = 50;
const RELEASE_SWEEP_LIMIT = 100;

export const LEDGER_TYPES = {
  EARN_PENDING: "EARN_PENDING",
  EARN_RELEASE: "EARN_RELEASE",
  EARN_REVERSE: "EARN_REVERSE",
  USE_HOLD: "USE_HOLD",
  USE_CAPTURE: "USE_CAPTURE",
  USE_RELEASE: "USE_RELEASE",
  USE_REFUND: "USE_REFUND",
  ADJUSTMENT: "ADJUSTMENT",
};

const VISIBLE_LEDGER_TYPES = [
  LEDGER_TYPES.EARN_PENDING,
  LEDGER_TYPES.EARN_RELEASE,
  LEDGER_TYPES.EARN_REVERSE,
  LEDGER_TYPES.USE_CAPTURE,
  LEDGER_TYPES.USE_REFUND,
  LEDGER_TYPES.ADJUSTMENT,
];

export const LEDGER_STATUS = {
  PENDING: "PENDING",
  POSTED: "POSTED",
  VOIDED: "VOIDED",
};

export const HOLD_STATUS = {
  HELD: "HELD",
  CAPTURED: "CAPTURED",
  RELEASED: "RELEASED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
  REFUNDED: "REFUNDED",
};

const WALLET_REWARD_PCT = 0.02;

export const isGuestWalletHotelsEnabled = () =>
  String(process.env.GUEST_WALLET_HOTELS_ENABLED || "false").trim().toLowerCase() === "true";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const roundCurrency = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number.parseFloat(numeric.toFixed(2));
};

export const toMinor = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(0, Math.round(numeric * MINOR_FACTOR));
};

export const fromMinor = (value) => roundCurrency(toNumber(value, 0) / MINOR_FACTOR);

const withTransaction = async (transaction, runner) => {
  if (transaction) return runner(transaction);
  return sequelize.transaction(runner);
};

const formatCurrencyLabel = (amount, currency = WALLET_CURRENCY) => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;
  const normalizedCurrency = String(currency || WALLET_CURRENCY).trim().toUpperCase() || WALLET_CURRENCY;
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

const convertUsdForDisplay = async (amountUsd, currency) => {
  const targetCurrency = String(currency || WALLET_CURRENCY).trim().toUpperCase() || WALLET_CURRENCY;
  if (targetCurrency === WALLET_CURRENCY) {
    return {
      amount: roundCurrency(amountUsd),
      currency: WALLET_CURRENCY,
      label: formatCurrencyLabel(amountUsd, WALLET_CURRENCY),
    };
  }

  try {
    const converted = await convertCurrency(amountUsd, targetCurrency);
    return {
      amount: roundCurrency(converted?.amount),
      currency: String(converted?.currency || targetCurrency).trim().toUpperCase() || targetCurrency,
      label: formatCurrencyLabel(converted?.amount, converted?.currency || targetCurrency),
    };
  } catch {
    return {
      amount: roundCurrency(amountUsd),
      currency: WALLET_CURRENCY,
      label: formatCurrencyLabel(amountUsd, WALLET_CURRENCY),
    };
  }
};

const getOrCreateAccount = async ({ userId, transaction }) => {
  const [account] = await models.GuestWalletAccount.findOrCreate({
    where: { user_id: userId },
    defaults: { user_id: userId, currency: WALLET_CURRENCY },
    transaction,
  });
  return account;
};

const getLockedAccount = async ({ userId, transaction }) => {
  const account = await getOrCreateAccount({ userId, transaction });
  return models.GuestWalletAccount.findByPk(account.id, {
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  });
};

const toSummaryPayload = (account) => ({
  currency: WALLET_CURRENCY,
  availableMinor: Math.max(0, Math.round(toNumber(account?.available_minor, 0))),
  pendingMinor: Math.max(0, Math.round(toNumber(account?.pending_minor, 0))),
  lockedMinor: Math.max(0, Math.round(toNumber(account?.locked_minor, 0))),
  lifetimeEarnedMinor: Math.max(0, Math.round(toNumber(account?.lifetime_earned_minor, 0))),
  lifetimeSpentMinor: Math.max(0, Math.round(toNumber(account?.lifetime_spent_minor, 0))),
  lifetimeReversedMinor: Math.max(0, Math.round(toNumber(account?.lifetime_reversed_minor, 0))),
});

const createLedgerEntry = async ({
  accountId,
  userId,
  stayId = null,
  holdId = null,
  linkedEntryId = null,
  type,
  status = LEDGER_STATUS.POSTED,
  amountMinor = 0,
  referenceKey,
  effectiveAt = new Date(),
  releaseAt = null,
  meta = null,
  transaction,
}) => {
  const [entry] = await models.GuestWalletLedger.findOrCreate({
    where: { reference_key: referenceKey },
    defaults: {
      account_id: accountId,
      user_id: userId,
      stay_id: stayId,
      hold_id: holdId,
      linked_entry_id: linkedEntryId,
      type,
      status,
      amount_minor: Math.max(0, Math.round(toNumber(amountMinor, 0))),
      currency: WALLET_CURRENCY,
      reference_key: referenceKey,
      effective_at: effectiveAt,
      release_at: releaseAt,
      meta,
    },
    transaction,
  });
  return entry;
};

const sumLinkedLedgerMinor = async ({ linkedEntryId, type, transaction }) => {
  const value = await models.GuestWalletLedger.sum("amount_minor", {
    where: {
      linked_entry_id: linkedEntryId,
      ...(type ? { type } : {}),
    },
    transaction,
  });
  return Math.max(0, Math.round(toNumber(value, 0)));
};

const sumLedgerMinorByType = async ({ userId, type, transaction }) => {
  const value = await models.GuestWalletLedger.sum("amount_minor", {
    where: {
      user_id: userId,
      type,
      status: { [Op.ne]: LEDGER_STATUS.VOIDED },
    },
    transaction,
  });
  return Math.max(0, Math.round(toNumber(value, 0)));
};

export const computeWalletPreview = ({
  availableMinor = 0,
  publicTotalUsd = 0,
  minimumSellingUsd = 0,
}) => {
  const normalizedPublicTotal = roundCurrency(Math.max(0, toNumber(publicTotalUsd, 0)));
  const normalizedMinimumSelling = roundCurrency(Math.max(0, toNumber(minimumSellingUsd, 0)));
  const maximumUsableMinor = toMinor(
    roundCurrency(Math.max(0, normalizedPublicTotal - normalizedMinimumSelling))
  );
  const normalizedAvailableMinor = Math.max(0, Math.round(toNumber(availableMinor, 0)));
  const appliedMinor = Math.min(normalizedAvailableMinor, maximumUsableMinor);
  const appliedUsd = fromMinor(appliedMinor);
  const chargeAfterWalletUsd = roundCurrency(Math.max(0, normalizedPublicTotal - appliedUsd));

  return {
    availableMinor: normalizedAvailableMinor,
    availableUsd: fromMinor(normalizedAvailableMinor),
    publicTotalUsd: normalizedPublicTotal,
    minimumSellingUsd: normalizedMinimumSelling,
    maximumUsableUsd: fromMinor(maximumUsableMinor),
    appliedMinor,
    appliedUsd,
    chargeAfterWalletUsd,
    blockedByMinimumSelling: maximumUsableMinor <= 0,
  };
};

const computeRewardMinor = (publicTotalUsd) =>
  toMinor(roundCurrency(Math.max(0, toNumber(publicTotalUsd, 0) * WALLET_REWARD_PCT)));

const findPendingEarnEntry = async ({ stayId, transaction, lock = false }) =>
  models.GuestWalletLedger.findOne({
    where: {
      stay_id: stayId,
      type: LEDGER_TYPES.EARN_PENDING,
    },
    order: [["id", "DESC"]],
    transaction,
    ...(lock ? { lock: transaction?.LOCK?.UPDATE } : {}),
  });

const findReusableHeldHold = async ({
  userId,
  stayId,
  paymentScopeKey,
  transaction,
  lock = false,
}) =>
  models.GuestWalletHold.findOne({
    where: {
      user_id: userId,
      stay_id: stayId,
      payment_scope_key: paymentScopeKey,
      status: HOLD_STATUS.HELD,
    },
    order: [["id", "DESC"]],
    transaction,
    ...(lock ? { lock: transaction?.LOCK?.UPDATE } : {}),
  });

const findCapturedHold = async ({ stayId, transaction, lock = false }) =>
  models.GuestWalletHold.findOne({
    where: {
      stay_id: stayId,
      status: {
        [Op.in]: [
          HOLD_STATUS.CAPTURED,
          HOLD_STATUS.PARTIALLY_REFUNDED,
          HOLD_STATUS.REFUNDED,
        ],
      },
    },
    order: [["id", "DESC"]],
    transaction,
    ...(lock ? { lock: transaction?.LOCK?.UPDATE } : {}),
  });

const inferTransactionStatus = (entry) => {
  const type = String(entry?.type || "");
  if (type === LEDGER_TYPES.EARN_PENDING) return "pending";
  if (type === LEDGER_TYPES.USE_HOLD) return "held";
  if (type === LEDGER_TYPES.USE_CAPTURE) return "captured";
  if (type === LEDGER_TYPES.USE_RELEASE) return "released";
  if (type === LEDGER_TYPES.USE_REFUND) return "refunded";
  if (type === LEDGER_TYPES.EARN_RELEASE) return "available";
  if (type === LEDGER_TYPES.EARN_REVERSE) return "reversed";
  return String(entry?.status || "").trim().toLowerCase() || "posted";
};

const inferDisplaySign = (entry) => {
  const type = String(entry?.type || "");
  if (
    type === LEDGER_TYPES.USE_CAPTURE ||
    type === LEDGER_TYPES.USE_HOLD ||
    type === LEDGER_TYPES.EARN_REVERSE
  ) {
    return -1;
  }
  return 1;
};

export const resolveRewardReleaseAt = ({ flow = null, bookedAt = new Date() }) => {
  const now = bookedAt instanceof Date ? bookedAt : new Date(bookedAt || Date.now());
  const ensureArray = (value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  };

  const rules = ensureArray(
    flow?.selected_offer?.cancellationRules ??
      flow?.pricing_snapshot_priced?.cancellationRules?.rule ??
      flow?.pricing_snapshot_priced?.cancellationRules ??
      []
  );

  let earliestPenaltyDate = null;
  const candidates = [];
  for (const rule of rules) {
    const charge = toNumber(rule?.charge ?? rule?.cancelCharge ?? rule?.value ?? rule?.amount, 0);
    const restricted = String(rule?.cancelRestricted || "").trim().toLowerCase() === "true";
    const candidateRaw = rule?.fromDate ?? rule?.from ?? rule?.deadline ?? null;
    if (!candidateRaw) continue;
    const candidateDate = new Date(candidateRaw);
    if (Number.isNaN(candidateDate.valueOf())) continue;
    candidates.push(candidateDate);
    if (restricted || charge > 0) {
      if (!earliestPenaltyDate || candidateDate < earliestPenaltyDate) {
        earliestPenaltyDate = candidateDate;
      }
    }
  }

  if (earliestPenaltyDate) return earliestPenaltyDate;
  if (!candidates.length) return now;
  return candidates.sort((left, right) => left - right).pop() || now;
};

const buildSummaryEnvelope = ({
  account,
  nextReleaseAt = null,
  enabled = true,
  lifetimeRefundedMinor = 0,
  lifetimeRewardReversedMinor = 0,
} = {}) => ({
  enabled,
  ...toSummaryPayload(account),
  lifetimeRefundedMinor: Math.max(0, Math.round(toNumber(lifetimeRefundedMinor, 0))),
  lifetimeRewardReversedMinor: Math.max(
    0,
    Math.round(toNumber(lifetimeRewardReversedMinor, 0))
  ),
  nextReleaseAt,
});

const resolveLedgerNextCursor = (items) =>
  items.length ? String(items[items.length - 1]?.id || "") : null;

const releaseHeldAmount = async ({ account, hold, reason, transaction }) => {
  const amountMinor = Math.max(0, Math.round(toNumber(hold?.amount_minor, 0)));
  if (!hold || hold.status !== HOLD_STATUS.HELD || amountMinor <= 0) return hold;

  await account.update(
    {
      available_minor: Math.round(toNumber(account.available_minor, 0)) + amountMinor,
      locked_minor: Math.max(0, Math.round(toNumber(account.locked_minor, 0)) - amountMinor),
    },
    { transaction }
  );
  await hold.update(
    {
      status: HOLD_STATUS.RELEASED,
      released_at: new Date(),
      meta: {
        ...(hold.meta || {}),
        releaseReason: reason || "manual_release",
      },
    },
    { transaction }
  );
  await createLedgerEntry({
    accountId: account.id,
    userId: hold.user_id,
    stayId: hold.stay_id,
    holdId: hold.id,
    type: LEDGER_TYPES.USE_RELEASE,
    status: LEDGER_STATUS.POSTED,
    amountMinor,
    referenceKey: `guest-wallet:use-release:${hold.id}`,
    effectiveAt: new Date(),
    meta: { reason: reason || "manual_release" },
    transaction,
  });
  return hold;
};

// Converts an amount in fromCurrency to USD using the stored FX rates.
// convertCurrency(x, Y) goes USD→Y, so to invert: USD = amount / rate(Y).
const convertToUsd = async (amount, fromCurrency) => {
  const upper = String(fromCurrency || "USD").trim().toUpperCase();
  if (upper === "USD" || upper === WALLET_CURRENCY) return toNumber(amount, 0);
  try {
    const meta = await convertCurrency(1, upper); // 1 USD → X fromCurrency
    const rate = toNumber(meta?.rate, 0);
    return rate > 0 ? toNumber(amount, 0) / rate : toNumber(amount, 0);
  } catch {
    return toNumber(amount, 0); // fallback: assume 1:1 (safe to under-reward)
  }
};

export const releaseStaleHolds = async ({
  staleAfterHours = 24,
  limit = 50,
} = {}) => {
  if (!isGuestWalletHotelsEnabled()) return { enabled: false, released: 0 };

  const cutoff = new Date(Date.now() - staleAfterHours * 60 * 60 * 1000);
  const staleHolds = await models.GuestWalletHold.findAll({
    where: {
      status: HOLD_STATUS.HELD,
      created_at: { [Op.lt]: cutoff },
    },
    order: [["id", "ASC"]],
    limit: Math.max(1, Math.min(200, Number(limit) || 50)),
  });

  let released = 0;
  for (const hold of staleHolds) {
    try {
      await withTransaction(null, async (transaction) => {
        const lockedHold = await models.GuestWalletHold.findByPk(hold.id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!lockedHold || lockedHold.status !== HOLD_STATUS.HELD) return;

        const account = await getLockedAccount({ userId: lockedHold.user_id, transaction });
        await releaseHeldAmount({
          account,
          hold: lockedHold,
          reason: "stale_hold_cleanup",
          transaction,
        });
      });
      released += 1;
      console.warn("[wallet] releaseStaleHolds: released stale hold", {
        holdId: hold.id,
        userId: hold.user_id,
        stayId: hold.stay_id,
        amountMinor: hold.amount_minor,
        createdAt: hold.created_at,
      });
    } catch (err) {
      console.error("[wallet] releaseStaleHolds: failed to release hold", {
        holdId: hold.id,
        error: err?.message || err,
      });
    }
  }

  return { enabled: true, released };
};

export const reconcileLockedBalance = async ({ limit = 100 } = {}) => {
  if (!isGuestWalletHotelsEnabled()) return { enabled: false, checked: 0, discrepancies: 0 };

  // Find accounts with locked_minor > 0 — these are the ones that could drift
  const accounts = await models.GuestWalletAccount.findAll({
    where: { locked_minor: { [Op.gt]: 0 } },
    order: [["id", "ASC"]],
    limit: Math.max(1, Math.min(500, Number(limit) || 100)),
  });

  let checked = 0;
  let discrepancies = 0;

  for (const account of accounts) {
    try {
      const actualLocked = await models.GuestWalletHold.sum("amount_minor", {
        where: { user_id: account.user_id, status: HOLD_STATUS.HELD },
      });
      const expectedLocked = Math.max(0, Math.round(toNumber(actualLocked, 0)));
      const storedLocked = Math.max(0, Math.round(toNumber(account.locked_minor, 0)));
      checked += 1;

      if (storedLocked !== expectedLocked) {
        discrepancies += 1;
        const drift = storedLocked - expectedLocked;
        console.warn("[wallet] reconcileLockedBalance: drift detected", {
          accountId: account.id,
          userId: account.user_id,
          storedLockedMinor: storedLocked,
          expectedLockedMinor: expectedLocked,
          driftMinor: drift,
        });

        // Auto-correct only when locked_minor > actual held (funds stuck locked with no hold)
        // This is the safe direction: returning funds to available cannot overdraw anything.
        if (drift > 0 && expectedLocked === 0) {
          await withTransaction(null, async (transaction) => {
            const lockedAccount = await models.GuestWalletAccount.findByPk(account.id, {
              transaction,
              lock: transaction.LOCK.UPDATE,
            });
            // Re-check under lock before mutating
            const recheck = await models.GuestWalletHold.sum("amount_minor", {
              where: { user_id: lockedAccount.user_id, status: HOLD_STATUS.HELD },
              transaction,
            });
            if (Math.round(toNumber(recheck, 0)) !== 0) return; // race: hold appeared
            const correctedLocked = Math.max(0, Math.round(toNumber(lockedAccount.locked_minor, 0)));
            if (correctedLocked <= 0) return;
            await lockedAccount.update(
              {
                locked_minor: 0,
                available_minor: Math.round(toNumber(lockedAccount.available_minor, 0)) + correctedLocked,
              },
              { transaction }
            );
            await createLedgerEntry({
              accountId: lockedAccount.id,
              userId: lockedAccount.user_id,
              type: LEDGER_TYPES.ADJUSTMENT,
              status: LEDGER_STATUS.POSTED,
              amountMinor: correctedLocked,
              referenceKey: `guest-wallet:reconcile-locked:${lockedAccount.id}:${Date.now()}`,
              effectiveAt: new Date(),
              meta: { reason: "locked_balance_reconcile", correctedMinor: correctedLocked },
              transaction,
            });
          });
          console.warn("[wallet] reconcileLockedBalance: auto-corrected orphaned locked balance", {
            accountId: account.id,
            userId: account.user_id,
            correctedMinor: drift,
          });
        }
      }
    } catch (err) {
      console.error("[wallet] reconcileLockedBalance: error checking account", {
        accountId: account.id,
        error: err?.message || err,
      });
    }
  }

  return { enabled: true, checked, discrepancies };
};

export const releaseDueRewards = async ({ userId = null, limit = RELEASE_SWEEP_LIMIT } = {}) => {
  if (!isGuestWalletHotelsEnabled()) return { enabled: false, processed: 0 };

  const where = {
    type: LEDGER_TYPES.EARN_PENDING,
    release_at: { [Op.lte]: new Date() },
  };
  if (userId) where.user_id = userId;

  const dueEntries = await models.GuestWalletLedger.findAll({
    where,
    order: [["release_at", "ASC"], ["id", "ASC"]],
    limit: Math.max(1, Math.min(RELEASE_SWEEP_LIMIT, Number(limit) || RELEASE_SWEEP_LIMIT)),
  });

  let processed = 0;
  for (const dueEntry of dueEntries) {
    await withTransaction(null, async (transaction) => {
      const pendingEntry = await models.GuestWalletLedger.findByPk(dueEntry.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!pendingEntry) return;

      const existingRelease = await models.GuestWalletLedger.findOne({
        where: {
          linked_entry_id: pendingEntry.id,
          type: LEDGER_TYPES.EARN_RELEASE,
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (existingRelease) return;

      const account = await getLockedAccount({ userId: pendingEntry.user_id, transaction });
      const reversedMinor = await sumLinkedLedgerMinor({
        linkedEntryId: pendingEntry.id,
        type: LEDGER_TYPES.EARN_REVERSE,
        transaction,
      });
      const releasableMinor = Math.max(
        0,
        Math.round(toNumber(pendingEntry.amount_minor, 0)) - reversedMinor
      );

      if (releasableMinor > 0) {
        await account.update(
          {
            pending_minor: Math.max(
              0,
              Math.round(toNumber(account.pending_minor, 0)) - releasableMinor
            ),
            available_minor: Math.round(toNumber(account.available_minor, 0)) + releasableMinor,
          },
          { transaction }
        );
      }

      await createLedgerEntry({
        accountId: account.id,
        userId: pendingEntry.user_id,
        stayId: pendingEntry.stay_id,
        linkedEntryId: pendingEntry.id,
        type: LEDGER_TYPES.EARN_RELEASE,
        status: LEDGER_STATUS.POSTED,
        amountMinor: releasableMinor,
        referenceKey: `guest-wallet:earn-release:${pendingEntry.id}`,
        effectiveAt: new Date(),
        meta: {
          source: "scheduled_release",
          generatedAt: new Date().toISOString(),
        },
        transaction,
      });
      processed += 1;
    });
  }

  return { enabled: true, processed };
};

export const getSummary = async ({ userId, releaseDue = true } = {}) => {
  if (!isGuestWalletHotelsEnabled()) {
    return buildSummaryEnvelope({
      account: null,
      nextReleaseAt: null,
      enabled: false,
    });
  }

  if (releaseDue && userId) {
    await releaseDueRewards({ userId, limit: RELEASE_SWEEP_LIMIT });
  }

  const account = await getOrCreateAccount({ userId });
  const [lifetimeRefundedMinor, lifetimeRewardReversedMinor] = await Promise.all([
    sumLedgerMinorByType({ userId, type: LEDGER_TYPES.USE_REFUND }),
    sumLedgerMinorByType({ userId, type: LEDGER_TYPES.EARN_REVERSE }),
  ]);
  const nextPending = await models.GuestWalletLedger.findOne({
    where: {
      user_id: userId,
      type: LEDGER_TYPES.EARN_PENDING,
      release_at: { [Op.gt]: new Date() },
    },
    order: [["release_at", "ASC"], ["id", "ASC"]],
  });

  return buildSummaryEnvelope({
    account,
    nextReleaseAt: nextPending?.release_at || null,
    enabled: true,
    lifetimeRefundedMinor,
    lifetimeRewardReversedMinor,
  });
};

export const listTransactions = async ({
  userId,
  cursor = null,
  limit = DEFAULT_TRANSACTION_PAGE_SIZE,
} = {}) => {
  if (!isGuestWalletHotelsEnabled()) {
    return { enabled: false, items: [], nextCursor: null };
  }

  await releaseDueRewards({ userId, limit: RELEASE_SWEEP_LIMIT });
  const account = await getOrCreateAccount({ userId });
  const safeLimit = clamp(Number(limit) || DEFAULT_TRANSACTION_PAGE_SIZE, 1, MAX_TRANSACTION_PAGE_SIZE);
  const where = {
    user_id: userId,
    account_id: account.id,
    type: { [Op.in]: VISIBLE_LEDGER_TYPES },
    status: { [Op.ne]: LEDGER_STATUS.VOIDED },
    amount_minor: { [Op.gte]: 0 },
  };
  if (cursor) {
    const cursorId = Number(cursor);
    if (Number.isFinite(cursorId) && cursorId > 0) {
      where.id = { [Op.lt]: cursorId };
    }
  }

  const rows = await models.GuestWalletLedger.findAll({
    where,
    order: [["id", "DESC"]],
    limit: safeLimit,
  });

  const items = rows.map((row) => {
    const sign = inferDisplaySign(row);
    const signedAmount = sign * fromMinor(row.amount_minor);
    return {
      id: row.id,
      type: row.type,
      status: inferTransactionStatus(row),
      amountMinor: Math.round(toNumber(row.amount_minor, 0)),
      displayAmount: formatCurrencyLabel(signedAmount, WALLET_CURRENCY),
      stayId: row.stay_id || null,
      bookingRef: row.meta?.bookingRef || null,
      effectiveAt: row.effective_at || row.created_at || null,
      releaseAt: row.release_at || null,
      meta: row.meta || null,
    };
  });

  return {
    enabled: true,
    items,
    nextCursor: resolveLedgerNextCursor(rows),
  };
};

export const previewHotelUse = async ({
  userId,
  publicTotalUsd,
  minimumSellingUsd,
  displayCurrency = WALLET_CURRENCY,
  flowId = null,
  releaseAt = null,
} = {}) => {
  if (!isGuestWalletHotelsEnabled()) {
    return {
      enabled: false,
      flowId: flowId || null,
      availableUsd: 0,
      availableMinor: 0,
      availableDisplay: formatCurrencyLabel(0, displayCurrency),
      appliedUsd: 0,
      appliedMinor: 0,
      appliedDisplay: formatCurrencyLabel(0, displayCurrency),
      remainingChargeDisplay: formatCurrencyLabel(publicTotalUsd || 0, displayCurrency),
      minimumSellingDisplay: formatCurrencyLabel(minimumSellingUsd || 0, displayCurrency),
      blockedByMinimumSelling: true,
      pendingRewardUsd: 0,
      pendingRewardDisplay: formatCurrencyLabel(0, displayCurrency),
      rewardReleaseAt: releaseAt || null,
    };
  }

  await releaseDueRewards({ userId, limit: RELEASE_SWEEP_LIMIT });
  const account = await getOrCreateAccount({ userId });
  const preview = computeWalletPreview({
    availableMinor: account.available_minor,
    publicTotalUsd,
    minimumSellingUsd,
  });
  const appliedDisplay = await convertUsdForDisplay(preview.appliedUsd, displayCurrency);
  const remainingChargeDisplay = await convertUsdForDisplay(
    preview.chargeAfterWalletUsd,
    displayCurrency
  );
  const minimumSellingDisplay = await convertUsdForDisplay(
    preview.minimumSellingUsd,
    displayCurrency
  );
  const pendingRewardMinor = computeRewardMinor(publicTotalUsd);
  const availableDisplay = await convertUsdForDisplay(preview.availableUsd, displayCurrency);
  const pendingRewardDisplay = await convertUsdForDisplay(fromMinor(pendingRewardMinor), displayCurrency);

  return {
    enabled: true,
    flowId: flowId || null,
    availableUsd: preview.availableUsd,
    availableMinor: preview.availableMinor,
    availableDisplay: availableDisplay.label,
    appliedUsd: preview.appliedUsd,
    appliedMinor: preview.appliedMinor,
    appliedDisplay: appliedDisplay.label,
    remainingChargeDisplay: remainingChargeDisplay.label,
    minimumSellingDisplay: minimumSellingDisplay.label,
    blockedByMinimumSelling: preview.blockedByMinimumSelling,
    pendingRewardUsd: fromMinor(pendingRewardMinor),
    pendingRewardDisplay: pendingRewardDisplay.label,
    rewardReleaseAt: releaseAt || null,
  };
};

export const holdForHotelPayment = async ({
  userId,
  stayId,
  paymentScopeKey,
  paymentIntentId = null,
  publicTotalUsd,
  minimumSellingUsd,
  meta = null,
} = {}) => {
  if (!isGuestWalletHotelsEnabled()) {
    return {
      enabled: false,
      holdId: null,
      appliedMinor: 0,
      appliedUsd: 0,
      chargeAfterWalletUsd: roundCurrency(publicTotalUsd),
    };
  }

  await releaseDueRewards({ userId, limit: RELEASE_SWEEP_LIMIT });

  return withTransaction(null, async (transaction) => {
    const account = await getLockedAccount({ userId, transaction });
    const existingHold = await findReusableHeldHold({
      userId,
      stayId,
      paymentScopeKey,
      transaction,
      lock: true,
    });
    const effectiveAvailableMinor =
      Math.round(toNumber(account.available_minor, 0)) +
      Math.round(
        existingHold?.status === HOLD_STATUS.HELD ? toNumber(existingHold.amount_minor, 0) : 0
      );
    const preview = computeWalletPreview({
      availableMinor: effectiveAvailableMinor,
      publicTotalUsd,
      minimumSellingUsd,
    });

    if (
      existingHold &&
      preview.appliedMinor === Math.round(toNumber(existingHold.amount_minor, 0))
    ) {
      if (paymentIntentId && existingHold.payment_intent_id !== paymentIntentId) {
        await existingHold.update({ payment_intent_id: paymentIntentId }, { transaction });
      }
      return {
        enabled: true,
        holdId: existingHold.id,
        appliedMinor: preview.appliedMinor,
        appliedUsd: preview.appliedUsd,
        chargeAfterWalletUsd: preview.chargeAfterWalletUsd,
      };
    }

    if (existingHold) {
      await releaseHeldAmount({
        account,
        hold: existingHold,
        reason: "replaced_before_rehold",
        transaction,
      });
      await account.reload({ transaction, lock: transaction.LOCK.UPDATE });
    }

    if (preview.appliedMinor <= 0) {
      return {
        enabled: true,
        holdId: null,
        appliedMinor: 0,
        appliedUsd: 0,
        chargeAfterWalletUsd: preview.chargeAfterWalletUsd,
      };
    }

    await account.update(
      {
        available_minor: Math.max(
          0,
          Math.round(toNumber(account.available_minor, 0)) - preview.appliedMinor
        ),
        locked_minor: Math.round(toNumber(account.locked_minor, 0)) + preview.appliedMinor,
      },
      { transaction }
    );

    const hold = await models.GuestWalletHold.create(
      {
        user_id: userId,
        stay_id: stayId,
        payment_scope_key: paymentScopeKey,
        payment_intent_id: paymentIntentId,
        currency: WALLET_CURRENCY,
        amount_minor: preview.appliedMinor,
        refunded_minor: 0,
        public_total_minor: toMinor(publicTotalUsd),
        minimum_selling_minor: toMinor(minimumSellingUsd),
        status: HOLD_STATUS.HELD,
        meta,
      },
      { transaction }
    );

    await createLedgerEntry({
      accountId: account.id,
      userId,
      stayId,
      holdId: hold.id,
      type: LEDGER_TYPES.USE_HOLD,
      status: LEDGER_STATUS.POSTED,
      amountMinor: preview.appliedMinor,
      referenceKey: `guest-wallet:use-hold:${hold.id}`,
      effectiveAt: new Date(),
      meta: {
        paymentScopeKey,
        paymentIntentId: paymentIntentId || null,
      },
      transaction,
    });

    return {
      enabled: true,
      holdId: hold.id,
      appliedMinor: preview.appliedMinor,
      appliedUsd: preview.appliedUsd,
      chargeAfterWalletUsd: preview.chargeAfterWalletUsd,
    };
  });
};

export const releaseHold = async ({
  userId,
  stayId = null,
  paymentScopeKey = null,
  paymentIntentId = null,
  reason = "manual_release",
} = {}) => {
  if (!isGuestWalletHotelsEnabled()) return null;

  return withTransaction(null, async (transaction) => {
    const where = {
      user_id: userId,
      status: HOLD_STATUS.HELD,
    };
    if (stayId != null) where.stay_id = stayId;
    if (paymentScopeKey) where.payment_scope_key = paymentScopeKey;
    if (paymentIntentId) where.payment_intent_id = paymentIntentId;

    const hold = await models.GuestWalletHold.findOne({
      where,
      order: [["id", "DESC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!hold) return null;

    const account = await getLockedAccount({ userId, transaction });
    await releaseHeldAmount({ account, hold, reason, transaction });
    return hold;
  });
};

export const captureHold = async ({ userId, stayId = null, paymentIntentId = null } = {}) => {
  if (!isGuestWalletHotelsEnabled()) return null;

  return withTransaction(null, async (transaction) => {
    const where = {
      user_id: userId,
      status: HOLD_STATUS.HELD,
    };
    if (stayId != null) where.stay_id = stayId;
    if (paymentIntentId) where.payment_intent_id = paymentIntentId;

    const hold = await models.GuestWalletHold.findOne({
      where,
      order: [["id", "DESC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!hold) return null;

    const account = await getLockedAccount({ userId, transaction });
    const amountMinor = Math.max(0, Math.round(toNumber(hold.amount_minor, 0)));
    if (amountMinor <= 0) return hold;

    await account.update(
      {
        locked_minor: Math.max(0, Math.round(toNumber(account.locked_minor, 0)) - amountMinor),
        lifetime_spent_minor: Math.round(toNumber(account.lifetime_spent_minor, 0)) + amountMinor,
      },
      { transaction }
    );
    await hold.update(
      {
        status: HOLD_STATUS.CAPTURED,
        captured_at: new Date(),
      },
      { transaction }
    );
    await createLedgerEntry({
      accountId: account.id,
      userId,
      stayId: hold.stay_id,
      holdId: hold.id,
      type: LEDGER_TYPES.USE_CAPTURE,
      status: LEDGER_STATUS.POSTED,
      amountMinor,
      referenceKey: `guest-wallet:use-capture:${hold.id}`,
      effectiveAt: new Date(),
      transaction,
    });

    return hold;
  });
};

export const scheduleEarn = async ({
  userId,
  stayId,
  publicTotalUsd = 0,
  // Fallback for multi-currency bookings where publicTotalUsd is unavailable.
  // If publicTotalUsd is 0 and grossAmount + grossCurrency are provided,
  // grossAmount is converted to USD before computing the reward.
  grossAmount = null,
  grossCurrency = "USD",
  releaseAt = null,
  bookingRef = null,
  flow = null,
} = {}) => {
  if (!isGuestWalletHotelsEnabled()) return null;

  let resolvedPublicTotalUsd = toNumber(publicTotalUsd, 0);
  if (resolvedPublicTotalUsd <= 0 && grossAmount != null && toNumber(grossAmount, 0) > 0) {
    resolvedPublicTotalUsd = await convertToUsd(toNumber(grossAmount, 0), grossCurrency);
  }

  const rewardMinor = computeRewardMinor(resolvedPublicTotalUsd);
  if (rewardMinor <= 0) return null;

  return withTransaction(null, async (transaction) => {
    const existing = await findPendingEarnEntry({ stayId, transaction, lock: true });
    if (existing) return existing;

    const account = await getLockedAccount({ userId, transaction });
    await account.update(
      {
        pending_minor: Math.round(toNumber(account.pending_minor, 0)) + rewardMinor,
        lifetime_earned_minor: Math.round(toNumber(account.lifetime_earned_minor, 0)) + rewardMinor,
      },
      { transaction }
    );

    return createLedgerEntry({
      accountId: account.id,
      userId,
      stayId,
      type: LEDGER_TYPES.EARN_PENDING,
      status: LEDGER_STATUS.PENDING,
      amountMinor: rewardMinor,
      releaseAt: releaseAt || resolveRewardReleaseAt({ flow }),
      referenceKey: `guest-wallet:earn-pending:${stayId}`,
      effectiveAt: new Date(),
      meta: {
        bookingRef: bookingRef || null,
        rewardPct: WALLET_REWARD_PCT,
        source: "hotel_booking",
      },
      transaction,
    });
  });
};

export const reverseEarn = async ({
  userId,
  stayId,
  refundRatio,
  referenceKey,
  meta = null,
} = {}) => {
  if (!isGuestWalletHotelsEnabled()) return null;

  return withTransaction(null, async (transaction) => {
    const pendingEntry = await findPendingEarnEntry({ stayId, transaction, lock: true });
    if (!pendingEntry) return null;

    const totalRewardMinor = Math.max(0, Math.round(toNumber(pendingEntry.amount_minor, 0)));
    const requestedReverseMinor = Math.min(
      totalRewardMinor,
      toMinor(fromMinor(totalRewardMinor) * clamp(toNumber(refundRatio, 0), 0, 1))
    );
    const alreadyReversedMinor = await sumLinkedLedgerMinor({
      linkedEntryId: pendingEntry.id,
      type: LEDGER_TYPES.EARN_REVERSE,
      transaction,
    });
    const reverseMinor = Math.max(0, requestedReverseMinor - alreadyReversedMinor);
    if (reverseMinor <= 0) return null;

    const account = await getLockedAccount({ userId, transaction });
    const releaseEntry = await models.GuestWalletLedger.findOne({
      where: {
        linked_entry_id: pendingEntry.id,
        type: LEDGER_TYPES.EARN_RELEASE,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (releaseEntry) {
      const releasedMinor = Math.max(0, Math.round(toNumber(releaseEntry.amount_minor, 0)));
      const prereleaseReversedMinor = Math.max(0, totalRewardMinor - releasedMinor);
      const postreleaseReversedMinor = Math.max(0, alreadyReversedMinor - prereleaseReversedMinor);
      const availableCapacity = Math.max(0, releasedMinor - postreleaseReversedMinor);
      const effectiveReverseMinor = Math.min(reverseMinor, availableCapacity);
      if (effectiveReverseMinor <= 0) return null;

      await account.update(
        {
          available_minor: Math.max(
            0,
            Math.round(toNumber(account.available_minor, 0)) - effectiveReverseMinor
          ),
          lifetime_reversed_minor:
            Math.round(toNumber(account.lifetime_reversed_minor, 0)) + effectiveReverseMinor,
        },
        { transaction }
      );

      return createLedgerEntry({
        accountId: account.id,
        userId,
        stayId,
        linkedEntryId: pendingEntry.id,
        type: LEDGER_TYPES.EARN_REVERSE,
        status: LEDGER_STATUS.POSTED,
        amountMinor: effectiveReverseMinor,
        referenceKey,
        effectiveAt: new Date(),
        meta: {
          bucket: "available",
          refundRatio: clamp(toNumber(refundRatio, 0), 0, 1),
          ...(meta || {}),
        },
        transaction,
      });
    }

    await account.update(
      {
        pending_minor: Math.max(0, Math.round(toNumber(account.pending_minor, 0)) - reverseMinor),
        lifetime_reversed_minor:
          Math.round(toNumber(account.lifetime_reversed_minor, 0)) + reverseMinor,
      },
      { transaction }
    );

    return createLedgerEntry({
      accountId: account.id,
      userId,
      stayId,
      linkedEntryId: pendingEntry.id,
      type: LEDGER_TYPES.EARN_REVERSE,
      status: LEDGER_STATUS.POSTED,
      amountMinor: reverseMinor,
      referenceKey,
      effectiveAt: new Date(),
      meta: {
        bucket: "pending",
        refundRatio: clamp(toNumber(refundRatio, 0), 0, 1),
        ...(meta || {}),
      },
      transaction,
    });
  });
};

export const refundUsedAmount = async ({
  userId,
  stayId,
  refundRatio,
  referenceKey,
  meta = null,
} = {}) => {
  if (!isGuestWalletHotelsEnabled()) return null;

  return withTransaction(null, async (transaction) => {
    const hold = await findCapturedHold({ stayId, transaction, lock: true });
    if (!hold || Number(hold.user_id) !== Number(userId)) return null;

    const totalCapturedMinor = Math.max(0, Math.round(toNumber(hold.amount_minor, 0)));
    const alreadyRefundedMinor = Math.max(0, Math.round(toNumber(hold.refunded_minor, 0)));
    const requestedRefundMinor = Math.min(
      totalCapturedMinor,
      toMinor(fromMinor(totalCapturedMinor) * clamp(toNumber(refundRatio, 0), 0, 1))
    );
    const effectiveRefundMinor = Math.max(0, requestedRefundMinor - alreadyRefundedMinor);
    if (effectiveRefundMinor <= 0) return null;

    const account = await getLockedAccount({ userId, transaction });
    const nextRefundedMinor = Math.min(totalCapturedMinor, alreadyRefundedMinor + effectiveRefundMinor);
    const nextStatus =
      nextRefundedMinor >= totalCapturedMinor
        ? HOLD_STATUS.REFUNDED
        : HOLD_STATUS.PARTIALLY_REFUNDED;

    await account.update(
      {
        available_minor: Math.round(toNumber(account.available_minor, 0)) + effectiveRefundMinor,
        lifetime_reversed_minor:
          Math.round(toNumber(account.lifetime_reversed_minor, 0)) + effectiveRefundMinor,
      },
      { transaction }
    );
    await hold.update(
      {
        refunded_minor: nextRefundedMinor,
        status: nextStatus,
        meta: {
          ...(hold.meta || {}),
          refundUpdatedAt: new Date().toISOString(),
        },
      },
      { transaction }
    );

    return createLedgerEntry({
      accountId: account.id,
      userId,
      stayId,
      holdId: hold.id,
      type: LEDGER_TYPES.USE_REFUND,
      status: LEDGER_STATUS.POSTED,
      amountMinor: effectiveRefundMinor,
      referenceKey,
      effectiveAt: new Date(),
      meta: {
        refundRatio: clamp(toNumber(refundRatio, 0), 0, 1),
        ...(meta || {}),
      },
      transaction,
    });
  });
};

export const deriveRefundRatio = ({ refundedAmount = 0, chargedAmount = 0 }) => {
  const charged = Math.max(0, toNumber(chargedAmount, 0));
  if (charged <= 0) return 0;
  return clamp(toNumber(refundedAmount, 0) / charged, 0, 1);
};

export const buildWalletTransactionPreview = async ({
  publicTotalUsd,
  minimumSellingUsd,
  displayCurrency,
  bookingDisplayTotal = null,
} = {}) => {
  const preview = computeWalletPreview({
    availableMinor: 0,
    publicTotalUsd,
    minimumSellingUsd,
  });
  const minimumSellingDisplay = await convertUsdForDisplay(preview.minimumSellingUsd, displayCurrency);
  const fallbackRemainingDisplay = await convertUsdForDisplay(preview.publicTotalUsd, displayCurrency);
  return {
    preview,
    minimumSellingDisplay: minimumSellingDisplay.label,
    remainingChargeDisplay:
      bookingDisplayTotal != null
        ? formatCurrencyLabel(bookingDisplayTotal, displayCurrency)
        : fallbackRemainingDisplay.label,
  };
};

export default {
  buildWalletTransactionPreview,
  captureHold,
  computeWalletPreview,
  deriveRefundRatio,
  fromMinor,
  getSummary,
  holdForHotelPayment,
  isGuestWalletHotelsEnabled,
  listTransactions,
  previewHotelUse,
  reconcileLockedBalance,
  refundUsedAmount,
  releaseDueRewards,
  releaseHold,
  releaseStaleHolds,
  scheduleEarn,
  reverseEarn,
  toMinor,
};
