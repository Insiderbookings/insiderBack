import { Op, QueryTypes, literal } from "sequelize"
import models from "../models/index.js"
import { WebbedsProvider } from "../providers/webbeds/provider.js"
import { formatStaticHotel } from "../utils/webbedsMapper.js"
import { listSalutations } from "../providers/webbeds/salutations.js"
import cache from "../services/cache.js"
import { resolveGeoFromRequest } from "../utils/geoLocation.js"
import { sendBookingEmail } from "../emailTemplates/booking-email.js"
import { buildBookingEmailPayload } from "../helpers/bookingEmailPayload.js"
import { triggerBookingAutoPrompts, PROMPT_TRIGGERS } from "../services/chat.service.js"
import { dispatchBookingConfirmation } from "./payment.controller.js"
import { convertCurrency } from "../services/currency.service.js"
import {
  resolveHotelCanonicalPricing,
  resolveHotelPricingRole,
} from "../utils/hotelPricing.js"
import sharp from "sharp"
import { createHash } from "node:crypto"

import { Readable } from "stream"
import { pipeline } from "stream/promises"

import { resolveEnabledCurrency } from "../services/currencySettings.service.js"
import { getCaseInsensitiveLikeOp } from "../utils/sequelizeHelpers.js"
import {
  EXPLORE_RANKING_VERSION,
  fetchHotelExploreEngagementStats,
  rankHotelsForExplore,
  rankHotelSectionsForExplore,
  resolveExploreRankingVariant,
} from "../services/exploreRanking.service.js"
import {
  attachPartnerProgramToHotelItems,
  comparePartnerAwareHotelItems,
} from "../services/partnerLifecycle.service.js"
import { getPartnerHotelProfileCacheVersion } from "../services/partnerHotelProfile.service.js"

import {
  previewReferralCreditForBooking,
  reserveReferralCreditForBooking,
  restoreReferralCreditForBooking,
} from "../services/referralCredit.service.js"
import { FlowOrchestratorService } from "../services/flowOrchestrator.service.js"
import {
  captureHold,
  holdForHotelPayment,
  isGuestWalletHotelsEnabled,
  releaseHold,
  resolveRewardReleaseAt,
  scheduleEarn,
} from "../services/guestWallet.service.js"
import { runWalletBookingMutation } from "../services/guestWalletSync.service.js"


const provider = new WebbedsProvider()
const iLikeOp = getCaseInsensitiveLikeOp()
const STRIPE_FX_DEBUG = process.env.STRIPE_FX_DEBUG === "true"
const logStripeFxDebug = (...args) => {
  if (STRIPE_FX_DEBUG) console.log("[stripe.fx]", ...args)
}
const STATIC_HOTELS_CACHE_TTL_SECONDS = Math.max(
  30,
  Number(process.env.WEBBEDS_STATIC_HOTELS_CACHE_TTL_SECONDS || 300),
)
const STATIC_HOTELS_CACHE_DISABLED = process.env.WEBBEDS_STATIC_HOTELS_CACHE_DISABLED === "true"
const EXPLORE_HOTELS_CACHE_DISABLED = process.env.WEBBEDS_EXPLORE_CACHE_DISABLED === "true"
const EXPLORE_HOTELS_CACHE_TTL_SECONDS = Math.max(
  30,
  Number(process.env.WEBBEDS_EXPLORE_CACHE_TTL_SECONDS || STATIC_HOTELS_CACHE_TTL_SECONDS),
)
const EXPLORE_COLLECTIONS_CACHE_DISABLED = process.env.WEBBEDS_EXPLORE_COLLECTIONS_CACHE_DISABLED === "true"
const EXPLORE_COLLECTIONS_CACHE_TTL_SECONDS = Math.max(
  30,
  Number(process.env.WEBBEDS_EXPLORE_COLLECTIONS_CACHE_TTL_SECONDS || EXPLORE_HOTELS_CACHE_TTL_SECONDS),
)
const EXPLORE_DEFAULT_CITY_CODE = String(
  process.env.WEBBEDS_EXPLORE_DEFAULT_CITY_CODE || "364",
).trim()
const EXPLORE_DEFAULT_LIMIT = Math.max(
  20,
  Number(process.env.WEBBEDS_EXPLORE_DEFAULT_LIMIT || 120),
)
const EXPLORE_COLLECTIONS_DEFAULT_SECTIONS = Math.max(
  3,
  Number(process.env.WEBBEDS_EXPLORE_COLLECTIONS_SECTIONS || 5),
)
const EXPLORE_COLLECTIONS_DEFAULT_LIMIT = Math.max(
  4,
  Number(process.env.WEBBEDS_EXPLORE_COLLECTIONS_LIMIT || 10),
)
const EXPLORE_DEFAULT_RADIUS_KM = Math.max(
  5,
  Number(process.env.WEBBEDS_EXPLORE_RADIUS_KM || 60),
)
const EXPLORE_MAX_RESULTS = Math.max(
  20,
  Number(process.env.WEBBEDS_EXPLORE_MAX_RESULTS || 200),
)
const EXPLORE_GEO_BUCKET_PRECISION = Math.min(
  4,
  Math.max(0, Number(process.env.WEBBEDS_EXPLORE_GEO_BUCKET_PRECISION || 2)),
)

const buildStaticHotelsCacheKey = (payload = {}) =>
  `webbeds:static-hotels:${JSON.stringify(payload)}`
const buildExploreHotelsCacheKey = (payload = {}) =>
  `webbeds:explore-hotels:${JSON.stringify(payload)}`
const buildExploreCollectionsCacheKey = (payload = {}) =>
  `webbeds:explore-collections:${JSON.stringify(payload)}`
const getStripeClient = async () => {
  const { default: Stripe } = await import("stripe")
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" })
}

const isPrivilegedUser = (user) => {
  const role = Number(user?.role)
  return role === 1 || role === 100
}

const resolveHotelBookingPricingRole = (user) => resolveHotelPricingRole(user)

const resolveReferralContext = async (tokenUser) => {
  const userId = Number(tokenUser?.id) || null
  const tokenInfluencerId = Number(tokenUser?.referredByInfluencerId) || null
  const tokenCodeRaw = String(tokenUser?.referredByCode || "").trim()
  const tokenCode = tokenCodeRaw || null

  if (!userId) {
    return { influencerId: tokenInfluencerId, code: tokenCode }
  }

  if (tokenInfluencerId && tokenCode) {
    return { influencerId: tokenInfluencerId, code: tokenCode }
  }

  try {
    const user = await models.User.findByPk(userId, {
      attributes: ["id", "referred_by_influencer_id", "referred_by_code"],
    })
    return {
      influencerId: tokenInfluencerId || Number(user?.referred_by_influencer_id) || null,
      code: tokenCode || user?.referred_by_code || null,
    }
  } catch (error) {
    console.warn("[webbeds] resolve referral context fallback failed", error?.message || error)
    return { influencerId: tokenInfluencerId, code: tokenCode }
  }
}

const maskEmail = (email = "") => {
  const value = String(email || "").trim()
  if (!value) return null
  const [user, domain] = value.split("@")
  if (!domain) return value
  if (user.length <= 2) return `${user[0] || ""}*@${domain}`
  return `${user[0]}***${user[user.length - 1]}@${domain}`
}

const maskPhone = (phone = "") => {
  const value = String(phone || "").trim()
  if (!value) return null
  const tail = value.slice(-2)
  return `***${tail}`
}

const roundCurrency = (value) => {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number.parseFloat(numeric.toFixed(2))
}

const parseCurrencyDisplayAmount = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value === "number") return Number.isFinite(value) ? roundCurrency(value) : null
  const parsed = Number(String(value).replace(/[^0-9.\-]/g, ""))
  return Number.isFinite(parsed) ? roundCurrency(parsed) : null
}

const convertAmountForCurrency = async (amountUsd, currency) => {
  const normalizedCurrency = String(currency || "USD").trim().toUpperCase() || "USD"
  const safeAmount = roundCurrency(amountUsd)
  if (normalizedCurrency === "USD") return safeAmount
  const converted = await convertCurrency(safeAmount, normalizedCurrency)
  return roundCurrency(converted?.amount)
}

const resolveHotelBenchmarkAmount = (flow, selectedOffer) => {
  const candidates = [
    selectedOffer?.benchmarkAmount,
    selectedOffer?.competitorAmount,
    selectedOffer?.competitorPrice,
    selectedOffer?.priceBenchmark,
    selectedOffer?.referencePrice,
    selectedOffer?.benchmark?.amount,
    flow?.pricing_snapshot_priced?.benchmarkAmount,
    flow?.pricing_snapshot_priced?.competitorAmount,
    flow?.pricing_snapshot_priced?.competitorPrice,
    flow?.pricing_snapshot_priced?.priceBenchmark,
    flow?.pricing_snapshot_priced?.referencePrice,
    flow?.meta?.benchmarkAmount,
    flow?.meta?.competitorAmount,
    flow?.meta?.competitorPrice,
  ]
  for (const candidate of candidates) {
    const numeric = Number(candidate)
    if (Number.isFinite(numeric) && numeric > 0) return roundCurrency(numeric)
  }
  return null
}

const logHotelBenchmarkAlert = ({ flow, selectedOffer, canonicalPricing, context = "flow" }) => {
  const benchmarkAmount = resolveHotelBenchmarkAmount(flow, selectedOffer)
  const publicMarkedAmount = Number(canonicalPricing?.publicMarkedAmount)
  if (!Number.isFinite(benchmarkAmount) || !Number.isFinite(publicMarkedAmount)) return null
  if (publicMarkedAmount <= benchmarkAmount) return null

  const alert = {
    flowId: flow?.id ?? null,
    benchmarkAmount,
    publicMarkedAmount: roundCurrency(publicMarkedAmount),
    providerAmount: roundCurrency(canonicalPricing?.providerAmount ?? 0),
    markupRate: roundCurrency(canonicalPricing?.publicMarkupRate ?? 0),
    context,
  }
  console.warn("[hotel-pricing] benchmark alert", alert)
  return alert
}

const PAYMENT_INTENT_REUSABLE_STATUSES = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
  "requires_capture",
])

const isReusablePaymentIntentStatus = (status) =>
  PAYMENT_INTENT_REUSABLE_STATUSES.has(String(status || "").toLowerCase())

const buildPaymentScopeKey = ({ flow, bookingId, hotelId, checkIn, checkOut, guests, userId }) => {
  const selectedOffer = flow?.selected_offer && typeof flow.selected_offer === "object"
    ? flow.selected_offer
    : {}
  const safeAdults = Math.max(1, Number(guests?.adults) || 1)
  const safeChildren = Math.max(0, Number(guests?.children) || 0)
  const payload = {
    version: 1,
    userId: Number(userId) || 0,
    flowId: String(flow?.id || ""),
    bookingId: String(bookingId || ""),
    hotelId: String(selectedOffer.hotelId ?? hotelId ?? ""),
    checkIn: String(selectedOffer.fromDate ?? checkIn ?? ""),
    checkOut: String(selectedOffer.toDate ?? checkOut ?? ""),
    adults: safeAdults,
    children: safeChildren,
    roomRunno: selectedOffer.roomRunno ?? null,
    roomTypeCode: selectedOffer.roomTypeCode ?? null,
    rateBasisId: selectedOffer.rateBasisId ?? null,
    allocationDetails: selectedOffer.allocationDetails ?? null,
    price: Number.isFinite(Number(selectedOffer.price)) ? Number(selectedOffer.price) : null,
    minimumSelling:
      Number.isFinite(Number(selectedOffer.minimumSelling)) ? Number(selectedOffer.minimumSelling) : null,
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

const buildPaymentIntentIdempotencyKey = ({
  paymentScopeKey,
  amountForStripe,
  currency,
  walletAppliedMinor = 0,
}) => {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        paymentScopeKey,
        amountForStripe,
        currency: String(currency || "").toUpperCase(),
        walletAppliedMinor: Math.max(0, Number(walletAppliedMinor) || 0),
      }),
    )
    .digest("hex")
    .slice(0, 32)
  return `hotel-pi-${digest}`
}

const findPendingBookingByPaymentScope = async ({ userId, flowId, bookingId, paymentScopeKey }) => {
  const bookings = await models.Booking.findAll({
    where: {
      user_id: userId,
      flow_id: flowId,
      source: "PARTNER",
      inventory_type: "WEBBEDS_HOTEL",
      external_ref: bookingId,
      status: "PENDING",
    },
    order: [["id", "DESC"]],
  })
  return (
    bookings.find((entry) => String(entry?.meta?.paymentScopeKey || "") === String(paymentScopeKey || "")) ||
    null
  )
}

const buildPaymentIntentResponse = ({ booking, paymentIntent, flowId, pricingSnapshot }) => ({
  clientSecret: paymentIntent?.client_secret || null,
  paymentIntentId: paymentIntent?.id || null,
  paymentIntentStatus: paymentIntent?.status || null,
  localBookingId: booking?.id || null,
  bookingRef: booking?.booking_ref || null,
  flowId,
  pricingSnapshot: pricingSnapshot || booking?.pricing_snapshot || null,
})

