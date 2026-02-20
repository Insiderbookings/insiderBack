import models from "../models/index.js";

const toRate = (value) => Number(value);
const isSameRate = (a, b) => {
  const left = toRate(a);
  const right = toRate(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) < 1e-12;
};

const toCode = (value) => String(value || "").trim().toUpperCase().slice(0, 3);
const toProvider = (value) => String(value || "").trim().toLowerCase().slice(0, 40) || "apilayer";
const toSource = (value) => String(value || "").trim().slice(0, 80) || "unknown";
const toBatchId = (value) => String(value || "").trim().slice(0, 64);

const buildBatchId = () => `fx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const createFxRateChangeLogs = async ({
  changes = [],
  source = "unknown",
  triggeredBy = null,
  batchId = null,
  changedAt = new Date(),
} = {}) => {
  const validRows = (Array.isArray(changes) ? changes : [])
    .map((item) => ({
      baseCurrency: toCode(item?.baseCurrency),
      quoteCurrency: toCode(item?.quoteCurrency),
      provider: toProvider(item?.provider),
      oldRate: toRate(item?.oldRate),
      newRate: toRate(item?.newRate),
    }))
    .filter(
      (item) =>
        item.baseCurrency &&
        item.quoteCurrency &&
        Number.isFinite(item.oldRate) &&
        Number.isFinite(item.newRate) &&
        !isSameRate(item.oldRate, item.newRate)
    );

  if (!validRows.length) {
    return { batchId: null, count: 0 };
  }

  const resolvedBatchId = toBatchId(batchId) || buildBatchId();
  const resolvedSource = toSource(source);
  const resolvedChangedAt = changedAt instanceof Date ? changedAt : new Date(changedAt || Date.now());

  await models.FxRateChangeLog.bulkCreate(
    validRows.map((row) => ({
      batchId: resolvedBatchId,
      source: resolvedSource,
      triggeredBy,
      baseCurrency: row.baseCurrency,
      quoteCurrency: row.quoteCurrency,
      provider: row.provider,
      oldRate: row.oldRate,
      newRate: row.newRate,
      changedAt: resolvedChangedAt,
    }))
  );

  return { batchId: resolvedBatchId, count: validRows.length };
};

export const ratesAreEqual = isSameRate;

