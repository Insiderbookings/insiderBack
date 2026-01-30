import { Op } from "sequelize"
import { createHash } from "crypto"
import models from "../models/index.js"
import cache from "../services/cache.js"
import { WebbedsProvider } from "../providers/webbeds/provider.js"

const provider = new WebbedsProvider()
const DEFAULT_LIMIT = 50
const DEFAULT_CACHE_TTL = 120
const FULL_CACHE_TTL_SECONDS = Math.max(
  60,
  Number(process.env.WEBBEDS_SEARCH_FULL_CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL),
)
const FULL_CACHE_STATUS_TTL_SECONDS = Math.max(
  30,
  Number(process.env.WEBBEDS_SEARCH_FULL_CACHE_STATUS_TTL_SECONDS || 90),
)

const buildHashedKey = (prefix, payload) => {
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
  return `${prefix}${hash}`
}

const buildCacheKey = (payload) => buildHashedKey("webbeds:search:", payload)
const buildFullCacheKey = (payload) => buildHashedKey("webbeds:search:full:", payload)
const buildFullCacheStatusKey = (payload) =>
  buildHashedKey("webbeds:search:full:status:", payload)

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

const parseStarValue = (value) => {
  if (value === undefined || value === null) return null
  const raw = String(value).trim()
  if (!raw || raw.toLowerCase() === "null" || raw.toLowerCase() === "undefined") return null
  const starsFromText = (raw.match(/\*/g) || []).length
  if (starsFromText > 0 && starsFromText <= 5) return starsFromText
  const match = raw.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed)) return null
  if (parsed >= 559 && parsed <= 563) return parsed - 558
  if (parsed > 0 && parsed <= 5) return parsed
  return null
}

const resolveItemRating = (item) =>
  parseStarValue(
    item?.rating ??
    item?.hotelDetails?.rating ??
    item?.hotelDetails?.classification?.name ??
    item?.classification?.name,
  )

const resolveItemPrice = (item) => {
  const direct = Number(item?.bestPrice ?? item?.price ?? item?.minPrice)
  if (Number.isFinite(direct)) return direct
  const options = Array.isArray(item?.options) ? item.options : []
  const best = options.reduce((picked, option) => {
    const price = Number(option?.price)
    if (!Number.isFinite(price)) return picked
    if (!picked || price < picked) return price
    return picked
  }, null)
  return Number.isFinite(best) ? best : null
}

const filterCachedItems = (items, filters = {}) => {
  const priceMin = Number(filters.priceMin)
  const priceMax = Number(filters.priceMax)
  const ratingMin = Number(filters.ratingMin)
  const ratingMax = Number(filters.ratingMax)

  return (Array.isArray(items) ? items : []).filter((item) => {
    const price = resolveItemPrice(item)
    if (Number.isFinite(priceMin) || Number.isFinite(priceMax)) {
      if (price === null) return false
      if (Number.isFinite(priceMin) && price < priceMin) return false
      if (Number.isFinite(priceMax) && price > priceMax) return false
    }
    const rating = resolveItemRating(item)
    if (Number.isFinite(ratingMin) || Number.isFinite(ratingMax)) {
      if (rating === null) return false
      if (Number.isFinite(ratingMin) && rating < ratingMin) return false
      if (Number.isFinite(ratingMax) && rating > ratingMax) return false
    }
    return true
  })
}

