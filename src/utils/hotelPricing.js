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

export const HOTEL_PRICING_TIERS = Object.freeze({
  STANDARD: "STANDARD",
  TRAVEL_AGENT: "TRAVEL_AGENT",
  ADMIN: "ADMIN",
});

export const HOTEL_PRICING_MARKUP_RATES = Object.freeze({
  STANDARD: 0.2,
  TRAVEL_AGENT: 0.1,
  ADMIN: 0,
});

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

const normalizePricingTier = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (
    normalized === HOTEL_PRICING_TIERS.TRAVEL_AGENT ||
    normalized === "TRAVEL AGENT" ||
    normalized === "TRAVEL_AGENT" ||
    normalized === "TRAVEL-AGENT"
  ) {
    return HOTEL_PRICING_TIERS.TRAVEL_AGENT;
  }
  if (normalized === HOTEL_PRICING_TIERS.ADMIN || normalized === "NET" || normalized === "NET_RATE") {
    return HOTEL_PRICING_TIERS.ADMIN;
  }
  return HOTEL_PRICING_TIERS.STANDARD;
};

const resolvePricingTier = ({ pricingRole = null, user = null } = {}) => {
  if (pricingRole !== null && pricingRole !== undefined && pricingRole !== "") {
    const normalized = normalizePricingTier(pricingRole);
    if (normalized !== HOTEL_PRICING_TIERS.STANDARD || String(pricingRole).trim().toUpperCase() === HOTEL_PRICING_TIERS.STANDARD) {
      return normalized;
    }
    const parsed = Number(pricingRole);
    if (Number.isFinite(parsed)) {
      if (parsed === 100) return HOTEL_PRICING_TIERS.ADMIN;
      if (parsed === 10) return HOTEL_PRICING_TIERS.TRAVEL_AGENT;
      return HOTEL_PRICING_TIERS.STANDARD;
    }
  }

  const role = Number(user?.role);
  if (role === 100) return HOTEL_PRICING_TIERS.ADMIN;
  if (role === 10) return HOTEL_PRICING_TIERS.TRAVEL_AGENT;

  const tier = normalizePricingTier(user?.hotel_pricing_tier ?? user?.hotelPricingTier ?? user?.pricing_tier);
  if (tier === HOTEL_PRICING_TIERS.TRAVEL_AGENT) return HOTEL_PRICING_TIERS.TRAVEL_AGENT;
  return HOTEL_PRICING_TIERS.STANDARD;
};

export const resolveHotelPricingRole = (user) => {
  const tier = resolvePricingTier({ user });
  if (tier === HOTEL_PRICING_TIERS.ADMIN) return 100;
  if (tier === HOTEL_PRICING_TIERS.TRAVEL_AGENT) return 10;
  return 20;
};

export const resolveHotelPricingTier = (user) => resolvePricingTier({ user });

export const resolveHotelMarkupRate = ({
  providerAmount,
  pricingRole = null,
  user = null,
} = {}) => {
  const tier = resolvePricingTier({ pricingRole, user });
  const amount = resolveAmountFromSource(providerAmount, HOTEL_PRICE_PROVIDER_KEYS);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (tier === HOTEL_PRICING_TIERS.ADMIN) return HOTEL_PRICING_MARKUP_RATES.ADMIN;
  if (tier === HOTEL_PRICING_TIERS.TRAVEL_AGENT) return HOTEL_PRICING_MARKUP_RATES.TRAVEL_AGENT;
  return HOTEL_PRICING_MARKUP_RATES.STANDARD;
};

export const resolveHotelCanonicalPricing = ({
  providerAmount,
  minimumSelling = null,
  pricingRole = null,
  user = null,
} = {}) => {
  const tier = resolvePricingTier({ pricingRole, user });
  const publicPricingRole =
    tier === HOTEL_PRICING_TIERS.ADMIN
      ? 100
      : tier === HOTEL_PRICING_TIERS.TRAVEL_AGENT
        ? 10
        : 20;
  const providerBaseRaw = resolveAmountFromSource(providerAmount, HOTEL_PRICE_PROVIDER_KEYS);
  const providerBase = roundCurrency(providerBaseRaw);
  const minimumSellingRaw = resolveAmountFromSource(minimumSelling, HOTEL_MINIMUM_SELLING_KEYS);
  const normalizedMinimumSelling =
    Number.isFinite(minimumSellingRaw) && minimumSellingRaw > 0
      ? roundCurrency(minimumSellingRaw)
      : null;

  if (!Number.isFinite(providerBase) || providerBase == null) {
    return {
      pricingTier: tier,
      pricingRole: publicPricingRole,
      providerAmount: null,
      publicMarkupRate: 0,
      publicMarkupAmount: null,
      publicMarkedAmount: null,
      minimumSelling: normalizedMinimumSelling,
      effectiveAmount: null,
    };
  }

  const publicMarkupRate = resolveHotelMarkupRate({
    providerAmount: providerBase,
    pricingRole: tier,
    user,
  });
  const publicMarkupAmount = publicMarkupRate > 0
    ? roundCurrency(providerBase * publicMarkupRate)
    : 0;
  const publicMarkedAmount = roundCurrency(providerBase + publicMarkupAmount);
  const effectiveAmount =
    normalizedMinimumSelling != null
      ? roundCurrency(Math.max(Number(publicMarkedAmount) || 0, normalizedMinimumSelling))
      : publicMarkedAmount;

  return {
    pricingTier: tier,
    pricingRole: publicPricingRole,
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

export const resolveHotelStayNights = ({
  stayNights = null,
  checkIn = null,
  checkOut = null,
  fallback = 1,
} = {}) => {
  const explicit = Number(stayNights);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1, Math.floor(explicit));
  }

  if (checkIn && checkOut) {
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    if (
      !Number.isNaN(start.getTime()) &&
      !Number.isNaN(end.getTime()) &&
      end.getTime() > start.getTime()
    ) {
      const diffMs = end.getTime() - start.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (Number.isFinite(diffDays) && diffDays > 0) {
        return diffDays;
      }
    }
  }

  return Math.max(1, Number(fallback) || 1);
};

