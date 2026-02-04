import { createHash } from "crypto"
import { Op } from "sequelize"
import models from "../../models/index.js"
import { HotelProvider } from "../hotelProvider.js"
import { createWebbedsClient, buildEnvelope } from "./client.js"
import { getWebbedsConfig } from "./config.js"
import { buildSearchHotelsPayload, mapSearchHotelsResponse } from "./searchHotels.js"
import { buildGetRoomsPayload, mapGetRoomsResponse } from "./getRooms.js"
import { buildSaveBookingPayload, mapSaveBookingResponse } from "./saveBooking.js"
import { buildConfirmBookingPayload, mapConfirmBookingResponse } from "./confirmBooking.js"
import { buildCancelBookingPayload, mapCancelBookingResponse } from "./cancelBooking.js"
import { buildDeleteItineraryPayload, mapDeleteItineraryResponse } from "./deleteItinerary.js"
import { buildGetBookingDetailsPayload, mapGetBookingDetailsResponse } from "./getBookingDetails.js"
import {
  buildBookItineraryPayload,
  buildBookItineraryPreauthPayload,
  mapBookItineraryResponse,
} from "./bookItinerary.js"
import { tokenizeCard } from "./rezpayments.js"
import { mapWebbedsError } from "../../utils/webbedsErrorMapper.js"

const MAX_HOTEL_IDS_PER_REQUEST = 50
const DEFAULT_HOTEL_ID_CONCURRENCY = 4
const verboseLogs = process.env.WEBBEDS_VERBOSE_LOGS === "true"

const buildWebbedsErrorPayload = (error, extraPayload = {}) => {
  const mapped = mapWebbedsError(error?.code, error?.details)
  return {
    success: false,
    code: error?.code ?? null,
    message: error?.details ?? error?.message ?? "WebBeds request failed",
    errorKey: mapped.errorKey,
    userMessage: mapped.userMessage,
    retryable: mapped.retryable,
    ...extraPayload,
  }
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

const parseBooleanFlag = (value) => {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "boolean") return value
  const normalized = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "si"].includes(normalized)) return true
  if (["0", "false", "no", "n"].includes(normalized)) return false
  return null
}

const buildAdvancedConditionsFromQuery = (query = {}) => {
  const conditions = []

  const addEquals = (fieldName, rawValue) => {
    if (rawValue === undefined || rawValue === null || rawValue === "") return
    conditions.push({
      fieldName,
      fieldTest: "equals",
      fieldValues: [String(rawValue)],
    })
  }

  const addBetween = (fieldName, min, max) => {
    const values = []
    if (min !== undefined && min !== null && min !== "") values.push(String(min))
    if (max !== undefined && max !== null && max !== "") values.push(String(max))
    if (!values.length) return
    conditions.push({
      fieldName,
      fieldTest: "between",
      fieldValues: values,
    })
  }

  const addIn = (fieldName, rawValues) => {
    const values = parseCsvList(rawValues)
    if (!values.length) return
    conditions.push({
      fieldName,
      fieldTest: "in",
      fieldValues: values,
    })
  }

  const addLike = (fieldName, rawValue) => {
    if (!rawValue) return
    conditions.push({
      fieldName,
      fieldTest: "like",
      fieldValues: [String(rawValue)],
    })
  }

  const addRegexp = (fieldName, rawValue) => {
    if (!rawValue) return
    conditions.push({
      fieldName,
      fieldTest: "regexp",
      fieldValues: [String(rawValue)],
    })
  }

  const normalizeBetweenRange = (min, max, { minFallback, maxFallback } = {}) => {
    const hasMin = min !== undefined && min !== null && min !== ""
    const hasMax = max !== undefined && max !== null && max !== ""
    if (!hasMin && !hasMax) return { min: null, max: null }
    if (hasMin && !hasMax && maxFallback !== undefined && maxFallback !== null && maxFallback !== "") {
      return { min, max: maxFallback }
    }
    if (!hasMin && hasMax && minFallback !== undefined && minFallback !== null && minFallback !== "") {
      return { min: minFallback, max }
    }
    return { min, max }
  }

  // Price band
  addBetween(
    "price",
    query.priceMin ?? query.minPrice ?? query.price_from ?? query.priceFrom,
    query.priceMax ?? query.maxPrice ?? query.price_to ?? query.priceTo,
  )

  // Preferred / availability / luxury / rate basis
  const preferredFlag = parseBooleanFlag(query.preferred ?? query.isPreferred)
  if (preferredFlag !== null) {
    addEquals("preferred", preferredFlag ? "1" : "0")
  }

  const availabilityFlag = parseBooleanFlag(query.availability ?? query.available)
  if (availabilityFlag !== null) {
    addEquals("availability", availabilityFlag ? "1" : "0")
  }

  const luxuryValue =
    query.luxury ?? query.classification ?? query.starRating ?? query.classificationCode
  if (luxuryValue !== undefined && luxuryValue !== null && luxuryValue !== "") {
    addEquals("luxury", luxuryValue)
  }

  addIn("ratebasis", query.rateBasisFilter ?? query.rateBasisFilters ?? query.ratebasis)

  // Location / hotel-level filters
  addIn("location", query.location ?? query.locations)
  addIn("amenitie", query.amenities ?? query.amenityIds)
  addIn("leisure", query.leisure ?? query.leisureIds)
  addIn("business", query.business ?? query.businessIds)
  addIn(
    "hotelpreference",
    query.hotelPreference ?? query.hotelPreferenceIds ?? query.hotelPreferences,
  )
  addIn("chain", query.chain ?? query.chainIds)
  addIn("attraction", query.attraction ?? query.attractionIds ?? query.attractions)

  // Ratings
  const ratingRange = normalizeBetweenRange(
    query.ratingMin ?? query.minRating ?? query.hotelRateMin,
    query.ratingMax ?? query.maxRating ?? query.hotelRateMax,
    { minFallback: "1", maxFallback: "5" },
  )
  addBetween("rating", ratingRange.min, ratingRange.max)

  // Hotel meta
  addBetween(
    "builtYear",
    query.builtYearMin ?? query.builtYearFrom,
    query.builtYearMax ?? query.builtYearTo,
  )
  addBetween(
    "renovationYear",
    query.renovationYearMin ?? query.renovationYearFrom,
    query.renovationYearMax ?? query.renovationYearTo,
  )
  addBetween("floors", query.floorsMin ?? query.minFloors, query.floorsMax ?? query.maxFloors)

  const notRooms = query.notRooms ?? query.notrooms ?? query.roomCount
  if (notRooms !== undefined && notRooms !== null && notRooms !== "") {
    addEquals("notrooms", notRooms)
  }

  // Room-level filters
  addIn("roomtypecode", query.roomTypeCode ?? query.roomTypeCodes)
  addLike("roomtype", query.roomTypeLike ?? query.roomType)
  addIn("roomamenitie", query.roomAmenity ?? query.roomAmenityIds)
  addIn("roomfacilities", query.roomFacilities ?? query.roomFacilityIds)

  const suiteFlag = parseBooleanFlag(query.suite ?? query.isSuite)
  if (suiteFlag !== null) {
    addEquals("suite", suiteFlag ? "1" : "0")
  }

  addLike("roomname", query.roomNameLike)
  addRegexp("roomname", query.roomNameRegexp ?? query.roomNameRegex)

  // Hotel name filter
  addLike("hotelName", query.hotelNameLike ?? query.hotelName)

  // Last updated
  addBetween(
    "lastupdated",
    query.lastUpdatedFrom ?? query.lastUpdatedMin ?? query.updatedFrom,
    query.lastUpdatedTo ?? query.lastUpdatedMax ?? query.updatedTo,
  )

  return conditions
}

