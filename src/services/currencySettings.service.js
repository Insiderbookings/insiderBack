import models from "../models/index.js";
import cache from "./cache.js";
import { CURRENCY_DEFAULTS } from "../constants/currencies.js";

const CACHE_KEY = "currency:settings:enabled";
const CACHE_TTL_SECONDS = 300;

const normalizeCurrencyCode = (value) => {
  const raw = String(value || "USD").trim().toUpperCase();
  if (/^\d+$/.test(raw)) {
    if (raw === "520" || raw === "840") return "USD";
    if (raw === "978") return "EUR";
    if (raw === "826") return "GBP";
    if (raw === "124") return "CAD";
    if (raw === "036" || raw === "36") return "AUD";
    return "USD";
  }
  return raw.slice(0, 3) || "USD";
};

export async function ensureDefaultCurrencySettings() {
  for (const def of CURRENCY_DEFAULTS) {
    const payload = {
      code: def.code,
      name: def.name,
      symbol: def.symbol || null,
      enabled: true,
      sortOrder: Number(def.sortOrder || 0),
    };
    await models.CurrencySetting.findOrCreate({
      where: { code: payload.code },
      defaults: payload,
    });
  }
  await cache.del(CACHE_KEY);
}

export async function invalidateCurrencySettingsCache() {
  await cache.del(CACHE_KEY);
}

export async function getEnabledCurrencySettings({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = await cache.get(CACHE_KEY);
    if (cached && Array.isArray(cached)) return cached;
  }

  let rows = await models.CurrencySetting.findAll({
    where: { enabled: true },
    order: [["sortOrder", "ASC"], ["code", "ASC"]],
  });

  if (!rows || rows.length === 0) {
    await ensureDefaultCurrencySettings();
    rows = await models.CurrencySetting.findAll({
      where: { enabled: true },
      order: [["sortOrder", "ASC"], ["code", "ASC"]],
    });
  }

  const currencies = rows.map((row) => ({
    code: String(row.code || "").toUpperCase(),
    name: row.name || null,
    symbol: row.symbol || null,
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sortOrder || 0),
  }));

  await cache.set(CACHE_KEY, currencies, CACHE_TTL_SECONDS);
  return currencies;
}

export async function resolveEnabledCurrency(value) {
  const code = normalizeCurrencyCode(value);
  const enabled = await getEnabledCurrencySettings();
  const found = enabled.find((item) => item.code === code);
  return found ? code : "USD";
}

export function normalizeCurrency(value) {
  return normalizeCurrencyCode(value);
}