const resolveCanonicalPublicBookingAmount = ({ flow, providerAmount, pricingRole }) => {
  const snapshotMinimumSellingRaw = Number(flow?.pricing_snapshot_priced?.minimumSelling)
  const selectedMinimumSellingRaw = Number(flow?.selected_offer?.minimumSelling)
  const minimumSellingRaw = Number.isFinite(snapshotMinimumSellingRaw)
    ? snapshotMinimumSellingRaw
    : Number.isFinite(selectedMinimumSellingRaw)
      ? selectedMinimumSellingRaw
      : null
  return resolveHotelCanonicalPricing({
    providerAmount,
    minimumSelling: minimumSellingRaw,
    pricingRole,
  })
}

const parseCsvList = (value) => {
  if (!value) return []
  return Array.from(
    new Set(
      String(value)
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  )
}

const WEBBEDS_PAYMENT_CONTEXT_MODE = String(
  process.env.WEBBEDS_PAYMENT_CONTEXT_MODE || "guest",
)
  .trim()
  .toLowerCase()
const MERCHANT_CONTEXT_CACHE_KEY = "webbeds:merchant-payment-context"
const MERCHANT_CONTEXT_TTL_SECONDS = Math.max(
  300,
  Number(process.env.WEBBEDS_MERCHANT_DEVICE_PAYLOAD_TTL_SECONDS || 3600),
)

const fingerprintPayload = (value) => {
  const normalized = String(value || "").trim()
  if (!normalized) return null
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12)
}

const summarizeMerchantContext = (entry = null) => {
  if (!entry || typeof entry !== "object") {
    return {
      mode: WEBBEDS_PAYMENT_CONTEXT_MODE,
      present: false,
      source: null,
      payloadLength: 0,
      payloadFingerprint: null,
      updatedAt: null,
      expiresAt: null,
      updatedByUserId: null,
      sdkUrl: null,
    }
  }

  const payload = String(entry.devicePayload || "").trim()
  return {
    mode: WEBBEDS_PAYMENT_CONTEXT_MODE,
    present: Boolean(payload),
    source: entry.source || "merchant-cache",
    payloadLength: payload.length,
    payloadFingerprint: fingerprintPayload(payload),
    updatedAt: entry.updatedAt || null,
    expiresAt: entry.expiresAt || null,
    updatedByUserId: entry.updatedByUserId || null,
    sdkUrl: entry.sdkUrl || null,
  }
}

const parseCoordinate = (value) => {
  if (value == null || value === "") return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  if (num < -180 || num > 180) return null
  return num
}

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value))

