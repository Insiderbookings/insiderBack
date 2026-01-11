import models, { sequelize } from "../models/index.js"
import { Op } from "sequelize"
import { createWebbedsClient, buildEnvelope } from "../providers/webbeds/client.js"
import { getWebbedsConfig } from "../providers/webbeds/config.js"
import { createHash } from "crypto"
import { gzipSync } from "zlib"
import dayjs from "dayjs"

const ensureArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const chunkArray = (items, size) => {
  if (!Array.isArray(items) || !items.length) return []
  const chunkSize = Number(size) || items.length
  if (chunkSize <= 0) return [items]
  const chunks = []
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize))
  }
  return chunks
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
const HOTEL_BATCH_SIZE = Number(process.env.WEBBEDS_HOTEL_BATCH_SIZE || 50)
const MAX_HOTEL_ROW_BYTES = Number(process.env.WEBBEDS_HOTEL_MAX_ROW_BYTES || 1000000)
const MAX_ROOMTYPE_ROW_BYTES = Number(process.env.WEBBEDS_ROOMTYPE_MAX_ROW_BYTES || 200000)
const ROOMTYPE_BATCH_SIZE = Number(process.env.WEBBEDS_ROOMTYPE_BATCH_SIZE || 50)
const RELATION_BATCH_SIZE = Number(process.env.WEBBEDS_RELATION_BATCH_SIZE || 200)
const HOTEL_BATCH_RETRIES = Number(process.env.WEBBEDS_HOTEL_BATCH_RETRIES || 2)
const HOTEL_BATCH_RETRY_DELAY_MS = Number(process.env.WEBBEDS_HOTEL_BATCH_RETRY_DELAY_MS || 1000)
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

const upsertHotelRelations = async (hotelId, hotel, transaction, { safeMode = false } = {}) => {
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

  const relationBatchSize = safeMode ? Math.max(1, Math.floor(RELATION_BATCH_SIZE / 4)) : RELATION_BATCH_SIZE
  const roomBatchSize = safeMode ? Math.max(1, Math.floor(ROOMTYPE_BATCH_SIZE / 4)) : ROOMTYPE_BATCH_SIZE

  await models.WebbedsHotelImage.destroy({ where: { hotel_id: hotelId }, transaction })
  if (imageEntries.length) {
    const batches = chunkArray(imageEntries, relationBatchSize)
    for (const batch of batches) {
      await models.WebbedsHotelImage.bulkCreate(batch, { transaction })
    }
  }

  await models.WebbedsHotelAmenity.destroy({ where: { hotel_id: hotelId }, transaction })
  if (amenityEntries.length) {
    const batches = chunkArray(amenityEntries, relationBatchSize)
    for (const batch of batches) {
      await models.WebbedsHotelAmenity.bulkCreate(batch, { transaction })
    }
  }

  await models.WebbedsHotelGeoLocation.destroy({ where: { hotel_id: hotelId }, transaction })
  if (geoEntries.length) {
    const batches = chunkArray(geoEntries, relationBatchSize)
    for (const batch of batches) {
      await models.WebbedsHotelGeoLocation.bulkCreate(batch, { transaction })
    }
  }

  await models.WebbedsHotelRoomType.destroy({ where: { hotel_id: hotelId }, transaction })
  if (roomEntries.length) {
    const normalizedRooms = roomEntries.map((entry) => {
      if (safeMode) {
        return {
          ...entry,
          raw_payload: null,
        }
      }
      const rowBytes = estimateJsonBytes(entry)
      if (rowBytes <= MAX_ROOMTYPE_ROW_BYTES) return entry
      return {
        ...entry,
        raw_payload: null,
      }
    })
    const roomBatches = chunkArray(normalizedRooms, roomBatchSize)
    for (const batch of roomBatches) {
      try {
        await models.WebbedsHotelRoomType.bulkCreate(batch, { transaction })
      } catch (error) {
        const errorCode = error?.original?.code ?? error?.parent?.code
        if (errorCode !== "ER_NET_PACKET_TOO_LARGE") throw error
        const trimmedBatch = batch.map((entry) => ({
          ...entry,
          raw_payload: null,
        }))
        await models.WebbedsHotelRoomType.bulkCreate(trimmedBatch, { transaction })
      }
    }
  }
}

const resolvePasswordMd5 = (config) => {
  if (config.passwordMd5) return config.passwordMd5
  if (!config.password) throw new Error("WEBBEDS_PASSWORD or WEBBEDS_PASSWORD_MD5 required")
  return createHash("md5").update(config.password).digest("hex")
}

