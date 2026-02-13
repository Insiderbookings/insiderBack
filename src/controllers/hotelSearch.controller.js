import { Op } from "sequelize"
import { createHash } from "crypto"
import models from "../models/index.js"
import cache from "../services/cache.js"
import { WebbedsProvider } from "../providers/webbeds/provider.js"
import { getCaseInsensitiveLikeOp } from "../utils/sequelizeHelpers.js"

const provider = new WebbedsProvider()
const DEFAULT_LIMIT = 50
const MOBILE_RESULT_LIMIT = Math.max(
  1,
  Number(process.env.WEBBEDS_MOBILE_RESULT_LIMIT || 30),
)
const DEFAULT_CACHE_TTL = 120
const FULL_CACHE_TTL_SECONDS = Math.max(
  60,
  Number(process.env.WEBBEDS_SEARCH_FULL_CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL),
)
const FULL_CACHE_STATUS_TTL_SECONDS = Math.max(
  30,
  Number(process.env.WEBBEDS_SEARCH_FULL_CACHE_STATUS_TTL_SECONDS || 90),
)

const iLikeOp = getCaseInsensitiveLikeOp()
const MOBILE_CLIENT_TYPES = new Set(["mobile", "app", "react-native"])

const getClientType = (req) =>
  String(req?.headers?.["x-client-type"] || req?.headers?.["x-client-platform"] || "")
    .trim()
    .toLowerCase()