const roundCoordinate = (value, precision) => {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

const resolveExploreCoordinates = (req) => {
  const lat = parseCoordinate(req.query?.lat)
  const lng = parseCoordinate(req.query?.lng)
  if (lat != null && lng != null) {
    return { lat, lng, source: "query" }
  }
  const geo = resolveGeoFromRequest(req)
  const geoLat = parseCoordinate(geo?.latitude)
  const geoLng = parseCoordinate(geo?.longitude)
  if (geoLat != null && geoLng != null) {
    return { lat: geoLat, lng: geoLng, source: "ip", geo }
  }
  return null
}

const computeGeoBounds = (lat, lng, radiusKm) => {
  const safeLat = Number(lat)
  const safeLng = Number(lng)
  const safeRadius = Math.max(1, Number(radiusKm) || 0)
  const latRad = (safeLat * Math.PI) / 180
  const kmPerDeg = 111.32
  const deltaLat = safeRadius / kmPerDeg
  const cosLat = Math.cos(latRad)
  const deltaLng = cosLat === 0 ? 180 : safeRadius / (kmPerDeg * Math.max(0.0001, Math.abs(cosLat)))
  return {
    minLat: safeLat - deltaLat,
    maxLat: safeLat + deltaLat,
    minLng: safeLng - deltaLng,
    maxLng: safeLng + deltaLng,
  }
}

const buildDistanceLiteral = (lat, lng, latExpr = "lat", lngExpr = "lng") => {
  const safeLat = Number(lat)
  const safeLng = Number(lng)
  const latColumn = String(latExpr)
  const lngColumn = String(lngExpr)
  return literal(
    `6371 * acos(` +
    `cos(radians(${safeLat})) * cos(radians(${latColumn})) * cos(radians(${lngColumn}) - radians(${safeLng})) + ` +
    `sin(radians(${safeLat})) * sin(radians(${latColumn}))` +
    `)`,
  )
}

const STATIC_HOTEL_ATTRIBUTES_LITE = [
  "hotel_id",
  "name",
  "city_name",
  "city_code",
  "country_name",
  "country_code",
  "address",
  "full_address",
  "lat",
  "lng",
  "rating",
  "priority",
  "preferred",
  "exclusive",
  "chain",
  "chain_code",
  "classification_code",
  "images",
]

const STATIC_HOTEL_ATTRIBUTES_FULL = [
  ...STATIC_HOTEL_ATTRIBUTES_LITE,
  "region_name",
  "region_code",
  "zip_code",
  "location1",
  "location2",
  "location3",
  "built_year",
  "renovation_year",
  "floors",
  "no_of_rooms",
  "hotel_phone",
  "hotel_check_in",
  "hotel_check_out",
  "min_age",
  "last_updated",
  "direct",
  "fire_safety",
  "full_address",
  "transportation",
  "geo_locations",
  "amenities",
  "leisure",
  "business",
  "descriptions",
  "room_static",
]

const getStaticHotelAttributes = (useLite) =>
  useLite ? STATIC_HOTEL_ATTRIBUTES_LITE : STATIC_HOTEL_ATTRIBUTES_FULL

const getStaticHotelIncludes = () => [
  {
    model: models.WebbedsHotelChain,
    as: "chainCatalog",
    attributes: ["code", "name"],
  },
  {
    model: models.WebbedsHotelClassification,
    as: "classification",
    attributes: ["code", "name"],
  },
  {
    model: models.WebbedsHotelRoomType,
    as: "roomTypes",
    attributes: [
      "hotel_id",
      "roomtype_code",
      "name",
      "twin",
      "room_info",
      "room_capacity",
      "raw_payload",
    ],
    required: false,
  },
]

const sortPartnerFirstWithFallback = (items = [], fallbackCompare = null) =>
  items
    .map((item, index) => ({ item, index }))
    .sort((left, right) =>
      comparePartnerAwareHotelItems(left.item, right.item, (a, b) => {
        if (typeof fallbackCompare === "function") {
          const compared = fallbackCompare(a, b)
          if (compared !== 0) return compared
        }
        return left.index - right.index
      }),
    )
    .map(({ item }) => item)

export const search = (req, res, next) => provider.search(req, res, next)
export const getRooms = (req, res, next) => provider.getRooms(req, res, next)
export const saveBooking = (req, res, next) => provider.saveBooking(req, res, next)
export const bookItinerary = (req, res, next) => provider.bookItinerary(req, res, next)
export const bookItineraryRecheck = (req, res, next) => provider.bookItineraryRecheck(req, res, next)
export const bookItineraryPreauth = (req, res, next) => provider.bookItineraryPreauth(req, res, next)
export const confirmBooking = (req, res, next) => provider.confirmBooking(req, res, next)
export const cancelBooking = (req, res, next) => provider.cancelBooking(req, res, next)
export const deleteItinerary = (req, res, next) => provider.deleteItinerary(req, res, next)
export const getBookingDetails = (req, res, next) => provider.getBookingDetails(req, res, next)

export const createPaymentIntent = async (req, res, next) => {
  try {
    const {
      bookingId, // Webbeds Booking ID
      amount, // USD Amount from WebBeds (client-provided; ignored for security)
      currency = "USD", // Target currency requested by frontend
      flowId,
      hotelId,
      checkIn,
      checkOut,
      guests, // { adults, children }
      holder, // { firstName, lastName, ... }
      roomName,
      requestId,
      useWallet = false,
    } = req.body
    const requestTag =
      requestId ||
      req.headers["x-request-id"] ||
      req.headers["x-correlation-id"] ||
      `webbeds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const logPrefix = `[webbeds] createPaymentIntent ${requestTag}`
    const requestedCurrency = currency
    const resolvedCurrency = await resolveEnabledCurrency(requestedCurrency)
    const userId = Number(req.user?.id)
    if (!userId) {
      console.warn(`${logPrefix} missing user`)
      return res.status(401).json({ error: "Unauthorized" })
    }
    if (!flowId) {
      console.warn(`${logPrefix} missing flowId`)
      return res.status(400).json({ error: "Missing flowId" })
    }

    console.info(`${logPrefix} request`, {
      bookingId,
      amount,
      currency: resolvedCurrency,
      requestedCurrency,
      flowId,
      hotelId,
      checkIn,
      checkOut,
      guests,
      holder: {
        firstName: holder?.firstName || null,
        lastName: holder?.lastName || null,
        email: maskEmail(holder?.email),
        phone: maskPhone(holder?.phone),
      },
      roomName,
      useWallet: Boolean(useWallet),
      userId,
    })

    if (!bookingId) {
      console.warn(`${logPrefix} missing bookingId`)
      return res.status(400).json({ error: "Missing bookingId" })
    }
    const flow = await models.BookingFlow.findByPk(flowId)
    if (!flow) {
      console.warn(`${logPrefix} flow not found`, { flowId })
      return res.status(404).json({ error: "Flow not found" })
    }
    if (!isPrivilegedUser(req.user) && (!flow.user_id || Number(flow.user_id) !== userId)) {
      console.warn(`${logPrefix} flow forbidden`, { flowId, userId, flowUserId: flow.user_id })
      return res.status(403).json({ error: "Forbidden" })
    }

    const flowContext = flow.search_context || {}
    const flowHotelId = flowContext.hotelId ?? flowContext.productId ?? null
    const flowCheckIn = flowContext.fromDate ?? null
    const flowCheckOut = flowContext.toDate ?? null
    const resolvedHotelId = flowHotelId ?? hotelId
    const resolvedCheckIn = flowCheckIn ?? checkIn
    const resolvedCheckOut = flowCheckOut ?? checkOut

    if (!resolvedHotelId) {
      console.warn(`${logPrefix} missing hotelId`, { flowHotelId, hotelId })
      return res.status(400).json({ error: "Missing hotelId" })
    }
    if (!resolvedCheckIn || !resolvedCheckOut) {
      console.warn(`${logPrefix} missing dates`, { resolvedCheckIn, resolvedCheckOut })
      return res.status(400).json({ error: "Missing check-in or check-out dates" })
    }
    const referral = await resolveReferralContext(req.user)

    // 1. Create Local Booking Record (PENDING)
    // We store the Webbeds ID as external_ref
    // and "WEBBEDS" as source
    let booking_ref = null

    // Convert amounts (server-trusted)
    // WebBeds provides cost in USD; we use the priced flow snapshot as the source of truth.
    const pricedAmount =
      Number(flow.pricing_snapshot_priced?.price) ||
      Number(flow.pricing_snapshot_preauth?.price) ||
      null
    if (!Number.isFinite(pricedAmount) || pricedAmount <= 0) {
      console.warn(`${logPrefix} invalid flow amount`, {
        flowId,
        pricedAmount,
        pricedSnapshot: flow.pricing_snapshot_priced,
      })
      return res.status(409).json({ error: "Flow pricing unavailable" })
    }
    const requestUserRoleRaw = Number(req.user?.role)
    const requestUserRole = Number.isFinite(requestUserRoleRaw) ? requestUserRoleRaw : 0
    const publicPricingRole = resolveHotelBookingPricingRole(req.user)
    const providerAmountUsd = roundCurrency(pricedAmount)
    const canonicalPricing = resolveCanonicalPublicBookingAmount({
      flow,
      providerAmount: providerAmountUsd,
      pricingRole: publicPricingRole,
    })
    const {
      publicMarkedAmount,
      minimumSelling,
      effectiveAmount: amountUsd,
      publicMarkupRate: markupRate,
    } = canonicalPricing
    const benchmarkAlert = logHotelBenchmarkAlert({
      flow,
      selectedOffer: flow.selected_offer,
      canonicalPricing,
      context: "createPaymentIntent",
    })
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      console.warn(`${logPrefix} invalid marked amount`, {
        flowId,
        providerAmountUsd,
        publicMarkedAmount,
        minimumSelling,
        requestUserRole,
        publicPricingRole,
        markupRate,
      })
      return res.status(409).json({ error: "Flow pricing unavailable" })
    }
    if (benchmarkAlert) {
      console.warn(`${logPrefix} benchmark alert`, benchmarkAlert)
    }
    if (amount != null) {
      const clientAmount = Number(amount)
      if (
        Number.isFinite(clientAmount) &&
        Math.abs(clientAmount - amountUsd) > 0.01
      ) {
        console.warn(`${logPrefix} client amount mismatch`, {
          clientAmount,
          serverAmount: amountUsd,
          publicMarkedAmount,
          minimumSelling,
        })
      }
    }

    console.info(
      `${logPrefix} ###netprice: ${roundCurrency(providerAmountUsd)}###markup applied: ${roundCurrency(
        canonicalPricing.publicMarkupAmount || 0,
      )}### final price: ${roundCurrency(amountUsd)}###`,
    )

    const stripe = await getStripeClient()
    const stripeFxEnabled =
      String(process.env.STRIPE_FX_QUOTES_ENABLED || "false").toLowerCase() === "true"
    const stripeFxLockDuration =
      process.env.STRIPE_FX_QUOTES_LOCK_DURATION || "five_minutes"
    const stripeFxToCurrency = String(
      process.env.STRIPE_FX_QUOTES_TO_CURRENCY || "USD",
    ).toLowerCase()
    const stripeFxVersionRaw = process.env.STRIPE_FX_QUOTES_VERSION || ""
    const stripeFxVersion = stripeFxVersionRaw.replace(/^['"]|['"]$/g, "") || null
    const fxQuoteTtlSeconds = Number(process.env.FX_QUOTE_TTL_SECONDS || 900)

    logStripeFxDebug("config", {
      enabled: stripeFxEnabled,
      lockDuration: stripeFxLockDuration,
      toCurrency: stripeFxToCurrency,
      version: stripeFxVersion || null,
    })

    const createStripeFxQuote = async (fromCurrency, lockDurationOverride) => {
      const lockDuration = lockDurationOverride || stripeFxLockDuration
      const payload = {
        from_currencies: [String(fromCurrency).toLowerCase()],
        to_currency: stripeFxToCurrency,
        lock_duration: lockDuration,
        usage: { type: "payment" },
      }
      logStripeFxDebug("quote.request", {
        fromCurrency: payload.from_currencies?.[0] || null,
        toCurrency: payload.to_currency,
        lockDuration: payload.lock_duration,
      })
      const options = stripeFxVersion
        ? { apiVersion: stripeFxVersion }
        : undefined
      const response = await stripe.rawRequest("POST", "/v1/fx_quotes", payload, options)
      const body = response?.body || response?.data || response
      logStripeFxDebug("quote.response", {
        id: body?.id || null,
        created: body?.created || null,
        lockExpiresAt: body?.lock_expires_at || null,
        currencies: body?.rates ? Object.keys(body.rates) : null,
      })
      return body
    }

    let finalAmount = null
    let appliedRate = null
    let finalCurrency = null
    let rateSource = null
    let rateDate = null
    let fxQuoteUsed = false
    let stripeFxQuoteId = null
    let stripeFxExpiresAt = null
    let stripeFxBaseRate = null
    let stripeFxFeeRate = null
    let stripeFxReferenceRate = null
    let stripeFxReferenceProvider = null
    let localBooking = null
    let referralCreditReservation = null
    // flow resolved above

    const extractSupportedLockDurations = (message) => {
      if (!message) return []
      const matches = String(message).match(/\"([a-z_]+)\"/gi)
      if (!matches) return []
      return matches
        .map((value) => value.replace(/\"/g, "").trim())
        .filter(Boolean)
    }

    const pickFallbackLockDuration = (supported) => {
      if (!Array.isArray(supported) || supported.length === 0) return null
      if (supported.includes("none")) return "none"
      return supported[0]
    }

    const requestStripeFxQuote = async (fromCurrency) => {
      try {
        return await createStripeFxQuote(fromCurrency)
      } catch (error) {
        const supported = extractSupportedLockDurations(error?.message)
        const fallbackDuration = pickFallbackLockDuration(supported)
        if (fallbackDuration && fallbackDuration !== stripeFxLockDuration) {
          logStripeFxDebug("quote.retry", {
            reason: "unsupported_lock_duration",
            fallbackDuration,
            supported,
          })
          return await createStripeFxQuote(fromCurrency, fallbackDuration)
        }
        throw error
      }
    }

    if (stripeFxEnabled && resolvedCurrency && String(resolvedCurrency).toUpperCase() !== "USD") {
      try {
        const stripeFx = await requestStripeFxQuote(resolvedCurrency)
        const rateEntry =
          stripeFx?.rates?.[String(resolvedCurrency).toLowerCase()] ||
          stripeFx?.rates?.[String(resolvedCurrency).toUpperCase()] ||
          null
        const rateDetails = rateEntry?.rate_details || {}
        const exchangeRate = Number(rateEntry?.exchange_rate || rateEntry?.rate || null)
        if (Number.isFinite(exchangeRate) && exchangeRate > 0) {
          finalAmount = amountUsd / exchangeRate
          appliedRate = exchangeRate
          finalCurrency = String(resolvedCurrency).toUpperCase()
          rateSource = "stripe_fx"
          rateDate = stripeFx?.created
            ? new Date(Number(stripeFx.created) * 1000).toISOString()
            : null
          fxQuoteUsed = true
          stripeFxQuoteId = stripeFx?.id || null
          stripeFxExpiresAt = stripeFx?.lock_expires_at || null
          stripeFxBaseRate = Number(rateDetails?.base_rate || rateEntry?.base_rate || null)
          stripeFxFeeRate = Number(
            rateDetails?.fx_fee_rate || rateEntry?.fx_fee_rate || rateEntry?.fee_rate || null,
          )
          stripeFxReferenceRate = Number(rateDetails?.reference_rate || null)
          stripeFxReferenceProvider = rateDetails?.reference_rate_provider || null
          logStripeFxDebug("quote.applied", {
            quoteId: stripeFxQuoteId,
            exchangeRate,
            baseRate: stripeFxBaseRate,
            feeRate: stripeFxFeeRate,
            referenceRate: stripeFxReferenceRate,
            referenceProvider: stripeFxReferenceProvider,
            expiresAt: stripeFxExpiresAt || null,
            targetCurrency: finalCurrency,
          })
        }
      } catch (error) {
        console.warn(`${logPrefix} stripe fx quote failed`, error?.message || error)
        logStripeFxDebug("quote.error", { message: error?.message || error })
      }
    } else {
      logStripeFxDebug("quote.skip", {
        enabled: stripeFxEnabled,
        resolvedCurrency: resolvedCurrency || null,
      })
    }

    if (!finalAmount || !finalCurrency) {
      if (flowId) {
        const fxQuote = flow?.pricing_snapshot_priced?.fxQuote ?? null
        const fxRate = Number(fxQuote?.rate)
        const fxCurrency = fxQuote?.currency || fxQuote?.targetCurrency || null
        if (Number.isFinite(fxRate) && fxRate > 0 && fxCurrency) {
          const expiresAt = fxQuote.expiresAt ? Date.parse(fxQuote.expiresAt) : null
          if (expiresAt && Date.now() > expiresAt) {
            return res.status(409).json({ error: "FX quote expired", code: "FX_QUOTE_EXPIRED" })
          }
          finalAmount = roundCurrency(amountUsd * fxRate)
          appliedRate = fxRate
          finalCurrency = String(fxCurrency || currency).toUpperCase()
          rateSource = fxQuote.source || null
          rateDate = fxQuote.rateDate || null
          fxQuoteUsed = true
          logStripeFxDebug("fallback.flowQuote", {
            flowId,
            amount: finalAmount,
            currency: finalCurrency,
            rate: appliedRate,
            rateDate,
          })
        }
      }
    }

    if (!finalAmount || !finalCurrency) {
      const converted = await convertCurrency(amountUsd, resolvedCurrency)
      finalAmount = converted.amount
      appliedRate = converted.rate
      finalCurrency = converted.currency
      rateSource = converted.source
      rateDate = converted.rateDate
      logStripeFxDebug("fallback.cache", {
        amount: finalAmount,
        currency: finalCurrency,
        rate: appliedRate,
        rateDate,
        source: rateSource,
      })
      if (flow && finalCurrency && Number.isFinite(appliedRate) && finalAmount) {
        const existingFxQuote = flow.pricing_snapshot_priced?.fxQuote ?? null
        const existingExpiresAt = existingFxQuote?.expiresAt
          ? Date.parse(existingFxQuote.expiresAt)
          : null
        const isExpired = existingExpiresAt && Date.now() > existingExpiresAt
        if (!existingFxQuote || isExpired) {
          const pricingSnapshot =
            flow.pricing_snapshot_priced && typeof flow.pricing_snapshot_priced === "object"
              ? { ...flow.pricing_snapshot_priced }
              : {}
          const expiresAt = new Date(Date.now() + fxQuoteTtlSeconds * 1000).toISOString()
          pricingSnapshot.fxQuote = {
            baseCurrency: "USD",
            targetCurrency: finalCurrency,
            rate: appliedRate,
            amount: finalAmount,
            source: rateSource || null,
            rateDate: rateDate || null,
            expiresAt,
          }
          flow.pricing_snapshot_priced = pricingSnapshot
          await flow.save()
        }
      }
    }

    console.info(`${logPrefix} currency conversion`, {
      base: amountUsd,
      providerBase: providerAmountUsd,
      markupRate,
      requestUserRole,
      pricingRole: publicPricingRole,
      target: finalAmount,
      currency: finalCurrency,
      rate: appliedRate,
      source: rateSource,
      rateDate,
      fxQuoteUsed,
      requestedCurrency,
      resolvedCurrency,
    })

    const flowRooms = Array.isArray(flowContext.rooms) ? flowContext.rooms : null
    const flowAdults =
      flowRooms?.reduce((sum, room) => {
        const adultsValue = Number(room?.adults ?? room?.adult ?? 0)
        return sum + (Number.isFinite(adultsValue) ? adultsValue : 0)
      }, 0) ?? null
    const flowChildren =
      flowRooms?.reduce((sum, room) => {
        const childrenRaw = room?.children ?? room?.childrenAges ?? room?.kids ?? []
        if (Array.isArray(childrenRaw)) return sum + childrenRaw.length
        const numeric = Number(childrenRaw)
        return sum + (Number.isFinite(numeric) ? numeric : 0)
      }, 0) ?? null

    const guestAdultsRaw = flowAdults ?? guests?.adults ?? req.body?.adults
    const guestChildrenRaw = flowChildren ?? guests?.children ?? req.body?.children
    const adults = Math.max(1, Number(guestAdultsRaw) || 1)
    const children = Math.max(0, Number(guestChildrenRaw) || 0)

    const guestEmail = holder?.email || req.user?.email
    if (!guestEmail) {
      console.warn(`${logPrefix} missing guest email`)
      return res.status(400).json({ error: "Missing guest email" })
    }

    const guestName = holder?.firstName
      ? `${holder.firstName} ${holder.lastName || ""}`.trim()
      : "Guest"

    console.info(`${logPrefix} normalized`, {
      adults,
      children,
      guestName,
      guestEmail: maskEmail(guestEmail),
      guestPhone: maskPhone(holder?.phone),
    })

    let inventorySnapshot = null
    let guestSnapshot = null
    const hotelIdValue = String(resolvedHotelId).trim()
    let webbedsHotelIdForStay = null
    try {
      const staticHotel = await models.WebbedsHotel.findOne({
        where: { hotel_id: hotelIdValue },
      })
      if (staticHotel?.hotel_id != null) {
        webbedsHotelIdForStay = String(staticHotel.hotel_id)
      }
      const staticPayload = formatStaticHotel(staticHotel)
      const locationFallback =
        staticPayload?.address ||
        [staticPayload?.city, staticPayload?.country].filter(Boolean).join(", ") ||
        null
      const hotelSnapshot = staticPayload
        ? {
          id: staticPayload.id,
          name: staticPayload.name,
          city: staticPayload.city,
          country: staticPayload.country,
          rating: staticPayload.rating ?? null,
          address: staticPayload.address ?? null,
          geoPoint: staticPayload.geoPoint ?? null,
          image: staticPayload.coverImage ?? null,
          chain: staticPayload.chain ?? null,
          classification: staticPayload.classification ?? null,
        }
        : {
          id: hotelIdValue,
          name: null,
          city: null,
          country: null,
          rating: null,
          address: null,
          geoPoint: null,
          image: null,
          chain: null,
          classification: null,
        }

      inventorySnapshot = {
        hotelId: hotelIdValue,
        hotelName: hotelSnapshot?.name ?? null,
        hotelImage: hotelSnapshot?.image ?? null,
        location: locationFallback,
        hotel: hotelSnapshot,
        room: roomName ? { name: roomName } : null,
      }
    } catch (snapshotError) {
      console.warn(`${logPrefix} static hotel snapshot failed`, {
        hotelId,
        error: snapshotError?.message || snapshotError,
      })
    }

    guestSnapshot = {
      name: guestName,
      email: guestEmail,
      phone: holder?.phone || null,
      adults,
      children,
    }

    const walletFeatureEnabled = isGuestWalletHotelsEnabled()
    const walletRequested = walletFeatureEnabled && Boolean(useWallet)
    const walletRewardReleaseAt = resolveRewardReleaseAt({ flow, bookedAt: new Date() })
    const walletRewardReleaseAtIso = walletRewardReleaseAt?.toISOString?.() || null

    const paymentScopeKey = buildPaymentScopeKey({
      flow,
      bookingId,
      hotelId: resolvedHotelId,
      checkIn: resolvedCheckIn,
      checkOut: resolvedCheckOut,
      guests: { adults, children },
      userId,
    })
    localBooking = await findPendingBookingByPaymentScope({
      userId,
      flowId: flow.id,
      bookingId,
      paymentScopeKey,
    })
    if (localBooking) {
      booking_ref = localBooking.booking_ref
      const existingReferralStatus = String(
        localBooking?.pricing_snapshot?.referralCredit?.status ||
          localBooking?.pricing_snapshot?.referral_credit?.status ||
          localBooking?.meta?.referralCredit?.status ||
          localBooking?.meta?.referral_credit?.status ||
          "",
      )
        .trim()
        .toLowerCase()
      if (existingReferralStatus === "reserved") {
        await restoreReferralCreditForBooking({ booking: localBooking }).catch(() => {})
      }
    }

    const pricingConversionRate = amountUsd > 0 ? roundCurrency(finalAmount / amountUsd) : 1
    const providerAmountDisplay = roundCurrency(providerAmountUsd * pricingConversionRate)
    const publicAmountDisplay = roundCurrency(amountUsd * pricingConversionRate)
    const minimumSellingDisplay = roundCurrency((minimumSelling ?? 0) * pricingConversionRate)
    const totalBeforeDiscount = roundCurrency(finalAmount)
    let referralCreditPreview = null
    let totalDiscountAmount = 0
    let totalDiscountAmountUsd = 0
    if (req.user?.id && publicPricingRole === 20 && walletRequested) {
      referralCreditPreview = await previewReferralCreditForBooking({
        userId: req.user.id,
        providerTotalAmount: providerAmountDisplay,
        publicTotalAmount: publicAmountDisplay,
        minimumSellingAmount: minimumSellingDisplay,
        currency: finalCurrency,
      })
      if (Number(referralCreditPreview?.appliedMinor || 0) > 0) {
        referralCreditReservation = await reserveReferralCreditForBooking({
          userId: req.user.id,
          providerTotalAmount: providerAmountDisplay,
          publicTotalAmount: publicAmountDisplay,
          minimumSellingAmount: minimumSellingDisplay,
          currency: finalCurrency,
          bookingId: bookingId || null,
          bookingRef: booking_ref || null,
        })
        referralCreditPreview = referralCreditReservation
      }
      totalDiscountAmount = roundCurrency(
        parseCurrencyDisplayAmount(referralCreditPreview?.appliedDisplay) ??
          Number(referralCreditPreview?.appliedUsd || 0),
      )
      totalDiscountAmountUsd = roundCurrency(Number(referralCreditPreview?.appliedUsd || 0))
    }
    const grossTotal = roundCurrency(Math.max(0, totalBeforeDiscount - totalDiscountAmount))
    const grossTotalUsd = roundCurrency(Math.max(0, amountUsd - totalDiscountAmountUsd))
    console.info(
      `${logPrefix} ###netprice: ${roundCurrency(providerAmountUsd)}###markup applied: ${roundCurrency(
        canonicalPricing.publicMarkupAmount || 0,
      )}###benefit applied: ${roundCurrency(totalDiscountAmount)}###final price: ${roundCurrency(
        grossTotal,
      )}###`,
      {
        flowId,
        bookingId,
        currency: finalCurrency,
        referralCreditApplied: roundCurrency(totalDiscountAmount),
        referralCreditAppliedUsd: roundCurrency(totalDiscountAmountUsd),
        referralCreditActive: Boolean(referralCreditPreview?.apply),
      },
    )

    const baseMeta = {
      hotelId: resolvedHotelId,
      hotelName: inventorySnapshot?.hotelName ?? null,
      hotelImage: inventorySnapshot?.hotelImage ?? null,
      roomName,
      location: inventorySnapshot?.location ?? null,
      guests: { adults, children },
      flowId: flow.id,
      paymentScopeKey,
      ...(referral.influencerId
        ? {
          referral: {
            influencerUserId: referral.influencerId,
            code: referral.code || null,
          },
        }
        : {}),
      ...(referralCreditPreview?.apply
        ? {
          referralCredit: {
            totalMinor: Math.max(0, Math.round(Number(referralCreditPreview.totalMinor || 0))),
            availableMinor: Math.max(0, Math.round(Number(referralCreditPreview.availableMinor || 0))),
            usedMinor: Math.max(0, Math.round(Number(referralCreditPreview.usedMinor || 0))),
            appliedUsd: roundCurrency(referralCreditPreview.appliedUsd || 0),
            appliedDisplay: referralCreditPreview.appliedDisplay || null,
            appliedMinor: Math.max(0, Math.round(Number(referralCreditPreview.appliedMinor || 0))),
            availableUsd: roundCurrency(referralCreditPreview.availableUsd || 0),
            availableDisplay: referralCreditPreview.availableDisplay || null,
            remainingChargeUsd: roundCurrency(referralCreditPreview.remainingChargeUsd || 0),
            remainingChargeDisplay: referralCreditPreview.remainingChargeDisplay || null,
            minimumSellingDisplay: referralCreditPreview.minimumSellingDisplay || null,
            currency: referralCreditPreview.currency || finalCurrency,
            expiresAt: referralCreditPreview.expiresAt || null,
            grantedAt: referralCreditPreview.grantedAt || null,
            sourceInfluencerId: referralCreditPreview.sourceInfluencerId || null,
            sourceCode: referralCreditPreview.sourceCode || null,
            status: referralCreditPreview.reserved ? "reserved" : "preview",
          },
        }
        : {}),
      basePriceUsd: providerAmountUsd,
      providerAmountUsd,
      chargedBasePriceUsd: amountUsd,
      publicMarkedAmount,
      minimumSelling,
      publicMarkupAmount: canonicalPricing.publicMarkupAmount,
      publicMarkupRate: markupRate,
      effectiveAmount: amountUsd,
      pricingRole: publicPricingRole,
      requestUserRole,
      exchangeRate: appliedRate,
      exchangeRateSource: rateSource || null,
      exchangeRateDate: rateDate || null,
      fxQuoteUsed,
      stripeFxQuoteId,
      stripeFxRate: stripeFxQuoteId ? appliedRate : null,
      stripeFxBaseRate,
      stripeFxFeeRate,
      stripeFxReferenceRate,
      stripeFxReferenceProvider,
      stripeFxExpiresAt,
      benefit: referralCreditPreview?.apply
        ? {
          type: "REFERRAL_CREDIT",
          amountUsd: roundCurrency(totalDiscountAmountUsd),
          amount: roundCurrency(totalDiscountAmount),
          currency: finalCurrency,
        }
        : null,
    }

    const basePricingSnapshotPayload = {
      flowId: flow.id,
      totalBeforeDiscount,
      referralCredit: referralCreditPreview?.apply
        ? {
          totalMinor: Math.max(0, Math.round(Number(referralCreditPreview.totalMinor || 0))),
          availableMinor: Math.max(0, Math.round(Number(referralCreditPreview.availableMinor || 0))),
          usedMinor: Math.max(0, Math.round(Number(referralCreditPreview.usedMinor || 0))),
          appliedUsd: roundCurrency(referralCreditPreview.appliedUsd || 0),
          appliedDisplay: referralCreditPreview.appliedDisplay || null,
          appliedMinor: Math.max(0, Math.round(Number(referralCreditPreview.appliedMinor || 0))),
          availableUsd: roundCurrency(referralCreditPreview.availableUsd || 0),
          availableDisplay: referralCreditPreview.availableDisplay || null,
          remainingChargeUsd: roundCurrency(referralCreditPreview.remainingChargeUsd || 0),
          remainingChargeDisplay: referralCreditPreview.remainingChargeDisplay || null,
          minimumSellingDisplay: referralCreditPreview.minimumSellingDisplay || null,
          currency: referralCreditPreview.currency || finalCurrency,
          expiresAt: referralCreditPreview.expiresAt || null,
          grantedAt: referralCreditPreview.grantedAt || null,
          sourceInfluencerId: referralCreditPreview.sourceInfluencerId || null,
          sourceCode: referralCreditPreview.sourceCode || null,
          status: referralCreditPreview.reserved ? "reserved" : "preview",
        }
        : null,
      totalDiscountAmount,
      totalDiscountAmountUsd,
      totalBeforeWallet: grossTotal,
      totalBeforeWalletUsd: grossTotalUsd,
      total: grossTotal,
      totalUsd: grossTotalUsd,
      currency: finalCurrency,
      providerAmountUsd,
      publicMarkedAmount,
      minimumSelling,
      publicMarkupAmount: canonicalPricing.publicMarkupAmount,
      effectiveAmount: amountUsd,
      effectivePublicAmount: amountUsd,
      benefit: referralCreditPreview?.apply
        ? {
          type: "REFERRAL_CREDIT",
          amountUsd: roundCurrency(totalDiscountAmountUsd),
          amount: roundCurrency(totalDiscountAmount),
          currency: finalCurrency,
        }
        : null,
    }

    const baseBookingPayload = {
      user_id: req.user?.id || null,
      influencer_user_id: referral.influencerId,
      flow_id: flow.id,
      source: "PARTNER",
      inventory_type: "WEBBEDS_HOTEL",
      inventory_id: String(resolvedHotelId),
      external_ref: bookingId,
      check_in: resolvedCheckIn,
      check_out: resolvedCheckOut,
      guest_name: guestName,
      guest_email: guestEmail,
      guest_phone: holder?.phone || null,
      adults,
      children,
      status: "PENDING",
      payment_status: "UNPAID",
      gross_price: grossTotal,
      currency: finalCurrency,
      pricing_snapshot: basePricingSnapshotPayload,
      meta: baseMeta,
      inventory_snapshot: inventorySnapshot,
      guest_snapshot: guestSnapshot,
    }
    const isExistingBooking = Boolean(localBooking)
    const previousPaymentIntentId = localBooking?.payment_intent_id || null
    if (isExistingBooking) {
      booking_ref = localBooking.booking_ref
      await localBooking.update({
        ...baseBookingPayload,
        payment_provider: "STRIPE",
      })
      console.info(`${logPrefix} local booking refreshed`, {
        localBookingId: localBooking.id,
        bookingRef: booking_ref,
      })
    } else {
      booking_ref = `WB-${Date.now().toString(36).toUpperCase()}`
      localBooking = await models.Booking.create({
        booking_ref,
        payment_provider: "STRIPE",
        ...baseBookingPayload,
      })
      console.info(`${logPrefix} local booking created`, {
        localBookingId: localBooking.id,
        bookingRef: booking_ref,
      })
    }

    if (!isExistingBooking && models.StayHotel) {
      const parsedHotelId = Number(hotelIdValue)
      let hotelIdForStay = Number.isFinite(parsedHotelId) ? parsedHotelId : null
      if (hotelIdForStay != null && models.Hotel) {
        const localHotel = await models.Hotel.findByPk(hotelIdForStay, { attributes: ["id"] })
        if (!localHotel) hotelIdForStay = null
      }
      const roomSnapshot = roomName ? { name: roomName } : null
      await models.StayHotel.create({
        stay_id: localBooking.id,
        hotel_id: hotelIdForStay,
        webbeds_hotel_id: webbedsHotelIdForStay,
        room_id: null,
        room_name: roomName || null,
        room_snapshot: roomSnapshot,
      })
      console.info(`${logPrefix} stay_hotel created`, {
        stayId: localBooking.id,
        hotelId: hotelIdForStay,
        webbedsHotelId: webbedsHotelIdForStay,
        webbedsHotelIdRaw: hotelIdValue,
      })
    }

    let walletHoldResult = null
    if (walletRequested) {
      walletHoldResult = await holdForHotelPayment({
        userId,
        stayId: localBooking.id,
        paymentScopeKey,
        publicTotalUsd: grossTotalUsd,
        minimumSellingUsd: minimumSelling ?? 0,
        meta: {
          bookingRef: localBooking.booking_ref || booking_ref || null,
          flowId: flow.id,
          bookingId,
          requestId: requestTag,
        },
      })
    } else {
      await releaseHold({
        userId,
        stayId: localBooking.id,
        paymentScopeKey,
        reason: "wallet_not_requested",
      })
    }

    const walletAppliedUsd = roundCurrency(walletHoldResult?.appliedUsd || 0)
    const walletAppliedMinor = Math.max(0, Number(walletHoldResult?.appliedMinor) || 0)
    const chargeAfterWalletUsd = roundCurrency(
      walletHoldResult?.chargeAfterWalletUsd ?? grossTotalUsd
    )
    const chargeAfterWallet =
      grossTotalUsd > 0
        ? roundCurrency(grossTotal * (chargeAfterWalletUsd / grossTotalUsd))
        : grossTotal
    const walletAppliedAmount = roundCurrency(Math.max(0, grossTotal - chargeAfterWallet))
    const rewardPendingUsd = roundCurrency(grossTotalUsd * 0.02)
    const walletBlockedByMinimumSelling = roundCurrency(
      Math.max(0, grossTotalUsd - (minimumSelling ?? 0))
    ) <= 0
    const pricingSnapshotPayload = {
      ...basePricingSnapshotPayload,
      total: chargeAfterWallet,
      totalUsd: chargeAfterWalletUsd,
      wallet: walletFeatureEnabled
        ? {
          requested: walletRequested,
          appliedUsd: walletAppliedUsd,
          appliedAmount: walletAppliedAmount,
          chargeAfterWalletUsd,
          chargeAfterWallet,
          blockedByMinimumSelling: walletBlockedByMinimumSelling,
          holdId: walletHoldResult?.holdId || null,
          rewardPendingUsd,
          rewardReleaseAt: walletRewardReleaseAtIso,
        }
        : null,
    }
    const finalBookingPayload = {
      ...baseBookingPayload,
      gross_price: chargeAfterWallet,
      pricing_snapshot: pricingSnapshotPayload,
      meta: {
        ...baseMeta,
        wallet: walletFeatureEnabled
          ? {
            requested: walletRequested,
            appliedUsd: walletAppliedUsd,
            appliedAmount: walletAppliedAmount,
            chargeAfterWalletUsd,
            chargeAfterWallet,
            blockedByMinimumSelling: walletBlockedByMinimumSelling,
            holdId: walletHoldResult?.holdId || null,
            rewardPendingUsd,
            rewardReleaseAt: walletRewardReleaseAtIso,
          }
          : null,
      },
    }

    const zeroDecimalCurrencies = new Set([
      "BIF",
      "CLP",
      "DJF",
      "GNF",
      "JPY",
      "KMF",
      "KRW",
      "MGA",
      "PYG",
      "RWF",
      "UGX",
      "VND",
      "VUV",
      "XAF",
      "XOF",
      "XPF",
    ])
    const threeDecimalCurrencies = new Set(["BHD", "JOD", "KWD", "OMR", "TND"])
    const currencyUpper = String(finalCurrency || "USD").toUpperCase()
    const minorUnit = threeDecimalCurrencies.has(currencyUpper)
      ? 3
      : zeroDecimalCurrencies.has(currencyUpper)
        ? 0
        : 2
    const amountForStripe = Math.round(chargeAfterWallet * Math.pow(10, minorUnit))
    let reusablePaymentIntent = null
    if (previousPaymentIntentId) {
      try {
        const existingPaymentIntent = await stripe.paymentIntents.retrieve(previousPaymentIntentId)
        const sameAmount =
          Number(existingPaymentIntent?.amount) === Number(amountForStripe) &&
          String(existingPaymentIntent?.currency || "").toLowerCase() ===
            String(currencyUpper || "").toLowerCase()
        if (sameAmount && isReusablePaymentIntentStatus(existingPaymentIntent?.status)) {
          reusablePaymentIntent = existingPaymentIntent
        } else if (
          isReusablePaymentIntentStatus(existingPaymentIntent?.status) &&
          existingPaymentIntent?.status !== "canceled"
        ) {
          try {
            await stripe.paymentIntents.cancel(existingPaymentIntent.id, {
              cancellation_reason: "abandoned",
            })
          } catch (cancelExistingIntentError) {
            console.warn(`${logPrefix} previous payment intent cancel failed`, {
              localBookingId: localBooking.id,
              paymentIntentId: existingPaymentIntent.id,
              error: cancelExistingIntentError?.message || cancelExistingIntentError,
            })
          }
        }
      } catch (paymentIntentLookupError) {
        console.warn(`${logPrefix} existing payment intent lookup failed`, {
          localBookingId: localBooking.id,
          paymentIntentId: previousPaymentIntentId,
          error: paymentIntentLookupError?.message || paymentIntentLookupError,
        })
      }
    }

    if (reusablePaymentIntent) {
      if (walletRequested && walletHoldResult?.holdId) {
        await models.GuestWalletHold.update(
          { payment_intent_id: reusablePaymentIntent.id },
          { where: { id: walletHoldResult.holdId } },
        )
      }
      await localBooking.update({
        ...finalBookingPayload,
        payment_intent_id: reusablePaymentIntent.id,
        payment_provider: "STRIPE",
        charge_amount_minor: amountForStripe,
        charge_currency: currencyUpper,
      })
      console.info(`${logPrefix} reusing existing payment intent`, {
        localBookingId: localBooking.id,
        paymentIntentId: reusablePaymentIntent.id,
        paymentIntentStatus: reusablePaymentIntent.status,
        walletRequested,
        walletAppliedUsd,
      })
      return res.json(
        buildPaymentIntentResponse({
          booking: localBooking,
          paymentIntent: reusablePaymentIntent,
          flowId: flow.id,
          pricingSnapshot: pricingSnapshotPayload,
        }),
      )
    }

    const paymentIntentParams = {
      amount: amountForStripe,
      currency: currencyUpper.toLowerCase(),
      metadata: {
        bookingId: String(localBooking.id),
        webbedsId: String(bookingId),
        source: "WEBBEDS",
      },
      capture_method: "manual",
      automatic_payment_methods: { enabled: true },
    }

    if (stripeFxQuoteId) {
      paymentIntentParams.fx_quote = stripeFxQuoteId
    }

    const paymentIntentOptions = {
      ...(stripeFxQuoteId && stripeFxVersion ? { apiVersion: stripeFxVersion } : {}),
      idempotencyKey: buildPaymentIntentIdempotencyKey({
        paymentScopeKey,
        amountForStripe,
        currency: currencyUpper,
        walletAppliedMinor,
      }),
    }
    logStripeFxDebug("paymentIntent.create", {
      amount: amountForStripe,
      currency: currencyUpper.toLowerCase(),
      fxQuote: stripeFxQuoteId || null,
      apiVersion: paymentIntentOptions?.apiVersion || null,
    })

    let paymentIntent = null
    try {
      paymentIntent = await stripe.paymentIntents.create(
        paymentIntentParams,
        paymentIntentOptions,
      )
    } catch (paymentIntentCreateError) {
      if (walletRequested) {
        await runWalletBookingMutation({
          booking: localBooking,
          action: "release_hold",
          context: {
            source: "create_payment_intent",
            reason: "payment_intent_create_failed",
            paymentScopeKey,
          },
          mutation: () =>
            releaseHold({
              userId,
              stayId: localBooking.id,
              paymentScopeKey,
              reason: "payment_intent_create_failed",
            }),
        }).catch(() => {})
      }
      if (referralCreditReservation?.reserved) {
        await restoreReferralCreditForBooking({ booking: localBooking }).catch(() => {})
        referralCreditReservation = null
      }
      throw paymentIntentCreateError
    }
    logStripeFxDebug("paymentIntent.created", {
      id: paymentIntent?.id || null,
      currency: paymentIntent?.currency || null,
      amount: paymentIntent?.amount || null,
      fxQuote: paymentIntent?.fx_quote || stripeFxQuoteId || null,
    })
    console.info(`${logPrefix} payment intent created`, { paymentIntentId: paymentIntent.id })

    // 3. Update Local Booking with Payment Intent ID
    if (walletRequested && walletHoldResult?.holdId) {
      await models.GuestWalletHold.update(
        { payment_intent_id: paymentIntent.id },
        { where: { id: walletHoldResult.holdId } },
      )
    }
    await localBooking.update({
      ...finalBookingPayload,
      payment_intent_id: paymentIntent.id,
      payment_provider: "STRIPE",
      charge_amount_minor: amountForStripe,
      charge_currency: currencyUpper,
    })
    console.info(`${logPrefix} local booking updated`, { paymentIntentId: paymentIntent.id })

    res.json(
      buildPaymentIntentResponse({
        booking: localBooking,
        paymentIntent,
        flowId: flow.id,
        pricingSnapshot: pricingSnapshotPayload,
      }),
    )

  } catch (error) {
    if (referralCreditReservation?.reserved && localBooking) {
      await restoreReferralCreditForBooking({ booking: localBooking }).catch(() => {})
      referralCreditReservation = null
    }
    console.error("[webbeds] createPaymentIntent error", error)
    next(error)
  }
}

export const capturePaymentIntent = async (req, res, next) => {
  try {
    const { paymentIntentId, localBookingId } = req.body || {}
    if (!paymentIntentId && !localBookingId) {
      return res.status(400).json({ error: "Missing paymentIntentId or localBookingId" })
    }

    let booking = null
    if (localBookingId) {
      booking = await models.Booking.findByPk(localBookingId)
    }
    if (!booking && paymentIntentId) {
      booking = await models.Booking.findOne({ where: { payment_intent_id: paymentIntentId } })
    }
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" })
    }
    if (booking?.user_id && req.user?.id && booking.user_id !== req.user.id && !isPrivilegedUser(req.user)) {
      return res.status(403).json({ error: "Forbidden" })
    }

    const stripe = await getStripeClient()
    const intentId = paymentIntentId || booking?.payment_intent_id
    if (!intentId) return res.status(404).json({ error: "Payment intent not found" })

    // Verify the PI belongs to this booking (prevents cross-PI attack)
    if (booking.payment_intent_id && intentId !== booking.payment_intent_id && !isPrivilegedUser(req.user)) {
      console.warn("[webbeds] capturePaymentIntent: PI mismatch", {
        bookingId: booking.id,
        bookingPI: booking.payment_intent_id,
        requestedPI: intentId,
      })
      return res.status(403).json({ error: "Payment intent does not belong to this booking" })
    }

    const pi = await stripe.paymentIntents.retrieve(intentId)
    let captureResult = null
    if (pi.status === "requires_capture") {
      captureResult = await stripe.paymentIntents.capture(intentId)
    }

    if (booking) {
      const updates = { payment_status: "PAID" }
      if (booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") {
        updates.status = "CONFIRMED"
      }
      if (!booking.booked_at) {
        updates.booked_at = new Date()
      }
      await booking.update(updates)
      try {
        await runWalletBookingMutation({
          booking,
          action: "capture_hold",
          context: {
            source: "capture_payment_intent",
            paymentIntentId: intentId,
          },
          mutation: () =>
            captureHold({
              userId: booking.user_id,
              stayId: booking.id,
              paymentIntentId: intentId,
            }),
        })
        await runWalletBookingMutation({
          booking,
          action: "schedule_earn",
          context: {
            source: "capture_payment_intent",
            paymentIntentId: intentId,
          },
          mutation: () =>
            scheduleEarn({
              userId: booking.user_id,
              stayId: booking.id,
              publicTotalUsd:
                Number(booking.pricing_snapshot?.totalBeforeWalletUsd) ||
                Number(booking.meta?.wallet?.chargeAfterWalletUsd) +
                  Number(booking.meta?.wallet?.appliedUsd) ||
                Number(booking.pricing_snapshot?.effectivePublicAmount) ||
                0,
              // Fallback for multi-currency: gross_price may be in non-USD
              grossAmount: Number(booking.gross_price) || null,
              grossCurrency: booking.currency || "USD",
              releaseAt:
                booking.pricing_snapshot?.wallet?.rewardReleaseAt ||
                booking.meta?.wallet?.rewardReleaseAt ||
                null,
              bookingRef: booking.booking_ref || null,
            }),
        })
      } catch (walletCaptureError) {
        console.error("[webbeds] capturePaymentIntent wallet hooks failed", {
          bookingId: booking.id,
          paymentIntentId: intentId,
          error: walletCaptureError?.message || walletCaptureError,
        })
      }

      // --- NOTIFICATIONS (Email & Chat) ---
      try {
        const hotelId = booking.inventory_id
        const hotelName = booking.meta?.hotelName || "Hotel"
        const hotelImage = booking.meta?.hotelImage
        const addressText = booking.meta?.location || "Hotel Location"
        const checkInDate = new Date(booking.check_in)
        const checkOutDate = new Date(booking.check_out)
        const nightsCount = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24))

        // 1. Send Booking Email
        const bookingForEmail = await models.Stay.findByPk(booking.id, {
          include: [
            {
              model: models.StayHotel,
              as: "hotelStay",
              required: false,
              include: [
                { model: models.Hotel, as: "hotel", required: false },
                { model: models.WebbedsHotel, as: "webbedsHotel", required: false },
                { model: models.Room, as: "room", required: false },
              ],
            },
          ],
        })
        const emailPayload = buildBookingEmailPayload(bookingForEmail || booking)
        if (emailPayload) {
          await sendBookingEmail(emailPayload, emailPayload.guestEmail || booking.guest_email).catch((err) =>
            console.error("[webbeds] sendBookingEmail failed", err),
          )
        }

        try {
          await dispatchBookingConfirmation(bookingForEmail || booking)
        } catch (err) {
          console.warn("[webbeds] booking confirmation message failed:", err?.message || err)
        }

        // 2. Trigger Chat Auto-Prompts (using Support Bot)
        const supportUserId = process.env.HOTEL_SUPPORT_USER_ID
        const supportUserIdValue = supportUserId ? Number(supportUserId) : null
        if (
          Number.isFinite(supportUserIdValue) &&
          supportUserIdValue > 0 &&
          booking.user_id
        ) {
          const supportUser = await models.User.findByPk(supportUserIdValue, {
            attributes: ["id"],
          })
          if (!supportUser) {
            console.warn(
              "[webbeds] Skipped chat prompts: HOTEL_SUPPORT_USER_ID not found",
              { supportUserId: supportUserIdValue, bookingId: booking.id ?? null },
            )
          } else {
          triggerBookingAutoPrompts({
            trigger: PROMPT_TRIGGERS.BOOKING_CREATED,
            guestUserId: booking.user_id,
            hostUserId: supportUserIdValue, // The system/bot user
            homeId: null, // It's a hotel
            reserveId: booking.id,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            homeSnapshotName: hotelName,
            homeSnapshotImage: hotelImage,
          }).catch(err => console.error("[webbeds] triggerBookingAutoPrompts failed", err))
          }
        } else {
          console.warn("[webbeds] Skipped chat prompts: missing HOTEL_SUPPORT_USER_ID or booking.user_id")
        }

      } catch (notifyErr) {
        console.error("[webbeds] Notification error", notifyErr)
      }
    }

    return res.json({
      paymentIntentId: intentId,
      status: captureResult?.status || pi.status,
      bookingId: booking?.id || null,
    })
  } catch (error) {
    console.error("[webbeds] capturePaymentIntent error", error)

    if (booking?.flow_id) {
      try {
        const orchestrator = new FlowOrchestratorService()
        await orchestrator.emergencyCancel({ flowId: booking.flow_id })
      } catch (cancelErr) {
        console.error("[webbeds] capturePaymentIntent: emergencyCancel failed", {
          bookingId: booking?.id,
          flowId: booking?.flow_id,
          error: cancelErr?.message,
        })
      }
    }
    next(error)
  }
}

