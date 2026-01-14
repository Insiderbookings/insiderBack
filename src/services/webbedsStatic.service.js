import models, { sequelize } from "../models/index.js"
import { createWebbedsClient, buildEnvelope } from "../providers/webbeds/client.js"
import { getWebbedsConfig } from "../providers/webbeds/config.js"
import { createHash } from "crypto"
import { gzipSync } from "zlib"
import dayjs from "dayjs"

const ensureArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const STATIC_LOOKAHEAD_DAYS = Number(process.env.WEBBEDS_STATIC_LOOKAHEAD_DAYS || 120)
const normalizeBoolean = (value) => {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    return normalized === "true" || normalized === "yes" || normalized === "1"
  }
  return Boolean(value)
}

const getClient = () => {
  if (webbedsClient) return webbedsClient
  const config = getWebbedsConfig()
  cachedConfig = config
  webbedsClient = createWebbedsClient(config)
  return webbedsClient
}

let webbedsClient = null
let cachedConfig = null
let countryNameCache = null
const STATIC_CURRENCY = process.env.WEBBEDS_STATIC_CURRENCY || "520"
const STATIC_OCCUPANCIES =
  process.env.WEBBEDS_STATIC_OCCUPANCIES || "1|0,1|0,2|0"
const NAMESPACE_ATOMIC = "http://us.dotwconnect.com/xsd/atomicCondition"
const NAMESPACE_COMPLEX = "http://us.dotwconnect.com/xsd/complexCondition"
const MAX_NOTIN_VALUES = Number(process.env.WEBBEDS_NOTIN_MAX || 20000)
const amenityCatalogCache = new Set()

const formatTimestampForFilters = (value) => {
  if (!value) return null
  const parsed = dayjs(value)
  if (!parsed.isValid()) return null
  return parsed.format("YYYY-MM-DD HH:mm:ss")
}

const summarizeFilters = (filters = {}) => {
  if (!filters || typeof filters !== "object") return null
  const conditionNode = filters["c:condition"]?.["a:condition"]
  const conditionCount = Array.isArray(conditionNode)
    ? conditionNode.length
    : conditionNode
      ? 1
      : 0
  return {
    city: filters.city ?? null,
    country: filters.country ?? null,
    noPrice: filters.noPrice ?? null,
    lastUpdated: filters.lastUpdated ?? null,
    conditionCount,
  }
}

const hashPayload = (payload) => {
  if (!payload) return null
  const serialized = JSON.stringify(payload)
  return createHash("md5").update(serialized).digest("hex")
}

const getOptionValue = (option) => {
  const value = option?.["@_value"] ?? option?.value ?? option?.["@value"] ?? option?.["@_id"]
  if (value == null) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : value
}

const getOptionName = (option) => {
  if (typeof option === "string") return option
  return option?.["#text"] ?? option?._ ?? option?.text ?? option?.name ?? null
}

const getOptionRunno = (option) => {
  const runno = option?.["@_runno"] ?? option?.runno
  if (runno == null) return null
  const num = Number(runno)
  return Number.isFinite(num) ? num : null
}

const resolveOptionList = (result, path = []) => {
  let node = result
  for (const key of path) {
    node = node?.[key]
    if (!node) return []
  }
  if (Array.isArray(node)) return node
  if (Array.isArray(node?.option)) return node.option
  return ensureArray(node?.option ?? node)
}

const syncOptionCatalog = async ({
  command,
  model,
  nodePath,
  dryRun = false,
  mapOption,
  label,
}) => {
  if (dryRun) {
    return logDryRun({ command, payload: {} })
  }

  const client = getClient()
  console.log(`[webbeds][static] syncing ${label}...`)
  const { result } = await client.send(command, {})
  const options = resolveOptionList(result, nodePath)

  if (!options.length) {
    console.warn(`[webbeds][static] ${label} returned empty list`)
    return { inserted: 0 }
  }

  const tx = await sequelize.transaction()
  try {
    let processed = 0
    for (const option of options) {
      const record = mapOption(option)
      if (!record?.code) continue
      await model.upsert(record, { transaction: tx })
      processed += 1
    }
    await tx.commit()
    console.info(`[webbeds][static] ${label} synchronized`, { count: processed })
    return { inserted: processed }
  } catch (error) {
    await tx.rollback()
    console.error(`[webbeds][static] ${label} sync failed`, error)
    throw error
  }
}

