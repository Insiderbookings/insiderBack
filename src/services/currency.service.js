import models from "../models/index.js";
import { Op } from "sequelize";
import cache from "./cache.js";

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
const CURRENCY_RATE_CACHE_TTL_SECONDS = Math.max(
  30,
  Number(process.env.CURRENCY_RATE_CACHE_TTL_SECONDS || 300),
);

const normalizeCode = (value, fallback = "USD") => {
  const code = String(value || "").trim().toUpperCase().slice(0, 3);
  return code || fallback;
};

const buildExchangeRateCacheKey = ({ baseCurrency, quoteCurrency, provider }) =>
  `currency:rate-meta:${baseCurrency}:${quoteCurrency}:${provider}`;

const buildFallbackExchangeRateMeta = (target) => {
  const fallback = Number(FALLBACK_RATES[target] || 1);
  return {
    rate: fallback,
    date: null,
    source: "fallback",
    currency: target,
    missing: true,
  };
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

  const cacheKey = buildExchangeRateCacheKey({
    baseCurrency,
    quoteCurrency: target,
    provider: FX_PROVIDER,
  });
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  try {
    const row = await findLatestEnabledRate({
      baseCurrency,
      quoteCurrency: target,
      provider: FX_PROVIDER,
    });

    const meta = row
      ? {
          rate: Number(row.rate),
          date: row.rateDate || null,
          source: "fx_rates",
          currency: target,
          missing: false,
        }
      : buildFallbackExchangeRateMeta(target);

    await cache.set(cacheKey, meta, CURRENCY_RATE_CACHE_TTL_SECONDS);
    return meta;
  } catch (error) {
    console.warn("[currency] exchange rate lookup degraded to fallback", error?.message || error);
    const fallbackMeta = buildFallbackExchangeRateMeta(target);
    await cache.set(
      cacheKey,
      fallbackMeta,
      Math.min(CURRENCY_RATE_CACHE_TTL_SECONDS, 60),
    );
    return fallbackMeta;
  }
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

const roundCurrencyAmount = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(2));
};

// Converts amounts between arbitrary currencies using USD-base FX rates.
export const createCurrencyConverter = (targetCurrency = FX_BASE_CURRENCY) => {
  const target = normalizeCode(targetCurrency, FX_BASE_CURRENCY);
  const rateFromBaseCache = new Map();

  const getRateFromBase = async (currency) => {
    const code = normalizeCode(currency, FX_BASE_CURRENCY);
    if (code === FX_BASE_CURRENCY) return 1;
    if (rateFromBaseCache.has(code)) return rateFromBaseCache.get(code);

    const meta = await getExchangeRateMeta(code);
    const raw = Number(meta?.rate || 1);
    const safeRate = Number.isFinite(raw) && raw > 0 ? raw : 1;
    rateFromBaseCache.set(code, safeRate);
    return safeRate;
  };

  const convert = async (amount, sourceCurrency = FX_BASE_CURRENCY) => {
    const source = normalizeCode(sourceCurrency, FX_BASE_CURRENCY);
    const numericAmount = Number(amount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount === 0) return 0;
    if (source === target) return roundCurrencyAmount(numericAmount);

    const sourceRate = await getRateFromBase(source);
    const targetRate = await getRateFromBase(target);

    const amountInBase =
      source === FX_BASE_CURRENCY ? numericAmount : numericAmount / sourceRate;
    const amountInTarget =
      target === FX_BASE_CURRENCY ? amountInBase : amountInBase * targetRate;

    return roundCurrencyAmount(amountInTarget);
  };

  return {
    targetCurrency: target,
    convert,
  };
};