export const cancelPaymentIntent = async (req, res, next) => {
  try {
    const { paymentIntentId, localBookingId, reason } = req.body || {}
    if (!paymentIntentId && !localBookingId) {
      return res.status(400).json({ error: "Missing paymentIntentId or localBookingId" })
    }

    let booking = null
    if (localBookingId) {
      booking = await models.Booking.findByPk(localBookingId)
    }
    if (!booking && paymentIntentId) {
      booking = await models.Booking.findOne({ where: { payment_intent_id: paymentIntentId } })
    }
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" })
    }
    if (booking?.user_id && req.user?.id && booking.user_id !== req.user.id && !isPrivilegedUser(req.user)) {
      return res.status(403).json({ error: "Forbidden" })
    }

    const stripe = await getStripeClient()
    const intentId = paymentIntentId || booking?.payment_intent_id
    if (!intentId) return res.status(404).json({ error: "Payment intent not found" })

    const pi = await stripe.paymentIntents.retrieve(intentId)
    let cancelResult = null
    if (pi.status !== "canceled") {
      const normalizedReason = String(reason || "").trim().toLowerCase()
      const reasonMap = {
        failed_booking: "abandoned",
        failedbooking: "abandoned",
      }
      const allowedReasons = new Set([
        "duplicate",
        "fraudulent",
        "requested_by_customer",
        "abandoned",
      ])
      const mappedReason = reasonMap[normalizedReason] || normalizedReason
      const cancelParams =
        mappedReason && allowedReasons.has(mappedReason)
          ? { cancellation_reason: mappedReason }
          : undefined
      cancelResult = await stripe.paymentIntents.cancel(intentId, cancelParams)
    }

    const shouldRestoreReferralCredit =
      booking &&
      booking.status !== "CONFIRMED" &&
      booking.status !== "COMPLETED"

    if (booking) {
      const updates = { payment_status: "UNPAID" }
      if (booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") {
        updates.status = "CANCELLED"
      }
      await booking.update(updates)
      try {
        await runWalletBookingMutation({
          booking,
          action: "release_hold",
          context: {
            source: "cancel_payment_intent",
            paymentIntentId: intentId,
            reason: reason || "payment_intent_cancelled",
          },
          mutation: () =>
            releaseHold({
              userId: booking.user_id,
              stayId: booking.id,
              paymentScopeKey: booking.meta?.paymentScopeKey || null,
              paymentIntentId: intentId,
              reason: reason || "payment_intent_cancelled",
            }),
        })
      } catch (walletReleaseError) {
        console.error("[webbeds] cancelPaymentIntent wallet release failed", {
          bookingId: booking.id,
          paymentIntentId: intentId,
          error: walletReleaseError?.message || walletReleaseError,
        })
      }

      if (shouldRestoreReferralCredit) {
        try {
          await restoreReferralCreditForBooking({ booking })
        } catch (referralCreditRestoreError) {
          console.error("[webbeds] cancelPaymentIntent referral credit restore failed", {
            bookingId: booking.id,
            paymentIntentId: intentId,
            error: referralCreditRestoreError?.message || referralCreditRestoreError,
          })
        }
      }
    }

    return res.json({
      paymentIntentId: intentId,
      status: cancelResult?.status || pi.status,
      bookingId: booking?.id || null,
    })
  } catch (error) {
    console.error("[webbeds] cancelPaymentIntent error", error)
    next(error)
  }
}