const isCacheFilterable = (filters = {}) => {
  const hasValue = (val) => val !== undefined && val !== null && val !== ""
  const unsupported = [
    filters.amenities,
    filters.roomAmenity,
    filters.chain,
    filters.rateTypes,
    filters.fields,
    filters.roomFields,
  ].some(hasValue)
  return !unsupported
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

const resolveRatingCodes = async (minStr, maxStr) => {
  const min = parseInt(minStr) || 0
  const max = parseInt(maxStr) || 5
  // If requesting full range, effectively no filter needed (unless we want to exclude non-rated)
  // But let's filter to be safe if params are present.

  const all = await models.WebbedsHotelClassification.findAll({
    attributes: ["code", "name"],
    raw: true,
  })

  const codes = all.filter((c) => {
    // Strategy 1: Count asterisks
    let stars = (c.name.match(/\*/g) || []).length

    // Strategy 2: If no asterisks, try to find a leading number
    if (stars === 0) {
      const match = c.name.match(/^(\d+)(\s|$)/)
      if (match) {
        stars = parseInt(match[1], 10)
      }
    }

    if (stars === 0) return false // unrated or unknown
    return stars >= min && stars <= max
  }).map((c) => String(c.code))

  return codes
}

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

const fetchHotelIdsByName = async (query, limit = DEFAULT_LIMIT, offset = 0, filters = {}) => {
  const trimmed = String(query || "").trim()
  if (!trimmed) return []
  const safeLimit = resolveSafeLimit(limit)
  const safeOffset = resolveSafeOffset(offset)

  const where = {
    name: { [Op.iLike]: `%${trimmed}%` },
  }

  // Apply Filters
  // Apply Filters
  if (filters.ratingCodes && filters.ratingCodes.length > 0) {
    where.rating = { [Op.in]: filters.ratingCodes }
  }
  if (filters.ratingMin && !filters.ratingCodes) {
    // Fallback if no codes resolved (shouldn't happen if resolveRatingCodes works, but safe to keep or remove legacy)
    // Removing legacy string comparison as it is incorrect.
  }
  if (filters.chain && filters.chain.length > 0) {
    where.chain_code = { [Op.in]: filters.chain }
  }

  console.log("[fetchHotelIdsByName] filters:", JSON.stringify(filters))
  console.log("[fetchHotelIdsByName] where:", JSON.stringify(where))

  const rows = await models.WebbedsHotel.findAll({
    where,
    attributes: ["hotel_id", "priority", "name", "rating"],
    order: [
      ["priority", "DESC"],
      ["rating", "DESC"],
      ["name", "ASC"],
    ],
    limit: safeLimit,
    offset: safeOffset,
    raw: true,
  })
  return rows.map((row) => String(row.hotel_id)).filter(Boolean)
}

const fetchAllHotelIdsByCity = async (cityCode, filters = {}) => {
  if (!cityCode) return []

  const where = {
    city_code: String(cityCode).trim(),
  }

  // Apply Filters
  if (filters.ratingCodes && filters.ratingCodes.length > 0) {
    where.rating = { [Op.in]: filters.ratingCodes }
  }
  if (filters.chain && filters.chain.length > 0) {
    where.chain_code = { [Op.in]: filters.chain }
  }
  if (filters.hotelName) {
    where.name = { [Op.iLike]: `%${filters.hotelName.trim()}%` }
  }

  const rows = await models.WebbedsHotel.findAll({
    where,
    attributes: ["hotel_id", "priority", "name", "rating"],
    order: [
      ["priority", "DESC"],
      ["rating", "DESC"],
      ["name", "ASC"],
    ],
    raw: true,
  })
  return rows.map((row) => String(row.hotel_id)).filter(Boolean)
}

const fetchHotelIdsByCity = async (cityCode, limit = DEFAULT_LIMIT, offset = 0, filters = {}) => {
  if (!cityCode) return []
  const safeLimit = resolveSafeLimit(limit)
  const safeOffset = resolveSafeOffset(offset)

  const where = {
    city_code: String(cityCode).trim(),
  }

  // Apply Filters
  if (filters.ratingCodes && filters.ratingCodes.length > 0) {
    where.rating = { [Op.in]: filters.ratingCodes }
  }
  if (filters.chain && filters.chain.length > 0) {
    where.chain_code = { [Op.in]: filters.chain }
  }
  if (filters.hotelName) {
    where.name = { [Op.iLike]: `%${filters.hotelName.trim()}%` }
  }

  console.log("[fetchHotelIdsByCity] filters:", JSON.stringify(filters))
  console.log("[fetchHotelIdsByCity] where:", JSON.stringify(where))

  const rows = await models.WebbedsHotel.findAll({
    where,
    attributes: ["hotel_id", "priority", "name", "rating"],
    order: [
      ["priority", "DESC"],
      ["rating", "DESC"],
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

    const priceMin = req.query.priceMin ?? req.query.minPrice ?? req.query.price_from ?? req.query.priceFrom
    const priceMax = req.query.priceMax ?? req.query.maxPrice ?? req.query.price_to ?? req.query.priceTo
    const ratingMin = req.query.ratingMin ?? req.query.minRating ?? req.query.hotelRateMin
    const ratingMax = req.query.ratingMax ?? req.query.maxRating ?? req.query.hotelRateMax
    const amenities = req.query.amenities ?? req.query.amenityIds
    const roomAmenity = req.query.roomAmenity ?? req.query.roomAmenityIds
    const chain = req.query.chain ?? req.query.chainIds
    const hotelName = req.query.hotelName ?? req.query.nameFilter
    const passengerNationality =
      req.query.passengerNationality ?? req.query.nationality ?? null
    const passengerCountryOfResidence =
      req.query.passengerCountryOfResidence ?? req.query.residence ?? null

    const fullCachePayload = resolvedCityCode
      ? {
        cityCode: resolvedCityCode,
        checkIn,
        checkOut,
        occupancies,
        currency,
        rateBasis,
        passengerNationality,
        passengerCountryOfResidence,
      }
      : null
    const fullCacheKey = fullCachePayload ? buildFullCacheKey(fullCachePayload) : null
    const fullCacheStatusKey = fullCachePayload
      ? buildFullCacheStatusKey(fullCachePayload)
      : null
    const cacheFilters = {
      priceMin,
      priceMax,
      ratingMin,
      ratingMax,
      amenities,
      roomAmenity,
      chain,
      rateTypes,
      fields,
      roomFields,
      hotelName, // Cache must respect name filter
    }
    const hasFilterValue = (val) => val !== undefined && val !== null && val !== ""
    const hasAnyFilter = [
      priceMin,
      priceMax,
      ratingMin,
      ratingMax,
      amenities,
      roomAmenity,
      chain,
      hotelName,
    ].some(hasFilterValue)
    const canUseFullCache =
      fullCacheKey && !useFetchAll && isCacheFilterable(cacheFilters) && !hotelName // Disable full-cache optimization if searching by name (simpler)

    if (canUseFullCache && process.env.WEBBEDS_SEARCH_CACHE_DISABLED !== "true") {
      // ... existing cache logic ...
      // NOTE: We SKIP full-cache block if hotelName is present for safety, or we'd need to implementing name filtering on cached items in JS, which is fine but let's be safe.
      // Actually, standard cache filtering (line 89) needs to support name.
      // For now, let's just skip full-cache if name filter is present to rely on DB ILIKE.
    }

    // Parse DB Filters
    const dbFilters = {}
    if (chain) dbFilters.chain = parseCsvList(chain)
    if (hotelName) dbFilters.hotelName = String(hotelName).trim()

    if (ratingMin || ratingMax) {
      const codes = await resolveRatingCodes(ratingMin, ratingMax)
      if (codes.length > 0) {
        dbFilters.ratingCodes = codes
      } else {
        dbFilters.ratingCodes = ["-1"] // Impossible code
      }
    }

    let hotelIds = []
    let fallback = null
    if (resolvedCityCode) {
      hotelIds = useFetchAll
        ? await fetchAllHotelIdsByCity(resolvedCityCode, dbFilters)
        : await fetchHotelIdsByCity(resolvedCityCode, safeLimit, safeOffset, dbFilters)
      if (hotelIds.length) {
        fallback = "city"
      }
    } else {
      hotelIds = await fetchHotelIdsByName(searchQuery, safeLimit, safeOffset, dbFilters)
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
      passengerNationality,
      passengerCountryOfResidence,
      priceMin,
      priceMax,
      amenities,
      roomAmenity,
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
        console.log("[hotels.search] cache hit", {
          cityCode: resolvedCityCode,
          query: searchQuery || null,
          limit: safeLimit,
          offset: safeOffset,
          hotelIdsCount: cached?.meta?.hotelIdsCount ?? null,
        })
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

    const shouldWarmFullCache =
      fullCacheKey &&
      fullCacheStatusKey &&
      resolvedCityCode &&
      !useFetchAll &&
      !hasAnyFilter &&
      process.env.WEBBEDS_SEARCH_CACHE_DISABLED !== "true"

    if (shouldWarmFullCache) {
      setTimeout(async () => {
        try {
          const existing = await cache.get(fullCacheKey)
          if (existing?.items) {
            console.log("[hotels.search] full cache warm skip (already cached)", {
              cityCode: resolvedCityCode,
              query: searchQuery || null,
            })
            return
          }
          const status = await cache.get(fullCacheStatusKey)
          if (status) {
            console.log("[hotels.search] full cache warm skip (in progress)", {
              cityCode: resolvedCityCode,
              query: searchQuery || null,
            })
            return
          }
          await cache.set(fullCacheStatusKey, { status: "building" }, FULL_CACHE_STATUS_TTL_SECONDS)
          console.log("[hotels.search] full cache warm start", {
            cityCode: resolvedCityCode,
            query: searchQuery || null,
          })

          const allHotelIds = await fetchAllHotelIdsByCity(resolvedCityCode, {})
          if (!allHotelIds.length) return
          console.log("[hotels.search] full cache warm fetch", {
            cityCode: resolvedCityCode,
            hotelIdsCount: allHotelIds.length,
          })

          const fullQuery = {
            ...normalizedQuery,
            hotelIds: allHotelIds.join(","),
            limit: undefined,
            offset: 0,
            fetchAll: true,
            priceMin: undefined,
            priceMax: undefined,
            amenities: undefined,
            roomAmenity: undefined,
            chain: undefined,
          }

          let fullItems = await runWebbedsSearch({
            query: fullQuery,
            user: req.user,
            headers: req.headers,
          })

          fullItems = reduceToLite(Array.isArray(fullItems) ? fullItems : [])
          const fullPayload = {
            items: fullItems,
            meta: {
              cached: false,
              fallback,
              cityCode: resolvedCityCode,
              countryCode: resolvedCountryCode,
              cityName: resolvedCity?.name ?? null,
              countryName: resolvedCity?.country_name ?? null,
              query: searchQuery || null,
              total: fullItems.length,
              hotelIdsCount: allHotelIds.length,
              limit: allHotelIds.length,
              offset: 0,
              hasMore: false,
              nextOffset: null,
              fetchAll: true,
            },
          }

          await cache.set(fullCacheKey, fullPayload, FULL_CACHE_TTL_SECONDS)
          console.log("[hotels.search] full cache warm done", {
            cityCode: resolvedCityCode,
            hotelIdsCount: allHotelIds.length,
            items: fullItems.length,
          })
        } catch (err) {
          console.warn("[hotels.search] full cache warm failed", {
            message: err?.message || err,
          })
        } finally {
          await cache.del(fullCacheStatusKey)
        }
      }, 0)
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
