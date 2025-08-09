/* ────────────────────────────────────────────────
    Hotel‑X content: listHotels (15) + Search + Categories + Destinations + Rooms + Boards + Metadata
   ──────────────────────────────────────────────── */

import cache from "../services/cache.js"
import { fetchHotels } from "../services/tgx.hotelList.service.js"
import { searchTGX, mapSearchOptions } from "../services/tgx.search.service.js"
import { quoteTGX, bookTGX, cancelTGX } from "../services/tgx.booking.service.js"
import { fetchCategoriesTGX, mapCategories, fetchAllCategories } from "../services/tgx.categories.service.js"
import { fetchDestinationsTGX, mapDestinations, fetchAllDestinations } from "../services/tgx.destinations.service.js"
import { fetchRoomsTGX, mapRooms, fetchAllRooms } from "../services/tgx.rooms.service.js"
import { fetchBoardsTGX, mapBoards, fetchAllBoards } from "../services/tgx.boards.service.js"
import { fetchMetadataTGX, mapMetadata } from "../services/tgx.metadata.service.js"

function parseOccupancies(raw = "1|0") {
  const [adultsStr = "1", kidsStr = "0"] = raw.split("|")
  const adults = Number(adultsStr)
  const kids = Number(kidsStr)
  const paxes = [
    ...Array.from({ length: adults }, () => ({ age: 30 })), // adultos genéricos
    ...Array.from({ length: kids }, () => ({ age: 8 })), // niños genéricos
  ]
  return [{ paxes }] // HotelCriteriaSearchInput → occupancies[]
}

/** GET /api/tgx/getHotels */
export const listHotels = async (req, res, next) => {
  try {
    const { access, hotelCodes, countries, destinationCodes, nextToken = "" } = req.query
    if (!access) return res.status(400).json({ error: "access param required" })

    const cacheKey = `hotels:${access}:${hotelCodes || countries || "all"}:${nextToken || "first"}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    /* ── 1. Criterios de búsqueda ─────────────────────────── */
    const criteria = {
      access,
      // maxSize se omite para no limitar los resultados;
      // si prefieres "paginación grande", pon maxSize: 100 (límite TGX)
      hotelCodes: hotelCodes ? hotelCodes.split(",") : undefined,
      countries: countries ? countries.split(",") : undefined,
      destinationCodes: destinationCodes ? destinationCodes.split(",") : undefined,
    }

    /* ── 2. Bucle hasta agotar páginas ────────────────────── */
    let token = nextToken
    const collected = []
    let count = 0
    do {
      const page = await fetchHotels(criteria, token)
      count = page.count
      token = page.token || ""
      collected.push(...page.edges)
    } while (token) // ← sin límite de 15

    /* ── 3. Respuesta final ───────────────────────────────── */
    const response = {
      count,
      returned: collected.length,
      edges: collected,
      nextToken: token, // "" si no hay más páginas
    }

    await cache.set(cacheKey, response, 60) // TTL 60 s
    res.json(response)
  } catch (err) {
    next(err)
  }
}

/** GET /api/tgx/search */
export const search = async (req, res, next) => {
  try {
    const {
      checkIn,
      checkOut,
      occupancies,
      hotelCodes,
      countries,
      currency = "EUR",
      access = "2",
      markets = "ES",
      language = "es",
      nationality = "ES",
    } = req.query

    if (!checkIn || !checkOut || !occupancies) {
      return res.status(400).json({ error: "Missing required params" })
    }

    /* ── caché en memoria ─────────────────────────── */
    const cacheKey = `search:${JSON.stringify(req.query)}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    /* ── criteria ─────────────────────────────────── */
    const criteria = {
      checkIn,
      checkOut,
      occupancies: parseOccupancies(occupancies),
      hotels: hotelCodes?.split(",") || ["1", "2"],
      currency,
      markets: markets.split(","),
      language,
      nationality,
    }

    /* ── settings ─────────────────────────────────── */
    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 25000,
      testMode: true,
    }

    /* ── filterSearch ──────────────────────────────── */
    const filter = {
      access: { includes: [access] },
    }

    /* ── TGX ──────────────────────────────────────── */
    const raw = await searchTGX(criteria, settings, filter)
    const result = mapSearchOptions(raw)

    /* ── cache 60 s ───────────────────────────────── */
    await cache.set(cacheKey, result, 60)
    res.json(result)
  } catch (err) {
    /* log detallado del error GraphQL */
    if (err.response?.errors) {
      console.error("GraphQL Errors:", JSON.stringify(err.response.errors, null, 2))
    }
    console.error("Full error:", err)
    next(err)
  }
}