export const getMerchantPaymentContext = async (req, res, next) => {
  try {
    const cached = await cache.get(MERCHANT_CONTEXT_CACHE_KEY)
    return res.json({
      context: summarizeMerchantContext(cached),
      configuredMode: WEBBEDS_PAYMENT_CONTEXT_MODE,
      ttlSeconds: MERCHANT_CONTEXT_TTL_SECONDS,
      merchantPublicIp: String(process.env.WEBBEDS_MERCHANT_PUBLIC_IP || "").trim() || null,
    })
  } catch (error) {
    next(error)
  }
}

export const setMerchantPaymentContext = async (req, res, next) => {
  try {
    const devicePayload = String(req.body?.devicePayload || "").trim()
    const sdkUrl = String(req.body?.sdkUrl || "").trim() || null
    const source = String(req.body?.source || "merchant-sdk").trim() || "merchant-sdk"

    if (!devicePayload) {
      return res.status(400).json({ error: "devicePayload is required" })
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + MERCHANT_CONTEXT_TTL_SECONDS * 1000)
    const cacheEntry = {
      devicePayload,
      source,
      sdkUrl,
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      updatedByUserId: Number(req.user?.id) || null,
    }

    await cache.set(MERCHANT_CONTEXT_CACHE_KEY, cacheEntry, MERCHANT_CONTEXT_TTL_SECONDS)

    return res.status(201).json({
      ok: true,
      context: summarizeMerchantContext(cacheEntry),
    })
  } catch (error) {
    next(error)
  }
}

