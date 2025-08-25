/* ────────────────────────────────────────────────
    Hotel-X content + Search + Booking flow
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
import models from "../models/index.js"

function parseOccupancies(raw = "1|0") {
  const [adultsStr = "1", kidsStr = "0"] = raw.split("|")
  const adults = Number(adultsStr)
  const kids = Number(kidsStr)
  const paxes = [
    ...Array.from({ length: adults }, () => ({ age: 30 })),
    ...Array.from({ length: kids }, () => ({ age: 8 })),
  ]
  return [{ paxes }]
}

/** GET /api/tgx/getHotels */
export const listHotels = async (req, res, next) => {
  try {
    const { access, hotelCodes, countries, destinationCodes, nextToken = "" } = req.query
    if (!access) return res.status(400).json({ error: "access param required" })

      console.log(access, "acces")

    // CERT: una llamada, sin filtros ni paginación, maxSize alto, y devolver tal cual
    if (process.env.TGX_CERT_MODE === 'true') {
      const cacheKey = `cert_hotels:${access}`
      const cached = await cache.get(cacheKey)
      if (cached) return res.json(cached)

      const page = await fetchHotels({ access, maxSize: 10000 }, "")
      // page ya es la respuesta de TGX (hotelX.hotels), ideal para rs_hotels.json
      await cache.set(cacheKey, page, 300)
      return res.json(page)
    }

    // Modo normal (no cert): tu lógica de paginación actual
    const cacheKey = `hotels:${access}:${hotelCodes || countries || "all"}:${nextToken || "first"}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = {
      access,
      hotelCodes: hotelCodes ? hotelCodes.split(",") : undefined,
      countries: countries ? countries.split(",") : undefined,
      destinationCodes: destinationCodes ? destinationCodes.split(",") : undefined,
      maxSize: 10000, // también útil fuera de cert para minimizar páginas
    }

    let token = nextToken
    const collected = []
    let totalCountFromFirstPage = 0

    do {
      const page = await fetchHotels(criteria, token)
      if (!totalCountFromFirstPage) totalCountFromFirstPage = page.count || 0
      token = page.token || ""
      collected.push(...(page.edges || []))
    } while (token)

    const response = {
      count: totalCountFromFirstPage, // el "count" de TGX (normalmente del access)
      returned: collected.length,     // cuántos retornaste vos en total
      edges: collected,
      nextToken: "",                  // sin más páginas
    }

    await cache.set(cacheKey, response, 60)
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

      // filtros desde el front
      refundableMode,        // 'refundable' | 'non_refundable' | undefined
      paymentMethod,         // 'DIRECT' | 'MERCHANT' | 'CARD_CHECK_IN' | ''
      certCase               // 'rf' | 'nrf' | 'direct' | ''
    } = req.query

    if (!checkIn || !checkOut || !occupancies) {
      return res.status(400).json({ error: "Missing required params" })
    }

    /* ──────────────────────────────────────────────
       Markup por rol (definido en código)
    ────────────────────────────────────────────── */
    // Ajustá según negocio:
    // 1: guest, 2: staff, 3: influencer, 4: corporate/partner, 5: agency, 99: admin
    const ROLE_MARKUP = {
      1: 0.50, // guest → +50%
      2: 0.10, // staff → +20%
      3: 0.10, // influencer → +10%
      4: 0.05, // corporate → +10%
   
      99: 0.00 // admin → +0%
    }

    const moneyRound = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

    const getRoleFromReq = () => {
      const sources = {
        query: req.query.user_role,
        header: req.headers["x-user-role"],
        userRole: req.user?.role,
        userRoleId: req.user?.role_id,
      }
      const raw =
        sources.query ??
        sources.header ??
        sources.userRole ??
        sources.userRoleId
      const n = Number(raw)
      // Debug ingreso de rol
      console.log("[search][markup] role sources:", sources, "→ parsed:", n)
      return Number.isFinite(n) ? n : 1 // default a guest (1)
    }

    const roleNum = getRoleFromReq()
    const rolePct = Object.prototype.hasOwnProperty.call(ROLE_MARKUP, roleNum)
      ? ROLE_MARKUP[roleNum]
      : ROLE_MARKUP[1] // fallback guest

    const applyMarkup = (amount, pct) => {
      const n = Number(amount)
      if (!Number.isFinite(n)) return null
      return moneyRound(n * (1 + pct))
    }

    const decorateWithMarkup = (options, pct, roleNum) => {
      if (!Array.isArray(options)) return options
      return options.map((opt) => {
        const priceUser = applyMarkup(opt.price, pct)
        const rooms = Array.isArray(opt.rooms)
          ? opt.rooms.map((r) => ({
              ...r,
              priceUser: applyMarkup(r.price, pct),
            }))
          : opt.rooms

        return {
          ...opt,
          priceUser,
          rooms,
          markup: { roleNum, pct }, // útil para debug en front
        }
      })
    }

    /* ────────────────────────────────────────────── */

    // clave de caché incluye rol y pct para no cruzar precios
    const cacheKey = `search:${JSON.stringify({
      q: req.query,
      roleNum,
      rolePct,
    })}`

    // Debug de params clave (sin ensuciar logs con todo)
    console.log("[search] params:", {
      checkIn,
      checkOut,
      occupancies,
      hotelCodes,
      currency,
      access,
      markets,
      language,
      nationality,
      refundableMode,
      paymentMethod,
      certCase,
    })
    console.log("[search][markup] using role:", roleNum, "pct:", rolePct)

    const cached = await cache.get(cacheKey)
    if (cached) {
      console.log("[search] cache HIT with role/pct:", roleNum, rolePct, "items:", Array.isArray(cached) ? cached.length : "-")
      // pequeño sample para confirmar que priceUser existe
      const sample = Array.isArray(cached) ? cached.slice(0, 2).map(o => ({
        hotelCode: o.hotelCode,
        hotelName: o.hotelName,
        price: o.price,
        priceUser: o.priceUser
      })) : []
      console.log("[search] cache sample:", sample)
      res.set("x-markup-role", String(roleNum))
      res.set("x-markup-pct", String(rolePct))
      if (sample.length) {
        try { res.set("x-markup-sample", JSON.stringify(sample).slice(0, 512)) } catch (_) {}
      }
      return res.json(cached)
    }

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
    console.log("[search] criteria:", criteria)

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 25000,
      testMode: true,
    }

    // Base filter: access. (rateRules/status son los únicos soportados por doc)
    const filter = { access: { includes: [access] } }

    // Refundability → rateRules con NON_REFUNDABLE
    if (refundableMode === "refundable") {
      filter.rateRules = { ...(filter.rateRules || {}), excludes: ["NON_REFUNDABLE"] }
    } else if (refundableMode === "non_refundable") {
      filter.rateRules = { ...(filter.rateRules || {}), includes: ["NON_REFUNDABLE"] }
    }

    // Etiqueta de captura para certificación (si tgx.capture soporta label)
    const captureLabel =
      certCase === "rf" ? "search_rf"
      : certCase === "nrf" ? "search_nrf"
      : certCase === "direct" ? "search_direct"
      : undefined

    console.log("[search] filter:", filter, "captureLabel:", captureLabel)

    // 1) Buscar en TGX
    const raw = await searchTGX(criteria, settings, filter, captureLabel)

    // 2) Normalizar shape
    let result = mapSearchOptions(raw)
    console.log("[search] mapped options:", Array.isArray(result) ? result.length : 0)

    // quick sanity de tipos/precios originales
    if (Array.isArray(result) && result.length) {
      const sampleOrig = result.slice(0, 3).map(o => ({
        hotelCode: o.hotelCode,
        hotelName: o.hotelName,
        price: o.price,
        price_t: typeof o.price,
        rooms_len: Array.isArray(o.rooms) ? o.rooms.length : 0,
        room_first_price: Array.isArray(o.rooms) && o.rooms[0] ? o.rooms[0].price : undefined,
        room_first_price_t: Array.isArray(o.rooms) && o.rooms[0] ? typeof o.rooms[0].price : undefined,
      }))
      console.log("[search] original sample:", sampleOrig)
    }

    // 3) Post-filtrado por método de pago (filterSearch no soporta paymentType)
    if (paymentMethod) {
      const before = Array.isArray(result) ? result.length : 0
      result = result.filter(o => o.paymentType === paymentMethod)
      console.log("[search] paymentMethod filter:", paymentMethod, "before:", before, "after:", result.length)
    }

    // 4) Aplicar markup por rol (nuevo campo priceUser)
    const withMarkup = decorateWithMarkup(result, rolePct, roleNum)

    // diffs de precios para debug
    if (Array.isArray(withMarkup) && withMarkup.length) {
      const diffs = withMarkup.slice(0, 3).map(o => ({
        hotelCode: o.hotelCode,
        hotelName: o.hotelName,
        price: o.price,
        priceUser: o.priceUser,
        changed: Number(o.priceUser) !== Number(o.price),
        roomsDiff: Array.isArray(o.rooms)
          ? o.rooms.slice(0, 2).map(r => ({
              price: r.price,
              priceUser: r.priceUser,
              changed: Number(r.priceUser) !== Number(r.price),
            }))
          : [],
      }))
      console.log("[search][markup] price diffs (first items):", diffs)

      // señales comunes de fallo
      if (diffs.every(d => d.changed === false)) {
        console.warn("[search][markup] WARNING: ningún precio cambió. Posibles causas: pct=0, price no numérico, front no usa priceUser.")
      }
    }

    await cache.set(cacheKey, withMarkup, 60)

    // headers útiles
    res.set("x-markup-role", String(roleNum))
    res.set("x-markup-pct", String(rolePct))
    try {
      const hdrSample = (withMarkup || []).slice(0, 2).map(o => ({
        hotelCode: o.hotelCode, price: o.price, priceUser: o.priceUser
      }))
      res.set("x-markup-sample", JSON.stringify(hdrSample).slice(0, 512))
    } catch (_) {}

    res.json(withMarkup)
  } catch (err) {
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

    const cacheKey = `categories:${access}:${categoryCodes || "all"}:${group || "none"}:${fetchAll}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = {
      access,
      ...(categoryCodes && { categoryCodes: categoryCodes.split(",") }),
      ...(group && { group }),
    }

    let raw
    if (fetchAll === "true") raw = await fetchAllCategories(criteria)
    else raw = await fetchCategoriesTGX(criteria)

    const result = {
      count: raw.edges?.length || 0,
      categories: mapCategories(raw),
      ...(raw.token && { token: raw.token }),
    }

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
      type,
    } = req.query

    if (!access) return res.status(400).json({ error: "access param required" })

    const cacheKey = `destinations:${access}:${destinationCodes || "all"}:${group || "none"}:${maxSize}:${token}:${fetchAll}:${type || "all"}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = {
      access,
      maxSize: Number.parseInt(maxSize),
      ...(destinationCodes && { destinationCodes: destinationCodes.split(",") }),
      ...(group && { group }),
    }

    let raw
    if (fetchAll === "true") raw = await fetchAllDestinations(criteria)
    else raw = await fetchDestinationsTGX(criteria, token)

    let mappedDestinations = mapDestinations(raw)
    if (type && (type === "CITY" || type === "ZONE")) {
      mappedDestinations = mappedDestinations.filter((dest) => dest.type === type)
    }

    const result = {
      count: mappedDestinations.length,
      returned: mappedDestinations.length,
      destinations: mappedDestinations,
      ...(raw.token && { nextToken: raw.token }),
    }

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

    const cacheKey = `rooms:${access}:${roomCodes || "all"}:${maxSize}:${token}:${fetchAll}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = {
      access,
      maxSize: Number.parseInt(maxSize),
      ...(roomCodes && { roomCodes: roomCodes.split(",") }),
    }

    let raw
    if (fetchAll === "true") raw = await fetchAllRooms(criteria)
    else raw = await fetchRoomsTGX(criteria, token)

    const result = {
      count: raw.edges?.length || 0,
      returned: raw.edges?.length || 0,
      rooms: mapRooms(raw),
      ...(raw.token && { nextToken: raw.token }),
    }

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

    const cacheKey = `boards:${access}:${boardCodes || "all"}:${group || "none"}:${fetchAll}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = {
      access,
      ...(boardCodes && { boardCodes: boardCodes.split(",") }),
      ...(group && { group }),
    }

    let raw
    if (fetchAll === "true") raw = await fetchAllBoards(criteria)
    else raw = await fetchBoardsTGX(criteria)

    const result = {
      count: raw.edges?.length || 0,
      returned: raw.edges?.length || 0,
      boards: mapBoards(raw),
      ...(raw.token && { token: raw.token }),
    }

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

    const cacheKey = `metadata:${supplierCodes}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = { supplierCodes: supplierCodes.split(",") }
    const raw = await fetchMetadataTGX(criteria)
    const result = {
      count: raw.edges?.length || 0,
      metadata: mapMetadata(raw),
    }

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

    const data = await quoteTGX(rateKey, settings)
    res.json(data)
  } catch (err) {
    next(err)
  }
}

