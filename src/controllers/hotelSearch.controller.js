import { Op } from "sequelize"
import { createHash } from "crypto"
import models from "../models/index.js"
import cache from "../services/cache.js"
import { WebbedsProvider } from "../providers/webbeds/provider.js"

const provider = new WebbedsProvider()
const DEFAULT_LIMIT = 40
const DEFAULT_CACHE_TTL = 120

const buildCacheKey = (payload) => {
  const ordered = Object.keys(payload)
    .sort()
    .reduce((acc, key) => {
      const value = payload[key]
      if (value === undefined || value === null || value === "") return acc
      if (Array.isArray(value)) {
        acc[key] = value.map((item) => String(item)).sort()
        return acc
      }
      acc[key] = value
      return acc
    }, {})
  const hash = createHash("sha1").update(JSON.stringify(ordered)).digest("hex")
  return `webbeds:search:${hash}`
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

const resolveCityMatch = async ({ query, cityCode, countryCode, countryName }) => {
  if (cityCode) {
    const city = await models.WebbedsCity.findOne({
      where: { code: String(cityCode).trim() },
      attributes: ["code", "name", "country_code", "country_name"],
      raw: true,
    })
    return city
  }

  const trimmed = String(query || "").trim()
  if (!trimmed) return null

  const where = {
    name: { [Op.iLike]: `%${trimmed}%` },
  }
  if (countryCode) {
    where.country_code = String(countryCode).trim()
  } else if (countryName) {
    where.country_name = { [Op.iLike]: `%${String(countryName).trim()}%` }
  }

  return models.WebbedsCity.findOne({
    where,
    attributes: ["code", "name", "country_code", "country_name"],
    order: [
      ["name", "ASC"],
    ],
    raw: true,
  })
}

const resolveSafeLimit = (limit) =>
  Math.min(50, Math.max(1, Number(limit) || DEFAULT_LIMIT))

const resolveSafeOffset = (offset) =>
  Math.max(0, Number(offset) || 0)

const normalizeBoolean = (value) => {
  if (value === undefined || value === null || value === "") return false
  if (typeof value === "boolean") return value
  const normalized = String(value).trim().toLowerCase()
  return ["1", "true", "yes", "y", "si"].includes(normalized)
}

const pickLiteImages = (details = {}) => {
  const images = details?.images
  if (!images) return null
  if (Array.isArray(images)) {
    return images.length ? [images[0]] : null
  }
  const hotelImages = images?.hotelImages ?? images
  const thumb = hotelImages?.thumb ?? null
  const firstImage = Array.isArray(hotelImages?.image)
    ? hotelImages.image[0]
    : hotelImages?.image
  const firstUrl = firstImage?.url ?? firstImage ?? null
  if (!thumb && !firstUrl) return null
  return {
    hotelImages: {
      thumb: thumb || firstUrl,
      image: firstUrl ? [{ url: firstUrl }] : undefined,
    },
  }
}

const reduceToLite = (items = []) =>
  items.map((item) => {
    const details = item?.hotelDetails ?? {}
    const options = Array.isArray(item?.options) ? item.options : []
    const best = options.reduce((picked, option) => {
      const price = Number(option?.price)
      if (!Number.isFinite(price)) return picked
      if (!picked || price < picked.price) {
        return { price, currency: option?.currency ?? null }
      }
      return picked
    }, null)

    const hotelCode = item?.hotelCode ?? details?.hotelCode ?? null
    const hotelName = item?.hotelName ?? details?.hotelName ?? details?.name ?? null
    const liteDetails = {
      hotelCode,
      hotelName,
      city: details?.city ?? null,
      country: details?.country ?? null,
      geoPoint: details?.geoPoint ?? null,
      rating: details?.rating ?? null,
      images: pickLiteImages(details),
    }

    return {
      hotelCode,
      hotelName,
      bestPrice: best?.price ?? null,
      currency: best?.currency ?? null,
      hotelDetails: liteDetails,
    }
  })

const fetchHotelIdsByName = async (query, limit = DEFAULT_LIMIT, offset = 0) => {
  const trimmed = String(query || "").trim()
  if (!trimmed) return []
  const safeLimit = resolveSafeLimit(limit)
  const safeOffset = resolveSafeOffset(offset)
  const rows = await models.WebbedsHotel.findAll({
    where: {
      name: { [Op.iLike]: `%${trimmed}%` },
    },
    attributes: ["hotel_id", "priority", "name"],
    order: [
      ["priority", "DESC"],
      ["name", "ASC"],
    ],
    limit: safeLimit,
    offset: safeOffset,
    raw: true,
  })
  return rows.map((row) => String(row.hotel_id)).filter(Boolean)
}

const fetchAllHotelIdsByCity = async (cityCode) => {
  if (!cityCode) return []
  const rows = await models.WebbedsHotel.findAll({
    where: {
      city_code: String(cityCode).trim(),
    },
    attributes: ["hotel_id", "priority", "name"],
    order: [
      ["priority", "DESC"],
      ["name", "ASC"],
    ],
    raw: true,
  })
  return rows.map((row) => String(row.hotel_id)).filter(Boolean)
}

const fetchHotelIdsByCity = async (cityCode, limit = DEFAULT_LIMIT, offset = 0) => {
  if (!cityCode) return []
  const safeLimit = resolveSafeLimit(limit)
  const safeOffset = resolveSafeOffset(offset)
  const rows = await models.WebbedsHotel.findAll({
    where: {
      city_code: String(cityCode).trim(),
    },
    attributes: ["hotel_id", "priority", "name"],
    order: [
      ["priority", "DESC"],
      ["name", "ASC"],
    ],
    limit: safeLimit,
    offset: safeOffset,
    raw: true,
  })
  return rows.map((row) => String(row.hotel_id)).filter(Boolean)
}

const runWebbedsSearch = async ({ query, user, headers }) => {
  let statusCode = 200
  let payload = null
  const resProxy = {
    status(code) {
      statusCode = code
      return resProxy
    },
    json(data) {
      payload = data
      return data
    },
  }
  await provider.search(
    { query, user, headers },
    resProxy,
    (err) => {
      throw err
    },
  )

  if (statusCode >= 400) {
    const error = new Error(payload?.message || "WebBeds search failed")
    error.status = statusCode
    error.payload = payload
    throw error
  }

  return payload
}

export const searchHotels = async (req, res, next) => {
  const startTime = Date.now()
  const {
    query,
    q,
    cityCode,
    countryCode,
    country,
    checkIn,
    checkOut,
    occupancies,
    currency = "520",
    rateBasis = "-1",
    limit = DEFAULT_LIMIT,
    offset = 0,
    fields,
    roomFields,
    rateTypes,
    lite,
    fetchAll,
  } = req.query

  try {
    const searchQuery = String(query || q || "").trim()
    const useFetchAll = normalizeBoolean(fetchAll)
    const resolvedCity = await resolveCityMatch({
      query: searchQuery,
      cityCode,
      countryCode,
      countryName: country,
    })

    const safeLimit = resolveSafeLimit(limit)
    const safeOffset = resolveSafeOffset(offset)
    const resolvedCityCode = resolvedCity?.code ? String(resolvedCity.code) : null
    const resolvedCountryCode = resolvedCity?.country_code
      ? String(resolvedCity.country_code)
      : countryCode
        ? String(countryCode).trim()
        : null

    let hotelIds = []
    let fallback = null
    if (resolvedCityCode) {
      hotelIds = useFetchAll
        ? await fetchAllHotelIdsByCity(resolvedCityCode)
        : await fetchHotelIdsByCity(resolvedCityCode, safeLimit, safeOffset)
      if (hotelIds.length) {
        fallback = "city"
      }
    } else {
      hotelIds = await fetchHotelIdsByName(searchQuery, safeLimit, safeOffset)
      if (hotelIds.length) {
        fallback = "static-name"
      }
    }

    if (!hotelIds.length) {
      return res.json({
        items: [],
        meta: {
          cached: false,
          fallback: resolvedCityCode ? "no-hotels" : "no-city",
          cityCode: resolvedCityCode,
          countryCode: resolvedCountryCode,
          query: searchQuery || null,
          total: 0,
        },
      })
    }

    const normalizedQuery = {
      checkIn,
      checkOut,
      occupancies,
      currency,
      rateBasis,
      limit: useFetchAll ? undefined : safeLimit,
      offset: useFetchAll ? undefined : safeOffset,
      fields,
      roomFields,
      rateTypes,
      mode: "hotelids",
      cityCode: resolvedCityCode || undefined,
      countryCode: resolvedCountryCode || undefined,
      hotelIds: hotelIds.length ? hotelIds.join(",") : undefined,
      passengerNationality: req.query.passengerNationality,
      passengerCountryOfResidence: req.query.passengerCountryOfResidence,
      lite: normalizeBoolean(lite),
      fetchAll: useFetchAll,
    }

    const cacheKey = buildCacheKey({
      ...normalizedQuery,
      userCountry: req.user?.countryCode ?? req.user?.country ?? null,
    })
    const ttlSeconds = Math.max(
      1,
      Number(process.env.WEBBEDS_SEARCH_CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL),
    )
    if (process.env.WEBBEDS_SEARCH_CACHE_DISABLED !== "true") {
      const cached = await cache.get(cacheKey)
      if (cached) {
        return res.json({
          ...cached,
          meta: {
            ...cached.meta,
            cached: true,
          },
        })
      }
    }

    const searchStart = Date.now()
    let items = await runWebbedsSearch({
      query: normalizedQuery,
      user: req.user,
      headers: req.headers,
    })
    const useLite = normalizeBoolean(lite)
    if (useLite && Array.isArray(items)) {
      items = reduceToLite(items)
    }
    const durationMs = Date.now() - startTime
    const searchDurationMs = Date.now() - searchStart
    const hasMore = useFetchAll ? false : hotelIds.length === safeLimit
    const responsePayload = {
      items: Array.isArray(items) ? items : [],
      meta: {
        cached: false,
        fallback,
        cityCode: resolvedCityCode,
        countryCode: resolvedCountryCode,
        cityName: resolvedCity?.name ?? null,
        countryName: resolvedCity?.country_name ?? null,
        query: searchQuery || null,
        total: Array.isArray(items) ? items.length : 0,
        hotelIdsCount: hotelIds.length,
        limit: useFetchAll ? hotelIds.length : safeLimit,
        offset: useFetchAll ? 0 : safeOffset,
        hasMore,
        nextOffset: hasMore ? safeOffset + safeLimit : null,
        fetchAll: useFetchAll,
        timing: {
          totalMs: durationMs,
          searchMs: searchDurationMs,
        },
      },
    }

    if (process.env.WEBBEDS_SEARCH_CACHE_DISABLED !== "true") {
      await cache.set(cacheKey, responsePayload, ttlSeconds)
    }

    return res.json(responsePayload)
  } catch (error) {
    console.error("[hotels.search] failed", {
      message: error?.message,
      status: error?.status,
    })
    return res.json({
      items: [],
      meta: {
        cached: false,
        fallback: "error",
        cityCode: null,
        countryCode: null,
        query: String(query || q || "").trim() || null,
        total: 0,
        error: error?.message || "Search failed",
      },
    })
  }
}
