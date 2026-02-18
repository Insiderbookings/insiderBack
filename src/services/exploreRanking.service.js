import { Op, fn, col } from "sequelize"
import models from "../models/index.js"

const EXPLORE_RANKING_VERSION = "v2"

const parseBoolean = (value, fallback = false) => {
  if (value == null) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  return fallback
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const toFiniteNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const normalizeMinMax = (value, min, max, fallback = 0) => {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return fallback
  if (max <= min) return fallback
  return clamp((value - min) / (max - min), 0, 1)
}

const normalizeInverseMinMax = (value, min, max, fallback = 0.5) => {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return fallback
  if (max <= min) return fallback
  return 1 - clamp((value - min) / (max - min), 0, 1)
}

const hashStringToBucket = (value) => {
  const text = String(value || "")
  if (!text) return 0
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return Math.abs(hash >>> 0) % 100
}

const parseHotelRating = (value) => {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
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

const toDate = (value) => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return 6371 * c
}

const resolveDistanceScore = (coords, itemLat, itemLng) => {
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return 0.5
  if (!Number.isFinite(itemLat) || !Number.isFinite(itemLng)) return 0.35
  const distanceKm = haversineKm(coords.lat, coords.lng, itemLat, itemLng)
  return clamp(1 / (1 + distanceKm / 22), 0, 1)
}

const resolveFreshnessScore = (dateValue) => {
  const date = toDate(dateValue)
  if (!date) return 0.45
  const diffMs = Date.now() - date.getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return 1
  const days = diffMs / (1000 * 60 * 60 * 24)
  if (days <= 7) return 1
  if (days <= 30) return 0.82
  if (days <= 90) return 0.62
  if (days <= 180) return 0.45
  return 0.3
}

const resolveImageCount = (item) => {
  if (Array.isArray(item?.images)) return item.images.length
  if (Array.isArray(item?.photos)) return item.photos.length
  return item?.coverImage ? 1 : 0
}

const resolveHotelContentScore = (item) => {
  const imageCount = resolveImageCount(item)
  const hasCover = Boolean(item?.coverImage || item?.image)
  const hasDescription = Boolean(item?.shortDescription || item?.descriptions)
  const amenityCount = Array.isArray(item?.amenities) ? item.amenities.length : 0
  let score = 0
  if (hasCover) score += 0.38
  score += clamp(imageCount / 8, 0, 1) * 0.24
  if (hasDescription) score += 0.2
  score += clamp(amenityCount / 24, 0, 1) * 0.18
  return clamp(score, 0, 1)
}

const resolveHomeContentScore = (item) => {
  const imageCount = resolveImageCount(item)
  const hasCover = Boolean(item?.coverImage || item?.image)
  const hasSummary = Boolean(item?.summaryLine)
  const hasTitle = Boolean(item?.title && String(item.title).trim().length >= 4)
  const hasLocation = Boolean(item?.locationText || item?.location || item?.city)
  let score = 0
  if (hasCover) score += 0.35
  score += clamp(imageCount / 10, 0, 1) * 0.25
  if (hasSummary) score += 0.2
  if (hasTitle) score += 0.1
  if (hasLocation) score += 0.1
  return clamp(score, 0, 1)
}

const resolveEngagementScore = (id, engagementById, bounds) => {
  const key = id == null ? null : String(id)
  const entry = key ? engagementById.get(key) : null
  const favoritesCount = Number(entry?.favoritesCount || 0)
  const recentViewsCount = Number(entry?.recentViewsCount || 0)
  const favoritesLog = Math.log1p(Math.max(0, favoritesCount))
  const recentLog = Math.log1p(Math.max(0, recentViewsCount))
  const favoritesNorm = normalizeMinMax(
    favoritesLog,
    bounds.favoritesLogMin,
    bounds.favoritesLogMax,
    0,
  )
  const recentNorm = normalizeMinMax(
    recentLog,
    bounds.recentLogMin,
    bounds.recentLogMax,
    0,
  )
  return clamp(favoritesNorm * 0.6 + recentNorm * 0.4, 0, 1)
}

const buildEngagementBounds = (engagementById) => {
  const values = Array.from(engagementById.values())
  const favoritesLogs = values.map((entry) => Math.log1p(Number(entry?.favoritesCount || 0)))
  const recentLogs = values.map((entry) => Math.log1p(Number(entry?.recentViewsCount || 0)))
  const favoritesLogMin = favoritesLogs.length ? Math.min(...favoritesLogs) : 0
  const favoritesLogMax = favoritesLogs.length ? Math.max(...favoritesLogs) : 1
  const recentLogMin = recentLogs.length ? Math.min(...recentLogs) : 0
  const recentLogMax = recentLogs.length ? Math.max(...recentLogs) : 1
  return { favoritesLogMin, favoritesLogMax, recentLogMin, recentLogMax }
}

const rerankWithDiversity = (items, options = {}) => {
  const remaining = [...items]
  const selected = []
  const cityCounts = new Map()
  const chainCounts = new Map()
  const hostCounts = new Map()
  const maxPerCity = Number.isFinite(Number(options.maxPerCity)) ? Number(options.maxPerCity) : 2
  const maxPerChain = Number.isFinite(Number(options.maxPerChain)) ? Number(options.maxPerChain) : 2
  const maxPerHost = Number.isFinite(Number(options.maxPerHost)) ? Number(options.maxPerHost) : 2

  while (remaining.length) {
    let bestIndex = 0
    let bestAdjusted = -Infinity
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]
      const cityKey = String(candidate._rankCityKey || "")
      const chainKey = String(candidate._rankChainKey || "")
      const hostKey = String(candidate._rankHostKey || "")
      const cityCount = cityKey ? Number(cityCounts.get(cityKey) || 0) : 0
      const chainCount = chainKey ? Number(chainCounts.get(chainKey) || 0) : 0
      const hostCount = hostKey ? Number(hostCounts.get(hostKey) || 0) : 0
      const cityPenalty = cityCount >= maxPerCity ? 0.2 * (cityCount - maxPerCity + 1) : 0
      const chainPenalty = chainCount >= maxPerChain ? 0.15 * (chainCount - maxPerChain + 1) : 0
      const hostPenalty = hostCount >= maxPerHost ? 0.15 * (hostCount - maxPerHost + 1) : 0
      const adjusted = Number(candidate._rankScore || 0) - cityPenalty - chainPenalty - hostPenalty
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted
        bestIndex = index
      }
    }
    const next = remaining.splice(bestIndex, 1)[0]
    selected.push(next)
    const cityKey = String(next._rankCityKey || "")
    const chainKey = String(next._rankChainKey || "")
    const hostKey = String(next._rankHostKey || "")
    if (cityKey) cityCounts.set(cityKey, Number(cityCounts.get(cityKey) || 0) + 1)
    if (chainKey) chainCounts.set(chainKey, Number(chainCounts.get(chainKey) || 0) + 1)
    if (hostKey) hostCounts.set(hostKey, Number(hostCounts.get(hostKey) || 0) + 1)
  }
  return selected
}