const normalizeAdvancedOperator = (value) => {
  if (!value) return null
  const upper = String(value).trim().toUpperCase()
  if (upper === "AND" || upper === "OR") return upper
  return null
}

const buildHotelIdConditions = (ids) =>
  ids?.length
    ? [
      {
        fieldName: "hotelId",
        fieldTest: "in",
        fieldValues: ids,
      },
    ]
    : undefined

const chunkArray = (items, size = MAX_HOTEL_IDS_PER_REQUEST) => {
  if (!Array.isArray(items) || items.length === 0) return []
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const resolveHotelIdConcurrency = () => {
  const parsed = Number(process.env.WEBBEDS_HOTELID_MAX_CONCURRENCY)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return DEFAULT_HOTEL_ID_CONCURRENCY
}

const runBatchesWithLimit = async (batches, limit, iterator) => {
  if (!Array.isArray(batches) || batches.length === 0) return []
  const safeLimit = Math.max(1, Number(limit) || 1)
  const results = []
  for (let index = 0; index < batches.length; index += safeLimit) {
    const slice = batches.slice(index, index + safeLimit)
    const sliceResults = await Promise.all(slice.map((batch) => iterator(batch)))
    results.push(...sliceResults)
  }
  return results
}

const fetchHotelIdsByCity = async (cityCode) => {
  if (!cityCode || !models?.WebbedsHotel) return []
  const rows = await models.WebbedsHotel.findAll({
    attributes: ["hotel_id"],
    where: { city_code: cityCode },
    order: [
      ["priority", "DESC"],
      ["hotel_id", "ASC"],
    ],
    raw: true,
  })
  return rows.map((row) => String(row.hotel_id))
}

const sharedClient = (() => {
  try {
    const config = getWebbedsConfig()
    return createWebbedsClient(config)
  } catch (error) {
    console.warn("[webbeds] client not initialized:", error.message)
    return null
  }
})()

export class WebbedsProvider extends HotelProvider {
  constructor({ client = sharedClient } = {}) {
    super()
    if (!client) {
      throw new Error("WebBeds client is not configured")
    }
    this.client = client
  }

  getRequestId(req) {
    return req?.id || req?.headers?.["x-request-id"]
  }

  async tokenizeBusinessCard() {
    const {
      WEBBEDS_CC_NAME,
      WEBBEDS_CC_NUMBER,
      WEBBEDS_CC_EXP_MONTH,
      WEBBEDS_CC_EXP_YEAR,
      WEBBEDS_CC_CVV,
      WEBBEDS_TOKENIZER_URL,
      WEBBEDS_TOKENIZER_AUTH,
    } = process.env

    if (!WEBBEDS_CC_NUMBER || !WEBBEDS_CC_EXP_MONTH || !WEBBEDS_CC_EXP_YEAR || !WEBBEDS_CC_CVV) {
      throw new Error("Missing WebBeds business card config for tokenization")
    }

    const token = await tokenizeCard({
      cardName: WEBBEDS_CC_NAME || "Insider Business",
      cardNumber: WEBBEDS_CC_NUMBER,
      expiryYear: WEBBEDS_CC_EXP_YEAR,
      expiryMonth: WEBBEDS_CC_EXP_MONTH,
      securityCode: WEBBEDS_CC_CVV,
      tokenizerUrl: WEBBEDS_TOKENIZER_URL,
      authHeader: WEBBEDS_TOKENIZER_AUTH,
      logger: console,
    })
    return token
  }

  async search(req, res, next) {
    try {
      const defaultCountryCode = process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102"

      const ensureNumericCode = (value, fallback) => {
        if (value === undefined || value === null || value === "") {
          return fallback
        }
        const strValue = String(value).trim()
        return /^\d+$/.test(strValue) ? strValue : fallback
      }

      const {
        checkIn,
        checkOut,
        occupancies,
        currency,
        cityCode,
        countryCode,
        rateBasis,
      } = req.query
      const defaultCurrencyCode = process.env.WEBBEDS_DEFAULT_CURRENCY_CODE || "520"
      const normalizeCurrency = () => {
        // WebBeds account is USD-only; force USD currency code (520) for all search requests.
        return defaultCurrencyCode
      }

      const resolveRateBasis = (value) => {
        const parsed = Number(value)
        if (Number.isFinite(parsed) && parsed > 0) return String(parsed)
        const str = String(value ?? "").trim()
        if (/^\d+$/.test(str) && Number(str) > 0) return str
        return "-1"
      }

      const nationality = ensureNumericCode(
        req.query.passengerNationality ??
        req.query.nationality ??
        req?.user?.countryCode ??
        req?.user?.country,
        defaultCountryCode,
      )

      const residence = ensureNumericCode(
        req.query.passengerCountryOfResidence ??
        req.query.residence ??
        req?.user?.countryCode ??
        req?.user?.country,
        defaultCountryCode,
      )

      const includeFieldsList = parseCsvList(req.query.fields)
      const includeRoomFieldsList = parseCsvList(req.query.roomFields)
      const includeFields = includeFieldsList.length ? includeFieldsList : undefined
      const includeRoomFields = includeRoomFieldsList.length ? includeRoomFieldsList : undefined
      const includeNoPrice = req.query.noPrice === "true"
      const mergeStaticDetails = parseBooleanFlag(req.query.merge) === true
      const debug = req.query.debug ?? undefined
      const providedHotelIds = parseCsvList(req.query.hotelIds)
      const credentials = this.getCredentials()
      const queryAdvancedConditions = buildAdvancedConditionsFromQuery(req.query)
      const advancedOperator = normalizeAdvancedOperator(
        req.query.conditionOperator ?? req.query.advancedOperator ?? req.query.operator,
      )

      const payloadOptions = {
        checkIn,
        checkOut,
        currency: normalizeCurrency(),
        occupancies,
        nationality,
        residence,
        rateBasis: resolveRateBasis(rateBasis),
        cityCode,
        countryCode,
        includeFields,
        includeRoomFields,
        includeNoPrice,
        resultsPerPage: req.query.limit || req.query.resultsPerPage,
        page: req.query.page || req.query.offset ? Math.floor((Number(req.query.offset) || 0) / (Number(req.query.limit) || 20)) + 1 : undefined,
        rateTypes: parseCsvList(req.query.rateTypes),
        productCodeRequested: ensureNumericCode(req.query.productCodeRequested ?? req.query.productId, null),
        debug,
      }

      const searchMode = String(
        req.query.mode ?? req.query.searchMode ?? "hotelids",
      ).toLowerCase()

      if (searchMode === "hotelids") {
        if (!providedHotelIds.length && !cityCode) {
          return res.status(400).json({
            success: false,
            message: "WebBeds hotelId mode requires a cityCode or the hotelIds parameter",
          })
        }
        return await this.searchByHotelIdBatches({
          req,
          res,
          payloadOptions,
          providedHotelIds,
          credentials,
          cityCode,
          queryAdvancedConditions,
          advancedOperator,
        })
      }

      const {
        payload,
        requestAttributes,
      } = buildSearchHotelsPayload({
        ...payloadOptions,
        advancedConditions: [
          ...queryAdvancedConditions,
          ...(buildHotelIdConditions(providedHotelIds) ?? []),
        ],
        advancedOperator,
      })

      const options = await this.sendSearchRequest({
        req,
        payload,
        requestAttributes,
        credentials,
      })
      // Merge con metadata estática solo cuando el cliente lo solicita.
      const results = mergeStaticDetails ? await this.enrichWithHotelDetails(options) : options
      return res.json(this.groupOptionsByHotel(results))
    } catch (error) {
      if (error.name === "WebbedsError") {
        const xsdMessagesRaw = error.extraDetails?.xsd_error?.error_message
        const xsdMessages =
          Array.isArray(xsdMessagesRaw) && xsdMessagesRaw.length
            ? xsdMessagesRaw
            : xsdMessagesRaw
              ? [xsdMessagesRaw]
              : null
        console.error("[webbeds] search error", {
          command: error.command,
          code: error.code,
          details: error.details,
          extra: error.extraDetails,
          xsdMessages,
          metadata: error.metadata,
          requestXml: error.requestXml,
        })
        return res
          .status(400)
          .json(
            buildWebbedsErrorPayload(error, {
              extra: error.extraDetails,
              xsdMessages,
              metadata: error.metadata,
            }),
          )
      } else {
        console.error("[webbeds] unexpected error", error)
      }
      return next(error)
    }
  }

  async getRooms(req, res, next) {
    const {
      checkIn,
      checkOut,
      occupancies,
      currency,
      rateBasis,
      hotelId,
      productId,
      hotelCode,
      roomTypeCode,
      selectedRateBasis,
      allocationDetails,
    } = req.query

    try {

      const resolvedHotelCode = hotelId ?? productId ?? hotelCode
      if (!resolvedHotelCode || !/^\d+$/.test(String(resolvedHotelCode).trim())) {
        throw new Error("WebBeds getrooms requires numeric hotelId (productId)")
      }

      const defaultCountryCode = process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102"
      const defaultCurrencyCode = process.env.WEBBEDS_DEFAULT_CURRENCY_CODE || "520"
      const normalizeCurrency = () => {
        // WebBeds account is USD-only; force USD currency code (520) for all requests.
        return "520"
      }
      const ensureNumericCode = (value, fallback) => {
        if (value === undefined || value === null || value === "") {
          return fallback
        }
        const strValue = String(value).trim()
        return /^\d+$/.test(strValue) ? strValue : fallback
      }

      const resolveRateBasis = (value) => {
        const parsed = Number(value)
        if (Number.isFinite(parsed) && parsed > 0) return String(parsed)
        const str = String(value ?? "").trim()
        if (/^\d+$/.test(str) && Number(str) > 0) return str
        return "-1"
      }

      const nationality = ensureNumericCode(
        req.query.passengerNationality ??
        req.query.nationality ??
        req?.user?.countryCode ??
        req?.user?.country,
        defaultCountryCode,
      )

      const residence = ensureNumericCode(
        req.query.passengerCountryOfResidence ??
        req.query.residence ??
        req?.user?.countryCode ??
        req?.user?.country,
        defaultCountryCode,
      )

      const payload = buildGetRoomsPayload({
        checkIn,
        checkOut,
        currency,
        occupancies,
        rateBasis: resolveRateBasis(rateBasis),
        nationality,
        residence,
        hotelId: resolvedHotelCode,
        currency: normalizeCurrency(currency),
        roomTypeCode,
        selectedRateBasis,
        allocationDetails,
        req,
      })

      if (verboseLogs) {
        console.info("[webbeds] getRooms request", {
          hotelCode: resolvedHotelCode,
          checkIn,
          checkOut,
          currency: normalizeCurrency(currency),
          occupancies,
          rateBasis: resolveRateBasis(rateBasis),
          roomTypeCode,
          selectedRateBasis,
          allocationDetails: allocationDetails ? "[provided]" : null,
          nationality,
          residence,
        })
      }

      const requestId = this.getRequestId(req)
      const sendGetRooms = async (nextRequestId) =>
        this.client.send("getrooms", payload, {
          requestId: nextRequestId,
          productOverride: "hotel",
        })

      let response
      try {
        response = await sendGetRooms(requestId)
      } catch (error) {
        const errorCode = String(error?.code ?? "")
        const shouldRetry = error?.name === "WebbedsError" && (errorCode === "12" || errorCode === "149")
        if (!shouldRetry) {
          throw error
        }
        console.warn("[webbeds] getRooms retrying after provider error", {
          code: error?.code,
          details: error?.details,
          requestId,
        })
        const retryRequestId = requestId ? `${requestId}-retry` : undefined
        response = await sendGetRooms(retryRequestId)
      }

      const { result } = response
      if (verboseLogs) {
        console.info("[webbeds] getRooms result", {
          hotelId: result?.hotel?.["@_id"] ?? result?.hotel?.id ?? null,
          currency: result?.currencyShort ?? null,
          roomsCount:
            Array.isArray(result?.hotel?.rooms?.room) && result.hotel.rooms.room.length
              ? result.hotel.rooms.room.length
              : result?.hotel?.rooms?.room
                ? 1
                : 0,
        })
      }
      const mapped = mapGetRoomsResponse(result)
      if (verboseLogs) {
        try {
          console.log("[webbeds] getRooms mapped payload:", JSON.stringify(mapped, null, 2))
        } catch {
          console.log("[webbeds] getRooms mapped payload: [unserializable]")
        }
      }
      return res.json(mapped)
    } catch (error) {
      if (error.name === "WebbedsError") {
        const xsdMessages =
          Array.isArray(error.extra?.xsd_error?.error_message) &&
            error.extra.xsd_error.error_message.length
            ? error.extra.xsd_error.error_message
            : null
        console.error("[webbeds] search error", {
          command: error.command,
          code: error.code,
          details: error.details,
          extra: error.extraDetails,
          xsdMessages,
          metadata: error.metadata,
          requestXml: error.requestXml,
        })
        const code = String(error.code ?? "")
        if (code === "12" || code === "149") {
          return res.json({
            currency: null,
            hotel: {
              id: (hotelId ?? productId) ?? null,
              name: null,
              allowBook: false,
              rooms: [],
            },
            warning: error.details,
          })
        }
        // Respuesta clara al cliente para otros errores de Webbeds
        return res
          .status(400)
          .json(
            buildWebbedsErrorPayload(error, {
              extra: error.extraDetails,
              metadata: error.metadata,
              xsdMessages,
            }),
          )
      } else {
        console.error("[webbeds] unexpected error", error)
      }
      return next(error)
    }
  }

  async saveBooking(req, res, next) {
    const {
      checkIn,
      checkOut,
      currency,
      rateBasis,
      hotelId,
      productId,
      hotelCode,
      rooms,
      contact,
      passengers,
      voucherRemark,
      specialRequest,
      customerReference,
    } = req.body || {}

    try {
      const resolvedHotelCode = hotelId ?? productId ?? hotelCode
      if (!resolvedHotelCode || !/^\d+$/.test(String(resolvedHotelCode).trim())) {
        throw new Error("WebBeds savebooking requires numeric hotelId (productId)")
      }

      const defaultCountryCode = process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102"
      const defaultCurrencyCode = process.env.WEBBEDS_DEFAULT_CURRENCY_CODE || "520"
      const normalizeCurrency = () => {
        // WebBeds account is USD-only; force USD currency code (520) for all requests.
        return "520"
      }
      const ensureNumericCode = (value, fallback) => {
        if (value === undefined || value === null || value === "") {
          return fallback
        }
        const strValue = String(value).trim()
        return /^\d+$/.test(strValue) ? strValue : fallback
      }
      const resolveRateBasis = (value) => {
        const parsed = Number(value)
        if (Number.isFinite(parsed) && parsed > 0) return String(parsed)
        const str = String(value ?? "").trim()
        if (/^\d+$/.test(str) && Number(str) > 0) return str
        return "-1"
      }

      const nationality = ensureNumericCode(
        req.body?.passengerNationality ??
        req.body?.nationality ??
        req?.user?.countryCode ??
        req?.user?.country,
        defaultCountryCode,
      )

      const residence = ensureNumericCode(
        req.body?.passengerCountryOfResidence ??
        req.body?.residence ??
        req?.user?.countryCode ??
        req?.user?.country,
        defaultCountryCode,
      )

      const requestId = this.getRequestId(req)
      const customerReferenceRaw =
        customerReference ??
        req.body?.customer_reference ??
        null
      const customerReferenceValue =
        customerReferenceRaw == null
          ? ""
          : String(customerReferenceRaw).trim()
      const resolvedCustomerReference =
        customerReferenceValue ||
        (requestId ? `REQ-${requestId}` : `REQ-${Date.now()}`)

      const payload = buildSaveBookingPayload({
        checkIn,
        checkOut,
        currency: normalizeCurrency(currency),
        hotelId: resolvedHotelCode,
        rateBasis: resolveRateBasis(rateBasis),
        nationality,
        residence,
        rooms,
        contact,
        passengers,
        voucherRemark,
        specialRequest,
        customerReference: resolvedCustomerReference,
      })

      const { result } = await this.client.send("savebooking", payload, {
        requestId,
      })

      const mapped = mapSaveBookingResponse(result)
      return res.json(mapped)
    } catch (error) {
      if (error.name === "WebbedsError") {
        const xsdMessages =
          Array.isArray(error.extra?.xsd_error?.error_message) &&
            error.extra.xsd_error.error_message.length
            ? error.extra.xsd_error.error_message
            : null
        console.error("[webbeds] savebooking error", {
          command: error.command,
          code: error.code,
          details: error.details,
          extra: error.extraDetails,
          xsdMessages,
          metadata: error.metadata,
          requestXml: error.requestXml,
        })
        if (xsdMessages) {
          console.error("[webbeds] XSD VALIDATION DETAILS:", JSON.stringify(xsdMessages, null, 2))
        }
        return res
          .status(400)
          .json(
            buildWebbedsErrorPayload(error, {
              extra: error.extraDetails,
              xsdMessages,
              metadata: error.metadata,
            }),
          )
      } else {
        console.error("[webbeds] unexpected error", error)
      }
      return next(error)
    }
  }

  async bookItinerary(req, res, next) {
    const {
      bookingCode,
      bookingType,
      confirm = "yes",
      contact = {},
      payment = {},
      services = [],
    } = req.body || {}

    try {
      if (!bookingCode) {
        throw new Error("WebBeds bookitinerary requires bookingCode")
      }

      const confirmValue = (() => {
        if (typeof confirm === "boolean") {
          return confirm ? "yes" : "no"
        }
        if (typeof confirm === "number") {
          return confirm === 0 ? "no" : "yes"
        }
        const normalized = String(confirm ?? "")
          .trim()
          .toLowerCase()
        if (normalized === "preauth") return "preauth"
        if (normalized === "no" || normalized === "false" || normalized === "0") return "no"
        return "yes"
      })()
      let amount = payment.amount ?? payment.creditCardCharge
      // si faltó amount y tenemos servicios, lo inferimos sumando testPrice/servicePrice/price de cada service
      if (amount == null && Array.isArray(services) && services.length) {
        const prices = services
          .map((s) => s.testPrice ?? s.servicePrice ?? s.price)
          .filter((v) => v != null)
          .map((v) => Number(v))
          .filter((n) => !Number.isNaN(n))
        if (prices.length) {
          amount = prices.reduce((acc, n) => acc + n, 0)
        }
      }
      if (confirmValue === "yes" && amount == null) {
        throw new Error("WebBeds bookitinerary requires payment.amount (net to charge)")
      }
      if (confirmValue === "yes" && (!Array.isArray(services) || services.length === 0)) {
        throw new Error("WebBeds bookitinerary requires services (testPricesAndAllocation)")
      }
      const paymentMethod =
        payment.paymentMethod ||
        process.env.WEBBEDS_PAYMENT_METHOD ||
        "CC_PAYMENT_COMMISSIONABLE"
      const isCommissionable = paymentMethod === "CC_PAYMENT_COMMISSIONABLE"
      const authorisationId = payment.authorisationId ?? payment.authorizationId

      let token = payment.token
      if (confirmValue === "yes" && amount != null && !token && !isCommissionable) {
        token = await this.tokenizeBusinessCard()
      }

      if (confirmValue === "yes" && isCommissionable) {
        if (!payment.orderCode) {
          throw new Error("WebBeds bookitinerary requires payment.orderCode for commissionable payments")
        }
        if (!authorisationId) {
          throw new Error("WebBeds bookitinerary requires payment.authorisationId for commissionable payments")
        }
      }

      const paymentPayload =
        confirmValue !== "yes" || amount == null
          ? {}
          : {
            paymentMethod,
            usedCredit: payment.usedCredit ?? 0,
            creditCardCharge: amount,
            token,
            cardHolderName: payment.cardHolderName || process.env.WEBBEDS_CC_NAME,
            creditCardType: payment.creditCardType || process.env.WEBBEDS_CC_TYPE || 100,
            avsDetails: payment.avsDetails,
            authorisationId,
            orderCode: payment.orderCode,
            devicePayload: payment.devicePayload,
            endUserIPAddress: payment.endUserIPAddress,
          }

      const commEmail = contact.email ||
        payment.avsDetails?.avsEmail ||
        process.env.WEBBEDS_COMM_EMAIL ||
        process.env.WEBBEDS_CC_EMAIL

      const payload = buildBookItineraryPayload({
        bookingCode,
        bookingType,
        confirm: confirmValue,
        sendCommunicationTo: commEmail,
        payment: paymentPayload,
        services,
      })

      const { result } = await this.client.send("bookitinerary", payload, {
        requestId: this.getRequestId(req),
        productOverride: null, // omit <product>
      })

      const mapped = mapBookItineraryResponse(result)
      return res.json(mapped)
    } catch (error) {
      if (error.name === "WebbedsError") {
        console.error("[webbeds] bookitinerary error", {
          command: error.command,
          code: error.code,
          details: error.details,
          extra: error.extraDetails,
          metadata: error.metadata,
        })
        // Respuesta clara al cliente con el detalle que envía Webbeds
        return res
          .status(400)
          .json(
            buildWebbedsErrorPayload(error, {
              extra: error.extraDetails,
              metadata: error.metadata,
            }),
          )
      } else {
        console.error("[webbeds] unexpected error", error)
      }
      return next(error)
    }
  }

  async bookItineraryRecheck(req, res, next) {
    const {
      bookingCode,
      bookingType = 1,
      contact = {},
    } = req.body || {}

    try {
      if (!bookingCode) {
        throw new Error("WebBeds bookitinerary recheck requires bookingCode")
      }

      const payload = buildBookItineraryPayload({
        bookingCode,
        bookingType,
        confirm: "no",
        sendCommunicationTo: contact.email,
        payment: {}, // no payment on recheck
      })

      const { result } = await this.client.send("bookitinerary", payload, {
        requestId: this.getRequestId(req),
        productOverride: null,
      })

      const mapped = mapBookItineraryResponse(result)
      return res.json(mapped)
    } catch (error) {
      if (error.name === "WebbedsError") {
        console.error("[webbeds] bookitinerary recheck error", {
          command: error.command,
          code: error.code,
          details: error.details,
          extra: error.extraDetails,
          metadata: error.metadata,
        })
        return res
          .status(400)
          .json(
            buildWebbedsErrorPayload(error, {
              extra: error.extraDetails,
              metadata: error.metadata,
            }),
          )
      } else {
        console.error("[webbeds] unexpected error", error)
      }
      return next(error)
    }
  }

  async bookItineraryPreauth(req, res, next) {
    const {
      bookingCode,
      bookingType = 2,
      contact = {},
      payment = {},
      services = [],
    } = req.body || {}

    try {
      if (!bookingCode) {
        throw new Error("WebBeds bookitinerary_preauth requires bookingCode")
      }

      let amount = payment.amount ?? payment.creditCardCharge
      if (amount == null && Array.isArray(services) && services.length) {
        const prices = services
          .map((s) => s.testPrice ?? s.servicePrice ?? s.price)
          .filter((v) => v != null)
          .map((v) => Number(v))
          .filter((n) => !Number.isNaN(n))
        if (prices.length) {
          amount = prices.reduce((acc, n) => acc + n, 0)
        }
      }
      if (amount == null) {
        throw new Error("WebBeds bookitinerary_preauth requires payment.amount (net to preauthorize)")
      }
      const paymentMethod = payment.paymentMethod ||
        process.env.WEBBEDS_PAYMENT_METHOD ||
        "CC_PAYMENT_COMMISSIONABLE"

      // Validaciones mínimas solo si es flujo commissionable (tarjeta del cliente)
      const isCommissionable = paymentMethod === "CC_PAYMENT_COMMISSIONABLE"
      const endUserIPAddressRaw =
        payment.endUserIPAddress ||
        payment.endUserIPv4Address ||
        req.ip ||
        req?.headers?.["x-forwarded-for"] ||
        process.env.WEBBEDS_DEFAULT_IP
      if (isCommissionable) {
        if (!payment.avsDetails) {
          throw new Error("WebBeds bookitinerary_preauth requires avsDetails")
        }
        if (!payment.devicePayload) {
          throw new Error("WebBeds bookitinerary_preauth requires devicePayload")
        }
        if (!endUserIPAddressRaw) {
          throw new Error("WebBeds bookitinerary_preauth requires endUserIPv4Address")
        }
      }
      const endUserIPAddress = endUserIPAddressRaw || undefined

      let token = payment.token
      if (!token) {
        if (isCommissionable) {
          throw new Error("WebBeds bookitinerary_preauth requires payment.token (RezToken)")
        }
        token = await this.tokenizeBusinessCard()
      }

      if (!Array.isArray(services) || services.length === 0) {
        throw new Error("WebBeds bookitinerary_preauth requires services (testPricesAndAllocation)")
      }

      // Preautorización usando el mismo comando bookitinerary con confirm=no.
      const commEmail = contact.email ||
        payment.avsDetails?.avsEmail ||
        process.env.WEBBEDS_COMM_EMAIL ||
        process.env.WEBBEDS_CC_EMAIL

      const payload = buildBookItineraryPayload({
        bookingCode,
        bookingType,
        confirm: "preauth",
        sendCommunicationTo: commEmail,
        payment: {
          paymentMethod,
          usedCredit: payment.usedCredit ?? 0,
          creditCardCharge: amount,
          token,
          cardHolderName: payment.cardHolderName || process.env.WEBBEDS_CC_NAME,
          creditCardType: payment.creditCardType || process.env.WEBBEDS_CC_TYPE || 100,
          avsDetails: payment.avsDetails,
          devicePayload: payment.devicePayload,
          endUserIPAddress,
        },
        services,
      })

      const { result } = await this.client.send("bookitinerary", payload, {
        requestId: this.getRequestId(req),
        productOverride: null, // omit <product>
      })

      const mapped = mapBookItineraryResponse(result)
      return res.json(mapped)
    } catch (error) {
      if (error.name === "WebbedsError") {
        console.error("[webbeds] bookitinerary_preauth error", {
          command: error.command,
          code: error.code,
          details: error.details,
          extra: error.extraDetails,
          metadata: error.metadata,
        })
        return res
          .status(400)
          .json(
            buildWebbedsErrorPayload(error, {
              extra: error.extraDetails,
              metadata: error.metadata,
            }),
          )
      } else {
        console.error("[webbeds] unexpected error", error)
      }
      return next(error)
    }
  }

  async confirmBooking(req, res, next) {
    const {
      bookingId,
      bookingCode,
      parent,
      addToBookedItn,
      bookedItnParent,
      fromDate,
      toDate,
      currency,
      productId,
      rooms,
      passengers,
      contact,
      customerReference,
    } = req.body || {}

    try {
      const code = bookingId || bookingCode
      if (!code) {
        throw new Error("Webbeds confirmation requires bookingId or bookingCode")
      }

      const payload = buildConfirmBookingPayload({
        bookingId: code,
        bookingCode,
        parent,
        addToBookedItn,
        bookedItnParent,
        fromDate,
        toDate,
        currency,
        productId,
        rooms,
        passengers,
        contact,
        customerReference,
      })

      const { result } = await this.client.send("confirmbooking", payload, {
        requestId: this.getRequestId(req),
      })

      const mapped = mapConfirmBookingResponse(result)
      return res.json(mapped)
    } catch (error) {
      if (error.name === "WebbedsError") {
        console.error("[webbeds] confirmbooking error", {
          command: error.command,
          code: error.code,
          details: error.details,
          extra: error.extraDetails,
          metadata: error.metadata,
        })
        return res
          .status(400)
          .json(
            buildWebbedsErrorPayload(error, {
              extra: error.extraDetails,
              metadata: error.metadata,
            }),
          )
      } else {
        console.error("[webbeds] unexpected error", error)
      }
      return next(error)
    }
  }

  async cancelBooking(req, res, next) {
    const {
      bookingId,
      bookingCode,
      bookingType,
      confirm,
      reason,
      services,
    } = req.body || {}

    try {
      const code = bookingId || bookingCode
      if (!code) {
        throw new Error("Webbeds cancellation requires bookingId")
      }

      const payload = buildCancelBookingPayload({
        bookingId: code,
        bookingCode,
        bookingType,
        confirm,
        reason,
        services,
      })

      const { result } = await this.client.send("cancelbooking", payload, {
        requestId: this.getRequestId(req),
        productOverride: null,
      })

      const mapped = mapCancelBookingResponse(result)
      return res.json(mapped)
    } catch (error) {
      if (error.name === "WebbedsError") {
        console.error("[webbeds] cancelbooking error", {
          command: error.command,
          code: error.code,
          details: error.details,
          extra: error.extraDetails,
          metadata: error.metadata,
        })
        return res
          .status(400)
          .json(
            buildWebbedsErrorPayload(error, {
              extra: error.extraDetails,
              metadata: error.metadata,
            }),
          )
      } else {
        console.error("[webbeds] unexpected error", error)
      }
      return next(error)
    }
  }

  async getBookingDetails(req, res, next) {
    const { bookingId } = req.query || req.body || {}

    try {
      if (!bookingId) throw new Error("Webbeds getBookingDetails requires bookingId")

      const payload = buildGetBookingDetailsPayload({ bookingId })

      const { result } = await this.client.send("getbookingdetails", payload, {
        requestId: this.getRequestId(req),
      })

      const mapped = mapGetBookingDetailsResponse(result)
      return res.json(mapped)
    } catch (error) {
      if (error.name === "WebbedsError") {
        console.error("[webbeds] getbookingdetails error", {
          command: error.command,
          code: error.code,
          details: error.details,
          extra: error.extraDetails,
          metadata: error.metadata,
        })
        return res
          .status(400)
          .json(
            buildWebbedsErrorPayload(error, {
              extra: error.extraDetails,
              metadata: error.metadata,
            }),
          )
      }
      return next(error)
    }
  }

  async deleteItinerary(req, res, next) {
    const { bookingId, bookingCode, bookingType, confirm, reason } = req.body || {}

    try {
      const payload = buildDeleteItineraryPayload({
        bookingId,
        bookingCode,
        bookingType,
        confirm,
        reason
      })

      const { result } = await this.client.send("deleteitinerary", payload, {
        requestId: this.getRequestId(req),
        productOverride: null,
      })

      const mapped = mapDeleteItineraryResponse(result)
      return res.json(mapped)
    } catch (error) {
      if (error.name === "WebbedsError") {
        console.error("[webbeds] deleteitinerary error", {
          command: error.command,
          code: error.code,
          details: error.details,
          extra: error.extraDetails,
          metadata: error.metadata,
        })
        return res
          .status(400)
          .json(
            buildWebbedsErrorPayload(error, {
              extra: error.extraDetails,
              metadata: error.metadata,
            }),
          )
      }
      return next(error)
    }
  }

  getCredentials() {
    const config = getWebbedsConfig()
    const passwordHash =
      config.passwordMd5 ||
      (config.password
        ? createHash("md5").update(config.password).digest("hex")
        : null)

    return {
      username: config.username,
      companyCode: config.companyCode,
      passwordHash,
    }
  }

  async sendSearchRequest({ req, payload, requestAttributes, credentials }) {
    const requestXml = buildEnvelope({
      username: credentials.username,
      passwordMd5: credentials.passwordHash,
      companyCode: credentials.companyCode,
      command: "searchhotels",
      product: "hotel",
      payload,
      requestAttributes,
    })

    if (verboseLogs) {
      console.log("[webbeds] --- request build start ---")
      console.log("[webbeds] payload:", JSON.stringify(payload, null, 2))
      console.log("[webbeds] request attributes:", requestAttributes)
      console.log("[webbeds] request XML:", requestXml)
      console.log("[webbeds] --- request build end ---")
    }

    const { result } = await this.client.send("searchhotels", payload, {
      requestId: this.getRequestId(req),
      requestAttributes,
    })

    return mapSearchHotelsResponse(result)
  }

  async searchByHotelIdBatches({
    req,
    res,
    payloadOptions,
    providedHotelIds,
    credentials,
    cityCode,
    queryAdvancedConditions = [],
    advancedOperator,
  }) {
    let hotelIds = providedHotelIds
    if (!hotelIds.length) {
      if (!cityCode) {
        throw new Error(
          "WebBeds hotelId mode requires a cityCode or the hotelIds parameter",
        )
      }
      hotelIds = await fetchHotelIdsByCity(cityCode)
    }

    if (!hotelIds.length) {
      console.warn(
        `[webbeds] hotelId mode: no hotels found for city ${cityCode ?? "n/a"}`,
      )
      return res.json([])
    }

    const batches = chunkArray(hotelIds)
    const concurrency = resolveHotelIdConcurrency()
    if (verboseLogs) {
      console.log(
        `[webbeds] hotelId mode: executing ${batches.length} request(s) for ${hotelIds.length} hotels (concurrency=${concurrency})`,
      )
    }

    const batchResults = await runBatchesWithLimit(batches, concurrency, async (batch) => {
      const { payload, requestAttributes } = buildSearchHotelsPayload({
        ...payloadOptions,
        advancedConditions: [
          ...queryAdvancedConditions,
          ...(buildHotelIdConditions(batch) ?? []),
        ],
        advancedOperator,
      })
      return this.sendSearchRequest({
        req,
        payload,
        requestAttributes,
        credentials,
      })
    })

    const flattened = batchResults.flat()
    const enriched = await this.enrichWithHotelDetails(flattened)
    return res.json(this.groupOptionsByHotel(enriched))
  }

  async enrichWithHotelDetails(options = []) {
    if (!Array.isArray(options) || !options.length || !models?.WebbedsHotel) {
      return options
    }

    const hotelCodes = Array.from(
      new Set(
        options
          .map((option) => (option?.hotelCode != null ? String(option.hotelCode) : null))
          .filter(Boolean),
      ),
    )

    if (!hotelCodes.length) {
      return options
    }

    let records = []
    try {
      records = await models.WebbedsHotel.findAll({
        where: {
          hotel_id: {
            [Op.in]: hotelCodes,
          },
        },
        attributes: [
          "hotel_id",
          "name",
          "city_name",
          "city_code",
          "country_name",
          "country_code",
          "address",
          "zip_code",
          "location1",
          "location2",
          "location3",
          "lat",
          "lng",
          "rating",
          "hotel_phone",
          "hotel_check_in",
          "hotel_check_out",
          "min_age",
          "built_year",
          "renovation_year",
          "amenities",
          "leisure",
          "business",
          "descriptions",
          "images",
          "chain",
          "priority",
          "preferred",
          "exclusive",
          "fire_safety",
          "full_address",
          "geo_locations",
          "region_name",
          "region_code",
        ],
        raw: true,
      })
    } catch (error) {
      console.warn("[webbeds] failed to fetch hotel metadata:", error.message)
      return options
    }

    // Fetch room types for these hotels to expose static room metadata on search
    let roomTypesByHotel = new Map()
    try {
      const roomTypes = await models.WebbedsHotelRoomType.findAll({
        where: {
          hotel_id: {
            [Op.in]: hotelCodes,
          },
        },
        attributes: [
          "hotel_id",
          "roomtype_code",
          "name",
          "twin",
          "room_info",
          "room_capacity",
        ],
        raw: true,
      })
      roomTypesByHotel = roomTypes.reduce((map, rt) => {
        const key = String(rt.hotel_id)
        if (!map.has(key)) map.set(key, [])
        map.get(key).push({
          roomTypeCode: rt.roomtype_code,
          name: rt.name,
          twin: rt.twin === "yes" || rt.twin === "true" || rt.twin === true,
          roomInfo: rt.room_info,
          roomCapacity: rt.room_capacity,
        })
        return map
      }, new Map())
    } catch (error) {
      console.warn("[webbeds] failed to fetch hotel room types:", error.message)
    }

    if (!records.length) {
      return options
    }

    const hotelMap = new Map(records.map((record) => [String(record.hotel_id), record]))

    const normalizeJson = (value, fallback = []) => {
      if (Array.isArray(value)) return value
      if (value && typeof value === "object") return value
      return fallback
    }

    return options.map((option) => {
      const details = hotelMap.get(String(option.hotelCode))
      if (!details) return option

      const enrichedDetails = {
        hotelCode: String(details.hotel_id),
        hotelName: details.name ?? option.hotelDetails?.hotelName ?? option.hotelName ?? null,
        city: details.city_name ?? option.hotelDetails?.city ?? null,
        cityCode: details.city_code ? String(details.city_code) : option.hotelDetails?.cityCode ?? null,
        country: details.country_name ?? option.hotelDetails?.country ?? null,
        countryCode:
          details.country_code != null ? String(details.country_code) : option.hotelDetails?.countryCode ?? null,
        address: details.address ?? option.hotelDetails?.address ?? null,
        zipCode: details.zip_code ?? option.hotelDetails?.zipCode ?? null,
        locations: [
          details.location1,
          details.location2,
          details.location3,
          ...(option.hotelDetails?.locations ?? []),
        ].filter(Boolean),
        geoPoint:
          details.lat != null && details.lng != null
            ? { lat: Number(details.lat), lng: Number(details.lng) }
            : option.hotelDetails?.geoPoint ?? null,
        geoLocations: normalizeJson(details.geo_locations, option.hotelDetails?.geoLocations ?? []),
        rating: details.rating ?? option.hotelDetails?.rating ?? null,
        phone: details.hotel_phone ?? option.hotelDetails?.phone ?? null,
        checkIn: details.hotel_check_in ?? option.hotelDetails?.checkIn ?? null,
        checkOut: details.hotel_check_out ?? option.hotelDetails?.checkOut ?? null,
        minAge: details.min_age ?? option.hotelDetails?.minAge ?? null,
        builtYear: details.built_year ?? option.hotelDetails?.builtYear ?? null,
        renovationYear: details.renovation_year ?? option.hotelDetails?.renovationYear ?? null,
        amenities: normalizeJson(details.amenities, option.hotelDetails?.amenities ?? []),
        leisure: normalizeJson(details.leisure, option.hotelDetails?.leisure ?? []),
        business: normalizeJson(details.business, option.hotelDetails?.business ?? []),
        descriptions: normalizeJson(details.descriptions, option.hotelDetails?.descriptions ?? []),
        images: normalizeJson(details.images, option.hotelDetails?.images ?? []),
        chain: details.chain ?? option.hotelDetails?.chain ?? null,
        priority: details.priority ?? option.hotelDetails?.priority ?? null,
        preferred:
          details.preferred != null
            ? Boolean(details.preferred)
            : option.hotelDetails?.preferred ?? false,
        exclusive:
          details.exclusive != null
            ? Boolean(details.exclusive)
            : option.hotelDetails?.exclusive ?? false,
        fireSafety:
          details.fire_safety != null
            ? Boolean(details.fire_safety)
            : option.hotelDetails?.fireSafety ?? false,
        region: {
          name: details.region_name ?? option.hotelDetails?.region?.name ?? null,
          code: details.region_code ?? option.hotelDetails?.region?.code ?? null,
        },
        fullAddress: details.full_address ?? option.hotelDetails?.fullAddress ?? null,
        roomTypes: roomTypesByHotel.get(String(details.hotel_id)) ?? option.hotelDetails?.roomTypes ?? [],
      }

      return {
        ...option,
        hotelName: option.hotelName ?? details.name ?? option.hotelDetails?.hotelName ?? null,
        hotelDetails: {
          ...option.hotelDetails,
          ...enrichedDetails,
        },
      }
    })
  }

  groupOptionsByHotel(options = []) {
    if (!Array.isArray(options) || !options.length) {
      return []
    }

    const grouped = new Map()
    let unknownIndex = 0

    const pushOption = (entry, option) => {
      if (!entry._optionKeys) {
        entry._optionKeys = new Set()
      }

      const normalizedRateKey =
        option.rateKey != null ? String(option.rateKey).trim() : null

      const optionKey =
        normalizedRateKey ||
        JSON.stringify({
          board: option.board ?? null,
          paymentType: option.paymentType ?? null,
          status: option.status ?? null,
          price: option.price ?? null,
          currency: option.currency ?? null,
          refundable: option.refundable ?? null,
          rooms: (option.rooms || []).map((room) => ({
            code: room?.code ?? null,
            description: room?.description ?? null,
            rateBasisId: room?.rateBasisId ?? null,
          })),
        })

      if (entry._optionKeys.has(optionKey)) {
        return
      }
      entry._optionKeys.add(optionKey)

      entry.options.push({
        rateKey: normalizedRateKey,
        board: option.board,
        paymentType: option.paymentType,
        status: option.status,
        price: option.price,
        currency: option.currency,
        refundable: option.refundable,
        rooms: option.rooms,
        cancelPolicy: option.cancelPolicy,
        surcharges: option.surcharges,
        metadata: option.metadata,
      })
    }

    options.forEach((option) => {
      if (!option) return
      const hotelCodeRaw = option.hotelCode ?? option.hotelDetails?.hotelCode
      const mapKey =
        hotelCodeRaw != null
          ? String(hotelCodeRaw)
          : option.rateKey
            ? `unknown:${option.rateKey}`
            : `unknown:auto:${unknownIndex++}`

      const hotelCode = hotelCodeRaw != null ? String(hotelCodeRaw) : null
      const existing = grouped.get(mapKey)

      if (!existing) {
        const entry = {
          hotelCode,
          hotelName: option.hotelName ?? option.hotelDetails?.hotelName ?? null,
          hotelDetails: option.hotelDetails ?? null,
          options: [],
        }
        pushOption(entry, option)
        grouped.set(mapKey, entry)
        return
      }

      if (!existing.hotelDetails && option.hotelDetails) {
        existing.hotelDetails = option.hotelDetails
      }
      if (!existing.hotelName && (option.hotelName || option.hotelDetails?.hotelName)) {
        existing.hotelName = option.hotelName ?? option.hotelDetails?.hotelName ?? existing.hotelName
      }
      pushOption(existing, option)
    })

    return Array.from(grouped.values()).map(({ _optionKeys, ...rest }) => rest)
  }
}
