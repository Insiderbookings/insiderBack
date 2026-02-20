import axios from "axios";
import models from "../models/index.js";
import { getEnabledCurrencySettings } from "./currencySettings.service.js";
import { createFxRateChangeLogs, ratesAreEqual } from "./fxRateChangeLog.service.js";

const APILAYER_BASE_URL =
  process.env.APILAYER_EXCHANGE_URL ||
  process.env.APILAYER_BASE_URL ||
  "https://api.apilayer.com/exchangerates_data/latest";
const APILAYER_API_KEY = process.env.APILAYER_API_KEY || process.env.APILAYER_ACCESS_KEY || null;

const FX_PROVIDER = String(process.env.FX_RATES_PROVIDER || "apilayer").trim() || "apilayer";
const FX_BASE_CURRENCY = String(process.env.FX_RATES_BASE_CURRENCY || "USD").trim().toUpperCase();
const FX_TIMEOUT_MS = Math.max(1000, Number(process.env.FX_RATES_API_TIMEOUT_MS || 8000));
const FX_EXPIRES_SECONDS = Math.max(60, Number(process.env.FX_RATES_EXPIRES_SECONDS || 3600));

const normalizeCode = (value) => String(value || "").trim().toUpperCase().slice(0, 3);

const resolveSymbolsParam = async () => {
  if (process.env.APILAYER_SYMBOLS) return String(process.env.APILAYER_SYMBOLS).trim();
  try {
    const enabled = await getEnabledCurrencySettings();
    const symbols = enabled
      .map((item) => normalizeCode(item?.code))
      .filter((code) => code && code !== FX_BASE_CURRENCY);
    return symbols.length ? symbols.join(",") : "";
  } catch {
    return "";
  }
};

const resolveRateDate = (data) => {
  if (data?.date) return String(data.date);
  if (data?.timestamp) {
    const dt = new Date(Number(data.timestamp) * 1000);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return null;
};

const normalizeRatesPayload = (data) => {
  const rates = data?.rates || null;
  if (rates && typeof rates === "object") return rates;

  const quotes = data?.quotes || null;
  if (quotes && typeof quotes === "object") {
    const map = {};
    for (const [raw, value] of Object.entries(quotes)) {
      const code = String(raw || "").replace(/^USD/, "");
      if (code) map[code] = value;
    }
    return map;
  }
  return null;
};

const loadLatestSnapshotMap = async ({ baseCurrency, provider }) => {
  const rows = await models.FxRate.findAll({
    where: { baseCurrency, provider },
    attributes: ["quoteCurrency", "enabled", "rate", "fetchedAt"],
    order: [
      ["quoteCurrency", "ASC"],
      ["fetchedAt", "DESC"],
    ],
    limit: 5000,
  });

  const map = new Map();
  for (const row of rows) {
    const quote = normalizeCode(row.quoteCurrency);
    if (!quote) continue;
    if (!map.has(quote)) {
      map.set(quote, {
        enabled: row.enabled !== undefined ? Boolean(row.enabled) : true,
        rate: Number(row.rate),
      });
    }
  }
  return map;
};

export const fetchAndStoreFxRatesFromApiLayer = async ({ source = "automatic", triggeredBy = null } = {}) => {
  const symbols = await resolveSymbolsParam();
  const url = new URL(APILAYER_BASE_URL);
  const isCurrencyData = /currency_data/i.test(APILAYER_BASE_URL);
  const baseParam = isCurrencyData ? "source" : "base";
  const symbolsParam = isCurrencyData ? "currencies" : "symbols";

  if (!url.searchParams.get(baseParam)) url.searchParams.set(baseParam, FX_BASE_CURRENCY);
  if (symbols) url.searchParams.set(symbolsParam, symbols);
  if (process.env.APILAYER_ACCESS_KEY) {
    url.searchParams.set("access_key", process.env.APILAYER_ACCESS_KEY);
  }

  const headers = APILAYER_API_KEY ? { apikey: APILAYER_API_KEY } : undefined;
  let data = null;
  try {
    const response = await axios.get(url.toString(), { headers, timeout: FX_TIMEOUT_MS });
    data = response?.data || {};
  } catch (error) {
    const status = Number(error?.response?.status || 0);
    if (status === 429) {
      throw new Error("APILayer rejected request due to too many requests (429). Try again later.");
    }
    throw error;
  }

  if (data?.success === false) {
    const message = data?.error?.info || data?.message || "APILayer error";
    throw new Error(message);
  }

  const normalizedRates = normalizeRatesPayload(data);
  if (!normalizedRates) {
    throw new Error("APILayer response did not include rates/quotes payload");
  }

  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + FX_EXPIRES_SECONDS * 1000);
  const rateDate = resolveRateDate(data);
  const baseCurrency = normalizeCode(data?.base || data?.source || FX_BASE_CURRENCY) || FX_BASE_CURRENCY;
  const latestSnapshotMap = await loadLatestSnapshotMap({ baseCurrency, provider: FX_PROVIDER });
  const changedRates = [];

  const rows = Object.entries(normalizedRates)
    .map(([quoteCurrencyRaw, rateValue]) => {
      const quoteCurrency = normalizeCode(quoteCurrencyRaw);
      const numericRate = Number(rateValue);
      const existing = latestSnapshotMap.get(quoteCurrency);
      const enabled = existing ? Boolean(existing.enabled) : true;

      if (
        quoteCurrency &&
        Number.isFinite(numericRate) &&
        enabled &&
        existing &&
        Number.isFinite(existing.rate) &&
        !ratesAreEqual(existing.rate, numericRate)
      ) {
        changedRates.push({
          baseCurrency,
          quoteCurrency,
          provider: FX_PROVIDER,
          oldRate: existing.rate,
          newRate: numericRate,
        });
      }

      return {
        baseCurrency,
        quoteCurrency,
        rate: numericRate,
        provider: FX_PROVIDER,
        enabled,
        rateDate,
        fetchedAt,
        expiresAt,
      };
    })
    .filter((row) => row.quoteCurrency && Number.isFinite(row.rate) && row.enabled);

  const baseExisting = latestSnapshotMap.get(baseCurrency);
  const baseEnabled = baseExisting ? Boolean(baseExisting.enabled) : true;
  if (baseEnabled) {
    if (baseExisting && Number.isFinite(baseExisting.rate) && !ratesAreEqual(baseExisting.rate, 1)) {
      changedRates.push({
        baseCurrency,
        quoteCurrency: baseCurrency,
        provider: FX_PROVIDER,
        oldRate: baseExisting.rate,
        newRate: 1,
      });
    }
    rows.push({
      baseCurrency,
      quoteCurrency: baseCurrency,
      rate: 1,
      provider: FX_PROVIDER,
      enabled: true,
      rateDate,
      fetchedAt,
      expiresAt,
    });
  }

  await models.FxRate.bulkCreate(rows, {
    updateOnDuplicate: ["rate", "enabled", "rateDate", "expiresAt", "updatedAt"],
  });

  const changeLogResult = await createFxRateChangeLogs({
    source,
    triggeredBy,
    changedAt: fetchedAt,
    changes: changedRates,
  });

  return {
    provider: FX_PROVIDER,
    baseCurrency,
    rateDate,
    fetchedAt,
    expiresAt,
    count: rows.length,
    changedCount: changeLogResult.count,
    changeBatchId: changeLogResult.batchId,
  };
};

export default {
  fetchAndStoreFxRatesFromApiLayer,
};
