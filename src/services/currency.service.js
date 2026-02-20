import models from "../models/index.js";
import { Op } from "sequelize";

const FALLBACK_RATES = {
  USD: 1,
  EUR: 0.95,
  GBP: 0.79,
  CAD: 1.35,
  AUD: 1.5,
  AED: 3.67,
  ARS: 1050,
  MXN: 17.2,
  BRL: 5.2,
};

const FX_BASE_CURRENCY = String(process.env.FX_RATES_BASE_CURRENCY || "USD").trim().toUpperCase();
const FX_PROVIDER = String(process.env.FX_RATES_PROVIDER || "apilayer").trim().toLowerCase();

const normalizeCode = (value, fallback = "USD") => {
  const code = String(value || "").trim().toUpperCase().slice(0, 3);
  return code || fallback;
};

const findLatestEnabledRate = async ({ baseCurrency, quoteCurrency, provider }) => {
  const now = new Date();

  const active = await models.FxRate.findOne({
    where: {
      baseCurrency,
      quoteCurrency,
      provider,
      enabled: true,
      expiresAt: { [Op.or]: [null, { [Op.gt]: now }] },
    },
    order: [["fetchedAt", "DESC"]],
  });
  if (active) return active;

  return models.FxRate.findOne({
    where: {
      baseCurrency,
      quoteCurrency,
      provider,
      enabled: true,
    },
    order: [["fetchedAt", "DESC"]],
  });
};

export const getExchangeRateMeta = async (toCurrency = "USD") => {
  const target = normalizeCode(toCurrency);
  const baseCurrency = normalizeCode(FX_BASE_CURRENCY);

  if (target === baseCurrency) {
    return { rate: 1, date: null, source: "base", currency: target, missing: false };
  }

  const row = await findLatestEnabledRate({
    baseCurrency,
    quoteCurrency: target,
    provider: FX_PROVIDER,
  });

  if (!row) {
    const fallback = Number(FALLBACK_RATES[target] || 1);
    return {
      rate: fallback,
      date: null,
      source: "fallback",
      currency: target === "USD" ? "USD" : target,
      missing: true,
    };
  }

  return {
    rate: Number(row.rate),
    date: row.rateDate || null,
    source: "fx_rates",
    currency: target,
    missing: false,
  };
};

export const convertCurrency = async (amountInBase, targetCurrency) => {
  const numericAmount = Number(amountInBase);
  const baseAmount = Number.isFinite(numericAmount) ? numericAmount : 0;
  const meta = await getExchangeRateMeta(targetCurrency);

  if (meta.currency === FX_BASE_CURRENCY) {
    return {
      amount: baseAmount,
      rate: 1,
      currency: FX_BASE_CURRENCY,
      source: meta.source,
      rateDate: meta.date,
      missing: meta.missing,
    };
  }

  return {
    amount: baseAmount * Number(meta.rate || 1),
    rate: Number(meta.rate || 1),
    currency: meta.currency,
    source: meta.source,
    rateDate: meta.date,
    missing: meta.missing,
  };
};
