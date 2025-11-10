import cache from "../../services/cache.js"
import { searchTGX, mapSearchOptions } from "./services/search.service.js"
import { getMarkup } from "../../utils/markup.js"

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

    const moneyRound = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

    const getRoleFromReq = () => {
      const sources = {
        query: req.query.user_role,
        header: req.headers["x-user-role"],
        userRole: req.user?.role,
        userRoleId: req.user?.role_id,
      }
      const jwtRole = sources.userRole ?? sources.userRoleId
      const nJwt = Number(jwtRole)
      if (Number.isFinite(nJwt)) {
        console.log("[search][markup] using authenticated role:", nJwt)
        return nJwt
      }
      // Unauthenticated: ignore hints and force guest (0)
      console.log("[search][markup] unauthenticated; ignoring hints and using guest (0). Sources:", sources)
      return 0
    }

    const roleNum = getRoleFromReq()

    const applyMarkup = (amount, pct) => {
      const n = Number(amount)
      if (!Number.isFinite(n)) return null
      return moneyRound(n * (1 + pct))
    }

    const decorateWithMarkup = (options, roleNum) => {
      if (!Array.isArray(options)) return options
      return options.map((opt) => {
        const pct = getMarkup(roleNum, opt.price)
        const priceUser = applyMarkup(opt.price, pct)
        const rooms = Array.isArray(opt.rooms)
          ? opt.rooms.map((r) => ({
              ...r,
              priceUser: applyMarkup(r.price, getMarkup(roleNum, r.price)),
            }))
          : opt.rooms

        return {
          ...opt,
          priceUser,
          rooms,
          markup: { roleNum, pct },
        }
      })
    }

    /* ────────────────────────────────────────────── */

    // clave de caché incluye solo rol
    const cacheKey = `search:${JSON.stringify({
      q: req.query,
      roleNum,
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
    console.log("[search][markup] using role:", roleNum)

    const cached = await cache.get(cacheKey)
    if (cached) {
      console.log("[search] cache HIT with role:", roleNum, "items:", Array.isArray(cached) ? cached.length : "-")
      // pequeño sample para confirmar que priceUser existe
      const sample = Array.isArray(cached) ? cached.slice(0, 2).map(o => ({
        hotelCode: o.hotelCode,
        hotelName: o.hotelName,
        price: o.price,
        priceUser: o.priceUser
      })) : []
      console.log("[search] cache sample:", sample)
      res.set("x-markup-role", String(roleNum))
      const samplePct = Array.isArray(cached) && cached[0] ? getMarkup(roleNum, cached[0].price) : getMarkup(roleNum, 0)
      res.set("x-markup-pct", String(samplePct))
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
    const withMarkup = decorateWithMarkup(result, roleNum)

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
    const headerPct = Array.isArray(withMarkup) && withMarkup[0]
      ? getMarkup(roleNum, withMarkup[0].price)
      : getMarkup(roleNum, 0)
    res.set("x-markup-pct", String(headerPct))
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



