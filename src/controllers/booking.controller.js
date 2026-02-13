/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   src/controllers/booking.controller.js   Â·   COMPLETO
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

import { Op } from "sequelize"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { sendMail } from "../helpers/mailer.js"
import models, { sequelize } from "../models/index.js"
import { streamCertificatePDF } from "../helpers/bookingCertificate.js"
import { generateAndSaveTripIntelligence } from "../services/aiAssistant.service.js"
import { sendCancellationEmail } from "../emailTemplates/cancel-email.js"
import { sendBookingEmail } from "../emailTemplates/booking-email.js"
import { sendHomeHostBookingEmail } from "../emailTemplates/home-host-booking-email.js"
import { createWebbedsClient } from "../providers/webbeds/client.js"
import { getWebbedsConfig } from "../providers/webbeds/config.js"
import {
  buildGetBookingDetailsPayload,
  mapGetBookingDetailsResponse,
} from "../providers/webbeds/getBookingDetails.js"
import {
  PROMPT_TRIGGERS,
  createThread,
  postMessage,
  triggerBookingAutoPrompts,
} from "../services/chat.service.js"
import { sendPushToUser } from "../services/pushNotifications.service.js"
import {
  planReferralCoupon,
  createPendingRedemption,
  reverseReferralRedemption,
  planReferralFirstBookingDiscount,
} from "../services/referralRewards.service.js"
import { emitAdminActivity } from "../websocket/emitter.js"
import { finalizeBookingAfterPayment } from "./payment.controller.js"
/* ──────────────── Helper – count nights ───────────── */
const diffDays = (from, to) =>
    Math.ceil((new Date(to) - new Date(from)) / 86_400_000)

const parseDateOnly = (value) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number)
    return new Date(year, month - 1, day)
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return null
  return parsed
}

const toDateOnlyString = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const enumerateStayDates = (from, to) => {
  const start = new Date(from)
  const end = new Date(to)
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return []
  const dates = []
  const cursor = new Date(start)
  cursor.setUTCHours(0, 0, 0, 0)
  const limit = new Date(end)
  limit.setUTCHours(0, 0, 0, 0)
  while (cursor < limit) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

const CANCELLATION_POLICY_CODES = {
  FLEXIBLE: "FLEXIBLE",
  MODERATE: "MODERATE",
  FIRM: "FIRM",
  STRICT: "STRICT",
  NON_REFUNDABLE: "NON_REFUNDABLE",
}
const HOTEL_INVENTORY_TYPES = new Set(["WEBBEDS_HOTEL", "LOCAL_HOTEL"])

const normalizeCancellationPolicy = (value) => {
  if (!value) return null
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) return null
  if (normalized.includes("flex")) return CANCELLATION_POLICY_CODES.FLEXIBLE
  if (normalized.includes("moder")) return CANCELLATION_POLICY_CODES.MODERATE
  if (normalized.includes("firm") || normalized.includes("firme"))
    return CANCELLATION_POLICY_CODES.FIRM
  if (normalized.includes("strict") || normalized.includes("estrict"))
    return CANCELLATION_POLICY_CODES.STRICT
  if (
    normalized.includes("non") ||
    normalized.includes("no reembolsable") ||
    normalized.includes("no-reembolsable")
  )
    return CANCELLATION_POLICY_CODES.NON_REFUNDABLE
  if (Object.values(CANCELLATION_POLICY_CODES).includes(String(value).toUpperCase())) {
    return String(value).toUpperCase()
  }
  return null
}

const roundCurrency = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}

const trimText = (value, max = 500) => {
  if (value == null) return null
  const text = String(value).trim()
  if (!text) return null
  return text.length > max ? text.slice(0, max) : text
}

const stripHtml = (value) => {
  if (value == null) return null
  const text = String(value)
  if (!text.includes("<")) return text
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

const normalizeVoucherIdentifier = (value) => {
  const cleaned = trimText(stripHtml(value), 2000)
  if (!cleaned) return null
  const bookingRefMatch = cleaned.match(
    /booking\s*reference(?:\s*no)?[:\s]*([A-Z0-9-]+)/i,
  )
  if (bookingRefMatch?.[1]) return bookingRefMatch[1]
  const itineraryMatch = cleaned.match(
    /itinerary\s*number[:\s]*([A-Z0-9-]+)/i,
  )
  if (itineraryMatch?.[1]) return itineraryMatch[1]
  return cleaned
}

const COUNTRY_CACHE_TTL_MS = 10 * 60 * 1000
let countryCache = new Map()
let countryCacheLoadedAt = 0

const resolveCountryNameByCode = async (code) => {
  const normalized = code != null ? String(code).trim() : ""
  if (!normalized || !/^\d+$/.test(normalized)) return null
  const now = Date.now()
  if (now - countryCacheLoadedAt > COUNTRY_CACHE_TTL_MS) {
    countryCache = new Map()
    countryCacheLoadedAt = now
  }
  if (countryCache.has(normalized)) return countryCache.get(normalized)
  const row = await models.WebbedsCountry.findByPk(Number(normalized))
  const name = row?.name ?? null
  countryCache.set(normalized, name)
  return name
}

const sanitizeStringArray = (values, limit = 20, max = 120) => {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => trimText(value, max))
    .filter(Boolean)
    .slice(0, limit)
}

const isGenericPromotionLabel = (value) => {
  if (!value) return false
  const text = String(value).trim().toLowerCase()
  if (!text) return false
  if (/[0-9]/.test(text) || text.includes("%")) return false
  return text === "promotional rate" || text === "promotion" || text === "promotional"
}

const resolveSpecialLabels = (rate) => {
  const directSpecials = Array.isArray(rate?.specials) ? rate.specials : []
  const fromDirect = directSpecials
    .map((entry) => {
      if (!entry) return null
      if (typeof entry === "string") return entry
      return (
        entry?.label ??
        entry?.specialName ??
        entry?.name ??
        entry?.description ??
        entry?.notes ??
        entry?.type ??
        null
      )
    })
    .filter(Boolean)
    .filter((label) => !isGenericPromotionLabel(label))
  if (fromDirect.length) return fromDirect

  if (!Array.isArray(rate?.appliedSpecials)) return []
  return rate.appliedSpecials
    .map((entry) => {
      if (!entry) return null
      if (typeof entry === "string") return entry
      return (
        entry?.label ??
        entry?.specialName ??
        entry?.name ??
        entry?.description ??
        entry?.notes ??
        entry?.type ??
        null
      )
    })
    .filter(Boolean)
    .filter((label) => !isGenericPromotionLabel(label))
}

const sanitizeConfirmationSnapshot = (raw = {}) => {
  const bookingCodes = raw.bookingCodes || {}
  const hotel = raw.hotel || {}
  const room = raw.room || {}
  const rate = raw.rate || {}
  const policies = raw.policies || {}
  const traveler = raw.traveler || {}
  const stay = raw.stay || {}
  const totals = raw.totals || {}
  const payment = raw.payment || {}

  const cancellationRules = Array.isArray(policies.cancellationRules)
    ? policies.cancellationRules.slice(0, 10).map((rule) => ({
        from: trimText(rule?.from, 120),
        to: trimText(rule?.to, 120),
        charge: trimText(rule?.charge, 120),
      }))
    : []

  const propertyFees = Array.isArray(policies.propertyFees)
    ? policies.propertyFees.slice(0, 15).map((fee) => ({
        name: trimText(fee?.name, 120),
        description: trimText(fee?.description, 200),
        amount: fee?.amount ?? fee?.formatted ?? null,
        currency: trimText(fee?.currency, 10),
        includedInPrice: fee?.includedInPrice ?? fee?.includedinprice ?? null,
      }))
    : []

  return {
    bookingCodes: {
      voucherId: trimText(normalizeVoucherIdentifier(bookingCodes?.voucherId), 120),
      bookingReference: trimText(bookingCodes?.bookingReference, 120),
      itineraryNumber: trimText(bookingCodes?.itineraryNumber, 120),
      externalRef: trimText(bookingCodes?.externalRef, 120),
    },
    hotel: {
      id: trimText(hotel?.id, 80),
      name: trimText(hotel?.name, 200),
      address: trimText(hotel?.address, 300),
      phone: trimText(hotel?.phone, 80),
      city: trimText(hotel?.city, 120),
      country: trimText(hotel?.country, 120),
    },
    room: {
      name: trimText(room?.name, 200),
      roomTypeCode: trimText(room?.roomTypeCode, 80),
    },
    rate: {
      rateBasis: trimText(rate?.rateBasis, 200),
      mealPlan: Array.isArray(rate?.mealPlan)
        ? sanitizeStringArray(rate.mealPlan, 8, 120)
        : trimText(rate?.mealPlan, 200),
      specials: sanitizeStringArray(resolveSpecialLabels(rate), 10, 160),
      tariffNotes: trimText(rate?.tariffNotes, 4000),
      refundable: rate?.refundable ?? null,
      nonRefundable: rate?.nonRefundable ?? null,
      cancelRestricted: rate?.cancelRestricted ?? null,
      amendRestricted: rate?.amendRestricted ?? null,
      paymentMode: trimText(rate?.paymentMode, 120),
    },
    policies: {
      cancellationRules,
      taxes: policies?.taxes ?? null,
      fees: policies?.fees ?? null,
      propertyFees,
    },
    traveler: {
      leadGuestName: trimText(traveler?.leadGuestName, 200),
      email: trimText(traveler?.email, 200),
      phone: trimText(traveler?.phone, 80),
      nationality: trimText(traveler?.nationality, 120),
      residence: trimText(traveler?.residence, 120),
      salutation: trimText(traveler?.salutation, 80),
    },
    stay: {
      checkIn: trimText(stay?.checkIn, 40),
      checkOut: trimText(stay?.checkOut, 40),
      nights: stay?.nights ?? null,
      guests: {
        adults: stay?.guests?.adults ?? null,
        children: stay?.guests?.children ?? null,
        childrenAges: Array.isArray(stay?.guests?.childrenAges)
          ? stay.guests.childrenAges.slice(0, 6)
          : null,
      },
    },
    totals: {
      total: totals?.total ?? null,
      currency: trimText(totals?.currency, 10),
    },
    payment: {
      method: trimText(payment?.method, 80),
      label: trimText(payment?.label, 120),
    },
  }
}

const ensureArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const mergeSnapshotValues = (primary, fallback) => {
  if (!isPlainObject(primary) && !isPlainObject(fallback)) {
    if (Array.isArray(primary) || Array.isArray(fallback)) {
      const primaryArr = Array.isArray(primary) ? primary : []
      const fallbackArr = Array.isArray(fallback) ? fallback : []
      return primaryArr.length ? primaryArr : fallbackArr
    }
    if (primary === null || primary === undefined) return fallback
    if (typeof primary === "string" && !primary.trim()) return fallback
    return primary
  }

  const primaryObj = isPlainObject(primary) ? primary : {}
  const fallbackObj = isPlainObject(fallback) ? fallback : {}
  const keys = new Set([...Object.keys(fallbackObj), ...Object.keys(primaryObj)])
  const merged = {}
  keys.forEach((key) => {
    merged[key] = mergeSnapshotValues(primaryObj[key], fallbackObj[key])
  })
  return merged
}

const pickFirst = (...values) => {
  for (const value of values) {
    if (value == null) continue
    if (typeof value === "string" && !value.trim()) continue
    return value
  }
  return null
}

const normalizeCancellationRules = (rules) => {
  const entries = ensureArray(rules?.rule ?? rules)
  return entries
    .map((rule) => ({
      from:
        rule?.from ??
        rule?.fromDate ??
        rule?.from_date ??
        rule?.fromDateDetails ??
        rule?.fromDetails ??
        null,
      to:
        rule?.to ??
        rule?.toDate ??
        rule?.to_date ??
        rule?.toDateDetails ??
        rule?.toDetails ??
        null,
      charge:
        rule?.charge ??
        rule?.amount ??
        rule?.cancelCharge ??
        rule?.amendCharge ??
        rule?.price ??
        rule?.formatted ??
        null,
    }))
    .filter((rule) => rule.from || rule.to || rule.charge)
}

const resolveFlowForBooking = async ({ bookingCode, bookingRef }) => {
  const flowId =
    bookingRef?.flow?.id ??
    bookingRef?.flowId ??
    bookingRef?.flow_id ??
    bookingRef?.pricing_snapshot?.flowId ??
    bookingRef?.pricing_snapshot?.flow_id ??
    null
  if (flowId) {
    const direct = await models.BookingFlow.findByPk(flowId)
    if (direct) return direct
  }
  if (!bookingCode) return null
  return models.BookingFlow.findOne({
    where: {
      [Op.or]: [
        { itinerary_booking_code: String(bookingCode) },
        { final_booking_code: String(bookingCode) },
        { booking_reference_number: String(bookingCode) },
      ],
    },
    order: [["created_at", "DESC"]],
  })
}

const fetchWebbedsBookingDetails = async ({ bookingCode, requestId }) => {
  if (!bookingCode) return null
  try {
    const client = createWebbedsClient(getWebbedsConfig())
    const payload = buildGetBookingDetailsPayload({ bookingId: bookingCode })
    const { result } = await client.send("getbookingdetails", payload, {
      requestId,
    })
    return mapGetBookingDetailsResponse(result)
  } catch (error) {
    console.warn("[booking] getbookingdetails failed", {
      bookingCode,
      error: error?.message || error,
    })
    return null
  }
}

const resolvePaymentMethodLabel = (provider, existingLabel) => {
  if (existingLabel) return existingLabel
  const normalized = provider ? String(provider).toUpperCase() : ""
  if (normalized === "STRIPE") return "Credit or debit card"
  if (normalized === "PAYPAL") return "PayPal"
  if (normalized === "CARD_ON_FILE") return "Card on file"
  return normalized || null
}

const resolveHomePricingConfig = ({ pricing = {}, capacity = null }) => {
  const basePrice = Number.parseFloat(pricing.base_price ?? 0) * 1.1
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return { error: "Listing does not have a valid base price" }
  }

  const weekendPrice =
    pricing.weekend_price != null ? Number.parseFloat(pricing.weekend_price) * 1.1 : null
  const hasWeekendPrice = Number.isFinite(weekendPrice) && weekendPrice > 0
  const securityDeposit =
    pricing.security_deposit != null ? Number.parseFloat(pricing.security_deposit) : 0
  const extraGuestFee =
    pricing.extra_guest_fee != null ? Number.parseFloat(pricing.extra_guest_fee) : 0
  const extraGuestThreshold =
    pricing.extra_guest_threshold != null
      ? Number(pricing.extra_guest_threshold)
      : capacity
  const taxRate =
    (pricing.tax_rate != null && Number(pricing.tax_rate) > 0) ? Number.parseFloat(pricing.tax_rate) : 8
  const currencyCode = String(
    pricing.currency ?? process.env.DEFAULT_CURRENCY ?? "USD"
  )
    .trim()
    .toUpperCase()

  return {
    basePrice,
    weekendPrice,
    hasWeekendPrice,
    securityDeposit,
    extraGuestFee,
    extraGuestThreshold,
    taxRate,
    currencyCode,
  }
}