/** POST /api/tgx/book */
export const book = async (req, res, next) => {
  try {
    const {
      optionRefId,
      holder,
      rooms,
      clientReference,
      remarks,
      paymentReference,
      guestEmail,
    } = req.body

    if (!optionRefId || !holder || !rooms?.length) {
      return res.status(400).json({ error: "Missing booking data" })
    }

    const cleanHolder = { name: holder.name, surname: holder.surname }

    let finalRemarks = remarks || ""
    const emailToAttach = holder.email || guestEmail
    if (emailToAttach) {
      finalRemarks = finalRemarks
        ? `${finalRemarks}\nGuest email: ${emailToAttach}`
        : `Guest email: ${emailToAttach}`
    }

    const input = {
      optionRefId,
      clientReference: clientReference || `BK-${Date.now()}`,
      holder: cleanHolder,
      rooms,
      ...(finalRemarks && { remarks: finalRemarks }),
      ...(paymentReference && { paymentReference }),
    }

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 30000,
      testMode: true,
    }

    const data = await bookTGX(input, settings)
    res.json(data)
  } catch (err) {
    next(err)
  }
}

/** POST /api/tgx/cancel */

export const cancel = async (req, res, next) => {
  console.log(req.body)
  try {
    const { bookingID, bookingRef, id } = req.body || {};
    if (!bookingID && !bookingRef && !id) {
      return res.status(400).json({ error: "bookingID, bookingRef or id is required" });
    }

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 10000,
      testMode: true,
      auditTransactions: true,
    };

    // 1) Buscar la reserva local (por id | booking_ref | external_ref)
    let bk = null;
    if (id) {
      bk = await models.Booking.findOne({
        where: { id },
        include: [{ model: models.TGXMeta, as: "tgxMeta" }],
      });
    }
    if (!bk && bookingRef) {
      bk = await models.Booking.findOne({
        where: { booking_ref: bookingRef },
        include: [{ model: models.TGXMeta, as: "tgxMeta" }],
      });
    }
    if (!bk && bookingID) {
      bk = await models.Booking.findOne({
        where: { external_ref: bookingID.trim() },
        include: [{ model: models.TGXMeta, as: "tgxMeta" }],
      });
    }
    if (!bk) {
      return res.status(404).json({ error: "Local booking not found" });
    }

    // Idempotencia
    if (bk.status === "CANCELLED") {
      return res.json({
        ok: true,
        alreadyCancelled: true,
        bookingId: bk.id,
        localStatus: bk.status,
        payment_status: bk.payment_status,
      });
    }

    // 2) Construir input FORMATO 2 para TGX
    const accessCode = bk.tgxMeta?.access_code || "2";
    const hotelCode = bk.tgxMeta?.hotel_code || "1";
    const refSupplier = bk.tgxMeta?.reference_supplier;
    const refClient = bk.tgxMeta?.reference_client;

    if (!refSupplier || !refClient) {
      return res.status(400).json({ 
        error: "Missing supplier reference or client reference for cancellation. Cannot proceed with format 2." 
      });
    }

    const tgxInput = {
      accessCode: accessCode,
      hotelCode: hotelCode,
      reference: {
        supplier: refSupplier,
        client: refClient
      }
    };

    console.log("🎯 Cancelling with format 2:", tgxInput);

    // 3) Cancelar en TGX
    const { cancellation, warnings = [] } = await cancelTGX(tgxInput, settings);

    // 4) Actualizar local
    const newPaymentStatus = bk.payment_status === "PAID" ? "REFUNDED" : bk.payment_status;
    await bk.update({
      status: "CANCELLED",
      payment_status: newPaymentStatus,
      cancelled_at: new Date(),
      meta: {
        ...(bk.meta || {}),
        tgxCancel: {
          at: new Date().toISOString(),
          via: "api/tgx/cancel",
          warnings,
          tgxCancellation: cancellation || null,
          cancelFormat: "format2",
        },
      },
    });

    // 4.1) Guardar cancelReference si lo tenés en el modelo
    if (bk.tgxMeta && cancellation?.cancelReference && bk.tgxMeta.update) {
      await bk.tgxMeta.update({ cancel_reference: cancellation.cancelReference });
    }

    // 5) Responder
    return res.json({
      ok: true,
      bookingId: bk.id,
      localStatus: "CANCELLED",
      payment_status: newPaymentStatus,
      tgx: {
        status:    cancellation?.status || null,
        reference: cancellation?.reference || null,
        booking:   cancellation?.booking || null,
        warnings,
      },
    });
  } catch (err) {
    if (err?.response?.errors) {
      console.error("Cancel GraphQL errors:", JSON.stringify(err.response.errors, null, 2));
    }
    next(err);
  }
};