/** GET /api/tgx/categories */
export const getCategories = async (req, res, next) => {
  try {
    const { access, categoryCodes, group, fetchAll = "false" } = req.query
    if (!access) return res.status(400).json({ error: "access param required" })

    /* ── caché en memoria ─────────────────────────── */
    const cacheKey = `categories:${access}:${categoryCodes || "all"}:${group || "none"}:${fetchAll}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    /* ── criteria ─────────────────────────────────── */
    const criteria = {
      access,
      ...(categoryCodes && { categoryCodes: categoryCodes.split(",") }),
      ...(group && { group }),
    }

    /* ── TGX ──────────────────────────────────────── */
    let raw
    if (fetchAll === "true") {
      // Obtener todas las categorías automáticamente
      raw = await fetchAllCategories(criteria)
    } else {
      // Obtener solo una página
      raw = await fetchCategoriesTGX(criteria)
    }

    const result = {
      count: raw.edges?.length || 0,
      categories: mapCategories(raw),
      ...(raw.token && { token: raw.token }),
    }

    /* ── cache 300 s (5 min) ──────────────────────── */
    await cache.set(cacheKey, result, 300)
    res.json(result)
  } catch (err) {
    if (err.response?.errors) {
      console.error("Categories GraphQL Errors:", JSON.stringify(err.response.errors, null, 2))
    }
    console.error("Categories error:", err)
    next(err)
  }
}

/** GET /api/tgx/destinations */
export const getDestinations = async (req, res, next) => {
  try {
    const {
      access,
      destinationCodes,
      group,
      maxSize = "15",
      token = "",
      fetchAll = "false",
      type, // Filtrar por CITY o ZONE
    } = req.query

    if (!access) return res.status(400).json({ error: "access param required" })

    /* ── caché en memoria ─────────────────────────── */
    const cacheKey = `destinations:${access}:${destinationCodes || "all"}:${group || "none"}:${maxSize}:${token}:${fetchAll}:${type || "all"}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    /* ── criteria ─────────────────────────────────── */
    const criteria = {
      access,
      maxSize: Number.parseInt(maxSize),
      ...(destinationCodes && { destinationCodes: destinationCodes.split(",") }),
      ...(group && { group }),
    }

    /* ── TGX ──────────────────────────────────────── */
    let raw
    if (fetchAll === "true") {
      // Obtener todos los destinos automáticamente
      raw = await fetchAllDestinations(criteria)
    } else {
      // Obtener solo una página con token
      raw = await fetchDestinationsTGX(criteria, token)
    }

    let mappedDestinations = mapDestinations(raw)

    // Filtrar por tipo si se especifica
    if (type && (type === "CITY" || type === "ZONE")) {
      mappedDestinations = mappedDestinations.filter((dest) => dest.type === type)
    }

    const result = {
      count: mappedDestinations.length,
      returned: mappedDestinations.length,
      destinations: mappedDestinations,
      ...(raw.token && { nextToken: raw.token }),
    }

    /* ── cache 300 s (5 min) ──────────────────────── */
    await cache.set(cacheKey, result, 300)
    res.json(result)
  } catch (err) {
    if (err.response?.errors) {
      console.error("Destinations GraphQL Errors:", JSON.stringify(err.response.errors, null, 2))
    }
    console.error("Destinations error:", err)
    next(err)
  }
}