const computeHomePricingBreakdown = ({
  checkInDate,
  checkOutDate,
  nights,
  totalGuests,
  basePrice,
  weekendPrice,
  hasWeekendPrice,
  extraGuestFee,
  extraGuestThreshold,
  taxRate,
}) => {
  let baseSubtotal = 0
  const nightlyBreakdown = []
  let cursor = new Date(checkInDate)
  const endDate = new Date(checkOutDate)
  while (cursor < endDate) {
    const day = cursor.getUTCDay()
    const isWeekend = day === 5 || day === 6
    const useWeekendRate = isWeekend && hasWeekendPrice
    const nightlyRate = useWeekendRate ? weekendPrice : basePrice
    const roundedRate = roundCurrency(nightlyRate)
    nightlyBreakdown.push({
      date: cursor.toISOString().slice(0, 10),
      rate: roundedRate,
      weekend: isWeekend,
      reason: useWeekendRate ? "weekend" : "standard",
    })
    baseSubtotal += roundedRate
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  baseSubtotal = roundCurrency(baseSubtotal)

  let extraGuestSubtotal = 0
  if (extraGuestFee > 0 && extraGuestThreshold != null && totalGuests > extraGuestThreshold) {
    const extraGuests = totalGuests - extraGuestThreshold
    extraGuestSubtotal = roundCurrency(extraGuests * extraGuestFee * nights)
  }

  const subtotalBeforeTax = roundCurrency(baseSubtotal + extraGuestSubtotal)
  const taxAmount = taxRate > 0 ? roundCurrency((subtotalBeforeTax * taxRate) / 100) : 0
  const totalBeforeDiscount = roundCurrency(subtotalBeforeTax + taxAmount)

  return {
    nightlyBreakdown,
    baseSubtotal,
    extraGuestSubtotal,
    subtotalBeforeTax,
    taxAmount,
    totalBeforeDiscount,
  }
}

const buildHomeCancellationQuote = ({
  policyRaw,
  checkIn,
  bookedAt,
  nights,
  total,
  now = new Date(),
}) => {
  const policyCode = normalizeCancellationPolicy(policyRaw) || CANCELLATION_POLICY_CODES.FLEXIBLE
  if (policyCode === CANCELLATION_POLICY_CODES.NON_REFUNDABLE) {
    return {
      policyCode,
      refundPercent: 0,
      refundAmount: 0,
      cancellable: false,
      reason: "This reservation is non-refundable.",
      timeline: null,
    }
  }

  const checkInDate = checkIn ? new Date(`${String(checkIn).slice(0, 10)}T00:00:00Z`) : null
  const bookedDate =
    bookedAt instanceof Date
      ? bookedAt
      : bookedAt
        ? new Date(bookedAt)
        : null

  if (!checkInDate || Number.isNaN(checkInDate.valueOf())) {
    return {
      policyCode,
      refundPercent: 0,
      refundAmount: 0,
      cancellable: true,
      reason: "Missing check-in date for cancellation policy.",
      timeline: null,
    }
  }

  const hoursUntilCheckIn = (checkInDate - now) / 36e5
  const daysUntilCheckIn = hoursUntilCheckIn / 24
  const hoursSinceBooking = bookedDate ? (now - bookedDate) / 36e5 : null

  let refundPercent = 0
  const nightsCount = Number(nights) || 0
  if (nightsCount >= 28) {
    const refundAmount = roundCurrency((Number(total) || 0) * (daysUntilCheckIn >= 30 ? 1 : 0))
    return {
      policyCode,
      refundPercent: daysUntilCheckIn >= 30 ? 100 : 0,
      refundAmount,
      cancellable: true,
      reason: null,
      timeline: {
        hoursUntilCheckIn,
        daysUntilCheckIn,
        hoursSinceBooking,
        nights: nightsCount || null,
      },
    }
  }
  if (policyCode === CANCELLATION_POLICY_CODES.FLEXIBLE) {
    refundPercent = hoursUntilCheckIn >= 24 ? 100 : 0
  } else if (policyCode === CANCELLATION_POLICY_CODES.MODERATE) {
    refundPercent = daysUntilCheckIn >= 5 ? 100 : 0
  } else if (policyCode === CANCELLATION_POLICY_CODES.FIRM) {
    refundPercent = daysUntilCheckIn >= 30 ? 100 : daysUntilCheckIn >= 7 ? 50 : 0
  } else if (policyCode === CANCELLATION_POLICY_CODES.STRICT) {
    const within48h = hoursSinceBooking != null ? hoursSinceBooking <= 48 : false
    if (within48h && daysUntilCheckIn >= 14) {
      refundPercent = 100
    } else {
      refundPercent = daysUntilCheckIn >= 7 ? 50 : 0
    }
  }

  const refundAmount = roundCurrency((Number(total) || 0) * (refundPercent / 100))
  return {
    policyCode,
    refundPercent,
    refundAmount,
    cancellable: true,
    reason: null,
    timeline: {
      hoursUntilCheckIn,
      daysUntilCheckIn,
      hoursSinceBooking,
      nights: Number(nights) || null,
    },
  }
}

let stripeClient = null
const getStripeClient = async () => {
  if (stripeClient) return stripeClient
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  const { default: Stripe } = await import("stripe")
  stripeClient = new Stripe(key, { apiVersion: "2022-11-15" })
  return stripeClient
}

// OTP + token helpers (stateless challenge)
const codeHash = (email, code) => {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error("JWT_SECRET is required for OTP hashing")
  return crypto
    .createHash("sha256")
    .update(`${String(email).trim().toLowerCase()}|${String(code)}|${secret}`)
    .digest("hex")
}

const BOOKING_MEMBER_ROLES = { OWNER: "OWNER", GUEST: "GUEST" }
const BOOKING_MEMBER_STATUSES = {
  INVITED: "INVITED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  REMOVED: "REMOVED",
}
const INVITE_TTL_DAYS = Number(process.env.BOOKING_INVITE_TTL_DAYS || 7)

const normalizeEmail = (value) => {
  if (!value) return null
  const normalized = String(value).trim().toLowerCase()
  return normalized || null
}

const normalizePhone = (value) => {
  if (!value) return null
  const normalized = String(value).trim()
  return normalized || null
}

const resolveClientUrl = () => {
  const candidates = [
    process.env.CLIENT_URL,
    process.env.WEBAPP_URL,
    process.env.FRONTEND_URL,
  ]
  const url = candidates.find((value) => value && String(value).trim().length > 0)
  if (!url) return "https://app.insiderbookings.com"
  return String(url).replace(/\/$/, "")
}

const resolveInviteBaseUrl = () => {
  const candidates = [
    process.env.BOOKING_INVITE_APP_URL,
    process.env.APP_DEEPLINK_URL,
    process.env.MOBILE_APP_URL,
    process.env.APP_URL,
  ]
  const url = candidates.find((value) => value && String(value).trim().length > 0)
  if (url) return String(url).replace(/\/$/, "")
  return "https://bookinggpt.app"
}

const buildBookingInviteUrl = (token) => {
  if (!token) return null
  const baseUrl = resolveInviteBaseUrl()
  return `${baseUrl}/booking-invite?token=${encodeURIComponent(token)}`
}

const mapBookingMember = (member) => {
  if (!member) return null
  return {
    id: member.id,
    userId: member.user_id ?? null,
    role: member.role ?? null,
    status: member.status ?? null,
    invitedEmail: member.invited_email ?? null,
    invitedPhone: member.invited_phone ?? null,
    invitedBy: member.invited_by ?? null,
    acceptedAt: member.accepted_at ?? null,
    user: member.user
      ? {
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
          phone: member.user.phone ?? null,
          avatarUrl: member.user.avatar_url ?? null,
        }
      : null,
  }
}

const ensureBookingOwnerMember = async ({ bookingId, ownerId, transaction }) => {
  if (!bookingId || !ownerId) return null
  const existing = await models.BookingUser.findOne({
    where: { stay_id: bookingId, user_id: ownerId },
    transaction,
  })
  if (existing) return existing
  return models.BookingUser.create(
    {
      stay_id: bookingId,
      user_id: ownerId,
      role: BOOKING_MEMBER_ROLES.OWNER,
      status: BOOKING_MEMBER_STATUSES.ACCEPTED,
      invited_by: ownerId,
      accepted_at: new Date(),
    },
    { transaction }
  )
}

/* ──────────────── Helper – flattener ──────────────────
   Recibe una fila de Booking (snake_case en DB) y la
   convierte al formato camelCase que usa el FE.       */
const toPlain = (value) => {
  if (!value) return null
  if (typeof value.toJSON === "function") {
    try {
      return value.toJSON()
    } catch {
      return value
    }
  }
  return value
}

const pickCoverImage = (media) => {
  if (!Array.isArray(media) || !media.length) return null
  const normalized = media.map(toPlain)
  const cover =
    normalized.find((item) => item?.is_cover) ??
    normalized.find((item) => Number(item?.order) === 0) ??
    normalized[0]
  return cover?.url ?? null
}

const buildHomePayload = (homeStay) => {
  const stayHome = toPlain(homeStay)
  if (!stayHome) return null
  const home = toPlain(stayHome.home ?? stayHome.Home ?? stayHome)
  if (!home) return null

  const address = toPlain(home.address) ?? {}
  const media = Array.isArray(home.media) ? home.media.map(toPlain) : []
  const pricing = toPlain(home.pricing) ?? {}

  const locationParts = [
    address.address_line1,
    address.city,
    address.state,
    address.country,
  ]
    .map((part) => (part ? String(part).trim() : null))
    .filter(Boolean)

  return {
    id: home.id,
    title: home.title ?? null,
    status: home.status ?? null,
    hostId: stayHome.host_id ?? home.host_id ?? null,
    maxGuests: home.max_guests ?? null,
    bedrooms: home.bedrooms ?? null,
    beds: home.beds ?? null,
    bathrooms: home.bathrooms != null ? Number(home.bathrooms) : null,
    propertyType: home.property_type ?? null,
    spaceType: home.space_type ?? null,
    address,
    locationText: locationParts.join(", "),
    coverImage: pickCoverImage(media),
    media,
    pricing: {
      currency: pricing.currency ?? null,
      basePrice:
        pricing.base_price != null ? Number.parseFloat(pricing.base_price) : null,
      weekendPrice:
        pricing.weekend_price != null
          ? Number.parseFloat(pricing.weekend_price)
          : null,
      cleaningFee:
        pricing.cleaning_fee != null
          ? Number.parseFloat(pricing.cleaning_fee)
          : null,
      securityDeposit:
        pricing.security_deposit != null
          ? Number.parseFloat(pricing.security_deposit)
          : null,
      taxRate:
        pricing.tax_rate != null ? Number.parseFloat(pricing.tax_rate) : null,
      extraGuestFee:
        pricing.extra_guest_fee != null
          ? Number.parseFloat(pricing.extra_guest_fee)
          : null,
      extraGuestThreshold:
        pricing.extra_guest_threshold != null
          ? Number(pricing.extra_guest_threshold)
          : null,
    },
  }
}

const hasAddressFields = (address) => {
  if (!address) return false
  return Object.values(address).some((value) => value != null && value !== "")
}

const buildLocationFromAddress = (address) => {
  if (!address) return null
  const parts = [
    address.address_line1,
    address.city,
    address.state,
    address.country,
  ]
    .map((part) => (part ? String(part).trim() : null))
    .filter(Boolean)
  return parts.length ? parts.join(", ") : null
}

const buildMediaFromUrls = (urls) => {
  if (!Array.isArray(urls)) return []
  return urls
    .map((url, index) => (url ? { url, is_cover: index === 0, order: index } : null))
    .filter(Boolean)
}

const applyHomeSnapshotFallback = (homePayload, inventorySnapshot) => {
  if (!homePayload && !inventorySnapshot) return null
  if (!inventorySnapshot) return homePayload

  const snapshot = toPlain(inventorySnapshot) ?? {}
  const snapshotHome = toPlain(snapshot.home ?? snapshot.home_snapshot) ?? null
  const snapshotHomeId =
    snapshotHome?.id ?? snapshot.homeId ?? snapshot.home_id ?? null
  const hasHomeSnapshot =
    Boolean(snapshotHome) ||
    snapshotHomeId != null ||
    snapshot?.propertyType ||
    snapshot?.spaceType ||
    snapshot?.coverImage ||
    Array.isArray(snapshot?.photos)

  if (!hasHomeSnapshot) return homePayload

  const base = homePayload ? { ...homePayload } : {}
  const snapshotAddress = toPlain(snapshotHome?.address ?? snapshot.address) ?? null
  const snapshotLocation = snapshotHome?.locationText ?? snapshot.location ?? null
  const snapshotMedia = Array.isArray(snapshotHome?.media)
    ? snapshotHome.media.map(toPlain)
    : null
  const snapshotPhotos = Array.isArray(snapshotHome?.photos)
    ? snapshotHome.photos
    : Array.isArray(snapshot?.photos)
      ? snapshot.photos
      : null
  const snapshotCover =
    snapshotHome?.coverImage ??
    snapshot.coverImage ??
    snapshot.image ??
    pickCoverImage(snapshotMedia) ??
    (Array.isArray(snapshotPhotos) && snapshotPhotos.length ? snapshotPhotos[0] : null)

  if (!base.id && snapshotHomeId != null) base.id = snapshotHomeId
  if (!base.title && (snapshotHome?.title || snapshot.title)) {
    base.title = snapshotHome?.title ?? snapshot.title ?? null
  }
  if (!base.coverImage && snapshotCover) base.coverImage = snapshotCover

  const hasMedia = Array.isArray(base.media) && base.media.length > 0
  if (!hasMedia) {
    if (snapshotMedia?.length) {
      base.media = snapshotMedia
    } else if (snapshotPhotos?.length) {
      base.media = buildMediaFromUrls(snapshotPhotos)
    }
  }

  if (!hasAddressFields(base.address) && snapshotAddress) {
    base.address = snapshotAddress
  }

  if (!base.locationText || !String(base.locationText).trim()) {
    const locationText =
      snapshotLocation ?? buildLocationFromAddress(snapshotAddress)
    if (locationText) base.locationText = locationText
  }

  if (!base.propertyType && (snapshotHome?.propertyType || snapshot.propertyType)) {
    base.propertyType = snapshotHome?.propertyType ?? snapshot.propertyType ?? null
  }
  if (!base.spaceType && (snapshotHome?.spaceType || snapshot.spaceType)) {
    base.spaceType = snapshotHome?.spaceType ?? snapshot.spaceType ?? null
  }

  if (base.maxGuests == null && snapshotHome?.stats?.maxGuests != null) {
    base.maxGuests = snapshotHome.stats.maxGuests
  }
  if (base.bedrooms == null && snapshotHome?.stats?.bedrooms != null) {
    base.bedrooms = snapshotHome.stats.bedrooms
  }
  if (base.beds == null && snapshotHome?.stats?.beds != null) {
    base.beds = snapshotHome.stats.beds
  }
  if (base.bathrooms == null && snapshotHome?.stats?.bathrooms != null) {
    base.bathrooms = snapshotHome.stats.bathrooms
  }

  return base
}

const mergeValues = (base, updates) => {
  if (!base && !updates) return null
  const result = base ? { ...base } : {}
  if (!updates) return Object.keys(result).length ? result : null
  Object.entries(updates).forEach(([key, value]) => {
    if (value == null || value === "") return
    result[key] = value
  })
  return Object.keys(result).length ? result : null
}

const mapStay = (row, source) => {
  const stayHotel = toPlain(row.hotelStay ?? row.StayHotel ?? row.stayHotel) ?? null
  const hotelFromStay = toPlain(stayHotel?.hotel) ?? null
  const webbedsHotelFromStay = toPlain(stayHotel?.webbedsHotel) ?? null
  const webbedsHotelPayload = webbedsHotelFromStay
    ? {
      id: webbedsHotelFromStay.hotel_id ?? webbedsHotelFromStay.id ?? null,
      name: webbedsHotelFromStay.name ?? null,
      city: webbedsHotelFromStay.city_name ?? null,
      country: webbedsHotelFromStay.country_name ?? null,
      rating: webbedsHotelFromStay.rating ?? null,
      address: webbedsHotelFromStay.address ?? null,
      location: null,
      image: null,
    }
    : null
  const roomFromStay = toPlain(stayHotel?.room) ?? toPlain(stayHotel?.room_snapshot) ?? null
  const inventorySnapshot = toPlain(row.inventory_snapshot ?? row.inventorySnapshot) ?? null
  const inventoryHotel = toPlain(inventorySnapshot?.hotel) ?? null
  const inventoryRoom = toPlain(inventorySnapshot?.room) ?? null
  const inventoryHotelFallback = inventorySnapshot
    ? {
      id: inventorySnapshot.hotelId ?? inventoryHotel?.id ?? null,
      name: inventorySnapshot.hotelName ?? inventoryHotel?.name ?? null,
      image:
        inventorySnapshot.hotelImage ??
        inventoryHotel?.image ??
        inventoryHotel?.coverImage ??
        null,
      city: inventorySnapshot.city ?? inventoryHotel?.city ?? null,
      country: inventorySnapshot.country ?? inventoryHotel?.country ?? null,
      rating: inventorySnapshot.rating ?? inventoryHotel?.rating ?? null,
      address: inventorySnapshot.address ?? inventoryHotel?.address ?? null,
      location: inventorySnapshot.location ?? null,
    }
    : null
  const inventoryRoomFallback = inventorySnapshot
    ? {
      name: inventorySnapshot.roomName ?? inventoryRoom?.name ?? null,
    }
    : null
  const hotel = toPlain(row.Hotel ?? row.hotel ?? hotelFromStay ?? webbedsHotelPayload) ?? null
  const room = toPlain(row.Room ?? row.room ?? roomFromStay) ?? null
  const stayHome = toPlain(row.homeStay ?? row.StayHome ?? row.stayHome) ?? null
  let homePayload = stayHome ? buildHomePayload(stayHome) : null
  homePayload = applyHomeSnapshotFallback(homePayload, inventorySnapshot)
  const cancellationPolicy =
    row.meta?.cancellationPolicy ??
    row.meta?.cancellation_policy ??
    stayHome?.house_rules_snapshot?.cancellation_policy ??
    stayHome?.house_rules_snapshot?.cancellationPolicy ??
    null

  let mergedHotel = mergeValues(inventoryHotelFallback, hotel)
  let mergedRoom = mergeValues(inventoryRoomFallback, room)

  const checkIn = row.check_in ?? row.checkIn ?? null
  const checkOut = row.check_out ?? row.checkOut ?? null
  const status = String(row.status ?? "").toLowerCase()
  const paymentStatus = String(row.payment_status ?? row.paymentStatus ?? "").toLowerCase()
  const nights = checkIn && checkOut ? diffDays(checkIn, checkOut) : null
  const inventoryType = row.inventory_type ?? row.inventoryType ?? (homePayload ? "HOME" : null)
  const isHomeStay =
    inventoryType === "HOME" ||
    row.source === "HOME" ||
    row.Source === "HOME" ||
    Boolean(homePayload)

  const location = isHomeStay
    ? homePayload?.locationText ?? null
    : mergedHotel
      ? `${mergedHotel?.city || mergedHotel?.location || ""}, ${mergedHotel?.country || ""}`.trim().replace(/, $/, "")
      : null

  const image = isHomeStay ? homePayload?.coverImage ?? null : mergedHotel?.image ?? null
  const listingName = isHomeStay ? homePayload?.title ?? null : mergedHotel?.name ?? null
  const referralCouponRaw =
    row.pricing_snapshot?.referralCoupon ??
    row.pricing_snapshot?.referral_coupon ??
    row.meta?.referralCoupon ??
    null
  const referralCoupon =
    referralCouponRaw && typeof referralCouponRaw === "object"
      ? {
        amount: Number(referralCouponRaw.amount ?? referralCouponRaw.discountAmount ?? 0),
        currency: referralCouponRaw.currency ?? row.currency ?? null,
        status: referralCouponRaw.status ?? null,
        walletId: referralCouponRaw.walletId ?? referralCouponRaw.wallet_id ?? null,
      }
      : null

  return {
    id: row.id,
    source,
    flowId:
      row.flow_id ??
      row.flowId ??
      row.flow?.id ??
      row.pricing_snapshot?.flowId ??
      row.pricing_snapshot?.flow_id ??
      null,
    bookingConfirmation: row.bookingConfirmation ?? row.external_ref ?? null,

    hotel_id: isHomeStay ? null : row.hotel_id ?? mergedHotel?.id ?? null,
    hotel_name: listingName,
    location,
    image,
    rating: isHomeStay ? null : mergedHotel?.rating ?? null,

    checkIn,
    checkOut,
    nights,
    bookedAt: row.booked_at ?? row.bookedAt ?? row.created_at ?? row.createdAt ?? null,

    status,
    paymentStatus,

    room_type: isHomeStay
      ? homePayload?.spaceType ?? "HOME"
      : row.room_type ?? mergedRoom?.name ?? mergedRoom?.room_type ?? null,
    room_number: isHomeStay
      ? null
      : row.room_number ?? mergedRoom?.room_number ?? mergedRoom?.roomNumber ?? null,

    guests: (row.adults ?? 0) + (row.children ?? 0),
    total: Number.parseFloat(row.gross_price ?? row.total ?? 0),
    referralCoupon,

    guestName: row.guest_name ?? row.guestName ?? null,
    guestLastName: row.guest_last_name ?? row.guestLastName ?? null,
    guestEmail: row.guest_email ?? row.guestEmail ?? null,
    guestPhone: row.guest_phone ?? row.guestPhone ?? null,

    hotel: isHomeStay ? null : mergedHotel,
    room: isHomeStay ? null : mergedRoom,
    home: homePayload,
    inventoryType,
    policies: cancellationPolicy
      ? { cancellation: cancellationPolicy, cancellation_policy: cancellationPolicy }
      : null,

    outside: Boolean(row.outside),
    active: row.active ?? true,
  }
}


const STAY_BASE_INCLUDE = [
  {
    model: models.StayHotel,
    as: "hotelStay",
    required: false,
    include: [
      {
        model: models.Hotel,
        as: "hotel",
        attributes: ["id", "name", "city", "country", "image", "rating"],
      },
      {
        model: models.Room,
        as: "room",
        attributes: ["id", "name", "room_number", "image", "price", "beds", "capacity"],
      },
      {
        model: models.WebbedsHotel,
        as: "webbedsHotel",
        attributes: [
          "hotel_id",
          "name",
          "city_name",
          "country_name",
          "rating",
          "address",
          "images",
        ],
      },
    ],
  },
  {
    model: models.OutsideMeta,
    as: "outsideMeta",
    required: false,
  },
  {
    model: models.StayHome,
    as: "homeStay",
    required: false,
    include: [
      {
        model: models.Home,
        as: "home",
        attributes: [
          "id",
          "title",
          "status",
          "max_guests",
          "bedrooms",
          "beds",
          "bathrooms",
          "property_type",
          "space_type",
          "host_id",
        ],
        include: [
          {
            model: models.HomeAddress,
            as: "address",
            attributes: ["address_line1", "city", "state", "country"],
          },
          {
            model: models.HomeMedia,
            as: "media",
            attributes: ["id", "url", "is_cover", "order"],
            separate: true,
            limit: 6,
            order: [
              ["is_cover", "DESC"],
              ["order", "ASC"],
              ["id", "ASC"],
            ],
          },
          {
            model: models.HomePricing,
            as: "pricing",
            attributes: [
              "currency",
              "base_price",
              "weekend_price",
              "cleaning_fee",
              "security_deposit",
              "tax_rate",
              "extra_guest_fee",
              "extra_guest_threshold",
            ],
          },
        ],
      },
    ],
  },
]


/* ────────────────────────────────────────────────────────────
   POST  /api/bookings
   (flujo legacy "insider/outside"; no TGX)
────────────────────────────────────────────────────────────── */
export const createBooking = async (req, res) => {
  try {
    const userId = Number(req.user?.id ?? 0)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    const referral = {
      influencerId: Number(req.user?.referredByInfluencerId) || null,
      code: req.user?.referredByCode || null,
    }

    const {
      hotelId,
      hotel_id,
      roomId,
      room_id,
      checkIn,
      checkOut,
      adults = 1,
      children = 0,
      rooms = 1,
      guestName,
      guestEmail,
      guestPhone,
      discountCode,
      outside = false,
      currency: currencyInput,
      paymentProvider,
      meta: metaPayload = {},
    } = req.body || {}

    const hotelIdValue = Number(hotel_id ?? hotelId ?? 0) || null
    const roomIdValue = Number(room_id ?? roomId ?? 0) || null

    if (!hotelIdValue || !roomIdValue || !checkIn || !checkOut)
      return res.status(400).json({ error: "Missing required fields" })

    const normalizedRooms = Number(rooms ?? 1) || 1
    if (normalizedRooms < 1)
      return res.status(400).json({ error: "Rooms must be at least 1" })

    const adultsCount = Number(adults ?? 0) || 0
    const childrenCount = Number(children ?? 0) || 0
    const totalGuests = adultsCount + childrenCount
    if (totalGuests <= 0)
      return res.status(400).json({ error: "A booking must include at least one guest" })

    const checkInDate = parseDateOnly(checkIn)
    const checkOutDate = parseDateOnly(checkOut)
    if (!checkInDate || !checkOutDate)
      return res.status(400).json({ error: "Invalid dates" })
    if (checkOutDate <= checkInDate)
      return res.status(400).json({ error: "Check-out must be after check-in" })

    const normalizedCheckIn = toDateOnlyString(checkInDate)
    const normalizedCheckOut = toDateOnlyString(checkOutDate)

    const nights = diffDays(normalizedCheckIn, normalizedCheckOut)
    if (nights <= 0)
      return res.status(400).json({ error: "Stay must be at least one night" })

    const room = await models.Room.findByPk(roomIdValue, {
      include: [
        {
          model: models.Hotel,
          attributes: ["id", "name", "city", "country", "image", "rating", "currency"],
        },
      ],
    })
    if (!room || room.hotel_id !== hotelIdValue)
      return res.status(404).json({ error: "Room not found" })

    const hotel = room.Hotel ?? null
    const nightlyRate = Number.parseFloat(room.price)
    if (!Number.isFinite(nightlyRate))
      return res.status(400).json({ error: "Room price is invalid" })

    const totalBeforeDiscount = nightlyRate * nights * normalizedRooms

    let discountRecord = null
    let discountPct = 0
    if (discountCode) {
      discountRecord = await models.DiscountCode.findOne({
        where: { code: discountCode },
        include: ["staff"],
      })
      if (!discountRecord)
        return res.status(404).json({ error: "Invalid discount code" })

      const startsAt = discountRecord.starts_at ?? discountRecord.startsAt
      const endsAt = discountRecord.ends_at ?? discountRecord.endsAt
      const maxUses = discountRecord.max_uses ?? discountRecord.maxUses
      const timesUsed = discountRecord.times_used ?? discountRecord.timesUsed ?? 0
      if (startsAt && new Date(startsAt) > new Date(checkIn))
        return res.status(400).json({ error: "Discount code not active yet" })
      if (endsAt && new Date(endsAt) < new Date())
        return res.status(400).json({ error: "Discount code expired" })
      if (Number.isFinite(maxUses) && Number.isFinite(timesUsed) && timesUsed >= maxUses)
        return res.status(400).json({ error: "Discount code usage limit reached" })

      discountPct = Number(discountRecord.percentage) || 0
    }

    const discountAmount = discountPct ? (totalBeforeDiscount * discountPct) / 100 : 0
    let referralCouponPlan = null
    let referralDiscountAmount = 0
    let referralCouponApplied = false
    let referralFirstBookingPlan = null
    let referralFirstBookingDiscount = 0

    const user = req.user || {}
    const guestNameFinal = (guestName ?? user.name ?? "").trim()
    const guestEmailFinal = (guestEmail ?? user.email ?? "").trim().toLowerCase()
    if (!guestNameFinal || !guestEmailFinal)
      return res.status(400).json({ error: "Guest name and email are required" })
    const guestPhoneFinal = (guestPhone ?? user.phone ?? "").trim() || null

    const currencyCode = String(
      currencyInput ?? hotel?.currency ?? process.env.DEFAULT_CURRENCY ?? "USD"
    )
      .trim()
      .toUpperCase()

    const paymentProviderValue = String(paymentProvider ?? "NONE").trim().toUpperCase()
    const source = outside ? "OUTSIDE" : "PARTNER"

    const booking = await sequelize.transaction(async (tx) => {
      if (discountRecord) {
        await discountRecord.increment("times_used", { by: 1, transaction: tx })
      }

      if (referral.influencerId && !discountRecord) {
        referralFirstBookingPlan = await planReferralFirstBookingDiscount({
          influencerUserId: referral.influencerId,
          userId,
          totalBeforeDiscount,
          currency: currencyCode,
          transaction: tx,
        })
        referralFirstBookingDiscount = referralFirstBookingPlan?.apply
          ? referralFirstBookingPlan.discountAmount
          : 0
      }

      if (!discountRecord && referral.influencerId && !referralFirstBookingPlan?.apply) {
        referralCouponPlan = await planReferralCoupon({
          influencerUserId: referral.influencerId,
          userId,
          totalBeforeDiscount,
          currency: currencyCode,
          transaction: tx,
        })
        referralDiscountAmount = referralCouponPlan?.apply ? referralCouponPlan.discountAmount : 0
        referralCouponApplied = referralCouponPlan?.apply || false
      }

      const totalDiscountAmount = discountAmount + referralDiscountAmount + referralFirstBookingDiscount
      const grossTotal = Number.parseFloat(Math.max(0, totalBeforeDiscount - totalDiscountAmount).toFixed(2))

      const stay = await models.Booking.create(
        {
          user_id: userId,
          hotel_id: hotelIdValue,
          room_id: roomIdValue,
          discount_code_id: discountRecord ? discountRecord.id : null,
          source,
          check_in: normalizedCheckIn,
          check_out: normalizedCheckOut,
          nights,
          adults: adultsCount,
          children: childrenCount,
          influencer_user_id: referral.influencerId,
          guest_name: guestNameFinal,
          guest_email: guestEmailFinal,
          guest_phone: guestPhoneFinal,
          gross_price: grossTotal,
          net_cost: null,
          currency: currencyCode,
          payment_provider: paymentProviderValue,
          payment_status: "UNPAID",
          status: "PENDING",
          outside,
          active: true,
          inventory_type: "LOCAL_HOTEL",
          inventory_id: String(roomIdValue),
          booked_at: new Date(),
          pricing_snapshot: {
            nightlyRate,
            rooms: normalizedRooms,
            nights,
            discountPct,
            discountAmount: Number.parseFloat(discountAmount.toFixed(2)),
            referralFirstBooking: referralFirstBookingPlan?.apply
              ? {
                pct: referralFirstBookingPlan.pct,
                amount: Number.parseFloat(referralFirstBookingDiscount.toFixed(2)),
                currency: referralFirstBookingPlan.currency,
                applied: true,
              }
              : null,
            referralCoupon: referralCouponPlan?.apply
              ? {
                amount: Number.parseFloat(referralDiscountAmount.toFixed(2)),
                currency: referralCouponPlan.currency,
                walletId: referralCouponPlan.wallet?.id ?? null,
                status: "pending",
                applied: referralCouponApplied,
              }
              : null,
            referralDiscountAmount: Number.parseFloat(referralDiscountAmount.toFixed(2)),
            totalBeforeDiscount: Number.parseFloat(totalBeforeDiscount.toFixed(2)),
            totalDiscountAmount: Number.parseFloat(totalDiscountAmount.toFixed(2)),
            total: grossTotal,
          },
          guest_snapshot: {
            name: guestNameFinal,
            email: guestEmailFinal,
            phone: guestPhoneFinal,
            adults: adultsCount,
            children: childrenCount,
          },
          meta: {
            ...(typeof metaPayload === "object" && metaPayload ? metaPayload : {}),
            ...(cancellationPolicy ? { cancellationPolicy } : {}),
            ...(referral.influencerId
              ? {
                referral: {
                  influencerUserId: referral.influencerId,
                  code: referral.code || null,
                },
              }
              : {}),
            ...(referralCouponPlan?.apply
              ? {
                referralCoupon: {
                  amount: Number.parseFloat(referralDiscountAmount.toFixed(2)),
                  currency: referralCouponPlan.currency,
                  walletId: referralCouponPlan.wallet?.id ?? null,
                  status: "pending",
                },
              }
              : {}),
            ...(referralFirstBookingPlan?.apply
              ? {
                referralFirstBooking: {
                  pct: referralFirstBookingPlan.pct,
                  amount: Number.parseFloat(referralFirstBookingDiscount.toFixed(2)),
                  currency: referralFirstBookingPlan.currency,
                  applied: true,
                },
              }
              : {}),
            source,
            hotel: hotel
              ? { id: hotel.id, name: hotel.name, city: hotel.city, country: hotel.country }
              : { id: hotelIdValue },
            roomsRequested: normalizedRooms,
          },
        },
        { transaction: tx, returning: ["id", "booking_ref"] }
      )

      await models.StayHotel.create(
        {
          stay_id: stay.id,
          hotel_id: hotelIdValue,
          room_id: roomIdValue,
          room_name: room.name ?? null,
          room_snapshot: {
            id: room.id,
            name: room.name,
            price: nightlyRate,
            beds: room.beds,
            capacity: room.capacity,
          },
        },
        { transaction: tx }
      )

      if (discountRecord?.staff_id && models.Staff && models.Commission) {
        const staff = await models.Staff.findByPk(discountRecord.staff_id, {
          include: [{ model: models.StaffRole, as: "role" }],
          transaction: tx,
        })
        const commissionPct = Number(staff?.role?.commissionPct) || 0
        if (commissionPct > 0) {
          const commissionAmount = Number.parseFloat(((grossTotal * commissionPct) / 100).toFixed(2))
          await models.Commission.create(
            {
              booking_id: stay.id,
              staff_id: discountRecord.staff_id,
              amount: commissionAmount,
            },
            { transaction: tx }
          )
        }
      }

      if (discountRecord) {
        await discountRecord.update({ booking_id: stay.id }, { transaction: tx })
      }

      if (referralCouponPlan?.apply) {
        await createPendingRedemption({ plan: referralCouponPlan, stayId: stay.id, transaction: tx })
      }

      return stay
    })

    const fresh = await models.Booking.findByPk(booking.id, {
      include: STAY_BASE_INCLUDE,
    })

    const payload = mapStay(fresh.toJSON(), outside ? "outside" : "insider");

    // Emit real-time activity to Admin Dashboard
    emitAdminActivity({
      type: 'booking',
      user: { name: payload.guestName || 'Guest' },
      action: 'requested a new booking at',
      location: payload.hotel_name || payload.location || 'somewhere',
      amount: payload.total,
      status: 'PENDING',
      timestamp: new Date()
    });

    return res.status(201).json(payload)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}


export const quoteHomeBooking = async (req, res) => {
  try {
    const userId = Number(req.user?.id ?? 0)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    const referral = {
      influencerId: Number(req.user?.referredByInfluencerId) || null,
      code: req.user?.referredByCode || null,
    }

    const {
      homeId,
      checkIn,
      checkOut,
      adults = 1,
      children = 0,
      infants = 0,
    } = req.body || {}

    const homeIdValue = Number(homeId ?? 0) || null
    if (!homeIdValue || !checkIn || !checkOut)
      return res.status(400).json({ error: "Missing required fields" })

    const checkInDate = parseDateOnly(checkIn)
    const checkOutDate = parseDateOnly(checkOut)
    if (!checkInDate || !checkOutDate)
      return res.status(400).json({ error: "Invalid dates" })
    if (checkOutDate <= checkInDate)
      return res.status(400).json({ error: "Check-out must be after check-in" })

    const normalizedCheckIn = toDateOnlyString(checkInDate)
    const normalizedCheckOut = toDateOnlyString(checkOutDate)

    const nights = diffDays(normalizedCheckIn, normalizedCheckOut)
    if (nights <= 0)
      return res.status(400).json({ error: "Stay must be at least one night" })

    const adultsCount = Number(adults ?? 0) || 0
    const childrenCount = Number(children ?? 0) || 0
    const totalGuests = adultsCount + childrenCount
    if (totalGuests <= 0)
      return res.status(400).json({ error: "A booking must include at least one guest" })

    const home = await models.Home.findOne({
      where: { id: homeIdValue, status: "PUBLISHED" },
      include: [{ model: models.HomePricing, as: "pricing" }],
    })
    if (!home) return res.status(404).json({ error: "Listing not found or unavailable" })

    const pricing = home.pricing ?? {}
    const cancellationPolicy = home.policies?.cancellation_policy ?? null
    const minStay = Number(pricing.minimum_stay ?? 0) || 1
    const maxStay = Number(pricing.maximum_stay ?? 0) || null
    if (nights < minStay)
      return res.status(400).json({ error: `Minimum stay is ${minStay} nights` })
    if (maxStay && nights > maxStay)
      return res.status(400).json({ error: `Maximum stay is ${maxStay} nights` })

    const pricingConfig = resolveHomePricingConfig({
      pricing,
      capacity: Number(home.max_guests ?? 0) || null,
    })
    if (pricingConfig.error) return res.status(400).json({ error: pricingConfig.error })

    const {
      basePrice,
      weekendPrice,
      hasWeekendPrice,
      securityDeposit,
      extraGuestFee,
      extraGuestThreshold,
      taxRate,
      currencyCode,
    } = pricingConfig

    const pricingBreakdown = computeHomePricingBreakdown({
      checkInDate,
      checkOutDate,
      nights,
      totalGuests,
      basePrice,
      weekendPrice,
      hasWeekendPrice,
      extraGuestFee,
      extraGuestThreshold,
      taxRate,
    })

    const {
      nightlyBreakdown,
      baseSubtotal,
      extraGuestSubtotal,
      subtotalBeforeTax,
      taxAmount,
      totalBeforeDiscount,
    } = pricingBreakdown

    let referralCouponPlan = null
    let referralDiscountAmount = 0
    let referralFirstBookingPlan = null
    let referralFirstBookingDiscount = 0
    if (referral.influencerId) {
      referralFirstBookingPlan = await planReferralFirstBookingDiscount({
        influencerUserId: referral.influencerId,
        userId,
        totalBeforeDiscount,
        currency: (pricing.currency ?? process.env.DEFAULT_CURRENCY ?? "USD").toUpperCase(),
      })
      referralFirstBookingDiscount = referralFirstBookingPlan?.apply
        ? referralFirstBookingPlan.discountAmount
        : 0

      if (!referralFirstBookingPlan?.apply) {
        referralCouponPlan = await planReferralCoupon({
          influencerUserId: referral.influencerId,
          userId,
          totalBeforeDiscount,
          currency: (pricing.currency ?? process.env.DEFAULT_CURRENCY ?? "USD").toUpperCase(),
        })
        referralDiscountAmount = referralCouponPlan?.apply ? referralCouponPlan.discountAmount : 0
      }
    }

    const total = roundCurrency(
      Math.max(0, totalBeforeDiscount - referralDiscountAmount - referralFirstBookingDiscount)
    )

    const nightlyGroups = new Map()
    nightlyBreakdown.forEach((night) => {
      const key = `${night.reason}-${night.rate}`
      const existing = nightlyGroups.get(key)
      if (existing) {
        existing.count += 1
        existing.amount += night.rate
      } else {
        nightlyGroups.set(key, {
          rate: night.rate,
          reason: night.reason,
          count: 1,
          amount: night.rate,
        })
      }
    })

    const items = Array.from(nightlyGroups.values()).map((group, index) => {
      const reasonLabel = group.reason === "weekend" ? "weekend night" : "standard night"
      const amount = Number.parseFloat(group.amount.toFixed(2))
      return {
        key: `nights-${index}`,
        label: `${currencyCode} ${group.rate.toFixed(2)} x ${group.count} ${reasonLabel}${group.count === 1 ? "" : "s"}`,
        amount,
      }
    })
    if (extraGuestSubtotal > 0) {
      items.push({
        key: "extraGuests",
        label: "Extra guests",
        amount: roundCurrency(extraGuestSubtotal),
      })
    }
    if (taxAmount > 0) {
      items.push({
        key: "tax",
        label: `Taxes (${taxRate.toFixed(2)}%)`,
        amount: taxAmount,
      })
    }
    if (referralCouponPlan?.apply && referralDiscountAmount > 0) {
      items.push({
        key: "referralCoupon",
        label: "Referral discount",
        amount: -roundCurrency(referralDiscountAmount),
      })
    }
    if (referralFirstBookingPlan?.apply && referralFirstBookingDiscount > 0) {
      items.push({
        key: "referralFirstBooking",
        label: "Referral first booking discount",
        amount: -roundCurrency(referralFirstBookingDiscount),
      })
    }

    const referralCoupon =
      referralCouponPlan?.apply
        ? {
          amount: Number.parseFloat(referralDiscountAmount.toFixed(2)),
          currency: referralCouponPlan.currency,
          walletId: referralCouponPlan.wallet?.id ?? null,
          status: "pending",
          applied: true,
        }
        : null

    return res.json({
      quote: {
        homeId: home.id,
        checkIn: normalizedCheckIn,
        checkOut: normalizedCheckOut,
        nights,
        guests: { adults: adultsCount, children: childrenCount, infants },
        currency: currencyCode,
        items,
        subtotalBeforeTax,
        taxRate,
        taxAmount,
        totalBeforeDiscount,
        discountAmount: roundCurrency(referralDiscountAmount + referralFirstBookingDiscount),
        total,
        referralCoupon,
        referralFirstBooking: referralFirstBookingPlan?.apply
          ? {
            pct: referralFirstBookingPlan.pct,
            amount: Number.parseFloat(referralFirstBookingDiscount.toFixed(2)),
            currency: referralFirstBookingPlan.currency,
            applied: true,
          }
          : null,
        pricingSnapshot: {
          nightlyBreakdown,
          baseSubtotal: roundCurrency(baseSubtotal),
          extraGuestSubtotal: roundCurrency(extraGuestSubtotal),
          cleaningFee: null,
          taxRate,
          taxAmount,
          securityDeposit,
          subtotalBeforeTax: roundCurrency(subtotalBeforeTax),
          totalBeforeDiscount,
          referralFirstBooking: referralFirstBookingPlan?.apply
            ? {
              pct: referralFirstBookingPlan.pct,
              amount: Number.parseFloat(referralFirstBookingDiscount.toFixed(2)),
              currency: referralFirstBookingPlan.currency,
              applied: true,
            }
            : null,
          referralCoupon,
          referralDiscountAmount: roundCurrency(referralDiscountAmount),
          total,
          currency: currencyCode,
        },
      },
    })
  } catch (err) {
    console.error("quoteHomeBooking:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const createHomeBooking = async (req, res) => {
  try {
    const userId = Number(req.user?.id ?? 0)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    const referral = {
      influencerId: Number(req.user?.referredByInfluencerId) || null,
      code: req.user?.referredByCode || null,
    }
    console.log("[HOME BOOKING] createHomeBooking payload", {
      userId,
      referral,
      body: {
        homeId: req.body?.homeId,
        checkIn: req.body?.checkIn,
        checkOut: req.body?.checkOut,
        adults: req.body?.adults,
        children: req.body?.children,
        infants: req.body?.infants,
        hasReferralCode: Boolean(req.body?.referralCode || req.body?.referrerCode),
      },
    })

    const {
      homeId,
      checkIn,
      checkOut,
      adults = 1,
      children = 0,
      infants = 0,
      guestName,
      guestEmail,
      guestPhone,
      meta: metaPayload = {},
    } = req.body || {}

    const homeIdValue = Number(homeId ?? 0) || null
    if (!homeIdValue || !checkIn || !checkOut)
      return res.status(400).json({ error: "Missing required fields" })

    const checkInDate = parseDateOnly(checkIn)
    const checkOutDate = parseDateOnly(checkOut)
    if (!checkInDate || !checkOutDate)
      return res.status(400).json({ error: "Invalid dates" })
    if (checkOutDate <= checkInDate)
      return res.status(400).json({ error: "Check-out must be after check-in" })

    const normalizedCheckIn = toDateOnlyString(checkInDate)
    const normalizedCheckOut = toDateOnlyString(checkOutDate)

    const nights = diffDays(normalizedCheckIn, normalizedCheckOut)
    if (nights <= 0)
      return res.status(400).json({ error: "Stay must be at least one night" })

    const adultsCount = Number(adults ?? 0) || 0
    const childrenCount = Number(children ?? 0) || 0
    const infantsCount = Number(infants ?? 0) || 0
    const totalGuests = adultsCount + childrenCount
    if (totalGuests <= 0)
      return res.status(400).json({ error: "A booking must include at least one guest" })

    const home = await models.Home.findOne({
      where: { id: homeIdValue, status: "PUBLISHED" },
      include: [
        { model: models.HomePricing, as: "pricing" },
        { model: models.HomeAddress, as: "address" },
        { model: models.HomePolicies, as: "policies" },
        {
          model: models.HomeMedia,
          as: "media",
          attributes: ["id", "url", "is_cover", "order"],
          separate: true,
          limit: 20,
          order: [
            ["is_cover", "DESC"],
            ["order", "ASC"],
            ["id", "ASC"],
          ],
        },
      ],
    })
    if (!home) return res.status(404).json({ error: "Listing not found or unavailable" })

    const capacity = Number(home.max_guests ?? 0) || null
    if (capacity && totalGuests > capacity)
      return res.status(400).json({ error: "Guest count exceeds listing capacity" })

    const pricing = home.pricing ?? {}
    const cancellationPolicy = home.policies?.cancellation_policy ?? null
    const minStay = Number(pricing.minimum_stay ?? 0) || 1
    const maxStay = Number(pricing.maximum_stay ?? 0) || null
    if (nights < minStay)
      return res.status(400).json({ error: `Minimum stay is ${minStay} nights` })
    if (maxStay && nights > maxStay)
      return res.status(400).json({ error: `Maximum stay is ${maxStay} nights` })

    const pricingConfig = resolveHomePricingConfig({ pricing, capacity })
    if (pricingConfig.error) return res.status(400).json({ error: pricingConfig.error })

    const {
      basePrice,
      weekendPrice,
      hasWeekendPrice,
      securityDeposit,
      extraGuestFee,
      extraGuestThreshold,
      taxRate,
      currencyCode,
    } = pricingConfig

    const pricingBreakdown = computeHomePricingBreakdown({
      checkInDate,
      checkOutDate,
      nights,
      totalGuests,
      basePrice,
      weekendPrice,
      hasWeekendPrice,
      extraGuestFee,
      extraGuestThreshold,
      taxRate,
    })

    const {
      nightlyBreakdown,
      baseSubtotal,
      extraGuestSubtotal,
      subtotalBeforeTax,
      taxAmount,
      totalBeforeDiscount,
    } = pricingBreakdown

    const stayDates = enumerateStayDates(normalizedCheckIn, normalizedCheckOut)
    let referralCouponPlan = null
    let referralDiscountAmount = 0
    let referralCouponApplied = false
    let referralFirstBookingPlan = null
    let referralFirstBookingDiscount = 0

    const user = req.user || {}
    const guestNameFinal = (guestName ?? user.name ?? "").trim()
    const guestEmailFinal = (guestEmail ?? user.email ?? "").trim().toLowerCase()
    if (!guestNameFinal || !guestEmailFinal)
      return res.status(400).json({ error: "Guest name and email are required" })
    const guestPhoneFinal = (guestPhone ?? user.phone ?? "").trim() || null

    const stay = await sequelize.transaction(async (tx) => {
      await models.Home.findByPk(homeIdValue, { transaction: tx, lock: tx.LOCK.UPDATE })

      const calendarEntries = await models.HomeCalendar.findAll({
        where: {
          home_id: homeIdValue,
          date: { [Op.gte]: normalizedCheckIn, [Op.lt]: normalizedCheckOut },
        },
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      })
      const blockedEntry = calendarEntries.find(
        (entry) => entry.status && entry.status.toUpperCase() !== "AVAILABLE"
      )
      if (blockedEntry) {
        const err = new Error("Selected dates are not available")
        err.status = 409
        throw err
      }

      const overlappingStay = await models.Stay.findOne({
        where: {
          inventory_type: "HOME",
          status: { [Op.in]: ["PENDING", "CONFIRMED"] },
          check_in: { [Op.lt]: normalizedCheckOut },
          check_out: { [Op.gt]: normalizedCheckIn },
        },
        include: [
          { model: models.StayHome, as: "homeStay", required: true, where: { home_id: homeIdValue } },
        ],
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      })
      if (overlappingStay) {
        const err = new Error("Selected dates already reserved")
        err.status = 409
        throw err
      }

      if (referral.influencerId) {
        console.log("[HOME BOOKING] referral lookup", {
          influencerId: referral.influencerId,
          referralCode: referral.code || null,
          totalBeforeDiscount,
          currency: currencyCode,
        })

        referralFirstBookingPlan = await planReferralFirstBookingDiscount({
          influencerUserId: referral.influencerId,
          userId,
          totalBeforeDiscount,
          currency: currencyCode,
          transaction: tx,
        })
        referralFirstBookingDiscount = referralFirstBookingPlan?.apply
          ? referralFirstBookingPlan.discountAmount
          : 0

        if (!referralFirstBookingPlan?.apply) {
          referralCouponPlan = await planReferralCoupon({
            influencerUserId: referral.influencerId,
            userId,
            totalBeforeDiscount,
            currency: currencyCode,
            transaction: tx,
          })
          console.log("[HOME BOOKING] referral coupon plan", {
            apply: referralCouponPlan?.apply || false,
            discountAmount: referralCouponPlan?.discountAmount || 0,
            walletId: referralCouponPlan?.wallet?.id || null,
            walletAvailable: referralCouponPlan?.wallet?.available ?? null,
            reason: referralCouponPlan?.reason || null,
          })
          referralDiscountAmount = referralCouponPlan?.apply ? referralCouponPlan.discountAmount : 0
          referralCouponApplied = referralCouponPlan?.apply || false
        }
      }
      const grossTotal = roundCurrency(
        Math.max(0, totalBeforeDiscount - referralDiscountAmount - referralFirstBookingDiscount)
      )

        const created = await models.Booking.create(
          {
            user_id: userId,
          source: "HOME",
          inventory_type: "HOME",
          inventory_id: String(homeIdValue),
          check_in: normalizedCheckIn,
          check_out: normalizedCheckOut,
          nights,
          adults: adultsCount,
          children: childrenCount,
          influencer_user_id: referral.influencerId,
          guest_name: guestNameFinal,
          guest_email: guestEmailFinal,
          guest_phone: guestPhoneFinal,
          gross_price: grossTotal,
          net_cost: null,
          currency: currencyCode,
          payment_provider: "NONE",
          payment_status: "UNPAID",
          status: "PENDING",
          outside: false,
          active: true,
          booked_at: new Date(),
          pricing_snapshot: {
            nightlyBreakdown,
            baseSubtotal: roundCurrency(baseSubtotal),
            extraGuestSubtotal: roundCurrency(extraGuestSubtotal),
            cleaningFee: null,
            taxRate,
            taxAmount,
            securityDeposit,
            subtotalBeforeTax: roundCurrency(subtotalBeforeTax),
            totalBeforeDiscount: roundCurrency(totalBeforeDiscount),
            referralFirstBooking: referralFirstBookingPlan?.apply
              ? {
                pct: referralFirstBookingPlan.pct,
                amount: Number.parseFloat(referralFirstBookingDiscount.toFixed(2)),
                currency: referralFirstBookingPlan.currency,
                applied: true,
              }
              : null,
            referralCoupon: referralCouponPlan?.apply
              ? {
                amount: Number.parseFloat(referralDiscountAmount.toFixed(2)),
                currency: referralCouponPlan.currency,
                walletId: referralCouponPlan.wallet?.id ?? null,
                status: "pending",
                applied: referralCouponApplied,
              }
              : null,
            referralDiscountAmount: roundCurrency(referralDiscountAmount),
            total: grossTotal,
            currency: currencyCode,
          },
          guest_snapshot: {
            name: guestNameFinal,
            email: guestEmailFinal,
            phone: guestPhoneFinal,
            adults: adultsCount,
            children: childrenCount,
            infants: infantsCount,
          },
          meta: {
            ...(typeof metaPayload === "object" && metaPayload ? metaPayload : {}),
            ...(referral.influencerId
              ? {
                referral: {
                  influencerUserId: referral.influencerId,
                  code: referral.code || null,
                },
              }
              : {}),
            ...(referralCouponPlan?.apply
              ? {
                referralCoupon: {
                  amount: Number.parseFloat(referralDiscountAmount.toFixed(2)),
                  currency: referralCouponPlan.currency,
                  walletId: referralCouponPlan.wallet?.id ?? null,
                  status: "pending",
                  applied: referralCouponApplied,
                },
              }
              : {}),
            ...(referralFirstBookingPlan?.apply
              ? {
                referralFirstBooking: {
                  pct: referralFirstBookingPlan.pct,
                  amount: Number.parseFloat(referralFirstBookingDiscount.toFixed(2)),
                  currency: referralFirstBookingPlan.currency,
                  applied: true,
                },
              }
              : {}),
            source: "HOME",
            home: { id: home.id, title: home.title, hostId: home.host_id },
          },
        },
        {
          transaction: tx,
          returning: ["id", "booking_ref"],
          fields: [
            "user_id",
            "source",
            "inventory_type",
            "inventory_id",
            "check_in",
            "check_out",
            "nights",
            "adults",
            "children",
            "influencer_user_id",
            "guest_name",
            "guest_email",
            "guest_phone",
            "gross_price",
            "net_cost",
            "currency",
            "payment_provider",
            "payment_status",
            "status",
            "outside",
            "active",
            "booked_at",
            "pricing_snapshot",
            "guest_snapshot",
            "meta",
            ],
          }
        )

        await ensureBookingOwnerMember({
          bookingId: created.id,
          ownerId: userId,
          transaction: tx,
        })

        await models.StayHome.create(
          {
          stay_id: created.id,
          home_id: home.id,
          host_id: home.host_id,
          cleaning_fee: null,
          security_deposit: securityDeposit || null,
          house_rules_snapshot: cancellationPolicy
            ? { cancellation_policy: cancellationPolicy }
            : null,
          fees_snapshot: {
            extraGuestFee: extraGuestFee || null,
            extraGuestThreshold,
            weekendPrice: weekendPrice != null ? Number.parseFloat(weekendPrice.toFixed(2)) : null,
          },
        },
        { transaction: tx }
      )

      if (referralCouponPlan?.apply) {
        await createPendingRedemption({ plan: referralCouponPlan, stayId: created.id, transaction: tx })
      }

      console.log("[HOME BOOKING] created stay", {
        id: created.id,
        gross_price: created.gross_price,
        referralCouponApplied,
        referralDiscountAmount,
        pricing_snapshot: created.pricing_snapshot,
      })

      for (const date of stayDates) {
        await models.HomeCalendar.upsert(
          {
            home_id: homeIdValue,
            date,
            status: "RESERVED",
            currency: currencyCode,
            source: "PLATFORM",
            note: `BOOKING:${created.id}`,
          },
          { transaction: tx }
        )
      }

      return created
    })

    const fresh = await models.Booking.findByPk(stay.id, {
      include: STAY_BASE_INCLUDE,
    })

    const bookingView = mapStay(fresh.toJSON(), "home")
    const responsePayload = {
      ...bookingView,
      pricingSnapshot: fresh.pricing_snapshot ?? null,
      referralCoupon:
        fresh.pricing_snapshot?.referralCoupon ??
        fresh.pricing_snapshot?.referral_coupon ??
        fresh.meta?.referralCoupon ??
        fresh.meta?.referral_coupon ??
        null,
    }
    console.log("[HOME BOOKING] response payload", {
      id: bookingView.id,
      total: bookingView.total,
      referralCoupon: responsePayload.referralCoupon,
      pricingSnapshot: responsePayload.pricingSnapshot,
    })

    const coverImageUrl = pickCoverImage(home.media ?? [])
    triggerBookingAutoPrompts({
      trigger: PROMPT_TRIGGERS.BOOKING_CREATED,
      guestUserId: userId,
      hostUserId: home.host_id,
      homeId: home.id,
      reserveId: bookingView.id,
      checkIn: normalizedCheckIn,
      checkOut: normalizedCheckOut,
      homeSnapshotName: home.title,
      homeSnapshotImage: coverImageUrl,
    }).catch((err) => console.error("booking auto prompt dispatch error:", err))

    const homeAddress = [
      home.address?.address_line1,
      home.address?.city,
      home.address?.state,
      home.address?.country,
    ]
      .filter(Boolean)
      .join(", ") || null

    // FIRE AND FORGET: Generate Trip Intelligence (Trip Hub)
    generateAndSaveTripIntelligence({
      stayId: bookingView.id,
      tripContext: {
        stayName: home.title,
        locationText: homeAddress,
        location: { city: home.address?.city, country: home.address?.country },
        amenities: home.amenities || [],
        houseRules: home.house_rules || "",
        inventoryType: "HOME"
      },
      lang: "es" // Default or detect from user
    }).catch(err => console.error("[HOME BOOKING] Intelligence generation failed", err));

    try {
      const pricingSnapshot =
        fresh.pricing_snapshot && typeof fresh.pricing_snapshot === "object" ? fresh.pricing_snapshot : {}
      const nightsCount = Number(fresh.nights ?? nights) || null
      const baseSubtotalValue = Number(pricingSnapshot.baseSubtotal ?? 0)
      const ratePerNight = nightsCount ? Number((baseSubtotalValue / nightsCount).toFixed(2)) : null
      const taxAmountValue = Number(pricingSnapshot.taxAmount ?? 0)
      const bookingCode = fresh.booking_ref || fresh.id
      await sendBookingEmail(
        {
          id: fresh.id,
          bookingCode,
          guestName: fresh.guest_name,
          guests: { adults: fresh.adults, children: fresh.children },
          roomsCount: 1,
          checkIn: fresh.check_in,
          checkOut: fresh.check_out,
          hotel: {
            name: home.title || "Home",
            address: homeAddress,
            city: home.address?.city || null,
            country: home.address?.country || null,
          },
          currency: fresh.currency || currencyCode,
          totals: {
            total: Number(fresh.gross_price ?? totalBeforeDiscount),
            nights: nightsCount || undefined,
            ratePerNight: ratePerNight || undefined,
            taxes: taxAmountValue || undefined,
          },
        },
        fresh.guest_email,
        {
          attachCertificate: false,
          branding: {
            footerIntroText: "We look forward to hosting you. Your booking details are below.",
          },
        }
      )

      const hostUser = await models.User.findByPk(home.host_id, {
        attributes: ["id", "name", "email", "phone"],
      })
      if (hostUser?.email) {
        await sendHomeHostBookingEmail({
          toEmail: hostUser.email,
          hostName: hostUser.name,
          bookingCode,
          homeName: home.title,
          homeAddress,
          checkIn: fresh.check_in,
          checkOut: fresh.check_out,
          nights: nightsCount,
          guests: {
            adults: fresh.adults,
            children: fresh.children,
            infants: infantsCount,
          },
          total: Number(fresh.gross_price ?? totalBeforeDiscount),
          currency: fresh.currency || currencyCode,
          guestName: fresh.guest_name,
          guestEmail: fresh.guest_email,
          guestPhone: fresh.guest_phone,
          securityDeposit: pricingSnapshot.securityDeposit ?? null,
        })
      }
    } catch (mailErr) {
      console.warn("createHomeBooking: email dispatch failed:", mailErr?.message || mailErr)
    }

    return res.status(201).json({
      booking: responsePayload,
      payment: {
        required: true,
        provider: "stripe",
        amount: Number(fresh.gross_price ?? totalBeforeDiscount),
        currency: fresh.currency || currencyCode,
      },
    })
  } catch (err) {
    console.error("createHomeBooking:", err)
    const status = err?.status || err?.statusCode
    if (status) return res.status(status).json({ error: err.message || "Request failed" })
    if (err?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ error: "Selected dates already reserved" })
    }
    return res.status(500).json({ error: "Server error" })
  }
}

export const getBookingsUnified = async (req, res) => {
  try {
    const { latest, status, includeCancelled, limit = 50, offset = 0 } = req.query
    const inventoryQuery = typeof req.query.inventory === "string"
      ? req.query.inventory.trim().toUpperCase()
      : null

    const userId = req.user.id
    const includeCancelledFlag = String(includeCancelled || "").toLowerCase() === "true"

    // 1. Buscar usuario
    const user = await models.User.findByPk(userId)
    if (!user) return res.status(404).json({ error: "User not found" })
    const email = user.email

    // 2. Traer bookings preferentemente por user_id; como transiciÃ³n,
    //    incluir tambiÃ©n huÃ©rfanas donde guest_email coincide y user_id es NULL
      const inventoryFilter =
        inventoryQuery === "HOME"
          ? { inventory_type: "HOME" }
          : inventoryQuery === "HOTEL"
            ? { inventory_type: { [Op.ne]: "HOME" } }
            : {}

      const memberRows = await models.BookingUser.findAll({
        where: {
          user_id: userId,
          status: BOOKING_MEMBER_STATUSES.ACCEPTED,
        },
        attributes: ["stay_id"],
      })
      const memberStayIds = memberRows.map((row) => row.stay_id).filter(Boolean)

      const rows = await models.Booking.findAll({
        where: {
          ...(!includeCancelledFlag && !status
            ? { status: { [Op.ne]: "CANCELLED" } }
            : {}),
          ...(status && { status }),
          ...inventoryFilter,
          [Op.or]: [
            { user_id: userId },
            { user_id: null, guest_email: email },
            ...(memberStayIds.length ? [{ id: { [Op.in]: memberStayIds } }] : []),
          ],
        },
      include: STAY_BASE_INCLUDE,
      order: [["check_in", "DESC"]],
      limit: latest ? 1 : Number(limit),
      offset: latest ? 0 : Number(offset)
    })

    // 3. Mapear y unificar
    const merged = rows
      .map(r => {
        const obj = r.toJSON()
        const channel =
          obj.inventory_type === "HOME" || obj.source === "HOME"
            ? "home"
            : obj.source === "OUTSIDE"
              ? "outside"
              : obj.source === "VAULT"
                ? "vault"
                : "insider"
        return mapStay(obj, channel)
      })
      .sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn))

    // 4. Devolver
    return res.json(latest ? merged[0] ?? null : merged)
  } catch (err) {
    console.error("getBookingsUnified:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const getLatestStayForUser = (req, res) => {
  req.query.latest = "true"
  return getBookingsUnified(req, res)
}

export const getHomeBookingsForUser = (req, res) => {
  req.query.inventory = "home"
  return getBookingsUnified(req, res)
}

/* ---------------------------------------------------------------
   GET  /api/bookings/lookup?email=...&ref=...
   PÃºblico: permite recuperar UNA reserva si coincide el email del
   huÃ©sped y una referencia segura (id/booking_ref/external_ref).
   Evita listados amplios por email en claro.
---------------------------------------------------------------- */
export const lookupBookingPublic = async (req, res) => {
  try {
    const { email, ref } = req.query
    if (!email || !ref)
      return res.status(400).json({ error: "Missing email or ref" })

    // Construir OR por referencia
    const isNumeric = /^\d+$/.test(String(ref))
    const whereRef = {
      [Op.or]: [
        ...(isNumeric ? [{ id: Number(ref) }] : []),
        { booking_ref: ref },
        { external_ref: ref },
      ],
    }

    const row = await models.Booking.findOne({
      where: { guest_email: email, ...whereRef },
      include: STAY_BASE_INCLUDE,
    })

    if (!row) return res.status(404).json({ error: "Booking not found" })

    const obj = row.toJSON()
    const channel =
      obj.inventory_type === "HOME" || obj.source === "HOME"
        ? "home"
        : obj.source === "OUTSIDE"
          ? "outside"
          : obj.source === "VAULT"
            ? "vault"
            : "insider"
    return res.json(mapStay(obj, channel))
  } catch (err) {
    console.error("lookupBookingPublic:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   POST /api/bookings/guest/start { email }
   EnvÃ­a un cÃ³digo de 6 dÃ­gitos y devuelve un challengeToken.
---------------------------------------------------------------- */
export const startGuestAccess = async (req, res) => {
  try {
    const { email } = req.body || {}
    if (!email) return res.status(400).json({ error: "Email is required" })
    const normalized = String(email).trim().toLowerCase()

    const code = (Math.floor(Math.random() * 900000) + 100000).toString()
    const hash = codeHash(normalized, code)

    const challengeToken = jwt.sign(
      { kind: "guest_challenge", email: normalized, codeHash: hash },
      process.env.JWT_SECRET,
      { expiresIn: "10m" },
    )

    // send email
    const brand = process.env.BRAND_NAME || "InsiderBookings"
    await sendMail({
      to: normalized,
      subject: `${brand} verification code`,
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your verification code is <b>${code}</b>.<br/>It expires in 10 minutes.</p>`,
    })

    return res.json({ challengeToken, sent: true })
  } catch (err) {
    console.error("startGuestAccess:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   POST /api/bookings/guest/verify { challengeToken, code }
   Devuelve un guest token (Bearer) de corta duraciÃ³n.
---------------------------------------------------------------- */
export const verifyGuestAccess = async (req, res) => {
  try {
    const { challengeToken, code } = req.body || {}
    if (!challengeToken || !code) return res.status(400).json({ error: "Missing fields" })

    let payload
    try {
      payload = jwt.verify(challengeToken, process.env.JWT_SECRET)
    } catch (e) {
      return res.status(401).json({ error: "Invalid or expired challenge" })
    }
    if (payload.kind !== "guest_challenge") return res.status(400).json({ error: "Invalid challenge" })

    const normalized = String(payload.email).trim().toLowerCase()
    const valid = codeHash(normalized, String(code)) === payload.codeHash
    if (!valid) return res.status(401).json({ error: "Invalid code" })

    const guestToken = jwt.sign(
      { kind: "guest", email: normalized, scope: ["bookings:read:guest"] },
      process.env.JWT_SECRET,
      { expiresIn: "24h" },
    )

    return res.json({ token: guestToken })
  } catch (err) {
    console.error("verifyGuestAccess:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   GET /api/bookings/guest (?latest=true)
   Listado mÃ­nimo para invitados con guest token.
---------------------------------------------------------------- */
export const listGuestBookings = async (req, res) => {
  try {
    const { latest, includeCancelled } = req.query
    const email = req.guest?.email
    if (!email) return res.status(401).json({ error: "Unauthorized" })

    const rows = await models.Booking.findAll({
      where: {
        guest_email: email,
        ...(String(includeCancelled || "").toLowerCase() === "true"
          ? {}
          : { status: { [Op.ne]: "CANCELLED" } }),
      },
      order: [["check_in", "DESC"]],
      limit: latest ? 1 : 50,
      include: STAY_BASE_INCLUDE,
    })
    const result = rows.map((r) => {
      const obj = r.toJSON()
      const channel =
        obj.inventory_type === "HOME" || obj.source === "HOME"
          ? "home"
          : obj.source === "OUTSIDE"
            ? "outside"
            : obj.source === "VAULT"
              ? "vault"
              : "insider"
      return mapStay(obj, channel)
    })
    return res.json(latest ? result[0] ?? null : result)
  } catch (err) {
    console.error("listGuestBookings:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   POST /api/bookings/link { guestToken }
   Autenticado: enlaza reservas huÃ©rfanas del email del invitado a user_id.
---------------------------------------------------------------- */
export const linkGuestBookingsToUser = async (req, res) => {
  try {
    const { guestToken } = req.body || {}
    if (!guestToken) return res.status(400).json({ error: "Missing guestToken" })
    let payload
    try { payload = jwt.verify(guestToken, process.env.JWT_SECRET) } catch (e) { return res.status(401).json({ error: "Invalid guest token" }) }
    if (payload.kind !== "guest") return res.status(400).json({ error: "Invalid token kind" })

    const email = String(payload.email).trim().toLowerCase()
    const today = new Date().toISOString().slice(0, 10)
    const [count] = await models.Booking.update(
      { user_id: req.user.id },
      {
        where: {
          user_id: null,
          guest_email: email,
          check_out: { [Op.gte]: today }, // solo futuras o en curso
        }
      }
    )
    return res.json({ linked: count })
  } catch (err) {
    console.error("linkGuestBookingsToUser:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   GET  /api/bookings/legacy/me           (sÃ³lo insider)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const getBookingsForUser = async (req, res) => {
  try {
    const { status, includeCancelled, limit = 50, offset = 0 } = req.query
    const where = {
      user_id: req.user.id,
      outside: false,
      ...(status && { status }),
      ...(!status && String(includeCancelled || "").toLowerCase() !== "true"
        ? { status: { [Op.ne]: "CANCELLED" } }
        : {}),
    }

    const rows = await models.Booking.findAll({
      where,
      include: [
        {
          model: models.Hotel,
          attributes: ["id", "name", "location", "image", "address", "city", "country", "rating"],
        },
        {
          model: models.Room,
          attributes: ["id", "name", "image", "price", "beds", "capacity"],
        },
        {
          model: models.DiscountCode,
          attributes: ["id", "code", "percentage"],
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: Number(limit),
      offset: Number(offset),
    })

    const result = rows.map(r => ({
      id: r.id,
      hotelName: r.Hotel.name,
      location: `${r.Hotel.city || r.Hotel.location}, ${r.Hotel.country || ""}`.trim().replace(/,$/, ""),
      checkIn: r.check_in,
      checkOut: r.check_out,
      guests: r.adults + r.children,
      adults: r.adults,
      children: r.children,
      status: String(r.status).toLowerCase(),
      paymentStatus: String(r.payment_status).toLowerCase(),
      total: Number.parseFloat(r.gross_price ?? 0),
      nights: diffDays(r.check_in, r.check_out),
      rating: r.Hotel.rating,
      image: r.Hotel.image || r.Room.image,
      roomName: r.Room.name,
      roomPrice: Number.parseFloat(r.Room.price),
      beds: r.Room.beds,
      capacity: r.Room.capacity,
      guestName: r.guest_name,
      guestEmail: r.guest_email,
      guestPhone: r.guest_phone,
      discountCode: r.DiscountCode ? { code: r.DiscountCode.code, percentage: r.DiscountCode.percentage } : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))

    return res.json(result)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   GET  /api/bookings/staff/me
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const getBookingsForStaff = async (req, res) => {
  try {
    const staffId = req.user.id
    const rows = await models.Booking.findAll({
      include: [
        { model: models.DiscountCode, where: { staff_id: staffId } },
        { model: models.Hotel, attributes: ["name"] },
        { model: models.Room, attributes: ["name"] },
      ],
    })
    return res.json(rows)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   GET  /api/bookings/:id       (insider & outside)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params
    const userId = Number(req.user?.id)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    const role = Number(req.user?.role)
    const isStaff = role === 1 || role === 100

    const booking = await models.Booking.findByPk(id, {
      include: [
        { model: models.User, attributes: ["id", "name", "email"], required: false },
        ...STAY_BASE_INCLUDE,
        {
          model: models.BookingUser,
          as: "members",
          required: false,
          include: [
            {
              model: models.User,
              as: "user",
              attributes: ["id", "name", "email", "phone", "avatar_url"],
              required: false,
            },
          ],
        },
        {
          model: models.AddOn,
          through: {
            attributes: [
              "id",
              "add_on_option_id",
              "quantity",
              "unit_price",
              "payment_status",
              "status",
            ],
          },
          include: [
            { model: models.AddOnOption, attributes: ["id", "name", "price"], required: false },
          ],
        },
        { model: models.DiscountCode, attributes: ["id", "code", "percentage"], required: false },
      ],
    })

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" })
    }

    const isOwner = Number(booking.user_id) === userId
    const isMember = Array.isArray(booking.members)
      ? booking.members.some(
          (member) =>
            Number(member.user_id) === userId &&
            String(member.status || "").toUpperCase() === BOOKING_MEMBER_STATUSES.ACCEPTED
        )
      : false
    const isHost = Number(booking.homeStay?.host_id) === userId
    if (!isOwner && !isHost && !isStaff && !isMember) {
      return res.status(403).json({ error: "Forbidden" })
    }

    const addons = booking.AddOns.map((addon) => {
      const pivot = addon.BookingAddOn
      const option = addon.AddOnOptions?.find((o) => o.id === pivot.add_on_option_id) || null

      return {
        bookingAddOnId: pivot.id,
        addOnId: addon.id,
        addOnName: addon.name,
        addOnSlug: addon.slug,
        quantity: pivot.quantity,
        unitPrice: Number(pivot.unit_price),
        paymentStatus: pivot.payment_status,
        status: pivot.status,
        optionId: option?.id ?? null,
        optionName: option?.name ?? null,
        optionPrice: option?.price ?? null,
      }
    })

    const obj = booking.toJSON()
    const channel =
      obj.inventory_type === "HOME" || obj.source === "HOME"
        ? "home"
        : obj.source === "OUTSIDE"
          ? "outside"
          : obj.source === "VAULT"
            ? "vault"
            : "insider"
    const stayView = mapStay(obj, channel)

    const meta = booking.source === "OUTSIDE" ? booking.outsideMeta : null

    return res.json({
      id: stayView.id,
      externalRef: booking.external_ref,
      user: booking.User ?? null,
      hotel: stayView.hotel,
      home: stayView.home,
      room: stayView.room,
      checkIn: stayView.checkIn,
      checkOut: stayView.checkOut,
      nights: stayView.nights,
      adults: booking.adults,
      children: booking.children,
      guestName: stayView.guestName,
      guestEmail: stayView.guestEmail,
      guestPhone: stayView.guestPhone,
      grossPrice: stayView.total,
      netCost: Number(booking.net_cost ?? 0),
      currency: booking.currency,
      status: stayView.status,
      paymentStatus: stayView.paymentStatus,
      discountCode: booking.DiscountCode ?? null,
      meta,
      addons,
      source: booking.source,
      inventoryType: stayView.inventoryType,
      pricingSnapshot: booking.pricing_snapshot ?? null,
      guestSnapshot: booking.guest_snapshot ?? null,
      members: Array.isArray(booking.members) ? booking.members.map(mapBookingMember) : [],
    })
  } catch (err) {
    console.error("getBookingById:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const saveHotelConfirmationSnapshot = async (req, res) => {
  try {
    const { id } = req.params
    const userId = Number(req.user?.id)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    if (!id) return res.status(400).json({ error: "Missing booking id" })

    const booking = await models.Booking.findByPk(id, { include: STAY_BASE_INCLUDE })
    if (!booking) return res.status(404).json({ error: "Booking not found" })

    const role = Number(req.user?.role)
    const isStaff = role === 1 || role === 100
    if (!isStaff && Number(booking.user_id) !== userId) {
      return res.status(403).json({ error: "Forbidden" })
    }

    const inventoryType = String(booking.inventory_type || "").toUpperCase()
    if (inventoryType === "HOME") {
      return res.status(400).json({ error: "Confirmation snapshot is only for hotel bookings" })
    }

    const bookingCode = booking.external_ref ? String(booking.external_ref).trim() : null
    const bookingObj = booking.toJSON()
    const channel =
      bookingObj.inventory_type === "HOME" || bookingObj.source === "HOME"
        ? "home"
        : bookingObj.source === "OUTSIDE"
          ? "outside"
          : bookingObj.source === "VAULT"
            ? "vault"
            : "insider"
    const stayView = mapStay(bookingObj, channel)

    const flow = await resolveFlowForBooking({ bookingCode, bookingRef: bookingObj })
    const selectedOffer = flow?.selected_offer ?? null
    const flowSnapshot =
      flow?.pricing_snapshot_confirmed ??
      flow?.pricing_snapshot_preauth ??
      flow?.pricing_snapshot_priced ??
      null
    const flowContext = flow?.search_context ?? {}

    const existingSnapshot =
      booking.pricing_snapshot?.confirmationSnapshot ??
      booking.pricing_snapshot?.confirmation_snapshot ??
      null

    let webbedsDetails = null
    if (
      bookingCode &&
      String(booking.source || "").toUpperCase() === "PARTNER" &&
      HOTEL_INVENTORY_TYPES.has(String(booking.inventory_type || "").toUpperCase())
    ) {
      const requestId =
        req?.headers?.["x-request-id"] ||
        req?.headers?.["x-correlation-id"] ||
        `confirm-${booking.id}`
      webbedsDetails = await fetchWebbedsBookingDetails({
        bookingCode,
        requestId,
      })
    }

    const cancellationRules = normalizeCancellationRules(
      webbedsDetails?.product?.policies?.cancellation ??
      flowSnapshot?.cancellationRules ??
      selectedOffer?.cancellationRules ??
      existingSnapshot?.policies?.cancellationRules ??
      null,
    )

    const propertyFees = ensureArray(
      webbedsDetails?.product?.totals?.propertyFees ??
      selectedOffer?.propertyFees ??
      existingSnapshot?.policies?.propertyFees ??
      [],
    )

    const taxes = pickFirst(
      webbedsDetails?.product?.totals?.tax,
      flowSnapshot?.totalTaxes,
      selectedOffer?.totalTaxes,
      existingSnapshot?.policies?.taxes,
      booking.taxes_total,
      booking.pricing_snapshot?.taxAmount,
      booking.pricing_snapshot?.taxes,
      null,
    )

    const fees = pickFirst(
      webbedsDetails?.product?.totals?.fee,
      flowSnapshot?.totalFee,
      selectedOffer?.totalFee,
      existingSnapshot?.policies?.fees,
      booking.fees_total,
      booking.pricing_snapshot?.feeAmount,
      booking.pricing_snapshot?.fees,
      null,
    )

    const totalNumeric = Number(booking.gross_price ?? booking.pricing_snapshot?.total ?? null)
    const total = Number.isFinite(totalNumeric)
      ? totalNumeric
      : booking.pricing_snapshot?.total ?? existingSnapshot?.totals?.total ?? null
    const currency = pickFirst(
      booking.currency,
      flowSnapshot?.currency,
      booking.pricing_snapshot?.currency,
      webbedsDetails?.product?.service?.currency,
      existingSnapshot?.totals?.currency,
      null,
    )

    const childrenAges = []
    let flowAdults = 0
    let flowChildren = 0
    ensureArray(flowContext.rooms).forEach((room) => {
      const adultsValue = Number(room?.adults ?? room?.adult ?? 0)
      if (Number.isFinite(adultsValue)) {
        flowAdults += adultsValue
      }
      const ages = room?.children ?? room?.childrenAges ?? room?.kids ?? []
      if (Array.isArray(ages)) {
        ages.forEach((age) => {
          if (age == null || age === "") return
          childrenAges.push(age)
        })
        flowChildren += ages.length
      } else {
        const childrenCount = Number(ages)
        if (Number.isFinite(childrenCount)) {
          flowChildren += childrenCount
        }
      }
    })

    const adultsValue = Number(booking.adults)
    const adults = Number.isFinite(adultsValue)
      ? adultsValue
      : flowAdults > 0
        ? flowAdults
        : existingSnapshot?.stay?.guests?.adults ?? null
    const childrenValue = Number(booking.children)
    const children = Number.isFinite(childrenValue)
      ? childrenValue
      : flowChildren > 0
        ? flowChildren
        : existingSnapshot?.stay?.guests?.children ?? null

    const nightsValue = booking.nights ?? stayView?.nights
    const resolvedNights =
      nightsValue ?? (booking.check_in && booking.check_out
        ? diffDays(booking.check_in, booking.check_out)
        : null)

    const nationalityCode = pickFirst(
      flowContext.passengerNationality,
      existingSnapshot?.traveler?.nationality,
    )
    const residenceCode = pickFirst(
      flowContext.passengerCountryOfResidence,
      existingSnapshot?.traveler?.residence,
    )
    const nationalityName = await resolveCountryNameByCode(nationalityCode)
    const residenceName = await resolveCountryNameByCode(residenceCode)

    const snapshot = {
      bookingCodes: {
        externalRef: pickFirst(booking.external_ref),
        itineraryNumber: pickFirst(
          flow?.itinerary_booking_code,
          booking.external_ref,
        ),
        bookingReference: pickFirst(
          flow?.booking_reference_number,
          flowSnapshot?.bookingReferenceNumber,
          booking.pricing_snapshot?.bookingReferenceNumber,
          webbedsDetails?.product?.bookingReference,
          booking.external_ref,
        ),
        voucherId: pickFirst(
          webbedsDetails?.product?.supplierConfirmation,
          flowSnapshot?.voucher,
        ),
      },
      hotel: {
        id: pickFirst(
          stayView?.hotel?.id,
          booking.inventory_id,
          existingSnapshot?.hotel?.id,
        ),
        name: pickFirst(
          stayView?.hotel?.name,
          booking.meta?.hotelName,
          existingSnapshot?.hotel?.name,
        ),
        address: pickFirst(
          stayView?.hotel?.address,
          booking.meta?.location,
          existingSnapshot?.hotel?.address,
        ),
        phone: pickFirst(
          stayView?.hotel?.phone,
          existingSnapshot?.hotel?.phone,
        ),
        city: pickFirst(
          stayView?.hotel?.city,
          existingSnapshot?.hotel?.city,
        ),
        country: pickFirst(
          stayView?.hotel?.country,
          existingSnapshot?.hotel?.country,
        ),
      },
      room: {
        name: pickFirst(
          stayView?.room?.name,
          booking.meta?.roomName,
          selectedOffer?.roomName,
          existingSnapshot?.room?.name,
        ),
        roomTypeCode: pickFirst(
          flow?.selected_offer?.roomTypeCode,
          webbedsDetails?.product?.room?.code,
          existingSnapshot?.room?.roomTypeCode,
        ),
      },
      rate: {
        rateBasis: pickFirst(
          webbedsDetails?.product?.room?.rateBasis,
          selectedOffer?.rateBasisName,
          flowSnapshot?.rateBasis,
          selectedOffer?.rateBasisId,
          existingSnapshot?.rate?.rateBasis,
          flow?.selected_offer?.rateBasisId,
        ),
        mealPlan: pickFirst(
          selectedOffer?.mealPlan,
          existingSnapshot?.rate?.mealPlan,
        ),
        specials: pickFirst(
          Array.isArray(selectedOffer?.specials) ? selectedOffer.specials : null,
          existingSnapshot?.rate?.specials,
        ),
        tariffNotes: pickFirst(
          webbedsDetails?.product?.notes?.tariff,
          flowSnapshot?.tariffNotes,
          selectedOffer?.tariffNotes,
          existingSnapshot?.rate?.tariffNotes,
        ),
        refundable: pickFirst(
          flowSnapshot?.refundable,
          selectedOffer?.refundable,
          existingSnapshot?.rate?.refundable,
        ),
        nonRefundable: pickFirst(
          flowSnapshot?.nonRefundable,
          selectedOffer?.nonRefundable,
          existingSnapshot?.rate?.nonRefundable,
        ),
        cancelRestricted: pickFirst(
          flowSnapshot?.cancelRestricted,
          selectedOffer?.cancelRestricted,
          existingSnapshot?.rate?.cancelRestricted,
        ),
        amendRestricted: pickFirst(
          flowSnapshot?.amendRestricted,
          selectedOffer?.amendRestricted,
          existingSnapshot?.rate?.amendRestricted,
        ),
        paymentMode: pickFirst(
          flowSnapshot?.paymentMode,
          selectedOffer?.paymentMode,
          existingSnapshot?.rate?.paymentMode,
        ),
      },
      policies: {
        cancellationRules,
        taxes,
        fees,
        propertyFees,
      },
      traveler: {
        leadGuestName: pickFirst(
          booking.guest_name,
          booking.guest_snapshot?.name,
          existingSnapshot?.traveler?.leadGuestName,
        ),
        email: pickFirst(
          booking.guest_email,
          booking.guest_snapshot?.email,
          existingSnapshot?.traveler?.email,
        ),
        phone: pickFirst(
          booking.guest_phone,
          booking.guest_snapshot?.phone,
          existingSnapshot?.traveler?.phone,
        ),
        nationality: nationalityName ?? nationalityCode ?? null,
        residence: residenceName ?? residenceCode ?? null,
        salutation: pickFirst(
          booking.guest_snapshot?.salutation,
          existingSnapshot?.traveler?.salutation,
        ),
      },
      stay: {
        checkIn: pickFirst(booking.check_in, stayView?.checkIn, existingSnapshot?.stay?.checkIn),
        checkOut: pickFirst(
          booking.check_out,
          stayView?.checkOut,
          existingSnapshot?.stay?.checkOut,
        ),
        nights: resolvedNights ?? existingSnapshot?.stay?.nights ?? null,
        guests: {
          adults,
          children,
          childrenAges: childrenAges.length
            ? childrenAges
            : existingSnapshot?.stay?.guests?.childrenAges ?? null,
        },
      },
      totals: {
        total,
        currency,
      },
      payment: {
        method: resolvePaymentMethodLabel(
          booking.payment_provider,
          existingSnapshot?.payment?.method ?? existingSnapshot?.payment?.label ?? null,
        ),
        label: existingSnapshot?.payment?.label ?? null,
      },
    }

    const sanitized = sanitizeConfirmationSnapshot(snapshot)
    const clientRaw = req.body?.snapshot
    const clientSanitized =
      clientRaw && typeof clientRaw === "object"
        ? sanitizeConfirmationSnapshot(clientRaw)
        : null
    const merged = clientSanitized
      ? mergeSnapshotValues(sanitized, clientSanitized)
      : sanitized
    const pricingSnapshot =
      booking.pricing_snapshot && typeof booking.pricing_snapshot === "object"
        ? { ...booking.pricing_snapshot }
        : {}
    pricingSnapshot.confirmationSnapshot = merged
    await booking.update({ pricing_snapshot: pricingSnapshot })

    return res.json({ success: true, confirmationSnapshot: merged })
  } catch (err) {
    console.error("saveHotelConfirmationSnapshot:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   GET  /api/bookings/invites
   Auth: list active booking invites for the current user.
---------------------------------------------------------------- */
export const listBookingInvites = async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    const now = new Date()
    const members = await models.BookingUser.findAll({
      where: {
        user_id: userId,
        status: BOOKING_MEMBER_STATUSES.INVITED,
        [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gte]: now } }],
      },
      include: [
        {
          model: models.Booking,
          as: "booking",
          required: true,
          include: STAY_BASE_INCLUDE,
        },
        {
          model: models.User,
          as: "user",
          attributes: ["id", "name", "email", "phone", "avatar_url"],
          required: false,
        },
      ],
      order: [["id", "DESC"]],
    })

    const invites = members
      .map((member) => {
        const booking = member.booking
        if (!booking) return null
        const statusLc = String(booking.status || "").toUpperCase()
        if (statusLc === "CANCELLED") return null
        const obj = booking.toJSON()
        const channel =
          obj.inventory_type === "HOME" || obj.source === "HOME"
            ? "home"
            : obj.source === "OUTSIDE"
              ? "outside"
              : obj.source === "VAULT"
                ? "vault"
                : "insider"
        return {
          token: member.invite_token ?? null,
          expiresAt: member.expires_at ?? null,
          createdAt: member.createdAt ?? member.created_at ?? null,
          booking: mapStay(obj, channel),
          member: mapBookingMember(member),
        }
      })
      .filter((invite) => invite?.token)

    return res.json(invites)
  } catch (err) {
    console.error("listBookingInvites:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   GET  /api/bookings/invites/:token
   Public: resolve invite details by token.
---------------------------------------------------------------- */
export const getBookingInvite = async (req, res) => {
  try {
    const token = String(req.params.token || "").trim()
    if (!token) return res.status(400).json({ error: "Missing invite token" })

    const member = await models.BookingUser.findOne({
      where: { invite_token: token },
      include: [
        {
          model: models.Booking,
          as: "booking",
          include: STAY_BASE_INCLUDE,
        },
        {
          model: models.User,
          as: "user",
          attributes: ["id", "name", "email", "phone", "avatar_url"],
          required: false,
        },
      ],
    })
    if (!member) return res.status(404).json({ error: "Invite not found" })
    if (member.expires_at && new Date(member.expires_at) < new Date()) {
      return res.status(410).json({ error: "Invite expired" })
    }

    const booking = member.booking
    if (!booking) return res.status(404).json({ error: "Booking not found" })

    const obj = booking.toJSON()
    const channel =
      obj.inventory_type === "HOME" || obj.source === "HOME"
        ? "home"
        : obj.source === "OUTSIDE"
          ? "outside"
          : obj.source === "VAULT"
            ? "vault"
            : "insider"

    return res.json({
      booking: mapStay(obj, channel),
      member: mapBookingMember(member),
      expiresAt: member.expires_at ?? null,
    })
  } catch (err) {
    console.error("getBookingInvite:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   POST /api/bookings/:id/invite { email?, phone? }
   Owner invites a co-traveler (homes only).
---------------------------------------------------------------- */
export const inviteBookingMember = async (req, res) => {
  try {
    const bookingId = Number(req.params.id)
    const userId = Number(req.user?.id)
    if (!bookingId || !userId) return res.status(401).json({ error: "Unauthorized" })

    const normalizedEmail = normalizeEmail(req.body?.email)
    const normalizedPhone = normalizePhone(req.body?.phone)
    if (!normalizedEmail && !normalizedPhone) {
      return res.status(400).json({ error: "Email or phone is required" })
    }

    const booking = await models.Booking.findByPk(bookingId, {
      include: [
        {
          model: models.StayHome,
          as: "homeStay",
          required: true,
          include: [
            {
              model: models.Home,
              as: "home",
              attributes: ["id", "title", "max_guests"],
              required: false,
            },
          ],
        },
      ],
    })
    if (!booking) return res.status(404).json({ error: "Booking not found" })

    const inventoryType = booking.inventory_type ?? booking.source
    if (String(inventoryType || "").toUpperCase() !== "HOME") {
      return res.status(400).json({ error: "Only home bookings support co-travelers" })
    }

    if (Number(booking.user_id) !== userId) {
      return res.status(403).json({ error: "Only the booking owner can invite" })
    }

    const statusLc = String(booking.status || "").toUpperCase()
    if (statusLc === "CANCELLED") {
      return res.status(400).json({ error: "Booking is cancelled" })
    }

    await ensureBookingOwnerMember({ bookingId, ownerId: userId })

    const maxGuests = Number(booking.homeStay?.home?.max_guests ?? 0) || null
    const activeMembers = await models.BookingUser.count({
      where: {
        stay_id: bookingId,
        status: { [Op.in]: [BOOKING_MEMBER_STATUSES.INVITED, BOOKING_MEMBER_STATUSES.ACCEPTED] },
      },
    })
    if (maxGuests && activeMembers >= maxGuests) {
      return res.status(409).json({ error: "Co-traveler limit reached for this home" })
    }

    const userLookup = []
    if (normalizedEmail) {
      userLookup.push(
        sequelize.where(
          sequelize.fn("lower", sequelize.col("email")),
          normalizedEmail,
        )
      )
    }
    if (normalizedPhone) userLookup.push({ phone: normalizedPhone })
    const invitedUser =
      userLookup.length > 0
        ? await models.User.findOne({ where: { [Op.or]: userLookup } })
        : null
    if (!invitedUser) {
      return res.status(404).json({ error: "User not found" })
    }

    if (invitedUser && Number(invitedUser.id) === userId) {
      return res.status(400).json({ error: "Owner is already part of the booking" })
    }

    const duplicateWhere = { stay_id: bookingId }
    if (invitedUser) duplicateWhere.user_id = invitedUser.id
    else if (normalizedEmail) duplicateWhere.invited_email = normalizedEmail
    else duplicateWhere.invited_phone = normalizedPhone

    const existing = await models.BookingUser.findOne({
      where: duplicateWhere,
      include: [
        {
          model: models.User,
          as: "user",
          attributes: ["id", "name", "email", "phone", "avatar_url"],
          required: false,
        },
      ],
    })
    if (existing) {
      return res.json({
        member: mapBookingMember(existing),
        inviteUrl: buildBookingInviteUrl(existing.invite_token),
      })
    }

    const inviteToken = crypto.randomBytes(24).toString("hex")
    const expiresAt =
      Number.isFinite(INVITE_TTL_DAYS) && INVITE_TTL_DAYS > 0
        ? new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
        : null

    const member = await models.BookingUser.create({
      stay_id: bookingId,
      user_id: invitedUser?.id ?? null,
      role: BOOKING_MEMBER_ROLES.GUEST,
      status: BOOKING_MEMBER_STATUSES.INVITED,
      invited_email: normalizedEmail,
      invited_phone: normalizedPhone,
      invited_by: userId,
      invite_token: inviteToken,
      expires_at: expiresAt,
    })

    const inviteUrl = buildBookingInviteUrl(inviteToken)
    const homeTitle = booking.homeStay?.home?.title ?? "a home stay"
    const emailTarget = normalizedEmail ?? invitedUser?.email ?? null
    if (emailTarget) {
      const brand = process.env.BRAND_NAME || "Insider Bookings"
      const subject = `${brand} booking invite`
      const text = [
        `You have been invited to join a booking for ${homeTitle}.`,
        "",
        `Accept the invite here: ${inviteUrl}`,
        "",
        "If you do not have the app yet, download it and open this link again.",
      ].join("\n")
      try {
        await sendMail({
          to: emailTarget,
          subject,
          text,
          html: `<p>You have been invited to join a booking for <b>${homeTitle}</b>.</p>
<p><a href="${inviteUrl}">Accept the invite</a></p>
<p>If you do not have the app yet, download it and open this link again.</p>`,
        })
      } catch (mailErr) {
        console.warn("[booking-invite] email failed:", mailErr?.message || mailErr)
      }
    }

    if (invitedUser?.id) {
      try {
        await sendPushToUser({
          userId: invitedUser.id,
          title: "Booking invite",
          body: `You were invited to join ${homeTitle}.`,
          data: {
            bookingId,
            inviteToken,
          },
        })
      } catch (pushErr) {
        console.warn("[booking-invite] push failed:", pushErr?.message || pushErr)
      }
    }

    const memberPayload = member.get({ plain: true })
    memberPayload.user = invitedUser ? invitedUser.get({ plain: true }) : null

    return res.status(201).json({
      member: mapBookingMember(memberPayload),
      inviteUrl,
    })
  } catch (err) {
    console.error("inviteBookingMember:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   POST /api/bookings/invites/accept { token }
---------------------------------------------------------------- */
export const acceptBookingInvite = async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    const token = String(req.body?.token || "").trim()
    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    if (!token) return res.status(400).json({ error: "Missing invite token" })

    const member = await models.BookingUser.findOne({
      where: { invite_token: token },
      include: [
        {
          model: models.Booking,
          as: "booking",
          include: [
            {
              model: models.StayHome,
              as: "homeStay",
              required: false,
              include: [
                { model: models.Home, as: "home", attributes: ["id", "title", "max_guests"] },
              ],
            },
          ],
        },
        {
          model: models.User,
          as: "user",
          attributes: ["id", "name", "email", "phone", "avatar_url"],
          required: false,
        },
      ],
    })
    if (!member) return res.status(404).json({ error: "Invite not found" })
    if (member.expires_at && new Date(member.expires_at) < new Date()) {
      return res.status(410).json({ error: "Invite expired" })
    }

    const booking = member.booking
    if (!booking) return res.status(404).json({ error: "Booking not found" })

    const inventoryType = booking.inventory_type ?? booking.source
    if (String(inventoryType || "").toUpperCase() !== "HOME") {
      return res.status(400).json({ error: "Invite is not for a home booking" })
    }

    const statusLc = String(booking.status || "").toUpperCase()
    if (statusLc === "CANCELLED") {
      return res.status(400).json({ error: "Booking is cancelled" })
    }

    if (member.user_id && Number(member.user_id) !== userId) {
      return res.status(409).json({ error: "Invite already claimed" })
    }

    if (
      String(member.status || "").toUpperCase() === BOOKING_MEMBER_STATUSES.DECLINED ||
      String(member.status || "").toUpperCase() === BOOKING_MEMBER_STATUSES.REMOVED
    ) {
      return res.status(409).json({ error: "Invite is no longer active" })
    }

    await ensureBookingOwnerMember({ bookingId: booking.id, ownerId: booking.user_id })

    await member.update({
      user_id: userId,
      status: BOOKING_MEMBER_STATUSES.ACCEPTED,
      accepted_at: new Date(),
    })

    const refreshedMember = await models.BookingUser.findByPk(member.id, {
      include: [
        {
          model: models.User,
          as: "user",
          attributes: ["id", "name", "email", "phone", "avatar_url"],
          required: false,
        },
      ],
    })

    const obj = booking.toJSON()
    const channel =
      obj.inventory_type === "HOME" || obj.source === "HOME"
        ? "home"
        : obj.source === "OUTSIDE"
          ? "outside"
          : obj.source === "VAULT"
            ? "vault"
            : "insider"

    return res.json({
      booking: mapStay(obj, channel),
      member: mapBookingMember(refreshedMember ?? member),
    })
  } catch (err) {
    console.error("acceptBookingInvite:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   POST /api/bookings/invites/decline { token }
---------------------------------------------------------------- */
export const declineBookingInvite = async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    const token = String(req.body?.token || "").trim()
    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    if (!token) return res.status(400).json({ error: "Missing invite token" })

    const member = await models.BookingUser.findOne({
      where: { invite_token: token },
      include: [
        {
          model: models.User,
          as: "user",
          attributes: ["id", "name", "email", "phone", "avatar_url"],
          required: false,
        },
      ],
    })
    if (!member) return res.status(404).json({ error: "Invite not found" })
    if (member.expires_at && new Date(member.expires_at) < new Date()) {
      return res.status(410).json({ error: "Invite expired" })
    }

    if (member.user_id && Number(member.user_id) !== userId) {
      return res.status(409).json({ error: "Invite already claimed" })
    }

    await member.update({ status: BOOKING_MEMBER_STATUSES.DECLINED })
    const refreshedMember = await models.BookingUser.findByPk(member.id, {
      include: [
        {
          model: models.User,
          as: "user",
          attributes: ["id", "name", "email", "phone", "avatar_url"],
          required: false,
        },
      ],
    })

    return res.json({ member: mapBookingMember(refreshedMember ?? member) })
  } catch (err) {
    console.error("declineBookingInvite:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

import { processBookingCancellation } from "../services/booking.service.js";

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   PUT  /api/bookings/:id/cancel
   (este endpoint cancela reservas legacy)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.id

    const result = await processBookingCancellation({
      bookingId: id,
      userId,
      reason: "user_initiated_cancel"
    });

    return res.json(result);
  } catch (err) {
    // Handle service errors
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("cancelBooking Error:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Public helpers for â€œoutsideâ€ bookings (transformed)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const getOutsideBookingByConfirmation = async (req, res) => {
  try {
    const { confirmation } = req.params
    if (!confirmation)
      return res.status(400).json({ error: "bookingConfirmation is required" })

    const bk = await models.Booking.findOne({
      where: { external_ref: confirmation, source: "OUTSIDE" },
    })
    if (!bk) return res.status(404).json({ error: "Booking not found" })

    return res.json(bk)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const getOutsideBookingWithAddOns = async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!id) return res.status(400).json({ error: "Invalid booking ID" })

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 1. Load booking (+relations) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    const bk = await models.Booking.findOne({
      where: { id, source: "OUTSIDE" },
      include: [
        {
          model: models.User,
          attributes: ["id", "name", "email"],
        },
        {
          model: models.Hotel,
          attributes: [
            "id", "name", "location", "address", "city", "country", "image", "phone", "price",
            "rating", "star_rating", "category", "amenities", "lat", "lng", "description"
          ],
        },
        {
          model: models.AddOn,
          attributes: ["id", "name", "slug", "description", "price"],
          through: {
            attributes: [
              "id", "quantity", "unit_price", "payment_status", "add_on_option_id", "status"
            ],
          },
          include: [
            { model: models.AddOnOption, attributes: ["id", "name", "price"] }
          ],
        },
        {
          model: models.Room,
          attributes: [
            "id", "room_number", "name", "description", "image", "price", "capacity",
            "beds", "amenities", "available"
          ],
        }
      ]
    })
    if (!bk) return res.status(404).json({ error: "Booking not found" })

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 2. Map add-ons for FE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    const addons = bk.AddOns.map(addon => {
      const pivot = addon.BookingAddOn
      const option = addon.AddOnOptions?.find(o => o.id === pivot.add_on_option_id) || null
      return {
        bookingAddOnId: pivot.id,
        addOnId: addon.id,
        addOnName: addon.name,
        addOnSlug: addon.slug,
        qty: pivot.qty,
        unitPrice: Number(pivot.unit_price),
        paymentStatus: pivot.payment_status,
        status: pivot.status,
        optionId: option?.id ?? null,
        optionName: option?.name ?? null,
        optionPrice: option?.price ?? null,
      }
    })

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 3. Hotel + rooms plain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    const hotelPlain = bk.Hotel.get({ plain: true })
    const roomRows = await models.Room.findAll({
      where: { hotel_id: hotelPlain.id },
      attributes: [
        "id", "room_number", "name", "description", "image", "price", "capacity",
        "beds", "amenities", "available"
      ],
    })
    hotelPlain.rooms = roomRows.map(r => r.get({ plain: true }))

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 4. Response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    return res.json({
      id: bk.id,
      bookingConfirmation: bk.external_ref, // usamos external_ref
      externalRef: bk.external_ref,
      guestName: bk.guest_name,
      guestLastName: bk.meta?.guest_last_name ?? null,
      guestEmail: bk.guest_email,
      guestRoomType: bk.Room?.name ?? null,
      guestPhone: bk.guest_phone,
      checkIn: bk.check_in,
      checkOut: bk.check_out,
      status: String(bk.status).toLowerCase(),
      paymentStatus: String(bk.payment_status).toLowerCase(),
      user: bk.User,
      hotel: hotelPlain,
      room: bk.Room ?? null,
      meta: bk.meta ?? null,
      addons,
      source: "OUTSIDE"
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const downloadBookingCertificate = async (req, res) => {
  try {
    const { id } = req.params

    const booking = await models.Booking.findByPk(id, {
      include: [
        { model: models.User, as: "user", attributes: ["name", "email", "phone", "country"] },
        { model: models.Hotel, as: "hotel", attributes: ["name", "hotelName", "address", "city", "country", "phone"] },
        { model: models.Room, as: "room", attributes: ["name", "description"] },
      ],
    })
    if (!booking) return res.status(404).json({ error: "Booking not found" })

    const payload = {
      id: booking.id,
      bookingCode: booking.bookingCode || booking.reference || booking.id,
      guestName: booking.guestName || booking.user?.name,
      guests: { adults: booking.adults || 2, children: booking.children || 0 },
      roomsCount: booking.rooms || 1,
      checkIn: booking.checkIn || booking.check_in,
      checkOut: booking.checkOut || booking.check_out,
      hotel: {
        name: booking.hotel?.name || booking.hotel?.hotelName,
        address: booking.hotel?.address,
        city: booking.hotel?.city,
        country: booking.hotel?.country,
        phone: booking.hotel?.phone,
      },
      country: booking.user?.country || "",
      propertyContact: booking.hotel?.phone,
      currency: (booking.currency || "USD").toUpperCase(),
      totals: {
        nights: booking.nights,
        ratePerNight: booking.ratePerNight || booking.rate || 0,
        taxes: booking.taxes || 0,
        total: booking.totalAmount || booking.total || 0,
      },
      payment: {
        method: booking.paymentMethod || booking.payment_type || "Credit Card",
        last4: booking.cardLast4 || null,
      },
    }

    return streamCertificatePDF(payload, res)
  } catch (err) {
    console.error("downloadCertificate error:", err)
    return res.status(500).json({ error: "Could not generate certificate" })
  }
}

/* -----------------------------------------------------------
   POST /api/bookings/:id/refund
   Marca la reserva como reembolsada y revierte la comisiÃ³n influencer asociada.
   AutorizaciÃ³n: owner de la booking, staff o admin.
----------------------------------------------------------- */
// requestRefund endpoint was removed â€” cancellation flow handles refunds.

/* -----------------------------------------------------------
   PUT  /api/bookings/:id/confirm
   Marca la reserva como CONFIRMED si el pago ya esta confirmado.
  Autorización: owner de la booking.
----------------------------------------------------------- */
export const confirmBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    console.log("[CONFIRM BOOKING] request", { id, userId });
    if (!id || !userId) return res.status(401).json({ error: "Unauthorized" });

    const booking = await models.Booking.findOne({
      where: { id, user_id: userId },
      include: STAY_BASE_INCLUDE,
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const statusLc = String(booking.status || "").toUpperCase();
    if (statusLc === "CANCELLED") return res.status(400).json({ error: "Booking is cancelled" });

    const paymentStatusLc = String(booking.payment_status || "").toUpperCase();
    if (paymentStatusLc !== "PAID") {
      return res.status(409).json({ error: "Payment not confirmed" });
    }

    const alreadyFinal = statusLc === "CONFIRMED" || statusLc === "COMPLETED";
    if (!alreadyFinal) {
      await booking.update({
        status: "CONFIRMED",
        booked_at: booking.booked_at || new Date(),
      });
      console.log("[CONFIRM BOOKING] updated to CONFIRMED", { id: booking.id });
    }

    try {
      await finalizeBookingAfterPayment({ bookingId: booking.id });
    } catch (finalizeErr) {
      console.warn("[CONFIRM BOOKING] finalize failed:", finalizeErr?.message || finalizeErr);
    }

    const fresh = await models.Booking.findByPk(id, { include: STAY_BASE_INCLUDE });
    if (!fresh) return res.status(404).json({ error: "Booking not found" });

    const mapped = mapStay(fresh.toJSON(), fresh.source || "insider");
    const responsePayload = {
      ...mapped,
      pricingSnapshot: fresh.pricing_snapshot ?? null,
      referralCoupon:
        fresh.pricing_snapshot?.referralCoupon ??
        fresh.pricing_snapshot?.referral_coupon ??
        fresh.meta?.referralCoupon ??
        fresh.meta?.referral_coupon ??
        null,
    };

    return res.json(responsePayload);
  } catch (err) {
    console.error("confirmBooking:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