const buildStaticHotelsPayload = ({
  cityCode,
  countryCode,
  includeRooms = true,
  includeNoPrice = true,
  filterConditions = [],
  lastUpdatedRange,
  additionalFields = [],
  additionalRoomFields = [],
} = {}) => {
  if (!cityCode && !countryCode) {
    throw new Error("cityCode or countryCode is required to sync hotels")
  }

  const today = dayjs().format("YYYY-MM-DD")
  const futureStart = dayjs().add(STATIC_LOOKAHEAD_DAYS, "day")
  const fromDate = futureStart.format("YYYY-MM-DD")
  const toDate = futureStart.add(1, "day").format("YYYY-MM-DD")

  const filters = {
    "@xmlns:a": NAMESPACE_ATOMIC,
    "@xmlns:c": NAMESPACE_COMPLEX,
  }

  if (cityCode) {
    filters.city = String(cityCode)
  } else if (countryCode) {
    filters.country = String(countryCode)
  }

  if (includeNoPrice) {
    filters.noPrice = "true"
  }

  const effectiveConditions = ensureArray(filterConditions).slice()
  if (lastUpdatedRange?.from) {
    const from = formatTimestampForFilters(lastUpdatedRange.from)
    const to = formatTimestampForFilters(lastUpdatedRange.to) ?? formatTimestampForFilters(dayjs())
    if (from) {
      effectiveConditions.push({
        fieldName: "lastUpdated",
        fieldTest: "between",
        fieldValues: [from, to].filter(Boolean),
      })
    }
  }

  const normalizedConditions = effectiveConditions
    .map((condition) => {
      const fieldName = condition?.fieldName
      const fieldTest = condition?.fieldTest
      const values = ensureArray(condition?.fieldValues)
        .map((value) => (value == null ? null : String(value)))
        .filter(Boolean)

      if (!fieldName || !fieldTest || !values.length) return null
      return {
        fieldName,
        fieldTest,
        fieldValues: {
          fieldValue: values,
        },
      }
    })
    .filter(Boolean)

  if (normalizedConditions.length) {
    filters["c:condition"] = {
      "a:condition": normalizedConditions,
    }
  }

  const baseFields = [
    "preferred",
    "builtYear",
    "renovationYear",
    "floors",
    "noOfRooms",
    "fullAddress",
    "description1",
    "description2",
    "hotelName",
    "address",
    "zipCode",
    "location",
    "locationId",
    "geoLocations",
    "location1",
    "location2",
    "location3",
    "cityName",
    "cityCode",
    "stateName",
    "stateCode",
    "countryName",
    "countryCode",
    "regionName",
    "regionCode",
    "attraction",
    "amenitie",
    "leisure",
    "business",
    "transportation",
    "hotelPhone",
    "hotelCheckIn",
    "hotelCheckOut",
    "minAge",
    "rating",
    "images",
    "fireSafety",
    "hotelPreference",
    "direct",
    "geoPoint",
    "leftToSell",
    "chain",
    "lastUpdated",
    "priority",
  ]

  const baseRoomFields = ["name", "roomInfo", "roomAmenities", "twin", "roomAttributes", "roomDescription", "roomImages"]

  const fieldSet = [...new Set([...baseFields, ...ensureArray(additionalFields).filter(Boolean)])]
  const roomFieldSet = [...new Set([...baseRoomFields, ...ensureArray(additionalRoomFields).filter(Boolean)])]

  const roomNodes = ensureArray(STATIC_OCCUPANCIES.split(","))
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token, idx) => {
      const [adultsStr = "1", childrenStr = "0"] = token.split("|")
      const childrenNo = String(childrenStr).trim()
      return {
        "@runno": String(idx),
        adultsCode: String(adultsStr).trim() || "1",
        children: { "@no": childrenNo || "0" },
        rateBasis: "-1",
      }
    })

  const returnNode = {}
  if (includeRooms) {
    returnNode.getRooms = "true"
  }
  returnNode.filters = filters
  returnNode.fields = {
    field: fieldSet,
    roomField: roomFieldSet,
  }

  return {
    bookingDetails: {
      fromDate,
      toDate,
      currency: STATIC_CURRENCY,
      rooms: {
        "@no": String(roomNodes.length || 1),
        room: roomNodes.length
          ? roomNodes
          : [
              {
                "@runno": "0",
                adultsCode: "1",
                children: { "@no": "0" },
                rateBasis: "-1",
              },
            ],
      },
    },
    return: returnNode,
  }
}

