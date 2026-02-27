const DEFAULT_HOME_PUBLIC_MARKUP_RATE = 0.1
export const LEGACY_HOST_PLATFORM_FEE_PCT = 0.03

const asFiniteNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const coalesceFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = asFiniteNumber(value)
    if (numeric != null) return numeric
  }
  return null
}

export const roundCurrency = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}

export const getHomePublicMarkupRate = () => {
  const raw = coalesceFiniteNumber(
    process.env.HOME_PUBLIC_MARKUP_RATE,
    process.env.HOMES_PUBLIC_MARKUP_RATE,
  )
  if (raw == null || raw < 0) return DEFAULT_HOME_PUBLIC_MARKUP_RATE
  return raw
}

export const applyHomePublicMarkup = (value, markupRate = getHomePublicMarkupRate()) => {
  const numeric = coalesceFiniteNumber(value, 0)
  if (numeric <= 0) return 0
  return roundCurrency(numeric * (1 + markupRate))
}

export const resolveHomePricingConfig = ({ pricing = {}, capacity = null }) => {
  const hostBasePrice = Number.parseFloat(pricing.base_price ?? 0)
  if (!Number.isFinite(hostBasePrice) || hostBasePrice <= 0) {
    return { error: "Listing does not have a valid base price" }
  }

  const hostWeekendPrice =
    pricing.weekend_price != null ? Number.parseFloat(pricing.weekend_price) : null
  const hasWeekendPrice = Number.isFinite(hostWeekendPrice) && hostWeekendPrice > 0
  const markupRate = getHomePublicMarkupRate()
  const guestBasePrice = applyHomePublicMarkup(hostBasePrice, markupRate)
  const guestWeekendPrice = hasWeekendPrice
    ? applyHomePublicMarkup(hostWeekendPrice, markupRate)
    : null
  const securityDeposit =
    pricing.security_deposit != null ? Number.parseFloat(pricing.security_deposit) : 0
  const hostExtraGuestFee =
    pricing.extra_guest_fee != null ? Number.parseFloat(pricing.extra_guest_fee) : 0
  const guestExtraGuestFee =
    hostExtraGuestFee > 0 ? applyHomePublicMarkup(hostExtraGuestFee, markupRate) : 0
  const extraGuestThreshold =
    pricing.extra_guest_threshold != null
      ? Number(pricing.extra_guest_threshold)
      : capacity
  const currencyCode = String(
    pricing.currency ?? process.env.DEFAULT_CURRENCY ?? "USD"
  )
    .trim()
    .toUpperCase()

  return {
    hostBasePrice: roundCurrency(hostBasePrice),
    hostWeekendPrice: hasWeekendPrice ? roundCurrency(hostWeekendPrice) : null,
    hostExtraGuestFee: roundCurrency(hostExtraGuestFee),
    basePrice: guestBasePrice,
    weekendPrice: guestWeekendPrice,
    extraGuestFee: guestExtraGuestFee,
    hasWeekendPrice,
    securityDeposit: roundCurrency(securityDeposit),
    extraGuestThreshold,
    taxRate: 0,
    currencyCode,
    markupRate,
  }
}

