import { Op, literal } from "sequelize"
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
import { getMarkup } from "../utils/markup.js"
import sharp from "sharp"

import { Readable } from "stream"
import { pipeline } from "stream/promises"

import { resolveEnabledCurrency } from "../services/currencySettings.service.js"
import { getCaseInsensitiveLikeOp } from "../utils/sequelizeHelpers.js"


import { planReferralFirstBookingDiscount } from "../services/referralRewards.service.js"


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

const applyMarkupToAmount = (amount, role) => {
  const numericAmount = Number(amount)
  if (!Number.isFinite(numericAmount)) return null
  if (numericAmount <= 0) return roundCurrency(numericAmount)
  const markup = Number(getMarkup(role, numericAmount))
  if (!Number.isFinite(markup) || markup <= 0) return roundCurrency(numericAmount)
  return roundCurrency(numericAmount * (1 + markup))
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
]

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
    const referral = {
      influencerId: Number(req.user?.referredByInfluencerId) || null,
      code: req.user?.referredByCode || null,
    }

    // 1. Create Local Booking Record (PENDING)
    // We store the Webbeds ID as external_ref
    // and "WEBBEDS" as source
    const booking_ref = `WB-${Date.now().toString(36).toUpperCase()}`

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
    const publicPricingRole = 0
    const markupRateRaw = Number(getMarkup(publicPricingRole, pricedAmount))
    const markupRate = Number.isFinite(markupRateRaw) && markupRateRaw > 0 ? markupRateRaw : 0
    const providerAmountUsd = roundCurrency(pricedAmount)
    const amountUsd = applyMarkupToAmount(providerAmountUsd, publicPricingRole)
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      console.warn(`${logPrefix} invalid marked amount`, {
        flowId,
        providerAmountUsd,
        requestUserRole,
        publicPricingRole,
        markupRate,
      })
      return res.status(409).json({ error: "Flow pricing unavailable" })
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
        })
      }
    }

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

    const totalBeforeDiscount = roundCurrency(finalAmount)
    let referralFirstBookingPlan = null
    let referralFirstBookingDiscount = 0
    if (referral.influencerId && req.user?.id) {
      referralFirstBookingPlan = await planReferralFirstBookingDiscount({
        influencerUserId: referral.influencerId,
        userId: req.user.id,
        totalBeforeDiscount,
        currency: finalCurrency,
      })
      referralFirstBookingDiscount = referralFirstBookingPlan?.apply
        ? referralFirstBookingPlan.discountAmount
        : 0
    }
    const totalDiscountAmount = roundCurrency(referralFirstBookingDiscount)
    const grossTotal = roundCurrency(Math.max(0, totalBeforeDiscount - totalDiscountAmount))

    const localBooking = await models.Booking.create({
      booking_ref,
      user_id: req.user?.id || null,
      influencer_user_id: referral.influencerId,
      flow_id: flow.id,
      source: "PARTNER",
      inventory_type: "WEBBEDS_HOTEL",
      inventory_id: String(resolvedHotelId),
      external_ref: bookingId, // The Webbeds Booking ID

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
      pricing_snapshot: {
        flowId: flow.id,
        totalBeforeDiscount,
        referralFirstBooking: referralFirstBookingPlan?.apply
          ? {
            pct: referralFirstBookingPlan.pct,
            amount: roundCurrency(referralFirstBookingDiscount),
            currency: referralFirstBookingPlan.currency,
            applied: true,
          }
          : null,
        totalDiscountAmount,
        total: grossTotal,
        currency: finalCurrency,
      },

      meta: {
        hotelId: resolvedHotelId,
        hotelName: inventorySnapshot?.hotelName ?? null,
        hotelImage: inventorySnapshot?.hotelImage ?? null,
        roomName,
        location: inventorySnapshot?.location ?? null,
        guests: { adults, children },
        flowId: flow.id,
        ...(referral.influencerId
          ? {
            referral: {
              influencerUserId: referral.influencerId,
              code: referral.code || null,
            },
          }
          : {}),
        ...(referralFirstBookingPlan?.apply
          ? {
            referralFirstBooking: {
              pct: referralFirstBookingPlan.pct,
              amount: roundCurrency(referralFirstBookingDiscount),
              currency: referralFirstBookingPlan.currency,
              applied: true,
            },
          }
          : {}),
        basePriceUsd: providerAmountUsd,
        chargedBasePriceUsd: amountUsd,
        publicMarkupRate: markupRate,
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
      },
      inventory_snapshot: inventorySnapshot,
      guest_snapshot: guestSnapshot,
    })
    console.info(`${logPrefix} local booking created`, {
      localBookingId: localBooking.id,
      bookingRef: booking_ref,
    })

    if (models.StayHotel) {
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

    // 2. Create Stripe Payment Intent

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
    const amountForStripe = Math.round(grossTotal * Math.pow(10, minorUnit))
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

    const paymentIntentOptions =
      stripeFxQuoteId && stripeFxVersion ? { apiVersion: stripeFxVersion } : undefined
    logStripeFxDebug("paymentIntent.create", {
      amount: amountForStripe,
      currency: currencyUpper.toLowerCase(),
      fxQuote: stripeFxQuoteId || null,
      apiVersion: paymentIntentOptions?.apiVersion || null,
    })

    const paymentIntent = await stripe.paymentIntents.create(
      paymentIntentParams,
      paymentIntentOptions,
    )
    logStripeFxDebug("paymentIntent.created", {
      id: paymentIntent?.id || null,
      currency: paymentIntent?.currency || null,
      amount: paymentIntent?.amount || null,
      fxQuote: paymentIntent?.fx_quote || stripeFxQuoteId || null,
    })
    console.info(`${logPrefix} payment intent created`, { paymentIntentId: paymentIntent.id })

    // 3. Update Local Booking with Payment Intent ID
    await localBooking.update({
      payment_intent_id: paymentIntent.id,
      payment_provider: "STRIPE"
    })
    console.info(`${logPrefix} local booking updated`, { paymentIntentId: paymentIntent.id })

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      localBookingId: localBooking.id,
      bookingRef: booking_ref,
      flowId: flow.id,
      pricingSnapshot: {
        totalBeforeDiscount,
        referralFirstBooking: referralFirstBookingPlan?.apply
          ? {
            pct: referralFirstBookingPlan.pct,
            amount: roundCurrency(referralFirstBookingDiscount),
            currency: referralFirstBookingPlan.currency,
            applied: true,
          }
          : null,
        totalDiscountAmount,
        total: grossTotal,
        currency: finalCurrency,
      },
    })

  } catch (error) {
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
        if (supportUserId && booking.user_id) {
          triggerBookingAutoPrompts({
            trigger: PROMPT_TRIGGERS.BOOKING_CREATED,
            guestUserId: booking.user_id,
            hostUserId: Number(supportUserId), // The system/bot user
            homeId: null, // It's a hotel
            reserveId: booking.id,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            homeSnapshotName: hotelName,
            homeSnapshotImage: hotelImage,
          }).catch(err => console.error("[webbeds] triggerBookingAutoPrompts failed", err))
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

    if (booking) {
      const updates = { payment_status: "UNPAID" }
      if (booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") {
        updates.status = "CANCELLED"
      }
      await booking.update(updates)
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
      order: [
        ["priority", "DESC"],
        ["name", "ASC"],
      ],
      limit: safeLimit,
      offset: safeOffset,
    })

    const responsePayload = {
      items: rows.map((row) => formatStaticHotel(row, { imageLimit: safeImagesLimit })),
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
    const items = pageRows
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
    const bucketLat = coords
      ? roundCoordinate(coords.lat, EXPLORE_GEO_BUCKET_PRECISION)
      : null
    const bucketLng = coords
      ? roundCoordinate(coords.lng, EXPLORE_GEO_BUCKET_PRECISION)
      : null

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
    const sectionsPayload = []

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
      const items = rows
        .map((row) => formatStaticHotel(row, { imageLimit: safeImagesLimit }))
        .filter(Boolean)
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
      countryCode,
      limit = 20,
      offset = 0,
    } = req.query

    const where = {}
    if (countryCode) {
      where.country_code = String(countryCode).trim()
    }
    if (q) {
      where.name = { [iLikeOp]: `%${q.trim()}%` }
    }

    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20))
    const safeOffset = Math.max(0, Number(offset) || 0)

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
      ],
      order: [
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