const toNumberOrNull = (value) => {
  if (value == null) return null
  const num = Number(String(value).trim())
  return Number.isFinite(num) ? num : null
}

const extractImageEntries = (hotelId, hotel) => {
  const toText = (node) => {
    if (node == null) return null
    if (typeof node === "string" || typeof node === "number") return String(node)
    if (typeof node === "object") {
      return node["#cdata-section"] ?? node["#text"] ?? node.value ?? null
    }
    return null
  }

  const imagesNode = hotel.images?.hotelImages
  if (!imagesNode) return []
  const entries = []
  if (imagesNode.thumb) {
    entries.push({
      hotel_id: hotelId,
      category_id: null,
      category_name: "thumbnail",
      alt: "thumbnail",
      url: toText(imagesNode.thumb),
      runno: null,
      is_thumbnail: true,
    })
  }
  const images = ensureArray(imagesNode.image)
  images.forEach((image) => {
    const url = toText(image?.url ?? image)
    entries.push({
      hotel_id: hotelId,
      category_id: image?.category?.["@_id"] ?? null,
      category_name: toText(image?.category),
      alt: toText(image?.alt),
      url,
      runno: toNumberOrNull(image?.["@_runno"]),
      is_thumbnail: false,
    })
  })
  return entries.filter((entry) => entry.url)
}

const extractTypedAmenities = (hotelId, type, node) => {
  if (!node) return []
  const languages = ensureArray(node.language ?? node)
  const entries = []
  const elementName =
    type === "amenitie"
      ? "amenitieItem"
      : type === "leisure"
        ? "leisureItem"
        : "businessItem"

  languages.forEach((languageNode) => {
    const items = ensureArray(languageNode[elementName])
    items.forEach((item) => {
      const itemName = typeof item === "string" ? item : item?.["#text"] ?? item?.["#cdata-section"]
      const codeCandidate = item?.["@_id"] ?? item?.["@id"] ?? item?.id ?? item?.["@_value"]
      const catalogCode = toNumberOrNull(codeCandidate)
      entries.push({
        hotel_id: hotelId,
        category: type,
        language_id: languageNode?.["@_id"] ?? languageNode?.id ?? null,
        language_name: languageNode?.["@_name"] ?? languageNode?.name ?? null,
        item_id: codeCandidate ? String(codeCandidate) : null,
        item_name: itemName ?? null,
        catalog_code: catalogCode ?? null,
      })
    })
  })
  return entries
}

const extractAmenityEntries = (hotelId, hotel) => {
  return [
    ...extractTypedAmenities(hotelId, "amenitie", hotel.amenitie),
    ...extractTypedAmenities(hotelId, "leisure", hotel.leisure),
    ...extractTypedAmenities(hotelId, "business", hotel.business),
  ]
}

const extractGeoLocationEntries = (hotelId, hotel) => {
  const locations = ensureArray(hotel.geoLocations?.geoLocation)
  return locations.map((geo) => ({
    hotel_id: hotelId,
    geo_id: geo?.["@_id"] ?? geo?.id ?? null,
    name: geo?.name ?? null,
    type: geo?.type ?? null,
    distance: toNumberOrNull(
      typeof geo?.distance === "object" ? geo?.distance?.["#text"] ?? geo?.distance?.value : geo?.distance,
    ),
    distance_unit:
      typeof geo?.distance === "object" ? geo?.distance?.["@_attr"] ?? geo?.distance?.attr ?? null : geo?.distanceAttr ?? null,
  }))
}

const extractRoomTypeEntries = (hotelId, hotel) => {
  const rooms = ensureArray(hotel.rooms?.room)
  const entries = []
  rooms.forEach((room) => {
    const roomTypes = ensureArray(room?.roomType)
    roomTypes.forEach((roomType) => {
      const roomtypeCode = roomType?.["@_roomtypecode"] ?? roomType?.roomtypecode ?? null
      if (!roomtypeCode) return
      entries.push({
        hotel_id: hotelId,
        roomtype_code: roomtypeCode,
        name: roomType?.name ?? null,
        twin: roomType?.twin ?? null,
        room_info: roomType?.roomInfo ?? null,
        room_capacity: roomType?.roomCapacityInfo ?? null,
        raw_payload: roomType,
      })
    })
  })
  return entries
}