const sanitizeRankFields = (item, debug) => {
  if (!debug) {
    delete item._rankScore
    delete item._rankCityKey
    delete item._rankChainKey
    delete item._rankHostKey
    delete item._rankReason
    return item
  }
  item.rankingMeta = {
    version: EXPLORE_RANKING_VERSION,
    score: Number((item._rankScore || 0).toFixed(4)),
    reason: item._rankReason || null,
  }
  delete item._rankScore
  delete item._rankCityKey
  delete item._rankChainKey
  delete item._rankHostKey
  delete item._rankReason
  return item
}

export const resolveExploreRankingVariant = (req) => {
  const forceVersion = String(req?.query?.rankingVersion || "").trim().toLowerCase()
  const enabled = parseBoolean(process.env.EXPLORE_RANKING_V2_ENABLED, true)
  const percent = clamp(Number(process.env.EXPLORE_RANKING_V2_PERCENT || 100), 0, 100)
  const debugEnv = parseBoolean(process.env.EXPLORE_RANKING_V2_DEBUG, false)
  const debugQuery = parseBoolean(req?.query?.rankingDebug, false)
  const debug = debugEnv || debugQuery

  if (forceVersion === "v1") {
    return {
      applied: false,
      version: EXPLORE_RANKING_VERSION,
      variant: "v1",
      percent,
      debug,
    }
  }
  if (forceVersion === "v2") {
    return {
      applied: true,
      version: EXPLORE_RANKING_VERSION,
      variant: "v2",
      percent,
      debug,
    }
  }
  if (!enabled || percent <= 0) {
    return {
      applied: false,
      version: EXPLORE_RANKING_VERSION,
      variant: "v1",
      percent,
      debug,
    }
  }
  if (percent >= 100) {
    return {
      applied: true,
      version: EXPLORE_RANKING_VERSION,
      variant: "v2",
      percent,
      debug,
    }
  }
  const identity =
    req?.user?.id ||
    req?.headers?.["x-session-id"] ||
    req?.headers?.["x-request-id"] ||
    req?.headers?.["x-forwarded-for"] ||
    req?.socket?.remoteAddress ||
    req?.ip ||
    "anon"
  const bucket = hashStringToBucket(identity)
  const applied = bucket < percent
  return {
    applied,
    version: EXPLORE_RANKING_VERSION,
    variant: applied ? "v2" : "v1",
    percent,
    debug,
  }
}

