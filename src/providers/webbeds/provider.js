import { createHash } from "crypto"
import { Op } from "sequelize"
import models from "../../models/index.js"
import { HotelProvider } from "../hotelProvider.js"
import { createWebbedsClient, buildEnvelope } from "./client.js"
import { getWebbedsConfig } from "./config.js"
import { buildSearchHotelsPayload, mapSearchHotelsResponse } from "./searchHotels.js"
import { buildGetRoomsPayload, mapGetRoomsResponse } from "./getRooms.js"

const MAX_HOTEL_IDS_PER_REQUEST = 50
const DEFAULT_HOTEL_ID_CONCURRENCY = 4

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

      const resolveRateBasis = (value) => {
        const parsed = Number(value)
        if (Number.isFinite(parsed) && parsed > 0) return String(parsed)
        const str = String(value ?? "").trim()
        if (/^\d+$/.test(str) && Number(str) > 0) return str
        return "1"
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
      const debug = req.query.debug ?? undefined
      const providedHotelIds = parseCsvList(req.query.hotelIds)
      const credentials = this.getCredentials()
      const payloadOptions = {
        checkIn,
        checkOut,
        currency,
        occupancies,
        nationality,
        residence,
        rateBasis: resolveRateBasis(rateBasis),
        cityCode,
        countryCode,
        includeFields,
        includeRoomFields,
        includeNoPrice,
        debug,
      }

      const searchMode = String(
        req.query.mode ?? req.query.searchMode ?? "city",
      ).toLowerCase()

      if (searchMode === "hotelids") {
        return this.searchByHotelIdBatches({
          req,
          res,
          payloadOptions,
          providedHotelIds,
          credentials,
          cityCode,
        })
      }

      const {
        payload,
        requestAttributes,
      } = buildSearchHotelsPayload({
        ...payloadOptions,
        advancedConditions: buildHotelIdConditions(providedHotelIds),
      })

      const options = await this.sendSearchRequest({
        req,
        payload,
        requestAttributes,
        credentials,
      })
      const enriched = await this.enrichWithHotelDetails(options)
      return res.json(this.groupOptionsByHotel(enriched))
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
      roomTypeCode,
      selectedRateBasis,
      allocationDetails,
    } = req.query

    try {

      const hotelCode = hotelId ?? productId
      if (!hotelCode || !/^\d+$/.test(String(hotelCode).trim())) {
        throw new Error("WebBeds getrooms requires numeric hotelId (productId)")
      }

      const defaultCountryCode = process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102"
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
        return "1"
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
        hotelId: hotelCode,
        roomTypeCode,
        selectedRateBasis,
        allocationDetails,
      })

      console.info("[webbeds] getRooms request", {
        hotelCode,
        checkIn,
        checkOut,
        currency,
        occupancies,
        rateBasis: resolveRateBasis(rateBasis),
        roomTypeCode,
        selectedRateBasis,
        allocationDetails: allocationDetails ? "[provided]" : null,
        nationality,
        residence,
      })

      const { result } = await this.client.send("getrooms", payload, {
        requestId: this.getRequestId(req),
      })
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
      const mapped = mapGetRoomsResponse(result)
      try {
        console.log("[webbeds] getRooms mapped payload:", JSON.stringify(mapped, null, 2))
      } catch {
        console.log("[webbeds] getRooms mapped payload: [unserializable]")
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
      } else {
        console.error("[webbeds] unexpected error", error)
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

    console.log("[webbeds] --- request build start ---")
    console.log("[webbeds] payload:", JSON.stringify(payload, null, 2))
    console.log("[webbeds] request attributes:", requestAttributes)
    console.log("[webbeds] request XML:", requestXml)
    console.log("[webbeds] --- request build end ---")

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
    console.log(
      `[webbeds] hotelId mode: executing ${batches.length} request(s) for ${hotelIds.length} hotels (concurrency=${concurrency})`,
    )

    const batchResults = await runBatchesWithLimit(batches, concurrency, async (batch) => {
      const { payload, requestAttributes } = buildSearchHotelsPayload({
        ...payloadOptions,
        advancedConditions: buildHotelIdConditions(batch),
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
