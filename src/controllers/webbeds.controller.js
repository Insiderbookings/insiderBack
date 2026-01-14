import { Op } from "sequelize"
import models from "../models/index.js"
import { WebbedsProvider } from "../providers/webbeds/provider.js"
import { formatStaticHotel } from "../utils/webbedsMapper.js"

const provider = new WebbedsProvider()

const maskEmail = (email = "") => {
  const value = String(email || "").trim()
  if (!value) return null
  const [user, domain] = value.split("@")
  if (!domain) return value
  if (user.length <= 2) return `${user[0] || ""}*@${domain}`
  return `${user[0]}***${user[user.length - 1]}@${domain}`
}

const maskPhone = (phone = "") => {
  const value = String(phone || "").trim()
  if (!value) return null
  const tail = value.slice(-2)
  return `***${tail}`
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

export const search = (req, res, next) => provider.search(req, res, next)
export const getRooms = (req, res, next) => provider.getRooms(req, res, next)
export const saveBooking = (req, res, next) => provider.saveBooking(req, res, next)
export const bookItinerary = (req, res, next) => provider.bookItinerary(req, res, next)
export const bookItineraryRecheck = (req, res, next) => provider.bookItineraryRecheck(req, res, next)
export const bookItineraryPreauth = (req, res, next) => provider.bookItineraryPreauth(req, res, next)
export const confirmBooking = (req, res, next) => provider.confirmBooking(req, res, next)
export const cancelBooking = (req, res, next) => provider.cancelBooking(req, res, next)
export const deleteItinerary = (req, res, next) => provider.deleteItinerary(req, res, next)
export const getBookingDetails = (req, res, next) => provider.getBookingDetails(req, res, next)

export const createPaymentIntent = async (req, res, next) => {
  try {
    const {
      bookingId, // Webbeds Booking ID
      amount,
      currency = "USD",
      hotelId,
      checkIn,
      checkOut,
      guests, // { adults, children }
      holder, // { firstName, lastName, ... }
      roomName,
      requestId,
    } = req.body
    const requestTag =
      requestId ||
      req.headers["x-request-id"] ||
      req.headers["x-correlation-id"] ||
      `webbeds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const logPrefix = `[webbeds] createPaymentIntent ${requestTag}`

    console.info(`${logPrefix} request`, {
      bookingId,
      amount,
      currency,
      hotelId,
      checkIn,
      checkOut,
      guests,
      holder: {
        firstName: holder?.firstName || null,
        lastName: holder?.lastName || null,
        email: maskEmail(holder?.email),
        phone: maskPhone(holder?.phone),
      },
      roomName,
      userId: req.user?.id || null,
    })

    if (!bookingId) {
      console.warn(`${logPrefix} missing bookingId`)
      return res.status(400).json({ error: "Missing bookingId" })
    }
    if (!hotelId) {
      console.warn(`${logPrefix} missing hotelId`)
      return res.status(400).json({ error: "Missing hotelId" })
    }
    if (!checkIn || !checkOut) {
      console.warn(`${logPrefix} missing dates`, { checkIn, checkOut })
      return res.status(400).json({ error: "Missing check-in or check-out dates" })
    }
    const referral = {
      influencerId: Number(req.user?.referredByInfluencerId) || null,
      code: req.user?.referredByCode || null,
    }

    // 1. Create Local Booking Record (PENDING)
    // We store the Webbeds ID as external_ref
    // and "WEBBEDS" as source
    const booking_ref = `WB-${Date.now().toString(36).toUpperCase()}`

    // Convert amounts
    const amountNumber = Number(amount)
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      console.warn(`${logPrefix} invalid amount`, { amount })
      return res.status(400).json({ error: "Invalid amount" })
    }

    const guestAdultsRaw = guests?.adults ?? req.body?.adults
    const guestChildrenRaw = guests?.children ?? req.body?.children
    const adults = Math.max(1, Number(guestAdultsRaw) || 1)
    const children = Math.max(0, Number(guestChildrenRaw) || 0)

    const guestEmail = holder?.email || req.user?.email
    if (!guestEmail) {
      console.warn(`${logPrefix} missing guest email`)
      return res.status(400).json({ error: "Missing guest email" })
    }

    const guestName = holder?.firstName
      ? `${holder.firstName} ${holder.lastName || ""}`.trim()
      : "Guest"

    console.info(`${logPrefix} normalized`, {
      adults,
      children,
      guestName,
      guestEmail: maskEmail(guestEmail),
      guestPhone: maskPhone(holder?.phone),
    })

    let inventorySnapshot = null
    let guestSnapshot = null
    const hotelIdValue = String(hotelId).trim()
    let webbedsHotelIdForStay = null
    try {
      const staticHotel = await models.WebbedsHotel.findOne({
        where: { hotel_id: hotelIdValue },
      })
      if (staticHotel?.hotel_id != null) {
        webbedsHotelIdForStay = String(staticHotel.hotel_id)
      }
      const staticPayload = formatStaticHotel(staticHotel)
      const locationFallback =
        staticPayload?.address ||
        [staticPayload?.city, staticPayload?.country].filter(Boolean).join(", ") ||
        null
      const hotelSnapshot = staticPayload
        ? {
            id: staticPayload.id,
            name: staticPayload.name,
            city: staticPayload.city,
            country: staticPayload.country,
            rating: staticPayload.rating ?? null,
            address: staticPayload.address ?? null,
            geoPoint: staticPayload.geoPoint ?? null,
            image: staticPayload.coverImage ?? null,
            chain: staticPayload.chain ?? null,
            classification: staticPayload.classification ?? null,
          }
        : {
            id: hotelIdValue,
            name: null,
            city: null,
            country: null,
            rating: null,
            address: null,
            geoPoint: null,
            image: null,
            chain: null,
            classification: null,
          }

      inventorySnapshot = {
        hotelId: hotelIdValue,
        hotelName: hotelSnapshot?.name ?? null,
        hotelImage: hotelSnapshot?.image ?? null,
        location: locationFallback,
        hotel: hotelSnapshot,
        room: roomName ? { name: roomName } : null,
      }
    } catch (snapshotError) {
      console.warn(`${logPrefix} static hotel snapshot failed`, {
        hotelId,
        error: snapshotError?.message || snapshotError,
      })
    }

    guestSnapshot = {
      name: guestName,
      email: guestEmail,
      phone: holder?.phone || null,
      adults,
      children,
    }

    const localBooking = await models.Booking.create({
      booking_ref,
      user_id: req.user?.id || null,
      influencer_user_id: referral.influencerId,
      source: "PARTNER",
      inventory_type: "LOCAL_HOTEL",
      inventory_id: String(hotelId),
      external_ref: bookingId, // The Webbeds Booking ID

      check_in: checkIn,
      check_out: checkOut,

      guest_name: guestName,
      guest_email: guestEmail,
      guest_phone: holder?.phone || null,

      adults,
      children,

      status: "PENDING",
      payment_status: "UNPAID",
      gross_price: amountNumber,
      currency: currency,

      meta: {
        hotelId,
        hotelName: inventorySnapshot?.hotelName ?? null,
        hotelImage: inventorySnapshot?.hotelImage ?? null,
        roomName,
        location: inventorySnapshot?.location ?? null,
        guests: { adults, children },
        ...(referral.influencerId
          ? {
              referral: {
                influencerUserId: referral.influencerId,
                code: referral.code || null,
              },
            }
          : {}),
      },
      inventory_snapshot: inventorySnapshot,
      guest_snapshot: guestSnapshot,
    })
    console.info(`${logPrefix} local booking created`, {
      localBookingId: localBooking.id,
      bookingRef: booking_ref,
    })

    if (models.StayHotel) {
      const parsedHotelId = Number(hotelIdValue)
      let hotelIdForStay = Number.isFinite(parsedHotelId) ? parsedHotelId : null
      if (hotelIdForStay != null && models.Hotel) {
        const localHotel = await models.Hotel.findByPk(hotelIdForStay, { attributes: ["id"] })
        if (!localHotel) hotelIdForStay = null
      }
      const roomSnapshot = roomName ? { name: roomName } : null
      await models.StayHotel.create({
        stay_id: localBooking.id,
        hotel_id: hotelIdForStay,
        webbeds_hotel_id: webbedsHotelIdForStay,
        room_id: null,
        room_name: roomName || null,
        room_snapshot: roomSnapshot,
      })
      console.info(`${logPrefix} stay_hotel created`, {
        stayId: localBooking.id,
        hotelId: hotelIdForStay,
        webbedsHotelId: webbedsHotelIdForStay,
        webbedsHotelIdRaw: hotelIdValue,
      })
    }

    // 2. Create Stripe Payment Intent
    const paymentIntent = await import("stripe").then(m => {
      const Stripe = m.default
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" })
      return stripe.paymentIntents.create({
        amount: Math.round(amountNumber * 100), // cents
        currency: currency.toLowerCase(),
        metadata: {
          bookingId: String(localBooking.id), // Link to LOCAL booking
          webbedsId: String(bookingId),
          source: "WEBBEDS"
        },
        automatic_payment_methods: { enabled: true },
      })
    })
    console.info(`${logPrefix} payment intent created`, { paymentIntentId: paymentIntent.id })

    // 3. Update Local Booking with Payment Intent ID
    await localBooking.update({
      payment_intent_id: paymentIntent.id,
      payment_provider: "STRIPE"
    })
    console.info(`${logPrefix} local booking updated`, { paymentIntentId: paymentIntent.id })

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      localBookingId: localBooking.id,
      bookingRef: booking_ref
    })

  } catch (error) {
    console.error("[webbeds] createPaymentIntent error", error)
    next(error)
  }
}


export const listStaticHotels = async (req, res, next) => {
  try {
    const {
      cityCode,
      countryCode,
      q,
      limit = 20,
      offset = 0,
      preferred,
      hotelId,
      hotelIds,
    } = req.query

    const where = {}
    const hotelIdList = parseCsvList(hotelIds)
    if (hotelIdList.length) {
      where.hotel_id = { [Op.in]: hotelIdList }
    } else if (hotelId) {
      where.hotel_id = String(hotelId).trim()
    }
    if (cityCode) {
      where.city_code = String(cityCode).trim()
    }
    if (countryCode) {
      where.country_code = String(countryCode).trim()
    }
    if (q) {
      where.name = { [Op.iLike]: `%${q.trim()}%` }
    }
    if (preferred === "true") {
      where.preferred = true
    }

    const limitBase = Number(limit) || (hotelIdList.length ? hotelIdList.length : 20)
    const safeLimit = Math.min(100, Math.max(1, limitBase))
    const safeOffset = Math.max(0, Number(offset) || 0)

    const { rows, count } = await models.WebbedsHotel.findAndCountAll({
      where,
      attributes: [
        "hotel_id",
        "name",
        "city_name",
        "city_code",
        "country_name",
        "country_code",
        "address",
        "full_address",
        "lat",
        "lng",
        "rating",
        "priority",
        "preferred",
        "exclusive",
        "chain",
        "chain_code",
        "classification_code",
        "images",
        "amenities",
        "leisure",
        "business",
        "descriptions",
        "room_static",
      ],
      include: [
        {
          model: models.WebbedsHotelChain,
          as: "chainCatalog",
          attributes: ["code", "name"],
        },
        {
          model: models.WebbedsHotelClassification,
          as: "classification",
          attributes: ["code", "name"],
        },
      ],
      order: [
        ["priority", "DESC"],
        ["name", "ASC"],
      ],
      limit: safeLimit,
      offset: safeOffset,
    })

    return res.json({
      items: rows.map(formatStaticHotel),
      pagination: {
        total: count,
        limit: safeLimit,
        offset: safeOffset,
      },
    })
  } catch (error) {
    return next(error)
  }
}

export const listCountries = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsCountry.findAll({
      attributes: ["code", "name"],
      order: [["name", "ASC"]],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

export const listCities = async (req, res, next) => {
  try {
    const {
      q,
      countryCode,
      limit = 20,
      offset = 0,
    } = req.query

    const where = {}
    if (countryCode) {
      where.country_code = String(countryCode).trim()
    }
    if (q) {
      where.name = { [Op.iLike]: `%${q.trim()}%` }
    }

    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20))
    const safeOffset = Math.max(0, Number(offset) || 0)

    const { rows, count } = await models.WebbedsCity.findAndCountAll({
      where,
      attributes: [
        "code",
        "name",
        "country_code",
        "country_name",
        "state_name",
        "state_code",
        "region_name",
        "region_code",
      ],
      order: [
        ["country_name", "ASC"],
        ["name", "ASC"],
      ],
      limit: safeLimit,
      offset: safeOffset,
    })

    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      countryCode: row.country_code != null ? String(row.country_code) : null,
      countryName: row.country_name,
      stateName: row.state_name,
      stateCode: row.state_code,
      regionName: row.region_name,
      regionCode: row.region_code,
    }))

    return res.json({
      items,
      pagination: {
        total: count,
        limit: safeLimit,
        offset: safeOffset,
      },
    })
  } catch (error) {
    return next(error)
  }
}

export const listRateBasis = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsRateBasis.findAll({
      attributes: ["code", "name", "runno"],
      order: [
        ["name", "ASC"],
        ["code", "ASC"],
      ],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      runno: row.runno ?? null,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

export const listHotelAmenities = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsAmenityCatalog.findAll({
      where: { type: "hotel" },
      attributes: ["code", "name", "runno"],
      order: [
        ["name", "ASC"],
        ["code", "ASC"],
      ],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      runno: row.runno ?? null,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

export const listRoomAmenities = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsRoomAmenityCatalog.findAll({
      attributes: ["code", "name", "runno"],
      order: [
        ["name", "ASC"],
        ["code", "ASC"],
      ],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      runno: row.runno ?? null,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

export const listHotelChains = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsHotelChain.findAll({
      attributes: ["code", "name", "runno"],
      order: [
        ["name", "ASC"],
        ["code", "ASC"],
      ],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      runno: row.runno ?? null,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}

export const listHotelClassifications = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsHotelClassification.findAll({
      attributes: ["code", "name", "runno"],
      order: [
        ["name", "ASC"],
        ["code", "ASC"],
      ],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
      runno: row.runno ?? null,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}