export const clearMerchantPaymentContext = async (req, res, next) => {
  try {
    await cache.del(MERCHANT_CONTEXT_CACHE_KEY)
    return res.json({
      ok: true,
      context: summarizeMerchantContext(null),
    })
  } catch (error) {
    next(error)
  }
}


export const listStaticHotels = async (req, res, next) => {
  try {
    const {
      cityCode,
      countryCode,
      q,
      limit = 20,
      offset = 0,
      preferred,
      hotelId,
      hotelIds,
      lite,
      imagesLimit,
    } = req.query

    const where = {}
    const hotelIdList = parseCsvList(hotelIds)
    if (hotelIdList.length) {
      where.hotel_id = { [Op.in]: hotelIdList }
    } else if (hotelId) {
      where.hotel_id = String(hotelId).trim()
    }
    if (cityCode) {
      where.city_code = String(cityCode).trim()
    }
    if (countryCode) {
      where.country_code = String(countryCode).trim()
    }
    if (q) {
      where.name = { [iLikeOp]: `%${q.trim()}%` }
    }
    if (preferred === "true") {
      where.preferred = true
    }

    const useLite = String(lite || "").trim().toLowerCase() === "true"
    const limitBase = Number(limit) || (hotelIdList.length ? hotelIdList.length : 20)
    const maxLimit = hotelIdList.length || hotelId ? 100 : 25
    const safeLimit = Math.min(maxLimit, Math.max(1, limitBase))
    const safeOffset = Math.max(0, Number(offset) || 0)
    const imagesLimitValue = Number(imagesLimit)
    const safeImagesLimit = Number.isFinite(imagesLimitValue)
      ? Math.max(0, Math.min(imagesLimitValue, 200))
      : (useLite ? 1 : null)
    const partnerProfileCacheVersion = await getPartnerHotelProfileCacheVersion()

    const cacheKey = STATIC_HOTELS_CACHE_DISABLED
      ? null
      : buildStaticHotelsCacheKey({
        cityCode: cityCode ? String(cityCode).trim() : null,
        countryCode: countryCode ? String(countryCode).trim() : null,
        q: q ? String(q).trim().toLowerCase() : null,
        preferred: preferred === "true",
        hotelId: hotelId ? String(hotelId).trim() : null,
        hotelIds: hotelIdList.length ? hotelIdList : null,
        limit: safeLimit,
        offset: safeOffset,
        lite: useLite,
        imagesLimit: safeImagesLimit,
        partnerProfileCacheVersion,
      })

    if (cacheKey) {
      const cached = await cache.get(cacheKey)
      if (cached) {
        res.set("Cache-Control", `private, max-age=${STATIC_HOTELS_CACHE_TTL_SECONDS}`)
        res.set("X-Cache", "HIT")
        return res.json(cached)
      }
    }

    const { rows, count } = await models.WebbedsHotel.findAndCountAll({
      where,
      attributes: getStaticHotelAttributes(useLite),
      include: getStaticHotelIncludes(),
      distinct: true,
      col: "hotel_id",
      order: [
        ["priority", "DESC"],
        ["name", "ASC"],
      ],
      limit: safeLimit,
      offset: safeOffset,
    })

    let items = rows.map((row) => formatStaticHotel(row, { imageLimit: safeImagesLimit }))
    items = await attachPartnerProgramToHotelItems(items)
    items = sortPartnerFirstWithFallback(
      items,
      (a, b) =>
        Number(b?.priority ?? 0) - Number(a?.priority ?? 0) ||
        String(a?.name || "").localeCompare(String(b?.name || "")),
    )

    const responsePayload = {
      items,
      pagination: {
        total: count,
        limit: safeLimit,
        offset: safeOffset,
      },
    }

    if (cacheKey) {
      await cache.set(cacheKey, responsePayload, STATIC_HOTELS_CACHE_TTL_SECONDS)
    }
    res.set("Cache-Control", `private, max-age=${STATIC_HOTELS_CACHE_TTL_SECONDS}`)
    res.set("X-Cache", "MISS")
    return res.json(responsePayload)
  } catch (error) {
    return next(error)
  }
}

const resolveFallbackCityCodes = () => {
  const envList = parseCsvList(process.env.WEBBEDS_EXPLORE_FALLBACK_CITIES)
  return envList.length ? envList : []
}

const fetchCityMetaByCode = async (cityCode) => {
  if (!cityCode) return null
  const row = await models.WebbedsHotel.findOne({
    where: { city_code: String(cityCode).trim() },
    attributes: ["city_code", "city_name", "country_name"],
    order: [["priority", "DESC"]],
  })
  if (!row) return null
  return {
    cityCode: String(row.city_code),
    cityName: row.city_name || null,
    countryName: row.country_name || null,
  }
}

const getNearbyCityBuckets = async (coords, radiusKm, limit) => {
  if (!coords) return []
  try {
    const bounds = computeGeoBounds(coords.lat, coords.lng, radiusKm)
    const distanceLiteral = buildDistanceLiteral(coords.lat, coords.lng, "AVG(lat)", "AVG(lng)")
    const rows = await models.WebbedsHotel.findAll({
      where: {
        lat: { [Op.not]: null, [Op.between]: [bounds.minLat, bounds.maxLat] },
        lng: { [Op.not]: null, [Op.between]: [bounds.minLng, bounds.maxLng] },
      },
      attributes: [
        "city_code",
        "city_name",
        "country_name",
        [distanceLiteral, "distance_km"],
        [literal("MAX(priority)"), "priority_score"],
      ],
      group: ["city_code", "city_name", "country_name"],
      order: [[literal("distance_km"), "ASC"], [literal("priority_score"), "DESC"]],
      limit: Math.max(limit * 2, limit),
    })
    return rows
      .map((row) => ({
        cityCode: row.city_code ? String(row.city_code) : null,
        cityName: row.city_name || null,
        countryName: row.country_name || null,
      }))
      .filter((item) => item.cityCode)
  } catch (error) {
    console.warn("[webbeds] nearby city buckets failed", error?.message || error)
    return []
  }
}

const getTopGlobalCities = async (limit) => {
  const rows = await models.WebbedsHotel.findAll({
    attributes: [
      "city_code",
      "city_name",
      "country_name",
      [literal("MAX(priority)"), "priority_score"],
      [literal("COUNT(hotel_id)"), "hotel_count"],
    ],
    group: ["city_code", "city_name", "country_name"],
    order: [[literal("priority_score"), "DESC"], [literal("hotel_count"), "DESC"]],
    limit: Math.max(limit * 2, limit),
  })
  return rows
    .map((row) => ({
      cityCode: row.city_code ? String(row.city_code) : null,
      cityName: row.city_name || null,
      countryName: row.country_name || null,
    }))
    .filter((item) => item.cityCode)
}