const upsertHotelRelations = async (hotelId, hotel, transaction) => {
  const imageEntries = extractImageEntries(hotelId, hotel)
  const amenityEntries = extractAmenityEntries(hotelId, hotel)
  const geoEntries = extractGeoLocationEntries(hotelId, hotel)
  const roomEntries = extractRoomTypeEntries(hotelId, hotel)

  for (const amenity of amenityEntries) {
    if (!amenity.catalog_code) continue
    if (amenityCatalogCache.has(amenity.catalog_code)) continue
    const exists = await models.WebbedsAmenityCatalog.findByPk(amenity.catalog_code, {
      attributes: ["code"],
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    if (!exists) {
      const derivedType =
        amenity.category === "leisure"
          ? "leisure"
          : amenity.category === "business"
            ? "business"
            : "hotel"
      await models.WebbedsAmenityCatalog.create(
        {
          code: amenity.catalog_code,
          name: amenity.item_name ?? `Amenity ${amenity.catalog_code}`,
          type: derivedType,
          metadata: { autoGenerated: true },
        },
        { transaction },
      )
    }
    amenityCatalogCache.add(amenity.catalog_code)
  }

  await models.WebbedsHotelImage.destroy({ where: { hotel_id: hotelId }, transaction })
  if (imageEntries.length) {
    await models.WebbedsHotelImage.bulkCreate(imageEntries, { transaction })
  }

  await models.WebbedsHotelAmenity.destroy({ where: { hotel_id: hotelId }, transaction })
  if (amenityEntries.length) {
    await models.WebbedsHotelAmenity.bulkCreate(amenityEntries, { transaction })
  }

  await models.WebbedsHotelGeoLocation.destroy({ where: { hotel_id: hotelId }, transaction })
  if (geoEntries.length) {
    await models.WebbedsHotelGeoLocation.bulkCreate(geoEntries, { transaction })
  }

  await models.WebbedsHotelRoomType.destroy({ where: { hotel_id: hotelId }, transaction })
  if (roomEntries.length) {
    await models.WebbedsHotelRoomType.bulkCreate(roomEntries, { transaction })
  }
}

const resolvePasswordMd5 = (config) => {
  if (config.passwordMd5) return config.passwordMd5
  if (!config.password) throw new Error("WEBBEDS_PASSWORD or WEBBEDS_PASSWORD_MD5 required")
  return createHash("md5").update(config.password).digest("hex")
}

const persistHotels = async (hotels, fallbackCityCode) => {
  if (!hotels?.length) return 0
  const tx = await sequelize.transaction()
  try {
    let processed = 0
    for (const hotel of hotels) {
      const hotelId = Number(hotel["@_hotelid"] ?? hotel.hotelid) || null
      if (!hotelId) {
        console.warn("[webbeds][static] hotel missing id", { hotel })
        continue
      }

      const cityCodeValue = Number(hotel.cityCode ?? fallbackCityCode) || null
      const countryCodeValue = Number(hotel.countryCode) || null
      const lat = hotel.geoPoint?.lat ? Number(hotel.geoPoint.lat) : null
      const lng = hotel.geoPoint?.lng ? Number(hotel.geoPoint.lng) : null

      await models.WebbedsHotel.upsert(
        {
          hotel_id: hotelId,
          name: hotel.hotelName ?? hotel.name ?? null,
          city_code: cityCodeValue,
          city_name: hotel.cityName ?? null,
          country_code: countryCodeValue,
          country_name: hotel.countryName ?? null,
          region_name: hotel.regionName ?? null,
          region_code: hotel.regionCode ?? null,
          address: hotel.address ?? null,
          zip_code: hotel.zipCode ?? null,
          location1: hotel.location1 ?? null,
          location2: hotel.location2 ?? null,
          location3: hotel.location3 ?? null,
          built_year: hotel.builtYear ?? null,
          renovation_year: hotel.renovationYear ?? null,
          floors: hotel.floors ?? null,
          no_of_rooms: hotel.noOfRooms ?? null,
          rating: hotel.rating ?? null,
          priority: hotel.priority ? Number(hotel.priority) : null,
          preferred: normalizeBoolean(hotel.preferred ?? hotel["@_preferred"]),
          exclusive: normalizeBoolean(hotel.exclusive ?? hotel["@_exclusive"]),
          direct: normalizeBoolean(hotel.direct),
          fire_safety: normalizeBoolean(hotel.fireSafety),
          chain: hotel.chain ?? null,
           chain_code: toNumberOrNull(hotel.chain),
           classification_code: toNumberOrNull(hotel.rating),
          hotel_phone: hotel.hotelPhone ?? null,
          hotel_check_in: hotel.hotelCheckIn ?? null,
          hotel_check_out: hotel.hotelCheckOut ?? null,
          min_age: hotel.minAge ?? null,
          last_updated: hotel.lastUpdated ? Number(hotel.lastUpdated) : null,
          lat,
          lng,
          full_address: hotel.fullAddress ?? null,
          descriptions: {
            description1: hotel.description1 ?? null,
            description2: hotel.description2 ?? null,
          },
          amenities: hotel.amenitie ?? null,
          leisure: hotel.leisure ?? null,
          business: hotel.business ?? null,
          transportation: hotel.transportation ?? null,
          geo_locations: hotel.geoLocations ?? null,
          images: hotel.images ?? null,
          room_static: hotel.rooms ?? null,
          raw_payload: hotel,
        },
        { transaction: tx },
      )

      await upsertHotelRelations(hotelId, hotel, tx)
      processed += 1
    }
    await tx.commit()
    return processed
  } catch (error) {
    await tx.rollback()
    throw error
  }
}

const logDryRun = ({ command, payload }) => {
  const config = cachedConfig ?? getWebbedsConfig()
  const host = config.host ?? "https://xmldev.dotwconnect.com"
  const url = host.endsWith("/gatewayV4.dotw") ? host : `${host.replace(/\/+$/, "")}/gatewayV4.dotw`
  const passwordMd5 = resolvePasswordMd5(config)
  const envelope = buildEnvelope({
    username: config.username,
    passwordMd5,
    companyCode: config.companyCode,
    command,
    product: "hotel",
    payload,
  })
  const headers = {
    "Content-Type": "text/xml",
    Accept: "text/xml",
    "Accept-Encoding": "gzip",
    "Content-Encoding": "gzip",
    Connection: "close",
    "Content-Length": String(Buffer.byteLength(envelope, "utf8")),
  }
  const gzBuffer = gzipSync(Buffer.from(envelope, "utf8"))
  console.log("[webbeds][static][dry-run]", {
    url,
    command,
    headers,
    xmlPreview: envelope.slice(0, 2000),
    xmlBytes: Buffer.byteLength(envelope, "utf8"),
    gzBytes: gzBuffer.length,
  })
  return { dryRun: true, command }
}

const ensureCitySyncLog = async (cityCode) => {
  if (!cityCode || !models.WebbedsSyncLog) return null
  const defaults = { scope: "city", city_code: cityCode }
  const city = await models.WebbedsCity.findByPk(cityCode)
  if (city?.country_code) {
    defaults.country_code = city.country_code
  }
  const [log] = await models.WebbedsSyncLog.findOrCreate({
    where: { scope: "city", city_code: cityCode },
    defaults,
  })
  if (city?.country_code && log.country_code !== city.country_code) {
    await log.update({ country_code: city.country_code })
  }
  return log
}

const recordSyncLog = async ({
  cityCode,
  mode,
  resultCount = 0,
  payloadHash,
  filtersSummary,
  metadata,
  error,
  syncLog,
}) => {
  if (!models.WebbedsSyncLog) return
  const log = syncLog ?? (await ensureCitySyncLog(cityCode))
  if (!log) return
  const mergedMetadata = {
    ...(log.metadata ?? {}),
    lastMode: mode,
    lastPayloadHash: payloadHash,
    lastFilters: filtersSummary,
    lastContext: metadata ?? null,
  }
  const updates = {
    last_result_count: resultCount,
    metadata: mergedMetadata,
    last_error: error ? error.message : null,
  }
  if (!error) {
    const now = new Date()
    if (mode === "full") updates.last_full_sync = now
    if (mode === "new") updates.last_new_sync = now
    if (mode === "updated") updates.last_incremental_sync = now
  }
  await log.update(updates)
}

const fetchExistingHotelIds = async (cityCode) => {
  const rows = await models.WebbedsHotel.findAll({
    attributes: ["hotel_id"],
    where: { city_code: cityCode },
    raw: true,
  })
  return rows
    .map((row) => row.hotel_id)
    .filter((id) => id != null)
    .map((id) => String(id))
}

const executeHotelSync = async ({
  cityCode,
  payload,
  dryRun,
  mode = "full",
  syncLog,
  metadata,
}) => {
  if (!cityCode) throw new Error("cityCode is required to sync hotels")
  if (dryRun) {
    return logDryRun({ command: "searchhotels", payload })
  }

  const client = getClient()
  const payloadHash = hashPayload(payload)
  const filtersSummary = summarizeFilters(payload?.return?.filters)
  let processed = 0
  try {
    console.log("[webbeds][static] syncing hotels", { cityCode, mode })
    const { result } = await client.send("searchhotels", payload)
    const hotels = ensureArray(result?.hotels?.hotel)

    if (!hotels.length) {
      console.warn("[webbeds][static] searchhotels returned empty list", { cityCode, mode })
      await recordSyncLog({
        cityCode,
        mode,
        resultCount: 0,
        payloadHash,
        filtersSummary,
        metadata,
        syncLog,
      })
      return { inserted: 0, mode }
    }

    processed = await persistHotels(hotels, cityCode)

    await recordSyncLog({
      cityCode,
      mode,
      resultCount: processed,
      payloadHash,
      filtersSummary,
      metadata,
      syncLog,
    })

    console.info("[webbeds][static] hotels synchronized", {
      count: processed,
      cityCode,
      mode,
    })

    return { inserted: processed, mode }
  } catch (error) {
    await recordSyncLog({
      cityCode,
      mode,
      resultCount: processed,
      payloadHash,
      filtersSummary,
      metadata,
      error,
      syncLog,
    })
    console.error("[webbeds][static] hotels sync failed", { cityCode, mode, error })
    throw error
  }
}

export const syncWebbedsCountries = async ({ dryRun = false } = {}) => {
  const payload = {}
  if (dryRun) {
    return logDryRun({ command: "getservingcountries", payload })
  }

  const client = getClient()
  console.log("[webbeds][static] syncing countries...")
  const { result } = await client.send("getservingcountries", payload)
  const countries = ensureArray(result?.countries?.country)

  if (!countries.length) {
    console.warn("[webbeds][static] getservingcountries returned empty list")
    return { inserted: 0 }
  }

  const tx = await sequelize.transaction()
  try {
    const operations = countries.map((country) => {
      const code = Number(country.code) || null
      const name = country.name ?? null
      if (!code || !name) return null
      return models.WebbedsCountry.upsert(
        {
          code,
          name,
        },
        { transaction: tx },
      )
    })

    await Promise.all(operations.filter(Boolean))
    await tx.commit()

    // refresh cache
    countryNameCache = new Map(
      countries
        .map((country) => {
          const code = Number(country.code) || null
          const name = country.name ?? null
          if (!code || !name) return null
          return [code, name]
        })
        .filter(Boolean),
    )

    console.info("[webbeds][static] countries synchronized", {
      count: operations.filter(Boolean).length,
    })
    return { inserted: operations.filter(Boolean).length }
  } catch (error) {
    await tx.rollback()
    console.error("[webbeds][static] countries sync failed", error)
    throw error
  }
}

export const syncWebbedsCities = async ({ countryCode, dryRun = false } = {}) => {
  const payload = {
    return: {
      filters: {
        "@xmlns:a": "http://us.dotwconnect.com/xsd/atomicCondition",
        "@xmlns:c": "http://us.dotwconnect.com/xsd/complexCondition",
        ...(countryCode != null ? { countryCode: String(countryCode) } : {}),
      },
      fields: {
        field: ["countryName", "countryCode"],
      },
    },
  }

  if (dryRun) {
    return logDryRun({ command: "getservingcities", payload })
  }

  const client = getClient()
  console.log("[webbeds][static] syncing cities", { countryCode })
  const { result } = await client.send("getservingcities", payload)
  const cities = ensureArray(result?.cities?.city)

  if (!cities.length) {
    console.warn("[webbeds][static] getservingcities returned empty list", {
      countryCode,
    })
    return { inserted: 0 }
  }

  if (!countryNameCache) {
    const countryRows = await models.WebbedsCountry.findAll({
      attributes: ["code", "name"],
    })
    countryNameCache = new Map(
      countryRows.map((row) => [Number(row.code), row.name]),
    )
  }

  const fallbackCountryCode = countryCode != null ? Number(countryCode) : null
  const countryUpserts = new Map()
  cities.forEach((city) => {
    const resolvedCountryCode =
      toNumberOrNull(city.countryCode) ?? fallbackCountryCode
    if (!resolvedCountryCode) return
    const resolvedCountryName =
      city.countryName ?? countryNameCache?.get(resolvedCountryCode) ?? null
    if (!resolvedCountryName) return
    countryUpserts.set(resolvedCountryCode, resolvedCountryName)
  })

  const tx = await sequelize.transaction()
  try {
    if (countryUpserts.size) {
      const operations = Array.from(countryUpserts.entries()).map(
        ([code, name]) =>
          models.WebbedsCountry.upsert(
            {
              code,
              name,
            },
            { transaction: tx },
          ),
      )
      await Promise.all(operations)
      countryUpserts.forEach((name, code) => {
        countryNameCache.set(code, name)
      })
    }

    const operations = cities.map((city) => {
      const code = Number(city.code) || null
      if (!code) return null
      const resolvedCountryCode =
        toNumberOrNull(city.countryCode) ?? fallbackCountryCode
      if (!resolvedCountryCode) {
        console.warn("[webbeds][static] city missing country code", {
          cityCode: code,
          cityName: city.name,
        })
        return null
      }
      const resolvedCountryName =
        city.countryName ??
        countryNameCache?.get(resolvedCountryCode) ??
        null
      if (!resolvedCountryName) {
        console.warn("[webbeds][static] city missing country name", {
          cityCode: code,
          cityName: city.name,
          resolvedCountryCode,
        })
        return null
      }
      return models.WebbedsCity.upsert(
        {
          code,
          name: city.name ?? null,
          country_code: resolvedCountryCode,
          country_name: resolvedCountryName,
          state_name: city.stateName ?? null,
          state_code: city.stateCode ?? null,
          region_name: city.regionName ?? null,
          region_code: city.regionCode ?? null,
          metadata: city,
        },
        { transaction: tx },
      )
    })

    await Promise.all(operations.filter(Boolean))
    await tx.commit()

    console.info("[webbeds][static] cities synchronized", {
      count: operations.filter(Boolean).length,
      countryCode,
    })
    return { inserted: operations.filter(Boolean).length }
  } catch (error) {
    await tx.rollback()
    console.error("[webbeds][static] cities sync failed", { countryCode, error })
    throw error
  }
}

export const syncWebbedsHotels = async ({ cityCode, dryRun = false } = {}) => {
  if (!cityCode) throw new Error("cityCode is required to sync hotels")
  const payload = buildStaticHotelsPayload({ cityCode })
  return executeHotelSync({ cityCode, payload, dryRun, mode: "full" })
}

export const syncWebbedsHotelsIncremental = async ({
  cityCode,
  mode = "updated",
  dryRun = false,
  since,
  excludeHotelIds = [],
} = {}) => {
  if (!cityCode) throw new Error("cityCode is required to sync hotels")
  if (!["new", "updated"].includes(mode)) {
    throw new Error(`Unsupported incremental mode: ${mode}`)
  }

  const syncLog = await ensureCitySyncLog(cityCode)
  const metadata = { mode }
  let filterConditions = []
  let lastUpdatedRange = null

  if (mode === "updated") {
    const resolvedSince =
      formatTimestampForFilters(since) ||
      formatTimestampForFilters(syncLog?.last_incremental_sync) ||
      formatTimestampForFilters(syncLog?.last_full_sync) ||
      formatTimestampForFilters(dayjs().subtract(30, "day"))

    const resolvedUntil = formatTimestampForFilters(dayjs())
    if (!resolvedSince) {
      throw new Error("Unable to resolve 'since' timestamp for incremental sync")
    }

    lastUpdatedRange = { from: resolvedSince, to: resolvedUntil }
    metadata.since = resolvedSince
    metadata.until = resolvedUntil
  } else if (mode === "new") {
    let existingIds = ensureArray(excludeHotelIds)
      .map((value) => (value == null ? null : String(value)))
      .filter(Boolean)

    if (!existingIds.length) {
      existingIds = await fetchExistingHotelIds(cityCode)
    }

    if (!existingIds.length) {
      console.warn("[webbeds][static] no existing hotels found, falling back to full sync", { cityCode })
      return syncWebbedsHotels({ cityCode, dryRun })
    }

    if (existingIds.length > MAX_NOTIN_VALUES) {
      console.warn("[webbeds][static] notin filter will include a large set of hotelIds", {
        cityCode,
        count: existingIds.length,
        maxHint: MAX_NOTIN_VALUES,
      })
    }

    filterConditions = [
      {
        fieldName: "hotelId",
        fieldTest: "notin",
        fieldValues: existingIds,
      },
    ]
    metadata.excludedIds = existingIds.length
  }

  const payload = buildStaticHotelsPayload({
    cityCode,
    filterConditions,
    lastUpdatedRange,
  })

  return executeHotelSync({
    cityCode,
    payload,
    dryRun,
    mode,
    syncLog,
    metadata,
  })
}

const mapCatalogRecord = (option, { type }) => {
  const code = getOptionValue(option)
  const name = getOptionName(option)
  if (!code || !name) return null
  const runno = getOptionRunno(option)
  const record = { code, name }
  if (runno != null) record.runno = runno
  if (type) record.type = type
  return record
}

export const syncWebbedsCurrencies = (options = {}) =>
  syncOptionCatalog({
    command: "getcurrenciesids",
    model: models.WebbedsCurrency,
    nodePath: ["currency"],
    dryRun: options.dryRun,
    label: "currencies",
    mapOption: (option) => {
      const record = mapCatalogRecord(option, {})
      if (!record) return null
      record.shortcut = option?.["@_shortcut"] ?? option?.shortcut ?? null
      record.metadata = {
        runno: getOptionRunno(option),
        raw: option,
      }
      return record
    },
  })

const syncAmenityCatalog = ({ command, label, type, dryRun }) =>
  syncOptionCatalog({
    command,
    model: models.WebbedsAmenityCatalog,
    nodePath: ["amenities"],
    dryRun,
    label,
    mapOption: (option) => {
      const record = mapCatalogRecord(option, { type })
      if (!record) return null
      record.metadata = option
      return record
    },
  })

export const syncWebbedsAmenities = (options = {}) =>
  syncAmenityCatalog({
    command: "getamenitieids",
    label: "amenities",
    type: "hotel",
    dryRun: options.dryRun,
  })

export const syncWebbedsLeisureAmenities = (options = {}) =>
  syncAmenityCatalog({
    command: "getleisureids",
    label: "leisure amenities",
    type: "leisure",
    dryRun: options.dryRun,
  })

export const syncWebbedsBusinessAmenities = (options = {}) =>
  syncAmenityCatalog({
    command: "getbusinessids",
    label: "business amenities",
    type: "business",
    dryRun: options.dryRun,
  })

export const syncWebbedsRoomAmenities = (options = {}) =>
  syncOptionCatalog({
    command: "getroomamenitieids",
    model: models.WebbedsRoomAmenityCatalog,
    nodePath: ["amenities"],
    dryRun: options.dryRun,
    label: "room amenities",
    mapOption: (option) => {
      const record = mapCatalogRecord(option, {})
      if (!record) return null
      record.metadata = option
      return record
    },
  })

export const syncWebbedsHotelChains = (options = {}) =>
  syncOptionCatalog({
    command: "gethotelchainsids",
    model: models.WebbedsHotelChain,
    nodePath: ["chains"],
    dryRun: options.dryRun,
    label: "hotel chains",
    mapOption: (option) => mapCatalogRecord(option, {}),
  })

export const syncWebbedsHotelClassifications = (options = {}) =>
  syncOptionCatalog({
    command: "gethotelclassificationids",
    model: models.WebbedsHotelClassification,
    nodePath: ["classification"],
    dryRun: options.dryRun,
    label: "hotel classifications",
    mapOption: (option) => mapCatalogRecord(option, {}),
  })

export const syncWebbedsRateBasis = (options = {}) =>
  syncOptionCatalog({
    command: "getratebasisids",
    model: models.WebbedsRateBasis,
    nodePath: ["ratebasis"],
    dryRun: options.dryRun,
    label: "rate basis codes",
    mapOption: (option) => mapCatalogRecord(option, {}),
  })