const isMobileClient = (req) => MOBILE_CLIENT_TYPES.has(getClientType(req))

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
    filters.leisure,
    filters.business,
    filters.roomAmenity,
    filters.chain,
    filters.specialDeals,
    filters.topDeals,
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
    name: { [iLikeOp]: `%${trimmed}%` },
  }
  if (countryCode) {
    where.country_code = String(countryCode).trim()
  } else if (countryName) {
    where.country_name = { [iLikeOp]: `%${String(countryName).trim()}%` }
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
    name: { [iLikeOp]: `%${trimmed}%` },
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
    const error = new Error(payload?.message || "Provider search failed")
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
    searchMode,
    mode,
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
    merge,
    lite,
    fetchAll,
  } = req.query
  const clientIsMobile = isMobileClient(req)

  try {
    const searchQuery = String(query || q || "").trim()
    const rawSearchMode = String(searchMode ?? mode ?? "").trim().toLowerCase()
    const resolvedSearchMode = rawSearchMode === "city" ? "city" : "hotelids"
    const useFetchAll = normalizeBoolean(fetchAll)
    const useLite = normalizeBoolean(lite)
    const hasDates = Boolean(checkIn && checkOut)
    const hasRatesParams = Boolean(hasDates && occupancies)
    const resolvedCity = await resolveCityMatch({
      query: searchQuery,
      cityCode,
      countryCode,
      countryName: country,
    })

    const requestedLimit = resolveSafeLimit(limit)
    const safeLimit = clientIsMobile
      ? Math.min(requestedLimit, MOBILE_RESULT_LIMIT)
      : requestedLimit
    const safeOffset = resolveSafeOffset(offset)
    const resolvedCityCode = resolvedCity?.code ? String(resolvedCity.code) : null
    const resolvedCountryCode = resolvedCity?.country_code
      ? String(resolvedCity.country_code)
      : countryCode
        ? String(countryCode).trim()
        : null
    const mustFetchAllHotelIds = Boolean(
      resolvedSearchMode === "hotelids" && resolvedCityCode && hasRatesParams,
    )
    const effectiveFetchAllBase = resolvedSearchMode === "hotelids"
      ? useFetchAll || mustFetchAllHotelIds
      : useFetchAll
    const effectiveFetchAll = clientIsMobile ? false : effectiveFetchAllBase

    const mergeModeRaw = String(merge ?? "").trim().toLowerCase()
    const normalizedMerge =
      mergeModeRaw === "lite"
        ? "lite"
        : ["1", "true", "yes", "y", "si"].includes(mergeModeRaw)
          ? "true"
          : undefined

    const priceMin = req.query.priceMin ?? req.query.minPrice ?? req.query.price_from ?? req.query.priceFrom
    const priceMax = req.query.priceMax ?? req.query.maxPrice ?? req.query.price_to ?? req.query.priceTo
    const ratingMin = req.query.ratingMin ?? req.query.minRating ?? req.query.hotelRateMin
    const ratingMax = req.query.ratingMax ?? req.query.maxRating ?? req.query.hotelRateMax
    const amenities = req.query.amenities ?? req.query.amenityIds
    const leisure = req.query.leisure ?? req.query.leisureIds
    const business = req.query.business ?? req.query.businessIds
    const roomAmenity = req.query.roomAmenity ?? req.query.roomAmenityIds
    const chain = req.query.chain ?? req.query.chainIds
    const specialDeals = req.query.specialDeals ?? req.query.specialDeal
    const topDeals = req.query.topDeals ?? req.query.topDeal
    const hotelName = req.query.hotelName ?? req.query.nameFilter
    const passengerNationality =
      req.query.passengerNationality ?? req.query.nationality ?? null
    const passengerCountryOfResidence =
      req.query.passengerCountryOfResidence ?? req.query.residence ?? null

    const fullCacheKeyPayload = resolvedCityCode
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
    const fullCacheKey = fullCacheKeyPayload ? buildFullCacheKey(fullCacheKeyPayload) : null
    const fullCacheStatusKey = fullCacheKeyPayload
      ? buildFullCacheStatusKey(fullCacheKeyPayload)
      : null
    const cacheFilters = {
      priceMin,
      priceMax,
      ratingMin,
      ratingMax,
      amenities,
      leisure,
      business,
      roomAmenity,
      chain,
      specialDeals,
      topDeals,
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
      leisure,
      business,
      roomAmenity,
      chain,
      specialDeals,
      topDeals,
      hotelName,
    ].some(hasFilterValue)
    const canUseFullCache =
      fullCacheKey &&
      resolvedCityCode &&
      hasRatesParams &&
      useLite &&
      isCacheFilterable(cacheFilters) &&
      resolvedSearchMode === "hotelids" &&
      !hotelName

    if (canUseFullCache && process.env.WEBBEDS_SEARCH_CACHE_DISABLED !== "true") {
      const buildFullCachePayload = async () => {
        const allHotelIds = await fetchAllHotelIdsByCity(resolvedCityCode, {})
        if (!allHotelIds.length) return null

        const fallbackLabel = resolvedCityCode ? "city" : null
        const fullQuery = {
          checkIn,
          checkOut,
          occupancies,
          currency,
          rateBasis,
          fields,
          roomFields,
          rateTypes,
          merge: normalizedMerge,
          mode: "hotelids",
          hotelIds: allHotelIds.join(","),
          passengerNationality,
          passengerCountryOfResidence,
          lite: true,
          fetchAll: true,
        }

        const fullProviderQuery = { ...fullQuery }
        if (fullProviderQuery.hotelIds) {
          delete fullProviderQuery.cityCode
          delete fullProviderQuery.countryCode
        }

        let fullItems = await runWebbedsSearch({
          query: fullProviderQuery,
          user: req.user,
          headers: req.headers,
        })

        fullItems = reduceToLite(Array.isArray(fullItems) ? fullItems : [])
        const fullPayload = {
          items: fullItems,
          meta: {
            cached: false,
            fallback: fallbackLabel,
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
        return fullPayload
      }

      let fullCacheEntry = await cache.get(fullCacheKey)
      if (!fullCacheEntry?.items) {
        if (fullCacheStatusKey) {
          await cache.set(fullCacheStatusKey, { status: "building" }, FULL_CACHE_STATUS_TTL_SECONDS)
        }
        try {
          fullCacheEntry = await buildFullCachePayload()
        } finally {
          if (fullCacheStatusKey) {
            await cache.del(fullCacheStatusKey)
          }
        }
      }

      if (fullCacheEntry?.items) {
        const sourceItems = Array.isArray(fullCacheEntry.items) ? fullCacheEntry.items : []
        const filteredItems = hasAnyFilter
          ? filterCachedItems(sourceItems, cacheFilters)
          : sourceItems
        const pagedItems = filteredItems.slice(safeOffset, safeOffset + safeLimit)
        const hasMore = filteredItems.length > safeOffset + safeLimit

        return res.json({
          items: pagedItems,
          meta: {
            ...fullCacheEntry.meta,
            cached: true,
            query: searchQuery || fullCacheEntry.meta?.query || null,
            cityCode: resolvedCityCode,
            countryCode: resolvedCountryCode,
            cityName: resolvedCity?.name ?? fullCacheEntry.meta?.cityName ?? null,
            countryName: resolvedCity?.country_name ?? fullCacheEntry.meta?.countryName ?? null,
            total: filteredItems.length,
            hotelIdsCount: fullCacheEntry.meta?.hotelIdsCount ?? filteredItems.length,
            limit: safeLimit,
            offset: safeOffset,
            hasMore,
            nextOffset: hasMore ? safeOffset + safeLimit : null,
            fetchAll: false,
            fullCache: true,
          },
        })
      }
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
      hotelIds = effectiveFetchAll
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
      limit: effectiveFetchAll ? undefined : safeLimit,
      offset: effectiveFetchAll ? undefined : safeOffset,
      fields,
      roomFields,
      rateTypes,
      merge: normalizedMerge,
      mode: resolvedSearchMode,
      cityCode: resolvedCityCode || undefined,
      countryCode: resolvedCountryCode || undefined,
      hotelIds: hotelIds.length ? hotelIds.join(",") : undefined,
      passengerNationality,
      passengerCountryOfResidence,
      priceMin,
      priceMax,
      amenities,
      leisure,
      business,
      roomAmenity,
      specialDeals,
      topDeals,
      lite: useLite,
      fetchAll: effectiveFetchAll,
    }

    const providerQuery = { ...normalizedQuery }
    if (resolvedSearchMode === "hotelids") {
      if (providerQuery.hotelIds) {
        delete providerQuery.cityCode
        delete providerQuery.countryCode
      }
    } else {
      delete providerQuery.hotelIds
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
    let items = []
    let isStaticResult = false

    if (hasRatesParams) {
      // Full Availability Search
      try {
        const shouldFetchAllCity =
          resolvedSearchMode === "city" && effectiveFetchAll

        if (shouldFetchAllCity) {
          const pageSize = resolveSafeLimit(limit)
          const maxPages = Math.max(1, Number(process.env.WEBBEDS_CITY_FETCH_ALL_MAX_PAGES || 50))
          let aggregated = []
          let pageIndex = 0
          let offsetCursor = resolveSafeOffset(offset)

          while (pageIndex < maxPages) {
            const pageQuery = {
              ...providerQuery,
              limit: pageSize,
              offset: offsetCursor,
            }
            const pageItems = await runWebbedsSearch({
              query: pageQuery,
              user: req.user,
              headers: req.headers,
            })
            const safeItems = Array.isArray(pageItems) ? pageItems : []
            aggregated = aggregated.concat(safeItems)
            if (safeItems.length < pageSize) break
            pageIndex += 1
            offsetCursor += pageSize
          }

          items = aggregated
        } else {
          items = await runWebbedsSearch({
            query: providerQuery,
            user: req.user,
            headers: req.headers,
          })
        }
      } catch (err) {
        // If webbeds fails, we could fallback to static, but for now let it throw or handle
        throw err
      }
    } else {
      // Static Content Search (No Dates/Occupancy)
      // Fetch details from DB for the resolved IDs
      isStaticResult = true
      console.log("[hotels.search] static search (no dates)", { hotelIdsCount: hotelIds.length });

      // We need to fetch full details for these IDs from DB to return useful cards
      // The previous fetch functions returned only IDs.
      const targetIds = effectiveFetchAll ? hotelIds : hotelIds.slice(safeOffset, safeOffset + safeLimit)

      const staticRows = await models.WebbedsHotel.findAll({
        where: { hotel_id: { [Op.in]: targetIds } },
        attributes: ["hotel_id", "name", "rating", "city_name", "country_name", "images"],
        raw: true,
      })

      // Map back to expected "item" structure for frontend
      const rowMap = new Map(staticRows.map(r => [String(r.hotel_id), r]))

      items = targetIds.map(id => {
        const row = rowMap.get(String(id))
        if (!row) return null

        // Pick best image
        let cover = null
        const images = row?.images?.hotelImages ?? row?.images ?? null
        if (images) {
          if (images?.thumb) {
            cover = images.thumb
          } else {
            const list = Array.isArray(images)
              ? images
              : (Array.isArray(images.image) ? images.image : [images.image])
            cover = list.find((img) => img?.url)?.url ?? null
          }
        }

        return {
          hotelCode: row.hotel_id,
          hotelName: row.name,
          bestPrice: null, // No price in static mode
          currency: null,
          hotelDetails: {
            hotelCode: row.hotel_id,
            hotelName: row.name,
            rating: row.rating,
            city: row.city_name ?? null,
            country: row.country_name ?? null,
            images: cover ? { hotelImages: { image: [{ url: cover }] } } : null
          },
          isStatic: true
        }
      }).filter(Boolean)
    }

    if (useLite && Array.isArray(items) && !isStaticResult) {
      items = reduceToLite(items)
    }
    const durationMs = Date.now() - startTime
    const searchDurationMs = Date.now() - searchStart
    const hasMore = effectiveFetchAll ? false : hotelIds.length === safeLimit
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
        limit: effectiveFetchAll ? hotelIds.length : safeLimit,
        offset: effectiveFetchAll ? 0 : safeOffset,
        hasMore,
        nextOffset: hasMore ? safeOffset + safeLimit : null,
        fetchAll: effectiveFetchAll,
        timing: {
          totalMs: durationMs,
          searchMs: searchDurationMs,
        },
      },
    }

    console.log("[hotels.search] response count", {
      items: responsePayload.items.length,
      cityCode: resolvedCityCode,
      searchMode: resolvedSearchMode,
      fetchAll: effectiveFetchAll,
    })

    if (process.env.WEBBEDS_SEARCH_CACHE_DISABLED !== "true") {
      await cache.set(cacheKey, responsePayload, ttlSeconds)
    }

    const shouldWarmFullCache =
      fullCacheKey &&
      fullCacheStatusKey &&
      resolvedCityCode &&
      !effectiveFetchAll &&
      !hasAnyFilter &&
      resolvedSearchMode === "hotelids" &&
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
            leisure: undefined,
            business: undefined,
            roomAmenity: undefined,
            chain: undefined,
            specialDeals: undefined,
            topDeals: undefined,
          }

          const fullProviderQuery = { ...fullQuery }
          if (fullProviderQuery.hotelIds) {
            delete fullProviderQuery.cityCode
            delete fullProviderQuery.countryCode
          }

          let fullItems = await runWebbedsSearch({
            query: fullProviderQuery,
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