export const listExploreHotels = async (req, res, next) => {
  try {
    const {
      limit,
      offset,
      lite,
      imagesLimit,
      radiusKm,
      fallbackCityCode,
      cityCode,
    } = req.query

    const useLite = String(lite || "").trim().toLowerCase() === "true"
    const limitBase = Number(limit) || EXPLORE_DEFAULT_LIMIT
    const safeLimit = clampNumber(limitBase, 1, EXPLORE_MAX_RESULTS)
    const safeOffset = clampNumber(Number(offset) || 0, 0, EXPLORE_MAX_RESULTS)
    const targetCount = Math.min(EXPLORE_MAX_RESULTS, safeLimit + safeOffset)
    const imagesLimitValue = Number(imagesLimit)
    const safeImagesLimit = Number.isFinite(imagesLimitValue)
      ? Math.max(0, Math.min(imagesLimitValue, 200))
      : (useLite ? 1 : null)
    const resolvedFallbackCity = String(
      fallbackCityCode || cityCode || EXPLORE_DEFAULT_CITY_CODE || "",
    ).trim() || null

    const coords = resolveExploreCoordinates(req)
    const rankingVariant = resolveExploreRankingVariant(req)
    const radiusBase = Number(radiusKm)
    const safeRadius = clampNumber(
      Number.isFinite(radiusBase) ? radiusBase : EXPLORE_DEFAULT_RADIUS_KM,
      5,
      500,
    )
    const bucketLat = coords
      ? roundCoordinate(coords.lat, EXPLORE_GEO_BUCKET_PRECISION)
      : null
    const bucketLng = coords
      ? roundCoordinate(coords.lng, EXPLORE_GEO_BUCKET_PRECISION)
      : null
    const partnerProfileCacheVersion = await getPartnerHotelProfileCacheVersion()

    const cacheKey = EXPLORE_HOTELS_CACHE_DISABLED
      ? null
      : buildExploreHotelsCacheKey({
        lat: bucketLat,
        lng: bucketLng,
        limit: safeLimit,
        offset: safeOffset,
        radiusKm: safeRadius,
        fallbackCityCode: resolvedFallbackCity,
        lite: useLite,
        imagesLimit: safeImagesLimit,
        rankingVariant: rankingVariant.variant,
        partnerProfileCacheVersion,
      })

    if (cacheKey) {
      const cached = await cache.get(cacheKey)
      if (cached) {
        res.set("Cache-Control", `private, max-age=${EXPLORE_HOTELS_CACHE_TTL_SECONDS}`)
        res.set("X-Cache", "HIT")
        return res.json(cached)
      }
    }

    const attributes = getStaticHotelAttributes(useLite)
    const include = getStaticHotelIncludes()
    const selectedRows = []
    const seen = new Set()

    const pushRows = (rows = []) => {
      for (const row of rows) {
        if (!row) continue
        const id = row?.hotel_id ?? row?.get?.("hotel_id")
        const key = id == null ? null : String(id)
        if (key && seen.has(key)) continue
        if (key) seen.add(key)
        selectedRows.push(row)
        if (selectedRows.length >= targetCount) break
      }
    }

    let primaryCityCode = null
    if (coords) {
      const bounds = computeGeoBounds(coords.lat, coords.lng, safeRadius)
      const distanceLiteral = buildDistanceLiteral(coords.lat, coords.lng)
      const maxCandidates = Math.min(1500, Math.max(targetCount * 5, 200))

      const nearbyRows = await models.WebbedsHotel.findAll({
        where: {
          lat: { [Op.not]: null, [Op.between]: [bounds.minLat, bounds.maxLat] },
          lng: { [Op.not]: null, [Op.between]: [bounds.minLng, bounds.maxLng] },
        },
        attributes: [...attributes, [distanceLiteral, "distance_km"]],
        include,
        order: [[distanceLiteral, "ASC"], ["priority", "DESC"], ["name", "ASC"]],
        limit: maxCandidates,
      })

      pushRows(nearbyRows)
      primaryCityCode = nearbyRows?.[0]?.city_code ?? null
    }

    if (selectedRows.length < targetCount && primaryCityCode) {
      const cityRows = await models.WebbedsHotel.findAll({
        where: { city_code: String(primaryCityCode).trim() },
        attributes,
        include,
        order: [["priority", "DESC"], ["rating", "DESC"], ["name", "ASC"]],
        limit: Math.min(targetCount * 2, EXPLORE_MAX_RESULTS),
      })
      pushRows(cityRows)
    }

    if (selectedRows.length < targetCount && resolvedFallbackCity) {
      const fallbackRows = await models.WebbedsHotel.findAll({
        where: { city_code: String(resolvedFallbackCity).trim() },
        attributes,
        include,
        order: [["priority", "DESC"], ["rating", "DESC"], ["name", "ASC"]],
        limit: Math.min(targetCount * 2, EXPLORE_MAX_RESULTS),
      })
      pushRows(fallbackRows)
    }

    if (selectedRows.length < targetCount) {
      const globalRows = await models.WebbedsHotel.findAll({
        attributes,
        include,
        order: [["priority", "DESC"], ["rating", "DESC"], ["name", "ASC"]],
        limit: Math.min(targetCount * 2, EXPLORE_MAX_RESULTS),
      })
      pushRows(globalRows)
    }

    const pageRows = selectedRows.slice(safeOffset, safeOffset + safeLimit)
    let items = pageRows
      .map((row) => {
        const item = formatStaticHotel(row, { imageLimit: safeImagesLimit })
        if (!item) return null
        const distanceValue = row?.get ? row.get("distance_km") : row?.distance_km
        const distanceNum = Number(distanceValue)
        if (Number.isFinite(distanceNum)) {
          item.distanceKm = distanceNum
        }
        return item
      })
      .filter(Boolean)

    if (rankingVariant.applied && items.length) {
      try {
        const engagementById = await fetchHotelExploreEngagementStats(
          items.map((item) => item?.id),
        )
        items = rankHotelsForExplore(items, {
          engagementById,
          coords: coords ? { lat: Number(coords.lat), lng: Number(coords.lng) } : null,
          debug: rankingVariant.debug,
        })
      } catch (error) {
        console.warn("[webbeds] listExploreHotels ranking failed", error?.message || error)
      }
    }

    items = await attachPartnerProgramToHotelItems(items)
    items = sortPartnerFirstWithFallback(items)

    const responsePayload = {
      items,
      pagination: {
        total: safeOffset + items.length,
        limit: safeLimit,
        offset: safeOffset,
      },
      meta: {
        source: coords?.source || "default",
        location: coords
          ? {
            lat: coords.lat,
            lng: coords.lng,
            city: coords.geo?.city ?? null,
            region: coords.geo?.region ?? null,
            country: coords.geo?.country ?? null,
          }
          : null,
        radiusKm: safeRadius,
        ranking: {
          applied: rankingVariant.applied,
          variant: rankingVariant.variant,
          version: EXPLORE_RANKING_VERSION,
          percent: rankingVariant.percent,
        },
      },
    }

    if (cacheKey) {
      await cache.set(cacheKey, responsePayload, EXPLORE_HOTELS_CACHE_TTL_SECONDS)
    }
    res.set("Cache-Control", `private, max-age=${EXPLORE_HOTELS_CACHE_TTL_SECONDS}`)
    res.set("X-Cache", "MISS")
    return res.json(responsePayload)
  } catch (error) {
    return next(error)
  }
}

export const listExploreCollections = async (req, res, next) => {
  try {
    const {
      sections,
      limitPerSection,
      lite,
      imagesLimit,
      radiusKm,
      fallbackCities,
      fallbackCityCode,
    } = req.query

    const useLite = String(lite || "").trim().toLowerCase() === "true"
    const safeSections = clampNumber(
      Number(sections) || EXPLORE_COLLECTIONS_DEFAULT_SECTIONS,
      1,
      12,
    )
    const perSection = clampNumber(
      Number(limitPerSection) || EXPLORE_COLLECTIONS_DEFAULT_LIMIT,
      3,
      30,
    )
    const imagesLimitValue = Number(imagesLimit)
    const safeImagesLimit = Number.isFinite(imagesLimitValue)
      ? Math.max(0, Math.min(imagesLimitValue, 200))
      : (useLite ? 1 : null)
    const radiusBase = Number(radiusKm)
    const safeRadius = clampNumber(
      Number.isFinite(radiusBase) ? radiusBase : EXPLORE_DEFAULT_RADIUS_KM,
      5,
      500,
    )

    const coords = resolveExploreCoordinates(req)
    const rankingVariant = resolveExploreRankingVariant(req)
    const bucketLat = coords
      ? roundCoordinate(coords.lat, EXPLORE_GEO_BUCKET_PRECISION)
      : null
    const bucketLng = coords
      ? roundCoordinate(coords.lng, EXPLORE_GEO_BUCKET_PRECISION)
      : null
    const partnerProfileCacheVersion = await getPartnerHotelProfileCacheVersion()

    const fallbackCodes = parseCsvList(fallbackCities).length
      ? parseCsvList(fallbackCities)
      : resolveFallbackCityCodes()
    const resolvedFallbackCity = String(
      fallbackCityCode || EXPLORE_DEFAULT_CITY_CODE || "",
    ).trim() || null

    const cacheKey = EXPLORE_COLLECTIONS_CACHE_DISABLED
      ? null
      : buildExploreCollectionsCacheKey({
        lat: bucketLat,
        lng: bucketLng,
        sections: safeSections,
        limitPerSection: perSection,
        radiusKm: safeRadius,
        fallbackCities: fallbackCodes.length ? fallbackCodes : null,
        fallbackCityCode: resolvedFallbackCity,
        lite: useLite,
        imagesLimit: safeImagesLimit,
        rankingVariant: rankingVariant.variant,
        partnerProfileCacheVersion,
      })

    if (cacheKey) {
      const cached = await cache.get(cacheKey)
      if (cached) {
        res.set("Cache-Control", `private, max-age=${EXPLORE_COLLECTIONS_CACHE_TTL_SECONDS}`)
        res.set("X-Cache", "HIT")
        return res.json(cached)
      }
    }

    const cityBuckets = []
    const seenCities = new Set()

    const pushCity = (entry) => {
      if (!entry?.cityCode) return
      const key = String(entry.cityCode)
      if (seenCities.has(key)) return
      seenCities.add(key)
      cityBuckets.push(entry)
    }

    const nearbyCities = await getNearbyCityBuckets(coords, safeRadius, safeSections)
    nearbyCities.forEach(pushCity)

    if (cityBuckets.length < safeSections && fallbackCodes.length) {
      for (const code of fallbackCodes) {
        if (cityBuckets.length >= safeSections) break
        const meta = await fetchCityMetaByCode(code)
        if (meta) pushCity(meta)
      }
    }

    if (cityBuckets.length < safeSections && resolvedFallbackCity) {
      const meta = await fetchCityMetaByCode(resolvedFallbackCity)
      if (meta) pushCity(meta)
    }

    if (cityBuckets.length < safeSections) {
      const globalCities = await getTopGlobalCities(safeSections)
      globalCities.forEach(pushCity)
    }

    const attributes = getStaticHotelAttributes(useLite)
    const include = getStaticHotelIncludes()
    let sectionsPayload = []

    for (const entry of cityBuckets.slice(0, safeSections)) {
      const code = String(entry.cityCode).trim()
      if (!code) continue
      const rows = await models.WebbedsHotel.findAll({
        where: { city_code: code },
        attributes,
        include,
        order: [["priority", "DESC"], ["rating", "DESC"], ["name", "ASC"]],
        limit: perSection,
      })
      let items = rows
        .map((row) => formatStaticHotel(row, { imageLimit: safeImagesLimit }))
        .filter(Boolean)
      items = await attachPartnerProgramToHotelItems(items)
      items = sortPartnerFirstWithFallback(
        items,
        (a, b) =>
          Number(b?.priority ?? 0) - Number(a?.priority ?? 0) ||
          String(a?.name || "").localeCompare(String(b?.name || "")),
      )
      if (!items.length) continue
      const cityLabel = entry.cityName || entry.countryName || "Explore"
      sectionsPayload.push({
        id: `city-${code}`,
        title: `Explore ${cityLabel}`,
        cityCode: code,
        location: {
          city: entry.cityName || null,
          country: entry.countryName || null,
        },
        data: items,
      })
    }

    if (rankingVariant.applied && sectionsPayload.length) {
      try {
        const hotelIds = sectionsPayload
          .flatMap((section) => (Array.isArray(section?.data) ? section.data : []))
          .map((item) => item?.id)
          .filter(Boolean)
        const engagementById = await fetchHotelExploreEngagementStats(hotelIds)
        sectionsPayload = rankHotelSectionsForExplore(sectionsPayload, {
          engagementById,
          coords: coords ? { lat: Number(coords.lat), lng: Number(coords.lng) } : null,
          debug: rankingVariant.debug,
        })
      } catch (error) {
        console.warn("[webbeds] listExploreCollections ranking failed", error?.message || error)
      }
    }

    const responsePayload = {
      sections: sectionsPayload,
      meta: {
        source: coords?.source || "default",
        location: coords
          ? {
            lat: coords.lat,
            lng: coords.lng,
            city: coords.geo?.city ?? null,
            region: coords.geo?.region ?? null,
            country: coords.geo?.country ?? null,
          }
          : null,
        radiusKm: safeRadius,
        fallbackUsed: sectionsPayload.length === 0,
        ranking: {
          applied: rankingVariant.applied,
          variant: rankingVariant.variant,
          version: EXPLORE_RANKING_VERSION,
          percent: rankingVariant.percent,
        },
      },
    }

    if (cacheKey) {
      await cache.set(cacheKey, responsePayload, EXPLORE_COLLECTIONS_CACHE_TTL_SECONDS)
    }
    res.set("Cache-Control", `private, max-age=${EXPLORE_COLLECTIONS_CACHE_TTL_SECONDS}`)
    res.set("X-Cache", "MISS")
    return res.json(responsePayload)
  } catch (error) {
    return next(error)
  }
}