const estimateJsonBytes = (value) => {
  if (value == null) return 0
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8")
  } catch (error) {
    return 0
  }
}

const isRetryableDbError = (error) => {
  const code = error?.original?.code ?? error?.parent?.code ?? error?.code
  return code === "ECONNRESET" || code === "PROTOCOL_CONNECTION_LOST"
}

const waitForRetry = (attempt) =>
  new Promise((resolve) =>
    setTimeout(resolve, HOTEL_BATCH_RETRY_DELAY_MS * Math.max(1, attempt)),
  )

const buildHotelRecord = (hotel, fallbackCityCode, { safeMode = false } = {}) => {
  const hotelId = Number(hotel["@_hotelid"] ?? hotel.hotelid) || null
  if (!hotelId) return null

  const cityCodeValue = Number(hotel.cityCode ?? fallbackCityCode) || null
  const countryCodeValue = Number(hotel.countryCode) || null
  const lat = hotel.geoPoint?.lat ? Number(hotel.geoPoint.lat) : null
  const lng = hotel.geoPoint?.lng ? Number(hotel.geoPoint.lng) : null

  const baseRecord = {
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
    amenities: safeMode ? null : (hotel.amenitie ?? null),
    leisure: safeMode ? null : (hotel.leisure ?? null),
    business: safeMode ? null : (hotel.business ?? null),
    transportation: safeMode ? null : (hotel.transportation ?? null),
    geo_locations: safeMode ? null : (hotel.geoLocations ?? null),
    images: safeMode ? null : (hotel.images ?? null),
    room_static: safeMode ? null : (hotel.rooms ?? null),
    raw_payload: safeMode ? null : hotel,
  }

  const rowBytes = estimateJsonBytes(baseRecord)
  const record =
    rowBytes > MAX_HOTEL_ROW_BYTES
      ? {
          ...baseRecord,
          amenities: null,
          leisure: null,
          business: null,
          transportation: null,
          geo_locations: null,
          images: null,
          room_static: null,
          raw_payload: null,
        }
      : baseRecord

  return { hotelId, cityCodeValue, record, rowBytes }
}

const upsertHotelRecord = async (hotelMeta, transaction) => {
  const { hotelId, cityCodeValue, record, rowBytes } = hotelMeta
  try {
    await models.WebbedsHotel.upsert(record, { transaction })
    return
  } catch (error) {
    const errorCode = error?.original?.code ?? error?.parent?.code
    if (errorCode === "ER_NET_PACKET_TOO_LARGE" && record.raw_payload) {
      console.warn("[webbeds][static] hotel payload too large, retrying without blobs", {
        hotelId,
        cityCode: cityCodeValue,
        rowBytes,
        maxBytes: MAX_HOTEL_ROW_BYTES,
      })
      const trimmedRecord = {
        ...record,
        amenities: null,
        leisure: null,
        business: null,
        transportation: null,
        geo_locations: null,
        images: null,
        room_static: null,
        raw_payload: null,
      }
      await models.WebbedsHotel.upsert(trimmedRecord, { transaction })
      return
    }
    throw error
  }
}

const persistSingleHotel = async (
  hotel,
  fallbackCityCode,
  transaction,
  { safeMode = false } = {},
) => {
  const hotelMeta = buildHotelRecord(hotel, fallbackCityCode, { safeMode })
  if (!hotelMeta) {
    console.warn("[webbeds][static] hotel missing id", { hotel })
    return false
  }

  await upsertHotelRecord(hotelMeta, transaction)
  await upsertHotelRelations(hotelMeta.hotelId, hotel, transaction, { safeMode })
  return true
}

const persistHotelIndividually = async (hotel, fallbackCityCode, { safeMode = false } = {}) => {
  let attempt = 0
  while (true) {
    const tx = await sequelize.transaction()
    try {
      const processed = await persistSingleHotel(hotel, fallbackCityCode, tx, { safeMode })
      await tx.commit()
      return processed
    } catch (error) {
      try {
        await tx.rollback()
      } catch (rollbackError) {
        console.warn("[webbeds][static] hotel rollback failed", rollbackError)
      }
      if (attempt < HOTEL_BATCH_RETRIES && isRetryableDbError(error)) {
        attempt += 1
        console.warn("[webbeds][static] retrying hotel after transient error", {
          attempt,
          maxAttempts: HOTEL_BATCH_RETRIES,
          error: error?.message,
        })
        await waitForRetry(attempt)
        continue
      }
      if (!safeMode && isRetryableDbError(error)) {
        console.warn("[webbeds][static] retrying hotel in safe mode after transient error", {
          error: error?.message,
        })
        return persistHotelIndividually(hotel, fallbackCityCode, { safeMode: true })
      }
      throw error
    }
  }
}