export const fetchHotelExploreEngagementStats = async (hotelIds = [], options = {}) => {
  const ids = Array.from(new Set((hotelIds || []).map((id) => String(id || "").trim()).filter(Boolean)))
  if (!ids.length) return new Map()
  const windowDays = clamp(Number(options.windowDays || 90), 7, 365)
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  const [favoritesRows, recentRows] = await Promise.all([
    models.HotelFavorite.findAll({
      attributes: ["hotel_id", [fn("COUNT", col("id")), "count"]],
      where: { hotel_id: { [Op.in]: ids } },
      group: ["hotel_id"],
      raw: true,
    }),
    models.HotelRecentView.findAll({
      attributes: ["hotel_id", [fn("COUNT", col("id")), "count"]],
      where: { hotel_id: { [Op.in]: ids }, viewed_at: { [Op.gte]: since } },
      group: ["hotel_id"],
      raw: true,
    }),
  ])

  const map = new Map()
  ids.forEach((id) => map.set(String(id), { favoritesCount: 0, recentViewsCount: 0 }))
  favoritesRows.forEach((row) => {
    const key = String(row.hotel_id)
    const current = map.get(key) || { favoritesCount: 0, recentViewsCount: 0 }
    current.favoritesCount = Number(row.count || 0)
    map.set(key, current)
  })
  recentRows.forEach((row) => {
    const key = String(row.hotel_id)
    const current = map.get(key) || { favoritesCount: 0, recentViewsCount: 0 }
    current.recentViewsCount = Number(row.count || 0)
    map.set(key, current)
  })
  return map
}

export const fetchHomeExploreEngagementStats = async (homeIds = [], options = {}) => {
  const ids = Array.from(new Set((homeIds || []).map((id) => String(id || "").trim()).filter(Boolean)))
  if (!ids.length) return new Map()
  const windowDays = clamp(Number(options.windowDays || 90), 7, 365)
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  const [favoritesRows, recentRows] = await Promise.all([
    models.HomeFavorite.findAll({
      attributes: ["home_id", [fn("COUNT", col("id")), "count"]],
      where: { home_id: { [Op.in]: ids } },
      group: ["home_id"],
      raw: true,
    }),
    models.HomeRecentView.findAll({
      attributes: ["home_id", [fn("COUNT", col("id")), "count"]],
      where: { home_id: { [Op.in]: ids }, viewed_at: { [Op.gte]: since } },
      group: ["home_id"],
      raw: true,
    }),
  ])

  const map = new Map()
  ids.forEach((id) => map.set(String(id), { favoritesCount: 0, recentViewsCount: 0 }))
  favoritesRows.forEach((row) => {
    const key = String(row.home_id)
    const current = map.get(key) || { favoritesCount: 0, recentViewsCount: 0 }
    current.favoritesCount = Number(row.count || 0)
    map.set(key, current)
  })
  recentRows.forEach((row) => {
    const key = String(row.home_id)
    const current = map.get(key) || { favoritesCount: 0, recentViewsCount: 0 }
    current.recentViewsCount = Number(row.count || 0)
    map.set(key, current)
  })
  return map
}