export const listCountries = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsCountry.findAll({
      attributes: ["code", "name"],
      order: [["name", "ASC"]],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

export const listCities = async (req, res, next) => {
  try {
    const {
      q,
      query,
      countryCode,
      country,
      countryName,
      limit = 20,
      offset = 0,
      hasHotels,
      minHotelCount,
    } = req.query

    const queryText = String(q ?? query ?? "").trim()
    const rawCountryCode = String(countryCode ?? "").trim()
    const rawCountryText = String(country ?? countryName ?? "").trim()
    const hotelCountLiteral = literal(
      `(SELECT COUNT(*)::int FROM webbeds_hotel h WHERE h.city_code::text = "WebbedsCity"."code"::text AND h.deleted_at IS NULL)`,
    )
    const whereClauses = []
    const baseWhere = {}
    if (rawCountryCode) {
      baseWhere.country_code = rawCountryCode
    } else if (rawCountryText) {
      baseWhere.country_name = { [iLikeOp]: `%${rawCountryText}%` }
    }
    if (queryText) {
      baseWhere.name = { [iLikeOp]: `%${queryText}%` }
    }
    if (Object.keys(baseWhere).length) {
      whereClauses.push(baseWhere)
    }

    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20))
    const safeOffset = Math.max(0, Number(offset) || 0)
    const parsedMinHotelCount = Number(minHotelCount)
    const resolvedMinHotelCount = Number.isFinite(parsedMinHotelCount)
      ? Math.max(0, Math.trunc(parsedMinHotelCount))
      : (String(hasHotels || "").trim().toLowerCase() === "true" ? 1 : 0)

    if (resolvedMinHotelCount > 0) {
      const replacements = {
        limit: safeLimit,
        offset: safeOffset,
        minHotelCount: resolvedMinHotelCount,
      }
      const whereClauses = ['h.deleted_at IS NULL']

      if (rawCountryCode) {
        replacements.countryCode = rawCountryCode
        whereClauses.push('h.country_code::text = :countryCode')
      } else if (rawCountryText) {
        replacements.countryName = `%${rawCountryText}%`
        whereClauses.push('h.country_name ILIKE :countryName')
      }

      if (queryText) {
        replacements.queryText = `%${queryText}%`
        whereClauses.push('h.city_name ILIKE :queryText')
      }

      const whereSql = whereClauses.join(' AND ')
      const countSql = `
        SELECT COUNT(*)::int AS total
        FROM (
          SELECT h.city_code
          FROM webbeds_hotel h
          WHERE ${whereSql}
          GROUP BY h.city_code
          HAVING COUNT(h.hotel_id) >= :minHotelCount
        ) city_bucket
      `
      const rowsSql = `
        SELECT
          h.city_code::text AS code,
          MAX(h.city_name) AS name,
          MAX(h.country_code)::text AS "countryCode",
          MAX(h.country_name) AS "countryName",
          MAX(h.region_name) AS "regionName",
          MAX(h.region_code) AS "regionCode",
          AVG(h.lat)::float AS lat,
          AVG(h.lng)::float AS lng,
          COUNT(h.hotel_id)::int AS "hotelCount"
        FROM webbeds_hotel h
        WHERE ${whereSql}
        GROUP BY h.city_code
        HAVING COUNT(h.hotel_id) >= :minHotelCount
        ORDER BY COUNT(h.hotel_id) DESC, MAX(h.city_name) ASC, MAX(h.country_name) ASC
        LIMIT :limit
        OFFSET :offset
      `

      const totalRows = await models.WebbedsHotel.sequelize.query(countSql, {
        replacements,
        type: QueryTypes.SELECT,
      })
      const rows = await models.WebbedsHotel.sequelize.query(rowsSql, {
        replacements,
        type: QueryTypes.SELECT,
      })

      const items = rows.map((row) => ({
        code: row.code != null ? String(row.code) : null,
        name: row.name ?? null,
        countryCode: row.countryCode != null ? String(row.countryCode) : null,
        countryName: row.countryName ?? null,
        stateName: null,
        stateCode: null,
        regionName: row.regionName ?? null,
        regionCode: row.regionCode ?? null,
        lat: row.lat != null ? Number(row.lat) : null,
        lng: row.lng != null ? Number(row.lng) : null,
        hotelCount: Number(row.hotelCount ?? 0) || 0,
      }))
      const total = Number(totalRows?.[0]?.total ?? 0) || 0

      return res.json({
        items,
        pagination: {
          total,
          limit: safeLimit,
          offset: safeOffset,
        },
      })
    }

    const where = whereClauses.length > 1 ? { [Op.and]: whereClauses } : (whereClauses[0] ?? {})
    const prioritizeHotelCount = Boolean(queryText)

    const { rows, count } = await models.WebbedsCity.findAndCountAll({
      where,
      attributes: [
        "code",
        "name",
        "country_code",
        "country_name",
        "state_name",
        "state_code",
        "region_name",
        "region_code",
        "lat",
        "lng",
        [hotelCountLiteral, "hotel_count"],
      ],
      order: prioritizeHotelCount
        ? [
            [literal(`"hotel_count"`), "DESC"],
            ["name", "ASC"],
            ["country_name", "ASC"],
          ]
        : [
            ["country_name", "ASC"],
            ["name", "ASC"],
          ],
      limit: safeLimit,
      offset: safeOffset,
    })

    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      countryCode: row.country_code != null ? String(row.country_code) : null,
      countryName: row.country_name,
      stateName: row.state_name,
      stateCode: row.state_code,
      regionName: row.region_name,
      regionCode: row.region_code,
      lat: row.lat != null ? Number(row.lat) : null,
      lng: row.lng != null ? Number(row.lng) : null,
      hotelCount: Number(row.get?.("hotel_count") ?? row.hotel_count ?? 0) || 0,
    }))

    return res.json({
      items,
      pagination: {
        total: count,
        limit: safeLimit,
        offset: safeOffset,
      },
    })
  } catch (error) {
    return next(error)
  }
}

export const listRateBasis = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsRateBasis.findAll({
      attributes: ["code", "name", "runno"],
      order: [
        ["name", "ASC"],
        ["code", "ASC"],
      ],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      runno: row.runno ?? null,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

export const listHotelAmenities = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsAmenityCatalog.findAll({
      where: { type: { [Op.in]: ["hotel", "leisure", "business"] } },
      attributes: ["code", "name", "runno", "type"],
      order: [
        ["name", "ASC"],
        ["code", "ASC"],
      ],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      runno: row.runno ?? null,
      type: row.type ?? "hotel",
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

export const listRoomAmenities = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsRoomAmenityCatalog.findAll({
      attributes: ["code", "name", "runno"],
      order: [
        ["name", "ASC"],
        ["code", "ASC"],
      ],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      runno: row.runno ?? null,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

export const listHotelChains = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsHotelChain.findAll({
      attributes: ["code", "name", "runno"],
      order: [
        ["name", "ASC"],
        ["code", "ASC"],
      ],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      runno: row.runno ?? null,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

export const listHotelClassifications = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsHotelClassification.findAll({
      attributes: ["code", "name", "runno"],
      order: [
        ["name", "ASC"],
        ["code", "ASC"],
      ],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      runno: row.runno ?? null,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

export const listSalutationsCatalog = async (req, res, next) => {
  try {
    const forceRefresh =
      String(req.query?.refresh || "").toLowerCase() === "true"
    const items = await listSalutations({ forceRefresh })
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

const WEBBEDS_IMAGE_HOSTS = new Set([
  "static-images.webbeds.com",
  "us.dotwconnect.com",
])
const WEBBEDS_IMAGE_FETCH_TIMEOUT_MS = clampNumber(
  Number(process.env.WEBBEDS_IMAGE_FETCH_TIMEOUT_MS) || 12000,
  2000,
  30000,
)
const WEBBEDS_IMAGE_FETCH_RETRIES = clampNumber(
  Number(process.env.WEBBEDS_IMAGE_FETCH_RETRIES) || 1,
  0,
  2,
)

const clampInt = (value, min, max) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const rounded = Math.round(parsed)
  if (rounded < min || rounded > max) return null
  return rounded
}

const normalizeImageFormat = (value) => {
  if (!value) return null
  const normalized = String(value).trim().toLowerCase()
  if (normalized === "jpg") return "jpeg"
  if (["jpeg", "png", "webp", "avif"].includes(normalized)) return normalized
  return null
}

const inferFormatFromContentType = (contentType = "") => {
  const lower = String(contentType || "").toLowerCase()
  if (lower.includes("image/jpeg") || lower.includes("image/jpg")) return "jpeg"
  if (lower.includes("image/png")) return "png"
  if (lower.includes("image/webp")) return "webp"
  if (lower.includes("image/avif")) return "avif"
  return null
}

const isRetryableImageFetchError = (error) => {
  const code = String(error?.code || "").toUpperCase()
  const message = String(error?.message || "").toLowerCase()
  if (error?.name === "AbortError") return true
  if (["ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return true
  return message.includes("fetch failed") || message.includes("network") || message.includes("timeout")
}

const fetchImageWithTimeoutAndRetry = async (url) => {
  let lastError = null
  for (let attempt = 0; attempt <= WEBBEDS_IMAGE_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEBBEDS_IMAGE_FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
      })
      if (response.ok) return response
      if (response.status >= 500 && attempt < WEBBEDS_IMAGE_FETCH_RETRIES) {
        continue
      }
      return response
    } catch (error) {
      lastError = error
      if (!isRetryableImageFetchError(error) || attempt >= WEBBEDS_IMAGE_FETCH_RETRIES) {
        throw error
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error("Image fetch failed")
}

export const proxyWebbedsImage = async (req, res) => {
  try {
    const rawUrl = String(req.query?.url || "").trim()
    if (!rawUrl) {
      return res.status(400).json({ error: "Missing image url" })
    }

    let parsed
    try {
      parsed = new URL(rawUrl)
    } catch {
      return res.status(400).json({ error: "Invalid image url" })
    }

    if (parsed.protocol !== "https:" || !WEBBEDS_IMAGE_HOSTS.has(parsed.hostname)) {
      return res.status(403).json({ error: "Host not allowed" })
    }

    const response = await fetchImageWithTimeoutAndRetry(parsed.toString())
    if (!response.ok) {
      return res.status(response.status).end()
    }

    const width = clampInt(req.query?.w, 64, 2400)
    const height = clampInt(req.query?.h, 64, 2400)
    const quality = clampInt(req.query?.q, 35, 90)
    const requestedFormat = normalizeImageFormat(req.query?.format ?? req.query?.fmt)
    const contentType = response.headers.get("content-type") || ""
    const inputFormat = inferFormatFromContentType(contentType)
    const outputFormat = requestedFormat ?? inputFormat
    const targetFormat = outputFormat || "jpeg"
    const shouldTransform =
      width != null ||
      height != null ||
      quality != null ||
      requestedFormat != null

    if (!shouldTransform) {
      if (contentType) {
        res.setHeader("Content-Type", contentType)
      }
      res.setHeader(
        "Cache-Control",
        "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, stale-if-error=86400"
      )

      if (!response.body) {
        return res.status(502).json({ error: "Empty image response" })
      }

      await pipeline(Readable.fromWeb(response.body), res)
      return
    }

    if (!response.body) {
      return res.status(502).json({ error: "Empty image response" })
    }

    const sourceStream = Readable.fromWeb(response.body)
    let transformer = sharp({
      failOn: "none",
      sequentialRead: true,
      limitInputPixels: 6000 * 6000,
    })

    if (width != null || height != null) {
      transformer = transformer.resize({
        width: width ?? undefined,
        height: height ?? undefined,
        fit: "cover",
        withoutEnlargement: true,
      })
    }

    if (targetFormat === "webp") {
      transformer = transformer.webp({
        quality: quality ?? 70,
        effort: 4,
      })
    } else if (targetFormat === "avif") {
      transformer = transformer.avif({
        quality: quality ?? 52,
        effort: 4,
      })
    } else if (targetFormat === "jpeg") {
      transformer = transformer.jpeg({
        quality: quality ?? 74,
        mozjpeg: true,
      })
    } else if (targetFormat === "png") {
      transformer = transformer.png({
        quality: quality ?? 80,
        compressionLevel: 9,
      })
    } else if (quality != null) {
      transformer = transformer.jpeg({
        quality,
        mozjpeg: true,
      })
    }

    const resolvedFormat = targetFormat
    res.setHeader("Content-Type", `image/${resolvedFormat}`)
    res.setHeader(
      "Cache-Control",
      "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, stale-if-error=86400"
    )
    await pipeline(sourceStream, transformer, res)
    return
  } catch (error) {
    const errorCode = String(error?.code || "")
    if (errorCode === "ERR_STREAM_PREMATURE_CLOSE") {
      // Client/upstream stream closed before completion; do not escalate noisy logs.
      if (!res.headersSent && !res.writableEnded && !res.destroyed) {
        return res.status(502).json({ error: "Image stream interrupted" })
      }
      return
    }
    if (res.writableEnded || res.destroyed) {
      return
    }
    console.error("[webbeds] image proxy failed", error)
    if (!res.headersSent) {
      return res.status(500).json({ error: "Image proxy failed" })
    }
    return
  }
}
