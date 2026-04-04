import { getMarkup } from "./markup.js";

const HOTEL_PRICE_PROVIDER_KEYS = [
  "providerAmount",
  "baseAmount",
  "bestPrice",
  "pricePerNight",
  "nightlyPrice",
  "price",
  "totalInRequestedCurrency",
  "total",
  "totalFormatted",
  "minPrice",
];

const HOTEL_MINIMUM_SELLING_KEYS = [
  "minimumSelling",
  "priceMinimumSelling",
  "totalMinimumSellingInRequestedCurrency",
  "totalMinimumSelling",
  "minimumSellingPrice",
  "minimumSellingFormatted",
  "totalMinimumSellingFormatted",
];

const HOTEL_CANONICAL_DISPLAY_KEYS = [
  "effectiveAmount",
  "displayedAmount",
  "displayAmount",
];

const HOTEL_CANONICAL_MARKED_KEYS = [
  "publicMarkedAmount",
  "publicPrice",
  "displayPrice",
];

export const roundCurrency = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number.parseFloat(numeric.toFixed(2));
};

const parseNumericText = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const cleaned = String(value).replace(/[^0-9.\-]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveAmountFromSource = (source, keys) => {
  if (source == null) return null;
  if (typeof source === "number" || typeof source === "string") {
    const direct = parseNumericText(source);
    if (direct != null) return direct;
  }
  if (typeof source !== "object") return null;

  const candidates = [source];
  for (const nested of [
    source.provider,
    source.pricing,
    source.priceData,
    source.raw,
    source.rateBasis,
    source.hotelDetails,
    source.hotelPricing,
    source.details,
    source.display,
  ]) {
    if (nested && typeof nested === "object" && nested !== source) {
      candidates.push(nested);
    }
  }

  for (const candidate of candidates) {
    for (const key of keys) {
      const parsed = parseNumericText(candidate?.[key]);
      if (parsed != null) return parsed;
    }
  }

  return null;
};

const resolvePricingRole = ({ pricingRole = null, user = null } = {}) => {
  if (pricingRole !== null && pricingRole !== undefined && pricingRole !== "") {
    const parsed = Number(pricingRole);
    if (Number.isFinite(parsed)) return parsed;
  }
  return resolveHotelPricingRole(user);
};

export const resolveHotelPricingRole = (user) => {
  const role = Number(user?.role);
  return role === 100 ? 100 : 0;
};

export const resolveHotelMarkupRate = ({
  providerAmount,
  pricingRole = null,
  user = null,
} = {}) => {
  const role = resolvePricingRole({ pricingRole, user });
  const amount = resolveAmountFromSource(providerAmount, HOTEL_PRICE_PROVIDER_KEYS);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Number(getMarkup(role, amount)) || 0;
};

export const resolveHotelCanonicalPricing = ({
  providerAmount,
  minimumSelling = null,
  pricingRole = null,
  user = null,
} = {}) => {
  const role = resolvePricingRole({ pricingRole, user });
  const providerBaseRaw = resolveAmountFromSource(providerAmount, HOTEL_PRICE_PROVIDER_KEYS);
  const providerBase = roundCurrency(providerBaseRaw);
  const minimumSellingRaw = resolveAmountFromSource(minimumSelling, HOTEL_MINIMUM_SELLING_KEYS);
  const normalizedMinimumSelling =
    Number.isFinite(minimumSellingRaw) && minimumSellingRaw > 0
      ? roundCurrency(minimumSellingRaw)
      : null;

  if (!Number.isFinite(providerBase) || providerBase == null) {
    return {
      pricingRole: role,
      providerAmount: null,
      publicMarkupRate: 0,
      publicMarkupAmount: null,
      publicMarkedAmount: null,
      minimumSelling: normalizedMinimumSelling,
      effectiveAmount: null,
    };
  }

  const publicMarkupRateRaw = Number(getMarkup(role, providerBase));
  const publicMarkupRate = Number.isFinite(publicMarkupRateRaw) && publicMarkupRateRaw > 0
    ? publicMarkupRateRaw
    : 0;
  const publicMarkupAmount = publicMarkupRate > 0
    ? roundCurrency(providerBase * publicMarkupRate)
    : 0;
  const publicMarkedAmount = roundCurrency(providerBase + publicMarkupAmount);
  const effectiveAmount =
    normalizedMinimumSelling != null
      ? roundCurrency(Math.max(Number(publicMarkedAmount) || 0, normalizedMinimumSelling))
      : publicMarkedAmount;

  return {
    pricingRole: role,
    providerAmount: providerBase,
    publicMarkupRate,
    publicMarkupAmount,
    publicMarkedAmount,
    minimumSelling: normalizedMinimumSelling,
    effectiveAmount,
  };
};

export const resolveHotelCanonicalPricingFromObject = (value, options = {}) =>
  resolveHotelCanonicalPricing({
    providerAmount: resolveAmountFromSource(value, HOTEL_PRICE_PROVIDER_KEYS),
    minimumSelling: resolveAmountFromSource(value, HOTEL_MINIMUM_SELLING_KEYS),
    ...options,
  });

export const resolveHotelCanonicalDisplayAmount = (value, options = {}) => {
  const directEffectiveAmount = resolveAmountFromSource(value, HOTEL_CANONICAL_DISPLAY_KEYS);
  if (directEffectiveAmount != null) {
    return roundCurrency(directEffectiveAmount);
  }

  const publicMarkedAmount = resolveAmountFromSource(value, HOTEL_CANONICAL_MARKED_KEYS);
  const minimumSelling = resolveAmountFromSource(value, HOTEL_MINIMUM_SELLING_KEYS);
  if (publicMarkedAmount != null) {
    if (minimumSelling == null) return roundCurrency(publicMarkedAmount);
    return roundCurrency(Math.max(publicMarkedAmount, minimumSelling));
  }

  const providerAmount = resolveAmountFromSource(value, HOTEL_PRICE_PROVIDER_KEYS);
  if (providerAmount == null) return null;

  const pricing = resolveHotelCanonicalPricingFromObject(value, options);
  if (pricing.effectiveAmount != null) return pricing.effectiveAmount;
  if (pricing.publicMarkedAmount != null) return pricing.publicMarkedAmount;
  return null;
};

export default {
  roundCurrency,
  resolveHotelCanonicalDisplayAmount,
  resolveHotelCanonicalPricing,
  resolveHotelCanonicalPricingFromObject,
  resolveHotelMarkupRate,
  resolveHotelPricingRole,
};