export const rankHotelsForExplore = (items = [], options = {}) => {
  const source = Array.isArray(items) ? items.filter(Boolean) : []
  if (!source.length) return []
  const engagementById = options.engagementById instanceof Map ? options.engagementById : new Map()
  const debug = Boolean(options.debug)
  const coords = options.coords || null
  const priorities = source.map((item) => Number(item?.priority || 0)).filter(Number.isFinite)
  const minPriority = priorities.length ? Math.min(...priorities) : 0
  const maxPriority = priorities.length ? Math.max(...priorities) : 1
  const prices = source
    .map((item) => toFiniteNumber(item?.price ?? item?.minPrice ?? item?.bestPrice))
    .filter((price) => Number.isFinite(price) && price > 0)
  const minPrice = prices.length ? Math.min(...prices) : null
  const maxPrice = prices.length ? Math.max(...prices) : null
  const engagementBounds = buildEngagementBounds(engagementById)

  const scored = source.map((item) => {
    const id = String(item?.id ?? item?.hotel_id ?? "")
    const rating = parseHotelRating(item?.rating ?? item?.ratingValue)
    const qualityScore = rating != null ? clamp(rating / 5, 0, 1) : 0.5
    const priorityScore = normalizeMinMax(Number(item?.priority || 0), minPriority, maxPriority, 0.5)
    const contentScore = resolveHotelContentScore(item)
    const engagementScore = resolveEngagementScore(id, engagementById, engagementBounds)
    const priceValue = toFiniteNumber(item?.price ?? item?.minPrice ?? item?.bestPrice)
    const valueScore = normalizeInverseMinMax(priceValue, minPrice, maxPrice, 0.5)
    const lat = toFiniteNumber(item?.lat ?? item?.geoPoint?.lat ?? item?.locationLat)
    const lng = toFiniteNumber(item?.lng ?? item?.geoPoint?.lng ?? item?.locationLng)
    const distanceScore = resolveDistanceScore(coords, lat, lng)
    const preferredBoost = item?.preferred || item?.exclusive ? 0.03 : 0
    const score =
      qualityScore * 0.3 +
      priorityScore * 0.24 +
      contentScore * 0.16 +
      engagementScore * 0.14 +
      distanceScore * 0.1 +
      valueScore * 0.06 +
      preferredBoost
    const cityKey = String(item?.cityCode || item?.city || "").trim().toLowerCase()
    const chainKey = String(item?.chain?.code || item?.chain?.name || item?.chain || "").trim().toLowerCase()
    const reason = preferredBoost > 0 ? "preferred" : qualityScore >= 0.85 ? "top_rated" : valueScore >= 0.7 ? "best_value" : "recommended"
    return {
      ...item,
      _rankScore: Number.isFinite(score) ? score : 0,
      _rankCityKey: cityKey,
      _rankChainKey: chainKey,
      _rankHostKey: "",
      _rankReason: reason,
    }
  })

  scored.sort((a, b) => Number(b._rankScore || 0) - Number(a._rankScore || 0))
  const diversified = rerankWithDiversity(scored, {
    maxPerCity: 2,
    maxPerChain: 2,
    maxPerHost: 999,
  })
  return diversified.map((item) => sanitizeRankFields(item, debug))
}

