/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   src/controllers/booking.controller.js   Â·   COMPLETO
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

import { Op } from "sequelize"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { sendMail } from "../helpers/mailer.js"
import models, { sequelize } from "../models/index.js"
import { streamCertificatePDF } from "../helpers/bookingCertificate.js"
import { sendCancellationEmail } from "../emailTemplates/cancel-email.js"
import { PROMPT_TRIGGERS, triggerBookingAutoPrompts } from "../services/chat.service.js"
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Helper â€“ count nights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const diffDays = (from, to) =>
  Math.ceil((new Date(to) - new Date(from)) / 86_400_000)

const enumerateStayDates = (from, to) => {
  const start = new Date(from)
  const end = new Date(to)
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return []
  const dates = []
  const cursor = new Date(start)
  cursor.setUTCHours(0, 0, 0, 0)
  const limit = new Date(end)
  limit.setUTCHours(0, 0, 0, 0)
  while (cursor < limit) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

// OTP + token helpers (stateless challenge)
const codeHash = (email, code) =>
  crypto
    .createHash("sha256")
    .update(`${String(email).trim().toLowerCase()}|${String(code)}|${process.env.JWT_SECRET || "secret"}`)
    .digest("hex")

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Helper â€“ flattener â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Recibe una fila de Booking (snake_case en DB) y la
   convierte al formato camelCase que usa el FE.       */
const toPlain = (value) => {
  if (!value) return null
  if (typeof value.toJSON === "function") {
    try {
      return value.toJSON()
    } catch {
      return value
    }
  }
  return value
}

const pickCoverImage = (media) => {
  if (!Array.isArray(media) || !media.length) return null
  const normalized = media.map(toPlain)
  const cover =
    normalized.find((item) => item?.is_cover) ??
    normalized.find((item) => Number(item?.order) === 0) ??
    normalized[0]
  return cover?.url ?? null
}

const buildHomePayload = (homeStay) => {
  const stayHome = toPlain(homeStay)
  if (!stayHome) return null
  const home = toPlain(stayHome.home ?? stayHome.Home ?? stayHome)
  if (!home) return null

  const address = toPlain(home.address) ?? {}
  const media = Array.isArray(home.media) ? home.media.map(toPlain) : []
  const pricing = toPlain(home.pricing) ?? {}

  const locationParts = [
    address.address_line1,
    address.city,
    address.state,
    address.country,
  ]
    .map((part) => (part ? String(part).trim() : null))
    .filter(Boolean)

  return {
    id: home.id,
    title: home.title ?? null,
    status: home.status ?? null,
    hostId: stayHome.host_id ?? home.host_id ?? null,
    maxGuests: home.max_guests ?? null,
    bedrooms: home.bedrooms ?? null,
    beds: home.beds ?? null,
    bathrooms: home.bathrooms != null ? Number(home.bathrooms) : null,
    propertyType: home.property_type ?? null,
    spaceType: home.space_type ?? null,
    address,
    locationText: locationParts.join(", "),
    coverImage: pickCoverImage(media),
    media,
    pricing: {
      currency: pricing.currency ?? null,
      basePrice:
        pricing.base_price != null ? Number.parseFloat(pricing.base_price) : null,
      weekendPrice:
        pricing.weekend_price != null
          ? Number.parseFloat(pricing.weekend_price)
          : null,
      cleaningFee:
        pricing.cleaning_fee != null
          ? Number.parseFloat(pricing.cleaning_fee)
          : null,
      securityDeposit:
        pricing.security_deposit != null
          ? Number.parseFloat(pricing.security_deposit)
          : null,
      taxRate:
        pricing.tax_rate != null ? Number.parseFloat(pricing.tax_rate) : null,
      extraGuestFee:
        pricing.extra_guest_fee != null
          ? Number.parseFloat(pricing.extra_guest_fee)
          : null,
      extraGuestThreshold:
        pricing.extra_guest_threshold != null
          ? Number(pricing.extra_guest_threshold)
          : null,
    },
  }
}

const mapStay = (row, source) => {
  const stayHotel = toPlain(row.hotelStay ?? row.StayHotel ?? row.stayHotel) ?? null
  const hotelFromStay = toPlain(stayHotel?.hotel) ?? null
  const roomFromStay = toPlain(stayHotel?.room) ?? toPlain(stayHotel?.room_snapshot) ?? null
  const hotel = toPlain(row.Hotel ?? row.hotel ?? hotelFromStay) ?? null
  const room = toPlain(row.Room ?? row.room ?? roomFromStay) ?? null
  const tgxMeta = toPlain(row.tgxMeta) ?? null
  const stayHome = toPlain(row.homeStay ?? row.StayHome ?? row.stayHome) ?? null
  const homePayload = stayHome ? buildHomePayload(stayHome) : null

  let mergedHotel = hotel
  let mergedRoom = room
  if (source === "tgx" && tgxMeta) {
    const tgxHotel = tgxMeta?.hotel ?? {}
    const tgxRoom = tgxMeta?.rooms?.[0] ?? {}
    mergedHotel = { ...mergedHotel, ...tgxHotel }
    mergedRoom = { ...mergedRoom, ...tgxRoom }
  }

  const checkIn = row.check_in ?? row.checkIn ?? null
  const checkOut = row.check_out ?? row.checkOut ?? null
  const status = String(row.status ?? "").toLowerCase()
  const paymentStatus = String(row.payment_status ?? row.paymentStatus ?? "").toLowerCase()
  const nights = checkIn && checkOut ? diffDays(checkIn, checkOut) : null
  const inventoryType = row.inventory_type ?? row.inventoryType ?? (homePayload ? "HOME" : null)
  const isHomeStay =
    inventoryType === "HOME" ||
    row.source === "HOME" ||
    row.Source === "HOME" ||
    Boolean(homePayload)

  const location = isHomeStay
    ? homePayload?.locationText ?? null
    : mergedHotel
      ? `${mergedHotel?.city || mergedHotel?.location || ""}, ${mergedHotel?.country || ""}`.trim().replace(/, $/, "")
      : null

  const image = isHomeStay ? homePayload?.coverImage ?? null : mergedHotel?.image ?? null
  const listingName = isHomeStay ? homePayload?.title ?? null : mergedHotel?.name ?? null

  return {
    id: row.id,
    source,
    bookingConfirmation: row.bookingConfirmation ?? row.external_ref ?? null,

    hotel_id: isHomeStay ? null : row.hotel_id ?? mergedHotel?.id ?? null,
    hotel_name: listingName,
    location,
    image,
    rating: isHomeStay ? null : mergedHotel?.rating ?? null,

    checkIn,
    checkOut,
    nights,

    status,
    paymentStatus,

    room_type: isHomeStay
      ? homePayload?.spaceType ?? "HOME"
      : row.room_type ?? mergedRoom?.name ?? mergedRoom?.room_type ?? null,
    room_number: isHomeStay
      ? null
      : row.room_number ?? mergedRoom?.room_number ?? mergedRoom?.roomNumber ?? null,

    guests: (row.adults ?? 0) + (row.children ?? 0),
    total: Number.parseFloat(row.gross_price ?? row.total ?? 0),

    guestName: row.guest_name ?? row.guestName ?? null,
    guestLastName: row.guest_last_name ?? row.guestLastName ?? null,
    guestEmail: row.guest_email ?? row.guestEmail ?? null,
    guestPhone: row.guest_phone ?? row.guestPhone ?? null,

    hotel: isHomeStay ? null : mergedHotel,
    room: isHomeStay ? null : mergedRoom,
    home: homePayload,
    inventoryType,

    outside: Boolean(row.outside),
    active: row.active ?? true,
  }
}


const STAY_BASE_INCLUDE = [
  {
    model: models.StayHotel,
    as: "hotelStay",
    required: false,
    include: [
      {
        model: models.Hotel,
        as: "hotel",
        attributes: ["id", "name", "city", "country", "image", "rating"],
      },
      {
        model: models.Room,
        as: "room",
        attributes: ["id", "name", "room_number", "image", "price", "beds", "capacity"],
      },
    ],
  },
  {
    model: models.TGXMeta,
    as: "tgxMeta",
    required: false,
  },
  {
    model: models.OutsideMeta,
    as: "outsideMeta",
    required: false,
  },
  {
    model: models.StayHome,
    as: "homeStay",
    required: false,
    include: [
      {
        model: models.Home,
        as: "home",
        attributes: [
          "id",
          "title",
          "status",
          "max_guests",
          "bedrooms",
          "beds",
          "bathrooms",
          "property_type",
          "space_type",
          "host_id",
        ],
        include: [
          {
            model: models.HomeAddress,
            as: "address",
            attributes: ["address_line1", "city", "state", "country"],
          },
          {
            model: models.HomeMedia,
            as: "media",
            attributes: ["id", "url", "is_cover", "order"],
            separate: true,
            limit: 6,
            order: [
              ["is_cover", "DESC"],
              ["order", "ASC"],
              ["id", "ASC"],
            ],
          },
          {
            model: models.HomePricing,
            as: "pricing",
            attributes: [
              "currency",
              "base_price",
              "weekend_price",
              "cleaning_fee",
              "security_deposit",
              "tax_rate",
              "extra_guest_fee",
              "extra_guest_threshold",
            ],
          },
        ],
      },
    ],
  },
]


/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   POST  /api/bookings
   (flujo legacy "insider/outside"; no TGX)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const createBooking = async (req, res) => {
  try {
    const userId = Number(req.user?.id ?? 0)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    const referral = {
      influencerId: Number(req.user?.referredByInfluencerId) || null,
      code: req.user?.referredByCode || null,
    }

    const {
      hotelId,
      hotel_id,
      roomId,
      room_id,
      checkIn,
      checkOut,
      adults = 1,
      children = 0,
      rooms = 1,
      guestName,
      guestEmail,
      guestPhone,
      discountCode,
      outside = false,
      currency: currencyInput,
      paymentProvider,
      meta: metaPayload = {},
    } = req.body || {}

    const hotelIdValue = Number(hotel_id ?? hotelId ?? 0) || null
    const roomIdValue = Number(room_id ?? roomId ?? 0) || null

    if (!hotelIdValue || !roomIdValue || !checkIn || !checkOut)
      return res.status(400).json({ error: "Missing required fields" })

    const normalizedRooms = Number(rooms ?? 1) || 1
    if (normalizedRooms < 1)
      return res.status(400).json({ error: "Rooms must be at least 1" })

    const adultsCount = Number(adults ?? 0) || 0
    const childrenCount = Number(children ?? 0) || 0
    const totalGuests = adultsCount + childrenCount
    if (totalGuests <= 0)
      return res.status(400).json({ error: "A booking must include at least one guest" })

    const checkInDate = new Date(checkIn)
    const checkOutDate = new Date(checkOut)
    if (Number.isNaN(checkInDate.valueOf()) || Number.isNaN(checkOutDate.valueOf()))
      return res.status(400).json({ error: "Invalid dates" })
    if (checkOutDate <= checkInDate)
      return res.status(400).json({ error: "Check-out must be after check-in" })

    const normalizedCheckIn = checkInDate.toISOString().slice(0, 10)
    const normalizedCheckOut = checkOutDate.toISOString().slice(0, 10)

    const nights = diffDays(normalizedCheckIn, normalizedCheckOut)
    if (nights <= 0)
      return res.status(400).json({ error: "Stay must be at least one night" })

    const room = await models.Room.findByPk(roomIdValue, {
      include: [
        {
          model: models.Hotel,
          attributes: ["id", "name", "city", "country", "image", "rating", "currency"],
        },
      ],
    })
    if (!room || room.hotel_id !== hotelIdValue)
      return res.status(404).json({ error: "Room not found" })

    const hotel = room.Hotel ?? null
    const nightlyRate = Number.parseFloat(room.price)
    if (!Number.isFinite(nightlyRate))
      return res.status(400).json({ error: "Room price is invalid" })

    const totalBeforeDiscount = nightlyRate * nights * normalizedRooms

    let discountRecord = null
    let discountPct = 0
    if (discountCode) {
      discountRecord = await models.DiscountCode.findOne({
        where: { code: discountCode },
        include: ["staff"],
      })
      if (!discountRecord)
        return res.status(404).json({ error: "Invalid discount code" })

      const startsAt = discountRecord.starts_at ?? discountRecord.startsAt
      const endsAt = discountRecord.ends_at ?? discountRecord.endsAt
      const maxUses = discountRecord.max_uses ?? discountRecord.maxUses
      const timesUsed = discountRecord.times_used ?? discountRecord.timesUsed ?? 0
      if (startsAt && new Date(startsAt) > new Date(checkIn))
        return res.status(400).json({ error: "Discount code not active yet" })
      if (endsAt && new Date(endsAt) < new Date())
        return res.status(400).json({ error: "Discount code expired" })
      if (Number.isFinite(maxUses) && Number.isFinite(timesUsed) && timesUsed >= maxUses)
        return res.status(400).json({ error: "Discount code usage limit reached" })

      discountPct = Number(discountRecord.percentage) || 0
    }

    const discountAmount = discountPct ? (totalBeforeDiscount * discountPct) / 100 : 0
    const grossTotal = Number.parseFloat((totalBeforeDiscount - discountAmount).toFixed(2))

    const user = req.user || {}
    const guestNameFinal = (guestName ?? user.name ?? "").trim()
    const guestEmailFinal = (guestEmail ?? user.email ?? "").trim().toLowerCase()
    if (!guestNameFinal || !guestEmailFinal)
      return res.status(400).json({ error: "Guest name and email are required" })
    const guestPhoneFinal = (guestPhone ?? user.phone ?? "").trim() || null

    const currencyCode = String(
      currencyInput ?? hotel?.currency ?? process.env.DEFAULT_CURRENCY ?? "USD"
    )
      .trim()
      .toUpperCase()

    const paymentProviderValue = String(paymentProvider ?? "NONE").trim().toUpperCase()
    const source = outside ? "OUTSIDE" : "PARTNER"

    const booking = await sequelize.transaction(async (tx) => {
      if (discountRecord) {
        await discountRecord.increment("times_used", { by: 1, transaction: tx })
      }

      const stay = await models.Booking.create(
        {
          user_id: userId,
          hotel_id: hotelIdValue,
          room_id: roomIdValue,
          discount_code_id: discountRecord ? discountRecord.id : null,
          source,
          check_in: normalizedCheckIn,
          check_out: normalizedCheckOut,
          nights,
          adults: adultsCount,
          children: childrenCount,
          influencer_user_id: referral.influencerId,
          guest_name: guestNameFinal,
          guest_email: guestEmailFinal,
          guest_phone: guestPhoneFinal,
          gross_price: grossTotal,
          net_cost: null,
          currency: currencyCode,
          payment_provider: paymentProviderValue,
          payment_status: "UNPAID",
          status: "PENDING",
          outside,
          active: true,
          inventory_type: "LOCAL_HOTEL",
          inventory_id: String(roomIdValue),
          booked_at: new Date(),
          pricing_snapshot: {
            nightlyRate,
            rooms: normalizedRooms,
            nights,
            discountPct,
            discountAmount: Number.parseFloat(discountAmount.toFixed(2)),
            totalBeforeDiscount: Number.parseFloat(totalBeforeDiscount.toFixed(2)),
            total: grossTotal,
          },
          guest_snapshot: {
            name: guestNameFinal,
            email: guestEmailFinal,
            phone: guestPhoneFinal,
            adults: adultsCount,
            children: childrenCount,
          },
          meta: {
            ...(typeof metaPayload === "object" && metaPayload ? metaPayload : {}),
            ...(referral.influencerId
              ? {
                referral: {
                  influencerUserId: referral.influencerId,
                  code: referral.code || null,
                },
              }
              : {}),
            source,
            hotel: hotel
              ? { id: hotel.id, name: hotel.name, city: hotel.city, country: hotel.country }
              : { id: hotelIdValue },
            roomsRequested: normalizedRooms,
          },
        },
        { transaction: tx, returning: ["id", "booking_ref"] }
      )

      await models.StayHotel.create(
        {
          stay_id: stay.id,
          hotel_id: hotelIdValue,
          room_id: roomIdValue,
          room_name: room.name ?? null,
          room_snapshot: {
            id: room.id,
            name: room.name,
            price: nightlyRate,
            beds: room.beds,
            capacity: room.capacity,
          },
        },
        { transaction: tx }
      )

      if (discountRecord?.staff_id && models.Staff && models.Commission) {
        const staff = await models.Staff.findByPk(discountRecord.staff_id, {
          include: [{ model: models.StaffRole, as: "role" }],
          transaction: tx,
        })
        const commissionPct = Number(staff?.role?.commissionPct) || 0
        if (commissionPct > 0) {
          const commissionAmount = Number.parseFloat(((grossTotal * commissionPct) / 100).toFixed(2))
          await models.Commission.create(
            {
              booking_id: stay.id,
              staff_id: discountRecord.staff_id,
              amount: commissionAmount,
            },
            { transaction: tx }
          )
        }
      }

      if (discountRecord) {
        await discountRecord.update({ booking_id: stay.id }, { transaction: tx })
      }

      return stay
    })

    const fresh = await models.Booking.findByPk(booking.id, {
      include: STAY_BASE_INCLUDE,
    })

    return res.status(201).json(mapStay(fresh.toJSON(), outside ? "outside" : "insider"))
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}


export const createHomeBooking = async (req, res) => {
  try {
    const userId = Number(req.user?.id ?? 0)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    const referral = {
      influencerId: Number(req.user?.referredByInfluencerId) || null,
      code: req.user?.referredByCode || null,
    }
    console.log("[HOME BOOKING] createHomeBooking payload", {
      userId,
      referral,
      body: {
        homeId: req.body?.homeId,
        checkIn: req.body?.checkIn,
        checkOut: req.body?.checkOut,
        adults: req.body?.adults,
        children: req.body?.children,
        infants: req.body?.infants,
        hasReferralCode: Boolean(req.body?.referralCode || req.body?.referrerCode),
      },
    })

    const {
      homeId,
      checkIn,
      checkOut,
      adults = 1,
      children = 0,
      infants = 0,
      guestName,
      guestEmail,
      guestPhone,
      meta: metaPayload = {},
    } = req.body || {}

    const homeIdValue = Number(homeId ?? 0) || null
    if (!homeIdValue || !checkIn || !checkOut)
      return res.status(400).json({ error: "Missing required fields" })

    const checkInDate = new Date(checkIn)
    const checkOutDate = new Date(checkOut)
    if (Number.isNaN(checkInDate.valueOf()) || Number.isNaN(checkOutDate.valueOf()))
      return res.status(400).json({ error: "Invalid dates" })
    if (checkOutDate <= checkInDate)
      return res.status(400).json({ error: "Check-out must be after check-in" })

    checkInDate.setHours(0, 0, 0, 0)
    checkOutDate.setHours(0, 0, 0, 0)

    const normalizedCheckIn = checkInDate.toISOString().slice(0, 10)
    const normalizedCheckOut = checkOutDate.toISOString().slice(0, 10)

    const nights = diffDays(normalizedCheckIn, normalizedCheckOut)
    if (nights <= 0)
      return res.status(400).json({ error: "Stay must be at least one night" })

    const adultsCount = Number(adults ?? 0) || 0
    const childrenCount = Number(children ?? 0) || 0
    const infantsCount = Number(infants ?? 0) || 0
    const totalGuests = adultsCount + childrenCount
    if (totalGuests <= 0)
      return res.status(400).json({ error: "A booking must include at least one guest" })

    const home = await models.Home.findOne({
      where: { id: homeIdValue, status: "PUBLISHED" },
      include: [
        { model: models.HomePricing, as: "pricing" },
        { model: models.HomeAddress, as: "address" },
        {
          model: models.HomeMedia,
          as: "media",
          attributes: ["id", "url", "is_cover", "order"],
          separate: true,
          limit: 20,
          order: [
            ["is_cover", "DESC"],
            ["order", "ASC"],
            ["id", "ASC"],
          ],
        },
      ],
    })
    if (!home) return res.status(404).json({ error: "Listing not found or unavailable" })

    const capacity = Number(home.max_guests ?? 0) || null
    if (capacity && totalGuests > capacity)
      return res.status(400).json({ error: "Guest count exceeds listing capacity" })

    const pricing = home.pricing ?? {}
    const minStay = Number(pricing.minimum_stay ?? 0) || 1
    const maxStay = Number(pricing.maximum_stay ?? 0) || null
    if (nights < minStay)
      return res.status(400).json({ error: `Minimum stay is ${minStay} nights` })
    if (maxStay && nights > maxStay)
      return res.status(400).json({ error: `Maximum stay is ${maxStay} nights` })

    const basePrice = Number.parseFloat(pricing.base_price ?? 0) * 1.1
    if (!Number.isFinite(basePrice) || basePrice <= 0)
      return res.status(400).json({ error: "Listing does not have a valid base price" })
    const weekendPrice =
      pricing.weekend_price != null ? Number.parseFloat(pricing.weekend_price) * 1.1 : null
    const cleaningFeeValue =
      pricing.cleaning_fee != null ? Number.parseFloat(pricing.cleaning_fee) : 0
    const securityDeposit =
      pricing.security_deposit != null ? Number.parseFloat(pricing.security_deposit) : 0
    const extraGuestFee =
      pricing.extra_guest_fee != null ? Number.parseFloat(pricing.extra_guest_fee) : 0
    const extraGuestThreshold =
      pricing.extra_guest_threshold != null
        ? Number(pricing.extra_guest_threshold)
        : capacity
    const taxRate =
      (pricing.tax_rate != null && Number(pricing.tax_rate) > 0) ? Number.parseFloat(pricing.tax_rate) : 8

    const calendarEntries = await models.HomeCalendar.findAll({
      where: {
        home_id: homeIdValue,
        date: { [Op.gte]: normalizedCheckIn, [Op.lt]: normalizedCheckOut },
      },
    })
    const blockedEntry = calendarEntries.find(
      (entry) => entry.status && entry.status.toUpperCase() !== "AVAILABLE"
    )
    if (blockedEntry)
      return res.status(409).json({ error: "Selected dates are not available" })

    const existingCalendarMap = new Map(calendarEntries.map((entry) => [entry.date, entry]))
    const stayDates = enumerateStayDates(normalizedCheckIn, normalizedCheckOut)

    const overlappingStay = await models.Stay.findOne({
      where: {
        inventory_type: "HOME",
        status: { [Op.in]: ["PENDING", "CONFIRMED"] },
        check_in: { [Op.lt]: normalizedCheckOut },
        check_out: { [Op.gt]: normalizedCheckIn },
      },
      include: [
        { model: models.StayHome, as: "homeStay", required: true, where: { home_id: homeIdValue } },
      ],
    })
    if (overlappingStay)
      return res.status(409).json({ error: "Selected dates already reserved" })

    const nightlyBreakdown = []
    let cursor = new Date(checkInDate)
    const endDate = new Date(checkOutDate)
    let baseSubtotal = 0
    while (cursor < endDate) {
      const day = cursor.getUTCDay()
      const isWeekend = day === 5 || day === 6
      const nightlyRate = isWeekend && Number.isFinite(weekendPrice) ? weekendPrice : basePrice
      const rateValue = Number.parseFloat(nightlyRate.toFixed(2))
      nightlyBreakdown.push({
        date: cursor.toISOString().slice(0, 10),
        rate: rateValue,
        weekend: isWeekend,
      })
      baseSubtotal += rateValue
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }

    let extraGuestSubtotal = 0
    if (extraGuestFee > 0 && extraGuestThreshold != null && totalGuests > extraGuestThreshold) {
      const extraGuests = totalGuests - extraGuestThreshold
      extraGuestSubtotal = extraGuests * extraGuestFee * nights
    }
    const cleaningFeeTotal = Number.parseFloat(cleaningFeeValue.toFixed(2))
    const subtotalBeforeTax = baseSubtotal + extraGuestSubtotal + cleaningFeeTotal
    const taxAmount = taxRate > 0 ? Number.parseFloat(((subtotalBeforeTax * taxRate) / 100).toFixed(2)) : 0
    const totalAmount = Number.parseFloat((subtotalBeforeTax + taxAmount).toFixed(2))

    const user = req.user || {}
    const guestNameFinal = (guestName ?? user.name ?? "").trim()
    const guestEmailFinal = (guestEmail ?? user.email ?? "").trim().toLowerCase()
    if (!guestNameFinal || !guestEmailFinal)
      return res.status(400).json({ error: "Guest name and email are required" })
    const guestPhoneFinal = (guestPhone ?? user.phone ?? "").trim() || null

    const currencyCode = String(
      pricing.currency ?? process.env.DEFAULT_CURRENCY ?? "USD"
    )
      .trim()
      .toUpperCase()

    const stay = await sequelize.transaction(async (tx) => {
      const created = await models.Booking.create(
        {
          user_id: userId,
          source: "HOME",
          inventory_type: "HOME",
          inventory_id: String(homeIdValue),
          check_in: normalizedCheckIn,
          check_out: normalizedCheckOut,
          nights,
          adults: adultsCount,
          children: childrenCount,
          influencer_user_id: referral.influencerId,
          guest_name: guestNameFinal,
          guest_email: guestEmailFinal,
          guest_phone: guestPhoneFinal,
          gross_price: totalAmount,
          net_cost: null,
          currency: currencyCode,
          payment_provider: "NONE",
          payment_status: "UNPAID",
          status: "PENDING",
          outside: false,
          active: true,
          booked_at: new Date(),
          pricing_snapshot: {
            nightlyBreakdown,
            baseSubtotal: Number.parseFloat(baseSubtotal.toFixed(2)),
            extraGuestSubtotal: Number.parseFloat(extraGuestSubtotal.toFixed(2)),
            cleaningFee: cleaningFeeTotal,
            taxRate,
            taxAmount,
            securityDeposit,
            subtotalBeforeTax: Number.parseFloat(subtotalBeforeTax.toFixed(2)),
            total: totalAmount,
            currency: currencyCode,
          },
          guest_snapshot: {
            name: guestNameFinal,
            email: guestEmailFinal,
            phone: guestPhoneFinal,
            adults: adultsCount,
            children: childrenCount,
            infants: infantsCount,
          },
          meta: {
            ...(typeof metaPayload === "object" && metaPayload ? metaPayload : {}),
            ...(referral.influencerId
              ? {
                referral: {
                  influencerUserId: referral.influencerId,
                  code: referral.code || null,
                },
              }
              : {}),
            source: "HOME",
            home: { id: home.id, title: home.title, hostId: home.host_id },
          },
        },
        {
          transaction: tx,
          returning: ["id", "booking_ref"],
          fields: [
            "user_id",
            "source",
            "inventory_type",
            "inventory_id",
            "check_in",
            "check_out",
            "nights",
            "adults",
            "children",
            "influencer_user_id",
            "guest_name",
            "guest_email",
            "guest_phone",
            "gross_price",
            "net_cost",
            "currency",
            "payment_provider",
            "payment_status",
            "status",
            "outside",
            "active",
            "booked_at",
            "pricing_snapshot",
            "guest_snapshot",
            "meta",
          ],
        }
      )

      await models.StayHome.create(
        {
          stay_id: created.id,
          home_id: home.id,
          host_id: home.host_id,
          cleaning_fee: cleaningFeeTotal || null,
          security_deposit: securityDeposit || null,
          fees_snapshot: {
            extraGuestFee: extraGuestFee || null,
            extraGuestThreshold,
            weekendPrice: weekendPrice != null ? Number.parseFloat(weekendPrice.toFixed(2)) : null,
          },
        },
        { transaction: tx }
      )

      console.log("[HOME BOOKING] created stay", {
        id: created.id,
        status: created.status,
        payment_status: created.payment_status,
        influencer_user_id: created.influencer_user_id,
        gross_price: created.gross_price,
        currency: created.currency,
      })

      for (const date of stayDates) {
        const existingEntry = existingCalendarMap.get(date)
        if (existingEntry) {
          await existingEntry.update(
            {
              status: "RESERVED",
              source: "PLATFORM",
            },
            { transaction: tx }
          )
        } else {
          await models.HomeCalendar.create(
            {
              home_id: homeIdValue,
              date,
              status: "RESERVED",
              currency: currencyCode,
              source: "PLATFORM",
              note: `BOOKING:${created.id}`,
            },
            { transaction: tx }
          )
        }
      }

      return created
    })

    const fresh = await models.Booking.findByPk(stay.id, {
      include: STAY_BASE_INCLUDE,
    })

    const bookingView = mapStay(fresh.toJSON(), "home")

    const coverImageUrl = pickCoverImage(home.media ?? [])
    triggerBookingAutoPrompts({
      trigger: PROMPT_TRIGGERS.BOOKING_CREATED,
      guestUserId: userId,
      hostUserId: home.host_id,
      homeId: home.id,
      reserveId: bookingView.id,
      checkIn: normalizedCheckIn,
      checkOut: normalizedCheckOut,
      homeSnapshotName: home.title,
      homeSnapshotImage: coverImageUrl,
    }).catch((err) => console.error("booking auto prompt dispatch error:", err))

    return res.status(201).json({
      booking: bookingView,
      payment: {
        required: true,
        provider: "stripe",
        amount: totalAmount,
        currency: currencyCode,
      },
    })
  } catch (err) {
    console.error("createHomeBooking:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const getBookingsUnified = async (req, res) => {
  try {
    const { latest, status, limit = 50, offset = 0 } = req.query
    const inventoryQuery = typeof req.query.inventory === "string"
      ? req.query.inventory.trim().toUpperCase()
      : null

    const userId = req.user.id

    // 1. Buscar usuario
    const user = await models.User.findByPk(userId)
    if (!user) return res.status(404).json({ error: "User not found" })
    const email = user.email

    // 2. Traer bookings preferentemente por user_id; como transiciÃ³n,
    //    incluir tambiÃ©n huÃ©rfanas donde guest_email coincide y user_id es NULL
    const inventoryFilter =
      inventoryQuery === "HOME"
        ? { inventory_type: "HOME" }
        : inventoryQuery === "HOTEL"
          ? { inventory_type: { [Op.ne]: "HOME" } }
          : {}

    const rows = await models.Booking.findAll({
      where: {
        ...(status && { status }),
        ...inventoryFilter,
        [Op.or]: [
          { user_id: userId },
          { user_id: null, guest_email: email },
        ],
      },
      include: STAY_BASE_INCLUDE,
      order: [["check_in", "DESC"]],
      limit: latest ? 1 : Number(limit),
      offset: latest ? 0 : Number(offset)
    })

    // 3. Mapear y unificar
    const merged = rows
      .map(r => {
        const obj = r.toJSON()
        const channel =
          obj.inventory_type === "HOME" || obj.source === "HOME"
            ? "home"
            : obj.source === "TGX"
              ? "tgx"
              : obj.source === "OUTSIDE"
                ? "outside"
                : obj.source === "VAULT"
                  ? "vault"
                  : "insider"
        return mapStay(obj, channel)
      })
      .sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn))

    // 4. Devolver
    return res.json(latest ? merged[0] ?? null : merged)
  } catch (err) {
    console.error("getBookingsUnified:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const getLatestStayForUser = (req, res) => {
  req.query.latest = "true"
  return getBookingsUnified(req, res)
}

export const getHomeBookingsForUser = (req, res) => {
  req.query.inventory = "home"
  return getBookingsUnified(req, res)
}

/* ---------------------------------------------------------------
   GET  /api/bookings/lookup?email=...&ref=...
   PÃºblico: permite recuperar UNA reserva si coincide el email del
   huÃ©sped y una referencia segura (id/booking_ref/external_ref).
   Evita listados amplios por email en claro.
---------------------------------------------------------------- */
export const lookupBookingPublic = async (req, res) => {
  try {
    const { email, ref } = req.query
    if (!email || !ref)
      return res.status(400).json({ error: "Missing email or ref" })

    // Construir OR por referencia
    const isNumeric = /^\d+$/.test(String(ref))
    const whereRef = {
      [Op.or]: [
        ...(isNumeric ? [{ id: Number(ref) }] : []),
        { booking_ref: ref },
        { external_ref: ref },
      ],
    }

    const row = await models.Booking.findOne({
      where: { guest_email: email, ...whereRef },
      include: STAY_BASE_INCLUDE,
    })

    if (!row) return res.status(404).json({ error: "Booking not found" })

    const obj = row.toJSON()
    const channel =
      obj.inventory_type === "HOME" || obj.source === "HOME"
        ? "home"
        : obj.source === "TGX"
          ? "tgx"
          : obj.source === "OUTSIDE"
            ? "outside"
            : obj.source === "VAULT"
              ? "vault"
              : "insider"
    return res.json(mapStay(obj, channel))
  } catch (err) {
    console.error("lookupBookingPublic:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   POST /api/bookings/guest/start { email }
   EnvÃ­a un cÃ³digo de 6 dÃ­gitos y devuelve un challengeToken.
---------------------------------------------------------------- */
export const startGuestAccess = async (req, res) => {
  try {
    const { email } = req.body || {}
    if (!email) return res.status(400).json({ error: "Email is required" })
    const normalized = String(email).trim().toLowerCase()

    const code = (Math.floor(Math.random() * 900000) + 100000).toString()
    const hash = codeHash(normalized, code)

    const challengeToken = jwt.sign(
      { kind: "guest_challenge", email: normalized, codeHash: hash },
      process.env.JWT_SECRET,
      { expiresIn: "10m" },
    )

    // send email
    const brand = process.env.BRAND_NAME || "InsiderBookings"
    await sendMail({
      to: normalized,
      subject: `${brand} verification code`,
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your verification code is <b>${code}</b>.<br/>It expires in 10 minutes.</p>`,
    })

    return res.json({ challengeToken, sent: true })
  } catch (err) {
    console.error("startGuestAccess:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   POST /api/bookings/guest/verify { challengeToken, code }
   Devuelve un guest token (Bearer) de corta duraciÃ³n.
---------------------------------------------------------------- */
export const verifyGuestAccess = async (req, res) => {
  try {
    const { challengeToken, code } = req.body || {}
    if (!challengeToken || !code) return res.status(400).json({ error: "Missing fields" })

    let payload
    try {
      payload = jwt.verify(challengeToken, process.env.JWT_SECRET)
    } catch (e) {
      return res.status(401).json({ error: "Invalid or expired challenge" })
    }
    if (payload.kind !== "guest_challenge") return res.status(400).json({ error: "Invalid challenge" })

    const normalized = String(payload.email).trim().toLowerCase()
    const valid = codeHash(normalized, String(code)) === payload.codeHash
    if (!valid) return res.status(401).json({ error: "Invalid code" })

    const guestToken = jwt.sign(
      { kind: "guest", email: normalized, scope: ["bookings:read:guest"] },
      process.env.JWT_SECRET,
      { expiresIn: "24h" },
    )

    return res.json({ token: guestToken })
  } catch (err) {
    console.error("verifyGuestAccess:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   GET /api/bookings/guest (?latest=true)
   Listado mÃ­nimo para invitados con guest token.
---------------------------------------------------------------- */
export const listGuestBookings = async (req, res) => {
  try {
    const { latest } = req.query
    const email = req.guest?.email
    if (!email) return res.status(401).json({ error: "Unauthorized" })

    const rows = await models.Booking.findAll({
      where: { guest_email: email },
      order: [["check_in", "DESC"]],
      limit: latest ? 1 : 50,
      include: STAY_BASE_INCLUDE,
    })
    const result = rows.map((r) => {
      const obj = r.toJSON()
      const channel =
        obj.inventory_type === "HOME" || obj.source === "HOME"
          ? "home"
          : obj.source === "TGX"
            ? "tgx"
            : obj.source === "OUTSIDE"
              ? "outside"
              : obj.source === "VAULT"
                ? "vault"
                : "insider"
      return mapStay(obj, channel)
    })
    return res.json(latest ? result[0] ?? null : result)
  } catch (err) {
    console.error("listGuestBookings:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------------------------------------------------------------
   POST /api/bookings/link { guestToken }
   Autenticado: enlaza reservas huÃ©rfanas del email del invitado a user_id.
---------------------------------------------------------------- */
export const linkGuestBookingsToUser = async (req, res) => {
  try {
    const { guestToken } = req.body || {}
    if (!guestToken) return res.status(400).json({ error: "Missing guestToken" })
    let payload
    try { payload = jwt.verify(guestToken, process.env.JWT_SECRET) } catch (e) { return res.status(401).json({ error: "Invalid guest token" }) }
    if (payload.kind !== "guest") return res.status(400).json({ error: "Invalid token kind" })

    const email = String(payload.email).trim().toLowerCase()
    const today = new Date().toISOString().slice(0, 10)
    const [count] = await models.Booking.update(
      { user_id: req.user.id },
      {
        where: {
          user_id: null,
          guest_email: email,
          check_out: { [Op.gte]: today }, // solo futuras o en curso
        }
      }
    )
    return res.json({ linked: count })
  } catch (err) {
    console.error("linkGuestBookingsToUser:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   GET  /api/bookings/legacy/me           (sÃ³lo insider)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const getBookingsForUser = async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query
    const where = { user_id: req.user.id, outside: false, ...(status && { status }) }

    const rows = await models.Booking.findAll({
      where,
      include: [
        {
          model: models.Hotel,
          attributes: ["id", "name", "location", "image", "address", "city", "country", "rating"],
        },
        {
          model: models.Room,
          attributes: ["id", "name", "image", "price", "beds", "capacity"],
        },
        {
          model: models.DiscountCode,
          attributes: ["id", "code", "percentage"],
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: Number(limit),
      offset: Number(offset),
    })

    const result = rows.map(r => ({
      id: r.id,
      hotelName: r.Hotel.name,
      location: `${r.Hotel.city || r.Hotel.location}, ${r.Hotel.country || ""}`.trim().replace(/,$/, ""),
      checkIn: r.check_in,
      checkOut: r.check_out,
      guests: r.adults + r.children,
      adults: r.adults,
      children: r.children,
      status: String(r.status).toLowerCase(),
      paymentStatus: String(r.payment_status).toLowerCase(),
      total: Number.parseFloat(r.gross_price ?? 0),
      nights: diffDays(r.check_in, r.check_out),
      rating: r.Hotel.rating,
      image: r.Hotel.image || r.Room.image,
      roomName: r.Room.name,
      roomPrice: Number.parseFloat(r.Room.price),
      beds: r.Room.beds,
      capacity: r.Room.capacity,
      guestName: r.guest_name,
      guestEmail: r.guest_email,
      guestPhone: r.guest_phone,
      discountCode: r.DiscountCode ? { code: r.DiscountCode.code, percentage: r.DiscountCode.percentage } : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))

    return res.json(result)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   GET  /api/bookings/staff/me
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const getBookingsForStaff = async (req, res) => {
  try {
    const staffId = req.user.id
    const rows = await models.Booking.findAll({
      include: [
        { model: models.DiscountCode, where: { staff_id: staffId } },
        { model: models.Hotel, attributes: ["name"] },
        { model: models.Room, attributes: ["name"] },
      ],
    })
    return res.json(rows)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   GET  /api/bookings/:id       (insider & outside)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params

    const booking = await models.Booking.findByPk(id, {
      include: [
        { model: models.User, attributes: ["id", "name", "email"], required: false },
        ...STAY_BASE_INCLUDE,
        {
          model: models.AddOn,
          through: {
            attributes: [
              "id",
              "add_on_option_id",
              "quantity",
              "unit_price",
              "payment_status",
              "status",
            ],
          },
          include: [
            { model: models.AddOnOption, attributes: ["id", "name", "price"], required: false },
          ],
        },
        { model: models.DiscountCode, attributes: ["id", "code", "percentage"], required: false },
      ],
    })

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" })
    }

    const addons = booking.AddOns.map((addon) => {
      const pivot = addon.BookingAddOn
      const option = addon.AddOnOptions?.find((o) => o.id === pivot.add_on_option_id) || null

      return {
        bookingAddOnId: pivot.id,
        addOnId: addon.id,
        addOnName: addon.name,
        addOnSlug: addon.slug,
        quantity: pivot.quantity,
        unitPrice: Number(pivot.unit_price),
        paymentStatus: pivot.payment_status,
        status: pivot.status,
        optionId: option?.id ?? null,
        optionName: option?.name ?? null,
        optionPrice: option?.price ?? null,
      }
    })

    const obj = booking.toJSON()
    const channel =
      obj.inventory_type === "HOME" || obj.source === "HOME"
        ? "home"
        : obj.source === "TGX"
          ? "tgx"
          : obj.source === "OUTSIDE"
            ? "outside"
            : obj.source === "VAULT"
              ? "vault"
              : "insider"
    const stayView = mapStay(obj, channel)

    const meta =
      booking.source === "OUTSIDE"
        ? booking.outsideMeta
        : booking.source === "TGX"
          ? booking.tgxMeta
          : null

    return res.json({
      id: stayView.id,
      externalRef: booking.external_ref,
      user: booking.User ?? null,
      hotel: stayView.hotel,
      home: stayView.home,
      room: stayView.room,
      checkIn: stayView.checkIn,
      checkOut: stayView.checkOut,
      nights: stayView.nights,
      adults: booking.adults,
      children: booking.children,
      guestName: stayView.guestName,
      guestEmail: stayView.guestEmail,
      guestPhone: stayView.guestPhone,
      grossPrice: stayView.total,
      netCost: Number(booking.net_cost ?? 0),
      currency: booking.currency,
      status: stayView.status,
      paymentStatus: stayView.paymentStatus,
      discountCode: booking.DiscountCode ?? null,
      meta,
      addons,
      source: booking.source,
      inventoryType: stayView.inventoryType,
      pricingSnapshot: booking.pricing_snapshot ?? null,
      guestSnapshot: booking.guest_snapshot ?? null,
    })
  } catch (err) {
    console.error("getBookingById:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   PUT  /api/bookings/:id/cancel
   (este endpoint cancela reservas legacy; para TGX usar su flow)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.id

    const booking = await models.Booking.findOne({ where: { id, user_id: userId } })
    if (!booking) return res.status(404).json({ error: "Booking not found" })

    const statusLc = String(booking.status).toLowerCase()
    if (statusLc === "cancelled")
      return res.status(400).json({ error: "Booking is already cancelled" })
    if (statusLc === "completed")
      return res.status(400).json({ error: "Cannot cancel completed booking" })

    const hoursUntilCI = (new Date(booking.check_in) - new Date()) / 36e5
    if (hoursUntilCI < 24)
      return res.status(400).json({ error: "Cannot cancel booking less than 24 hours before check-in" })

    await booking.update({
      status: "CANCELLED",
      payment_status: booking.payment_status === "PAID" ? "REFUNDED" : "UNPAID",
      cancelled_at: new Date(),
    })

    if (booking.inventory_type === "HOME") {
      try {
        const stayHome = await models.StayHome.findOne({ where: { stay_id: booking.id } })
        const homeIdValue =
          stayHome?.home_id ??
          (booking.inventory_id ? Number.parseInt(booking.inventory_id, 10) : null)

        const stayDates = enumerateStayDates(booking.check_in, booking.check_out)
        if (homeIdValue && stayDates.length) {
          const overlappingStays = await models.Stay.findAll({
            where: {
              id: { [Op.ne]: booking.id },
              inventory_type: "HOME",
              status: { [Op.in]: ["PENDING", "CONFIRMED"] },
              check_in: { [Op.lt]: booking.check_out },
              check_out: { [Op.gt]: booking.check_in },
            },
            include: [
              {
                model: models.StayHome,
                as: "homeStay",
                required: true,
                where: { home_id: homeIdValue },
              },
            ],
          })

          const occupiedDates = new Set()
          for (const otherStay of overlappingStays) {
            enumerateStayDates(otherStay.check_in, otherStay.check_out).forEach((d) =>
              occupiedDates.add(d)
            )
          }

          const calendarEntries = await models.HomeCalendar.findAll({
            where: {
              home_id: homeIdValue,
              date: stayDates,
            },
          })

          for (const entry of calendarEntries) {
            if (occupiedDates.has(entry.date)) continue

            const noteMatches =
              typeof entry.note === "string" &&
              entry.note.toUpperCase() === `BOOKING:${String(booking.id).toUpperCase()}`

            if (noteMatches) {
              if (entry.price_override == null) {
                await entry.destroy()
              } else {
                await entry.update({
                  status: "AVAILABLE",
                  note: null,
                  source: entry.source === "PLATFORM" ? "PLATFORM" : entry.source,
                })
              }
              continue
            }

            if (entry.price_override == null && !entry.note) {
              await entry.destroy()
            } else {
              await entry.update({
                status: "AVAILABLE",
                source: entry.source === "PLATFORM" ? "PLATFORM" : entry.source,
              })
            }
          }
        }
      } catch (calendarErr) {
        console.warn("cancelBooking: calendar cleanup failed:", calendarErr?.message || calendarErr)
      }
    }

    // Si quedÃ³ REFUNDED, revertir comisiÃ³n influencer asociada (si no fue pagada)
    if (String(booking.payment_status).toUpperCase() === 'PAID') {
      try {
        const ic = await models.InfluencerCommission.findOne({ where: { booking_id: booking.id } })
        if (ic && ic.status !== 'paid') {
          await ic.update({ status: 'reversed', reversal_reason: 'cancelled' })
        }
      } catch (e) {
        console.warn('cancelBooking: could not reverse influencer commission:', e?.message || e)
      }
    }

    // Enviar email de cancelaciÃ³n (best-effort)
    try {
      const bookingForEmail = {
        id: booking.id,
        bookingCode: booking.booking_ref || booking.id,
        guestName: booking.guest_name,
        guests: { adults: booking.adults, children: booking.children },
        roomsCount: 1,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        hotel: { name: booking.Hotel?.name || booking.meta?.snapshot?.hotelName || 'Hotel' },
        currency: booking.currency || 'USD',
        totals: { total: Number(booking.gross_price || 0) },
      }
      const lang = (booking.meta?.language || process.env.DEFAULT_LANG || 'en')
      const policy = null
      await sendCancellationEmail({ booking: bookingForEmail, toEmail: booking.guest_email, lang, policy, refund: {} })
    } catch (e) {
      console.warn('cancelBooking: could not send cancellation email:', e?.message || e)
    }

    return res.json({
      message: "Booking cancelled successfully",
      booking: {
        id: booking.id,
        status: String(booking.status).toLowerCase(),
        paymentStatus: String(booking.payment_status).toLowerCase(),
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Public helpers for â€œoutsideâ€ bookings (transformed)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const getOutsideBookingByConfirmation = async (req, res) => {
  try {
    const { confirmation } = req.params
    if (!confirmation)
      return res.status(400).json({ error: "bookingConfirmation is required" })

    const bk = await models.Booking.findOne({
      where: { external_ref: confirmation, source: "OUTSIDE" },
    })
    if (!bk) return res.status(404).json({ error: "Booking not found" })

    return res.json(bk)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const getOutsideBookingWithAddOns = async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!id) return res.status(400).json({ error: "Invalid booking ID" })

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 1. Load booking (+relations) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    const bk = await models.Booking.findOne({
      where: { id, source: "OUTSIDE" },
      include: [
        {
          model: models.User,
          attributes: ["id", "name", "email"],
        },
        {
          model: models.Hotel,
          attributes: [
            "id", "name", "location", "address", "city", "country", "image", "phone", "price",
            "rating", "star_rating", "category", "amenities", "lat", "lng", "description"
          ],
        },
        {
          model: models.AddOn,
          attributes: ["id", "name", "slug", "description", "price"],
          through: {
            attributes: [
              "id", "quantity", "unit_price", "payment_status", "add_on_option_id", "status"
            ],
          },
          include: [
            { model: models.AddOnOption, attributes: ["id", "name", "price"] }
          ],
        },
        {
          model: models.Room,
          attributes: [
            "id", "room_number", "name", "description", "image", "price", "capacity",
            "beds", "amenities", "available"
          ],
        }
      ]
    })
    if (!bk) return res.status(404).json({ error: "Booking not found" })

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 2. Map add-ons for FE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    const addons = bk.AddOns.map(addon => {
      const pivot = addon.BookingAddOn
      const option = addon.AddOnOptions?.find(o => o.id === pivot.add_on_option_id) || null
      return {
        bookingAddOnId: pivot.id,
        addOnId: addon.id,
        addOnName: addon.name,
        addOnSlug: addon.slug,
        qty: pivot.qty,
        unitPrice: Number(pivot.unit_price),
        paymentStatus: pivot.payment_status,
        status: pivot.status,
        optionId: option?.id ?? null,
        optionName: option?.name ?? null,
        optionPrice: option?.price ?? null,
      }
    })

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 3. Hotel + rooms plain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    const hotelPlain = bk.Hotel.get({ plain: true })
    const roomRows = await models.Room.findAll({
      where: { hotel_id: hotelPlain.id },
      attributes: [
        "id", "room_number", "name", "description", "image", "price", "capacity",
        "beds", "amenities", "available"
      ],
    })
    hotelPlain.rooms = roomRows.map(r => r.get({ plain: true }))

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 4. Response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    return res.json({
      id: bk.id,
      bookingConfirmation: bk.external_ref, // usamos external_ref
      guestName: bk.guest_name,
      guestLastName: bk.meta?.guest_last_name ?? null,
      guestEmail: bk.guest_email,
      guestRoomType: bk.Room?.name ?? null,
      guestPhone: bk.guest_phone,
      checkIn: bk.check_in,
      checkOut: bk.check_out,
      status: String(bk.status).toLowerCase(),
      paymentStatus: String(bk.payment_status).toLowerCase(),
      user: bk.User,
      hotel: hotelPlain,
      addons,
      source: "OUTSIDE"
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const downloadBookingCertificate = async (req, res) => {
  try {
    const { id } = req.params

    const booking = await models.Booking.findByPk(id, {
      include: [
        { model: models.User, as: "user", attributes: ["name", "email", "phone", "country"] },
        { model: models.Hotel, as: "hotel", attributes: ["name", "hotelName", "address", "city", "country", "phone"] },
        { model: models.Room, as: "room", attributes: ["name", "description"] },
      ],
    })
    if (!booking) return res.status(404).json({ error: "Booking not found" })

    const payload = {
      id: booking.id,
      bookingCode: booking.bookingCode || booking.reference || booking.id,
      guestName: booking.guestName || booking.user?.name,
      guests: { adults: booking.adults || 2, children: booking.children || 0 },
      roomsCount: booking.rooms || 1,
      checkIn: booking.checkIn || booking.check_in,
      checkOut: booking.checkOut || booking.check_out,
      hotel: {
        name: booking.hotel?.name || booking.hotel?.hotelName,
        address: booking.hotel?.address,
        city: booking.hotel?.city,
        country: booking.hotel?.country,
        phone: booking.hotel?.phone,
      },
      country: booking.user?.country || "",
      propertyContact: booking.hotel?.phone,
      currency: (booking.currency || "USD").toUpperCase(),
      totals: {
        nights: booking.nights,
        ratePerNight: booking.ratePerNight || booking.rate || 0,
        taxes: booking.taxes || 0,
        total: booking.totalAmount || booking.total || 0,
      },
      payment: {
        method: booking.paymentMethod || booking.payment_type || "Credit Card",
        last4: booking.cardLast4 || null,
      },
    }

    return streamCertificatePDF(payload, res)
  } catch (err) {
    console.error("downloadCertificate error:", err)
    return res.status(500).json({ error: "Could not generate certificate" })
  }
}

/* -----------------------------------------------------------
   POST /api/bookings/:id/refund
   Marca la reserva como reembolsada y revierte la comisiÃ³n influencer asociada.
   AutorizaciÃ³n: owner de la booking, staff o admin.
----------------------------------------------------------- */
// requestRefund endpoint was removed â€” cancellation flow handles refunds.

/* -----------------------------------------------------------
   PUT  /api/bookings/:id/confirm
   Marca la reserva como CONFIRMED/PAID (uso temporal desde app).
  Autorización: owner de la booking.
----------------------------------------------------------- */
export const confirmBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    console.log("[CONFIRM BOOKING] request", { id, userId });
    if (!id || !userId) return res.status(401).json({ error: "Unauthorized" });

    const booking = await models.Booking.findOne({
      where: { id, user_id: userId },
      include: STAY_BASE_INCLUDE,
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const statusLc = String(booking.status || "").toUpperCase();
    if (statusLc === "CANCELLED") return res.status(400).json({ error: "Booking is cancelled" });

    console.log("[CONFIRM BOOKING] loaded booking", {
      id: booking.id,
      status: booking.status,
      payment_status: booking.payment_status,
      influencer_user_id: booking.influencer_user_id,
      gross_price: booking.gross_price,
      currency: booking.currency,
    });

    const alreadyFinal = statusLc === "CONFIRMED" || statusLc === "COMPLETED";
    if (!alreadyFinal) {
      await booking.update({
        status: "CONFIRMED",
        payment_status: "PAID",
        booked_at: booking.booked_at || new Date(),
      });
      console.log("[CONFIRM BOOKING] updated to CONFIRMED/PAID", { id: booking.id });
    }

    const ensureInfluencerEventCommission = async (influencerUserId, eventType, payload = {}) => {
      if (!models.InfluencerEventCommission) return;
      const influencerId = Number(influencerUserId) || null;
      if (!influencerId) return;
      const { signup_user_id = null, stay_id = null } = payload;
      const where = { event_type: eventType };
      if (eventType === "signup") where.signup_user_id = signup_user_id;
      if (eventType === "booking") where.stay_id = stay_id;
      const bonusEnv =
        eventType === "signup"
          ? Number(process.env.INFLUENCER_SIGNUP_BONUS_USD)
          : Number(process.env.INFLUENCER_BOOKING_BONUS_USD);
      const defaultAmount = eventType === "signup" ? 0.25 : 2;
      const amount = Number.isFinite(bonusEnv) && bonusEnv > 0 ? bonusEnv : defaultAmount;
      if (!amount) return;

      try {
        await models.InfluencerEventCommission.findOrCreate({
          where,
          defaults: {
            influencer_user_id: influencerId,
            event_type: eventType,
            signup_user_id: signup_user_id || null,
            stay_id: stay_id || null,
            amount,
            currency: (booking.currency || "USD").toUpperCase(),
            status: "eligible",
          },
        });
        console.log("[CONFIRM BOOKING] influencer_event_commission created", {
          influencer_user_id: influencerId,
          stay_id: stay_id || null,
          event_type: eventType,
          amount,
        });
      } catch (e) {
        console.warn("(INF) No se pudo registrar bonus de evento:", e?.message || e);
      }
    };

    const ensureInfluencerCommission = async (influencerUserId) => {
      const influencerId = Number(influencerUserId) || null;
      if (!influencerId) return;
      try {
        const existing = await models.InfluencerCommission.findOne({ where: { stay_id: booking.id } });
        if (existing) return;

        const rateEnv = Number(process.env.INFLUENCER_COMMISSION_PCT);
        const ratePct = Number.isFinite(rateEnv) && rateEnv > 0 ? rateEnv : 15;
        const capUsdEnv = Number(process.env.INFLUENCER_COMMISSION_CAP_USD);
        const capUsd = Number.isFinite(capUsdEnv) && capUsdEnv > 0 ? capUsdEnv : 5;
        let capAmt = capUsd;
        try {
          const ratesStr = process.env.FX_USD_RATES || "{}";
          const rates = JSON.parse(ratesStr);
          const r = Number(rates[(booking.currency || "USD").toUpperCase()]);
          if (Number.isFinite(r) && r > 0) capAmt = capUsd * r;
        } catch { }
        const holdDaysEnv = Number(process.env.INFLUENCER_HOLD_DAYS);
        const holdDays = Number.isFinite(holdDaysEnv) && holdDaysEnv >= 0 ? holdDaysEnv : 3;

        const gross = Number(booking.gross_price || 0);
        const net = booking.net_cost != null ? Number(booking.net_cost) : null;
        const markup = net != null ? Math.max(0, gross - Number(net)) : null;
        const base = markup != null ? markup : gross;
        const baseType = markup != null ? "markup" : "gross";

        const rawCommission = base * (ratePct / 100);
        const commissionAmount =
          Math.round((Math.min(rawCommission, capAmt) + Number.EPSILON) * 100) / 100;
        const currency = booking.currency || "USD";

        let holdUntil = null;
        try {
          const co = booking.check_out ? new Date(booking.check_out) : null;
          if (co && !isNaN(co)) {
            co.setDate(co.getDate() + holdDays);
            holdUntil = co;
          }
        } catch { }
        const useHold = String(process.env.INFLUENCER_USE_HOLD || "").toLowerCase() === "true";
        await models.InfluencerCommission.create({
          influencer_user_id: influencerId,
          stay_id: booking.id,
          discount_code_id: null,
          commission_base: baseType,
          commission_rate_pct: ratePct,
          commission_amount: commissionAmount,
          commission_currency: currency,
          status: useHold && holdUntil ? "hold" : "eligible",
          hold_until: holdUntil,
        });
        console.log("[CONFIRM BOOKING] influencer_commission created", {
          influencer_user_id: influencerId,
          stay_id: booking.id,
          commission_amount: commissionAmount,
          commission_currency: currency,
          status: useHold && holdUntil ? "hold" : "eligible",
          commission_base: baseType,
          commission_rate_pct: ratePct,
        });
      } catch (e) {
        console.warn("(INF) Could not create InfluencerCommission:", e?.message || e);
      }
    };

    const influencerId = booking.influencer_user_id || null;
    if (influencerId) {
      console.log("[CONFIRM BOOKING] processing influencer", { influencer_user_id: influencerId });
      await ensureInfluencerCommission(influencerId);
      await ensureInfluencerEventCommission(influencerId, "booking", { stay_id: booking.id });
    }

    const fresh =
      alreadyFinal && typeof booking.toJSON === "function"
        ? booking
        : await models.Booking.findByPk(id, { include: STAY_BASE_INCLUDE });

    return res.json(mapStay(fresh.toJSON(), fresh.source || "insider"));
  } catch (err) {
    console.error("confirmBooking:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

