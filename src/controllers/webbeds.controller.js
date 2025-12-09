import { Op } from "sequelize"
import models from "../models/index.js"
import { WebbedsProvider } from "../providers/webbeds/provider.js"
import { formatStaticHotel } from "../utils/webbedsMapper.js"

const provider = new WebbedsProvider()

export const search = (req, res, next) => provider.search(req, res, next)
export const getRooms = (req, res, next) => provider.getRooms(req, res, next)
export const saveBooking = (req, res, next) => provider.saveBooking(req, res, next)
export const confirmBooking = (req, res, next) => provider.confirmBooking(req, res, next)
export const cancelBooking = (req, res, next) => provider.cancelBooking(req, res, next)
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
    } = req.body

    // 1. Create Local Booking Record (PENDING)
    // We store the Webbeds ID as external_ref
    // and "WEBBEDS" as source
    const booking_ref = `WB-${Date.now().toString(36).toUpperCase()}`

    // Convert amounts
    const amountNumber = Number(amount)
    if (!Number.isFinite(amountNumber)) throw new Error("Invalid amount")

    const localBooking = await models.Booking.create({
      booking_ref,
      user_id: req.user?.id || null,
      source: "WEBBEDS",
      inventory_type: "WEBBEDS",
      external_ref: bookingId, // The Webbeds Booking ID

      check_in: checkIn,
      check_out: checkOut,

      guest_name: holder?.firstName ? `${holder.firstName} ${holder.lastName}` : "Guest",
      guest_email: holder?.email,

      status: "PENDING",
      payment_status: "UNPAID",
      gross_price: amountNumber,
      currency: currency,

      meta: {
        hotelId,
        roomName,
        guests
      }
    })

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

    // 3. Update Local Booking with Payment Intent ID
    await localBooking.update({
      payment_intent_id: paymentIntent.id,
      payment_provider: "STRIPE"
    })

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
    const { cityCode, countryCode, q, limit = 20, offset = 0, preferred, hotelId } = req.query

    const where = {}
    if (hotelId) {
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

    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20))
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