export const decorateHotelPricingForDisplay = (
  item,
  {
    providerAmount = null,
    minimumSelling = null,
    pricingRole = null,
    user = null,
    stayNights = null,
    checkIn = null,
    checkOut = null,
  } = {},
) => {
  if (!item || typeof item !== "object") return item;

  const normalizedStayNights = resolveHotelStayNights({
    stayNights:
      stayNights ??
      item?.stayNights ??
      item?.hotelDetails?.stayNights ??
      item?.details?.stayNights ??
      null,
    checkIn:
      checkIn ??
      item?.checkIn ??
      item?.hotelDetails?.checkIn ??
      item?.details?.checkIn ??
      null,
    checkOut:
      checkOut ??
      item?.checkOut ??
      item?.hotelDetails?.checkOut ??
      item?.details?.checkOut ??
      null,
  });

  const canonicalPricing = resolveHotelCanonicalPricing({
    providerAmount: providerAmount ?? item,
    minimumSelling: minimumSelling ?? item,
    pricingRole,
    user,
  });

  if (
    canonicalPricing.providerAmount == null &&
    canonicalPricing.publicMarkedAmount == null &&
    canonicalPricing.minimumSelling == null &&
    canonicalPricing.effectiveAmount == null
  ) {
    return {
      ...item,
      stayNights: normalizedStayNights,
    };
  }

  const displayedTotal =
    canonicalPricing.effectiveAmount ??
    canonicalPricing.publicMarkedAmount ??
    canonicalPricing.providerAmount;
  const displayedNightly =
    displayedTotal != null
      ? roundCurrency(displayedTotal / normalizedStayNights)
      : null;

  const hotelDetails =
    item.hotelDetails && typeof item.hotelDetails === "object"
      ? {
          ...item.hotelDetails,
          providerAmount: canonicalPricing.providerAmount,
          publicMarkupRate: canonicalPricing.publicMarkupRate,
          publicMarkupAmount: canonicalPricing.publicMarkupAmount,
          publicMarkedAmount: canonicalPricing.publicMarkedAmount,
          minimumSelling: canonicalPricing.minimumSelling,
          effectiveAmount: canonicalPricing.effectiveAmount,
          pricingRole: canonicalPricing.pricingRole,
          bestPrice: displayedTotal ?? item.hotelDetails.bestPrice ?? null,
          nightlyPrice:
            displayedNightly ?? item.hotelDetails.nightlyPrice ?? null,
          pricePerNight:
            displayedNightly ?? item.hotelDetails.pricePerNight ?? null,
          stayNights: normalizedStayNights,
        }
      : item.hotelDetails;

  return {
    ...item,
    providerAmount: canonicalPricing.providerAmount,
    publicMarkupRate: canonicalPricing.publicMarkupRate,
    publicMarkupAmount: canonicalPricing.publicMarkupAmount,
    publicMarkedAmount: canonicalPricing.publicMarkedAmount,
    minimumSelling: canonicalPricing.minimumSelling,
    effectiveAmount: canonicalPricing.effectiveAmount,
    pricingRole: canonicalPricing.pricingRole,
    bestPrice: displayedTotal ?? item.bestPrice ?? null,
    nightlyPrice: displayedNightly ?? item.nightlyPrice ?? null,
    pricePerNight: displayedNightly ?? item.pricePerNight ?? null,
    stayNights: normalizedStayNights,
    hotelDetails,
  };
};

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
  HOTEL_PRICING_MARKUP_RATES,
  HOTEL_PRICING_TIERS,
  roundCurrency,
  decorateHotelPricingForDisplay,
  resolveHotelCanonicalDisplayAmount,
  resolveHotelCanonicalPricing,
  resolveHotelCanonicalPricingFromObject,
  resolveHotelMarkupRate,
  resolveHotelPricingRole,
  resolveHotelPricingTier,
  resolveHotelStayNights,
};