/** GET /api/tgx/rooms */
export const getRooms = async (req, res, next) => {
  try {
    const { access, roomCodes, maxSize = "15", token = "", fetchAll = "false" } = req.query
    if (!access) return res.status(400).json({ error: "access param required" })

    /* ── caché en memoria ─────────────────────────── */
    const cacheKey = `rooms:${access}:${roomCodes || "all"}:${maxSize}:${token}:${fetchAll}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    /* ── criteria ─────────────────────────────────── */
    const criteria = {
      access,
      maxSize: Number.parseInt(maxSize),
      ...(roomCodes && { roomCodes: roomCodes.split(",") }),
    }

    /* ── TGX ──────────────────────────────────────── */
    let raw
    if (fetchAll === "true") {
      // Obtener todas las habitaciones automáticamente
      raw = await fetchAllRooms(criteria)
    } else {
      // Obtener solo una página con token
      raw = await fetchRoomsTGX(criteria, token)
    }

    const result = {
      count: raw.edges?.length || 0,
      returned: raw.edges?.length || 0,
      rooms: mapRooms(raw),
      ...(raw.token && { nextToken: raw.token }),
    }

    /* ── cache 300 s (5 min) ──────────────────────── */
    await cache.set(cacheKey, result, 300)
    res.json(result)
  } catch (err) {
    if (err.response?.errors) {
      console.error("Rooms GraphQL Errors:", JSON.stringify(err.response.errors, null, 2))
    }
    console.error("Rooms error:", err)
    next(err)
  }
}

/** GET /api/tgx/boards */
export const getBoards = async (req, res, next) => {
  try {
    const { access, boardCodes, group, fetchAll = "false" } = req.query
    if (!access) return res.status(400).json({ error: "access param required" })

    /* ── caché en memoria ─────────────────────────── */
    const cacheKey = `boards:${access}:${boardCodes || "all"}:${group || "none"}:${fetchAll}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    /* ── criteria ─────────────────────────────────── */
    const criteria = {
      access,
      ...(boardCodes && { boardCodes: boardCodes.split(",") }),
      ...(group && { group }),
    }

    /* ── TGX ──────────────────────────────────────── */
    let raw
    if (fetchAll === "true") {
      // Obtener todos los boards automáticamente
      raw = await fetchAllBoards(criteria)
    } else {
      // Obtener solo una página
      raw = await fetchBoardsTGX(criteria)
    }

    const result = {
      count: raw.edges?.length || 0,
      returned: raw.edges?.length || 0,
      boards: mapBoards(raw),
      ...(raw.token && { token: raw.token }),
    }

    /* ── cache 300 s (5 min) ──────────────────────── */
    await cache.set(cacheKey, result, 300)
    res.json(result)
  } catch (err) {
    if (err.response?.errors) {
      console.error("Boards GraphQL Errors:", JSON.stringify(err.response.errors, null, 2))
    }
    console.error("Boards error:", err)
    next(err)
  }
}

/** GET /api/tgx/metadata */
export const getMetadata = async (req, res, next) => {
  try {
    const { supplierCodes } = req.query
    if (!supplierCodes) return res.status(400).json({ error: "supplierCodes param required" })

    /* ── caché en memoria ─────────────────────────── */
    const cacheKey = `metadata:${supplierCodes}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    /* ── criteria ─────────────────────────────────── */
    const criteria = {
      supplierCodes: supplierCodes.split(","),
    }

    /* ── TGX ──────────────────────────────────────── */
    const raw = await fetchMetadataTGX(criteria)
    const result = {
      count: raw.edges?.length || 0,
      metadata: mapMetadata(raw),
    }

    /* ── cache 3600 s (1 hora) ──────────────────────── */
    await cache.set(cacheKey, result, 3600)
    res.json(result)
  } catch (err) {
    if (err.response?.errors) {
      console.error("Metadata GraphQL Errors:", JSON.stringify(err.response.errors, null, 2))
    }
    console.error("Metadata error:", err)
    next(err)
  }
}

/** POST /api/tgx/quote */
export const quote = async (req, res, next) => {
  try {
    const { rateKey } = req.body
    if (!rateKey) return res.status(400).json({ error: "rateKey required" })

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 10000,
      testMode: true,
    }

    console.log("🔍 Quote request for rateKey:", rateKey)
    const data = await quoteTGX(rateKey, settings)
    console.log("✅ Quote response:", data)

    res.json(data)
  } catch (err) {
    console.error("❌ Quote controller error:", err)
    next(err)
  }
}

/** POST /api/tgx/book */
export const book = async (req, res, next) => {
  try {
    const { optionRefId, holder, rooms, clientReference, remarks, paymentReference } = req.body
    if (!optionRefId || !holder || !rooms?.length) {
      return res.status(400).json({ error: "Missing booking data" })
    }

    const input = {
      optionRefId,
      clientReference: clientReference || `BK-${Date.now()}`,
      holder,
      rooms,
      ...(remarks && { remarks }),
      ...(paymentReference && { paymentReference }),
    }

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 30000,
      testMode: true,
    }

    console.log("🎯 Book request:", input)
    const data = await bookTGX(input, settings)
    console.log("✅ Book response:", data)

    res.json(data)
  } catch (err) {
    console.error("❌ Book controller error:", err)
    next(err)
  }
}

/** POST /api/tgx/cancel */
export const cancel = async (req, res, next) => {
  try {
    const { bookingID } = req.body
    if (!bookingID) return res.status(400).json({ error: "bookingID required" })

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 10000,
      testMode: true,
    }

    console.log("🚫 Cancel request for bookingID:", bookingID)
    const data = await cancelTGX(bookingID, settings)
    console.log("✅ Cancel response:", data)

    res.json(data)
  } catch (err) {
    console.error("❌ Cancel controller error:", err)
    next(err)
  }
}