export const computeHomePricingBreakdown = ({
  checkInDate,
  checkOutDate,
  nights,
  totalGuests,
  basePrice,
  weekendPrice,
  hasWeekendPrice,
  extraGuestFee,
  extraGuestThreshold,
  hostBasePrice = null,
  hostWeekendPrice = null,
  hostExtraGuestFee = 0,
  markupRate = getHomePublicMarkupRate(),
}) => {
  let guestBaseSubtotal = 0
  let hostBaseSubtotal = 0
  const nightlyBreakdown = []
  let cursor = new Date(checkInDate)
  const endDate = new Date(checkOutDate)
  while (cursor < endDate) {
    const day = cursor.getUTCDay()
    const isWeekend = day === 5 || day === 6
    const useWeekendRate = isWeekend && hasWeekendPrice
    const guestNightlyRate = roundCurrency(useWeekendRate ? weekendPrice : basePrice)
    const hostNightlyRate = roundCurrency(
      useWeekendRate && hostWeekendPrice != null ? hostWeekendPrice : hostBasePrice ?? 0
    )
    nightlyBreakdown.push({
      date: cursor.toISOString().slice(0, 10),
      rate: guestNightlyRate,
      hostRate: hostNightlyRate,
      weekend: isWeekend,
      reason: useWeekendRate ? "weekend" : "standard",
    })
    guestBaseSubtotal += guestNightlyRate
    hostBaseSubtotal += hostNightlyRate
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  guestBaseSubtotal = roundCurrency(guestBaseSubtotal)
  hostBaseSubtotal = roundCurrency(hostBaseSubtotal)

  let guestExtraGuestSubtotal = 0
  let hostExtraGuestSubtotal = 0
  if (extraGuestThreshold != null && totalGuests > extraGuestThreshold) {
    const extraGuests = totalGuests - extraGuestThreshold
    if (extraGuestFee > 0) {
      guestExtraGuestSubtotal = roundCurrency(extraGuests * extraGuestFee * nights)
    }
    if (hostExtraGuestFee > 0) {
      hostExtraGuestSubtotal = roundCurrency(extraGuests * hostExtraGuestFee * nights)
    }
  }

  const guestSubtotalBeforeDiscount = roundCurrency(
    guestBaseSubtotal + guestExtraGuestSubtotal
  )
  const hostSubtotal = roundCurrency(hostBaseSubtotal + hostExtraGuestSubtotal)
  const platformMarkupAmount = roundCurrency(guestSubtotalBeforeDiscount - hostSubtotal)

  return {
    markupRate,
    nightlyBreakdown,
    baseSubtotal: guestBaseSubtotal,
    extraGuestSubtotal: guestExtraGuestSubtotal,
    subtotalBeforeTax: guestSubtotalBeforeDiscount,
    taxAmount: 0,
    totalBeforeDiscount: guestSubtotalBeforeDiscount,
    guestBaseSubtotal,
    guestExtraGuestSubtotal,
    guestSubtotalBeforeDiscount,
    hostBaseSubtotal,
    hostExtraGuestSubtotal,
    hostSubtotal,
    platformMarkupAmount,
  }
}

export const buildHomePricingSnapshot = ({
  pricingBreakdown,
  securityDeposit = 0,
  currencyCode = "USD",
  referralCoupon = null,
  referralCouponAmount = 0,
  referralFirstBooking = null,
  referralFirstBookingAmount = 0,
  guestTotal = 0,
}) => {
  const discountAmount = roundCurrency(
    roundCurrency(referralCouponAmount) + roundCurrency(referralFirstBookingAmount)
  )

  return {
    pricingModel: "HOST_BASE_PLUS_MARKUP",
    markupRate: pricingBreakdown.markupRate,
    nightlyBreakdown: pricingBreakdown.nightlyBreakdown,
    baseSubtotal: pricingBreakdown.guestBaseSubtotal,
    extraGuestSubtotal: pricingBreakdown.guestExtraGuestSubtotal,
    guestBaseSubtotal: pricingBreakdown.guestBaseSubtotal,
    guestExtraGuestSubtotal: pricingBreakdown.guestExtraGuestSubtotal,
    guestSubtotalBeforeDiscount: pricingBreakdown.guestSubtotalBeforeDiscount,
    hostBaseSubtotal: pricingBreakdown.hostBaseSubtotal,
    hostExtraGuestSubtotal: pricingBreakdown.hostExtraGuestSubtotal,
    hostSubtotal: pricingBreakdown.hostSubtotal,
    platformMarkupAmount: pricingBreakdown.platformMarkupAmount,
    cleaningFee: null,
    taxRate: 0,
    taxAmount: 0,
    securityDeposit: roundCurrency(securityDeposit),
    subtotalBeforeTax: pricingBreakdown.guestSubtotalBeforeDiscount,
    totalBeforeDiscount: pricingBreakdown.guestSubtotalBeforeDiscount,
    referralFirstBooking,
    referralFirstBookingDiscountAmount: roundCurrency(referralFirstBookingAmount),
    referralCoupon,
    referralDiscountAmount: roundCurrency(referralCouponAmount),
    guestDiscountAmount: discountAmount,
    discountAmount,
    hostServiceFee: 0,
    hostEarnings: pricingBreakdown.hostSubtotal,
    hostPayout: pricingBreakdown.hostSubtotal,
    total: roundCurrency(guestTotal),
    guestTotal: roundCurrency(guestTotal),
    currency: currencyCode,
  }
}

const resolveSnapshot = (stay) =>
  stay?.pricing_snapshot && typeof stay.pricing_snapshot === "object"
    ? stay.pricing_snapshot
    : stay?.pricingSnapshot && typeof stay.pricingSnapshot === "object"
      ? stay.pricingSnapshot
      : {}

const resolveGuestDiscountAmount = (snapshot) => {
  const explicit = coalesceFiniteNumber(
    snapshot?.guestDiscountAmount,
    snapshot?.guest_discount_amount,
    snapshot?.discountAmount,
    snapshot?.discount_amount,
  )
  if (explicit != null) return roundCurrency(explicit)

  const referralCouponAmount = coalesceFiniteNumber(
    snapshot?.referralDiscountAmount,
    snapshot?.referral_discount_amount,
    snapshot?.referralCoupon?.amount,
    snapshot?.referral_coupon?.amount,
  )
  const referralFirstBookingAmount = coalesceFiniteNumber(
    snapshot?.referralFirstBookingDiscountAmount,
    snapshot?.referral_first_booking_discount_amount,
    snapshot?.referralFirstBooking?.amount,
    snapshot?.referral_first_booking?.amount,
  )
  return roundCurrency(
    roundCurrency(referralCouponAmount ?? 0) +
      roundCurrency(referralFirstBookingAmount ?? 0)
  )
}

export const computeHomeFinancialsFromStay = (stay) => {
  const snapshot = resolveSnapshot(stay)
  const hostSubtotal = coalesceFiniteNumber(
    snapshot?.hostPayout,
    snapshot?.host_payout,
    snapshot?.hostEarnings,
    snapshot?.host_earnings,
    snapshot?.hostSubtotal,
    snapshot?.host_subtotal,
    stay?.net_cost,
  )

  if (hostSubtotal != null) {
    const guestTotal = roundCurrency(
      coalesceFiniteNumber(
        stay?.gross_price,
        snapshot?.guestTotal,
        snapshot?.guest_total,
        snapshot?.total,
      ) ?? 0
    )
    const guestDiscountAmount = resolveGuestDiscountAmount(snapshot)
    const guestSubtotalBeforeDiscount = roundCurrency(
      coalesceFiniteNumber(
        snapshot?.guestSubtotalBeforeDiscount,
        snapshot?.guest_subtotal_before_discount,
        snapshot?.totalBeforeDiscount,
        snapshot?.total_before_discount,
        snapshot?.subtotalBeforeTax,
        snapshot?.subtotal_before_tax,
        guestTotal + guestDiscountAmount,
      ) ?? 0
    )
    const platformMarkupAmount = roundCurrency(
      coalesceFiniteNumber(
        snapshot?.platformMarkupAmount,
        snapshot?.platform_markup_amount,
        guestSubtotalBeforeDiscount - hostSubtotal,
      ) ?? 0
    )

    return {
      model: snapshot?.pricingModel || "HOST_BASE_PLUS_MARKUP",
      legacy: false,
      guestTotal,
      guestBaseSubtotal: roundCurrency(
        coalesceFiniteNumber(snapshot?.guestBaseSubtotal, snapshot?.baseSubtotal) ?? 0
      ),
      guestExtraGuestSubtotal: roundCurrency(
        coalesceFiniteNumber(snapshot?.guestExtraGuestSubtotal, snapshot?.extraGuestSubtotal) ?? 0
      ),
      guestSubtotalBeforeDiscount,
      guestDiscountAmount,
      hostBaseSubtotal: roundCurrency(
        coalesceFiniteNumber(snapshot?.hostBaseSubtotal, snapshot?.host_base_subtotal) ?? 0
      ),
      hostExtraGuestSubtotal: roundCurrency(
        coalesceFiniteNumber(
          snapshot?.hostExtraGuestSubtotal,
          snapshot?.host_extra_guest_subtotal,
        ) ?? 0
      ),
      hostSubtotal: roundCurrency(hostSubtotal),
      hostPayout: roundCurrency(hostSubtotal),
      hostServiceFee: roundCurrency(
        coalesceFiniteNumber(snapshot?.hostServiceFee, snapshot?.host_service_fee, 0) ?? 0
      ),
      platformMarkupAmount,
      effectivePlatformRevenue: roundCurrency(guestTotal - hostSubtotal),
      taxAmount: 0,
      nightlyBreakdown: Array.isArray(snapshot?.nightlyBreakdown) ? snapshot.nightlyBreakdown : [],
      currency: String(stay?.currency || snapshot?.currency || "USD").toUpperCase(),
    }
  }

  const guestTotal = roundCurrency(coalesceFiniteNumber(stay?.gross_price, 0) ?? 0)
  const hostServiceFee = roundCurrency(guestTotal * LEGACY_HOST_PLATFORM_FEE_PCT)
  const hostPayout = roundCurrency(Math.max(0, guestTotal - hostServiceFee))
  return {
    model: "LEGACY_GROSS_MINUS_FEE",
    legacy: true,
    guestTotal,
    guestBaseSubtotal: guestTotal,
    guestExtraGuestSubtotal: 0,
    guestSubtotalBeforeDiscount: guestTotal,
    guestDiscountAmount: 0,
    hostBaseSubtotal: guestTotal,
    hostExtraGuestSubtotal: 0,
    hostSubtotal: guestTotal,
    hostPayout,
    hostServiceFee,
    platformMarkupAmount: 0,
    effectivePlatformRevenue: hostServiceFee,
    taxAmount: roundCurrency(coalesceFiniteNumber(stay?.taxes_total, 0) ?? 0),
    nightlyBreakdown: [],
    currency: String(stay?.currency || "USD").toUpperCase(),
  }
}