export const rankHotelSectionsForExplore = (sections = [], options = {}) => {
  const source = Array.isArray(sections) ? sections.filter(Boolean) : []
  if (!source.length) return []
  const rankedSections = source
    .map((section, index) => {
      const data = Array.isArray(section?.data) ? section.data : Array.isArray(section?.items) ? section.items : []
      if (!data.length) return null
      const rankedData = rankHotelsForExplore(data, options)
      const top = rankedData.slice(0, 3)
      const avgTopScore =
        top.length && options.debug
          ? top.reduce((sum, entry) => sum + Number(entry?.rankingMeta?.score || 0), 0) / top.length
          : 0
      return {
        ...section,
        data: rankedData,
        _sectionScore: avgTopScore,
        _sectionIndex: index,
      }
    })
    .filter(Boolean)
  rankedSections.sort((a, b) => {
    const scoreA = Number(a?._sectionScore || 0)
    const scoreB = Number(b?._sectionScore || 0)
    return scoreB - scoreA || Number(a?._sectionIndex || 0) - Number(b?._sectionIndex || 0)
  })
  rankedSections.forEach((section) => {
    delete section._sectionScore
    delete section._sectionIndex
  })
  return rankedSections
}

export const rankHomesForExplore = (items = [], options = {}) => {
  const source = Array.isArray(items) ? items.filter(Boolean) : []
  if (!source.length) return []
  const engagementById = options.engagementById instanceof Map ? options.engagementById : new Map()
  const debug = Boolean(options.debug)
  const coords = options.coords || null
  const prices = source
    .map((item) => toFiniteNumber(item?.pricePerNight ?? item?.price))
    .filter((price) => Number.isFinite(price) && price > 0)
  const minPrice = prices.length ? Math.min(...prices) : null
  const maxPrice = prices.length ? Math.max(...prices) : null
  const engagementBounds = buildEngagementBounds(engagementById)

  const scored = source.map((item) => {
    const id = String(item?.id ?? item?.homeId ?? "")
    const ratingRaw = toFiniteNumber(item?.ratingValue ?? item?.rating)
    const qualityScore = Number.isFinite(ratingRaw) && ratingRaw > 0 ? clamp(ratingRaw / 5, 0, 1) : 0.55
    const contentScore = resolveHomeContentScore(item)
    const engagementScore = resolveEngagementScore(id, engagementById, engagementBounds)
    const priceValue = toFiniteNumber(item?.pricePerNight ?? item?.price)
    const valueScore = normalizeInverseMinMax(priceValue, minPrice, maxPrice, 0.5)
    const freshnessScore = resolveFreshnessScore(item?.updatedAt ?? item?.updated_at)
    const lat = toFiniteNumber(item?.locationLat ?? item?.latitude ?? item?.lat)
    const lng = toFiniteNumber(item?.locationLng ?? item?.longitude ?? item?.lng)
    const distanceScore = resolveDistanceScore(coords, lat, lng)
    const score =
      qualityScore * 0.21 +
      valueScore * 0.24 +
      engagementScore * 0.18 +
      freshnessScore * 0.15 +
      contentScore * 0.14 +
      distanceScore * 0.08
    const cityKey = String(item?.city || "").trim().toLowerCase()
    const hostKey = String(item?.hostId || item?.host?.id || "").trim().toLowerCase()
    const reason = valueScore >= 0.72 ? "best_value" : freshnessScore >= 0.8 ? "fresh_pick" : "recommended"
    return {
      ...item,
      _rankScore: Number.isFinite(score) ? score : 0,
      _rankCityKey: cityKey,
      _rankChainKey: "",
      _rankHostKey: hostKey,
      _rankReason: reason,
    }
  })

  scored.sort((a, b) => Number(b._rankScore || 0) - Number(a._rankScore || 0))
  const diversified = rerankWithDiversity(scored, {
    maxPerCity: 2,
    maxPerChain: 999,
    maxPerHost: 2,
  })
  return diversified.map((item) => sanitizeRankFields(item, debug))
}

export { EXPLORE_RANKING_VERSION }