const persistHotels = async (hotels, fallbackCityCode) => {
  if (!hotels?.length) return 0
  const batches = chunkArray(hotels, HOTEL_BATCH_SIZE)
  let processed = 0

  for (const batch of batches) {
    let attempt = 0
    while (true) {
      const tx = await sequelize.transaction()
      let batchProcessed = 0
      try {
        for (const hotel of batch) {
          const didProcess = await persistSingleHotel(hotel, fallbackCityCode, tx)
          if (didProcess) batchProcessed += 1
        }
        await tx.commit()
        processed += batchProcessed
        break
      } catch (error) {
        try {
          await tx.rollback()
        } catch (rollbackError) {
          console.warn("[webbeds][static] hotel batch rollback failed", rollbackError)
        }
        if (attempt < HOTEL_BATCH_RETRIES && isRetryableDbError(error)) {
          attempt += 1
          console.warn("[webbeds][static] retrying hotel batch after transient error", {
            attempt,
            maxAttempts: HOTEL_BATCH_RETRIES,
            error: error?.message,
          })
          await waitForRetry(attempt)
          continue
        }
        if (isRetryableDbError(error)) {
          console.warn("[webbeds][static] falling back to per-hotel transactions", {
            error: error?.message,
          })
          for (const hotel of batch) {
            const didProcess = await persistHotelIndividually(hotel, fallbackCityCode, {
              safeMode: true,
            })
            if (didProcess) processed += 1
          }
          break
        }
        throw error
      }
    }
  }

  return processed
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

  const tx = await sequelize.transaction()
  try {
    if (!countryNameCache) {
      countryNameCache = new Map()
    }

    const countryCodeToName = new Map()
    for (const city of cities) {
      const resolvedCountryCode =
        Number(city.countryCode) ||
        (countryCode != null ? Number(countryCode) : null)
      const resolvedCountryName = city.countryName ?? null
      if (!resolvedCountryCode) continue
      if (resolvedCountryName) {
        countryCodeToName.set(resolvedCountryCode, resolvedCountryName)
      }
    }

    const countryCodes = Array.from(countryCodeToName.keys())
    if (countryCodes.length) {
      const existingCountryRows = await models.WebbedsCountry.findAll({
        where: { code: { [Op.in]: countryCodes } },
        attributes: ["code", "name"],
        transaction: tx,
      })
      const existingCodes = new Set()
      for (const row of existingCountryRows) {
        const code = Number(row.code)
        existingCodes.add(code)
        if (row.name) countryNameCache.set(code, row.name)
      }

      const missingCountries = countryCodes
        .filter((code) => !existingCodes.has(code))
        .map((code) => ({
          code,
          name: countryCodeToName.get(code) ?? null,
        }))
        .filter((row) => row.code && row.name)

      if (missingCountries.length) {
        await models.WebbedsCountry.bulkCreate(missingCountries, {
          transaction: tx,
          updateOnDuplicate: ["name"],
        })
        for (const row of missingCountries) {
          countryNameCache.set(row.code, row.name)
        }
      }
    }

    const rows = cities.map((city) => {
      const code = Number(city.code) || null
      if (!code) return null
      const resolvedCountryCode =
        Number(city.countryCode) ||
        (countryCode != null ? Number(countryCode) : null)
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
      return {
        code,
        name: city.name ?? null,
        country_code: resolvedCountryCode,
        country_name: resolvedCountryName,
        state_name: city.stateName ?? null,
        state_code: city.stateCode ?? null,
        region_name: city.regionName ?? null,
        region_code: city.regionCode ?? null,
        metadata: city,
      }
    })

    const entries = rows.filter(Boolean)
    const updateFields = [
      "name",
      "country_code",
      "country_name",
      "state_name",
      "state_code",
      "region_name",
      "region_code",
      "metadata",
    ]

    let processed = 0
    const batches = chunkArray(entries, process.env.WEBBEDS_CITY_BATCH_SIZE || 1000)
    for (const batch of batches) {
      await models.WebbedsCity.bulkCreate(batch, {
        transaction: tx,
        updateOnDuplicate: updateFields,
      })
      processed += batch.length
    }
    await tx.commit()

    console.info("[webbeds][static] cities synchronized", {
      count: processed,
      countryCode,
    })
    return { inserted: processed }
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


