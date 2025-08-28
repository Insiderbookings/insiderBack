/* ────────────────────────────────────────────────────────────
   src/controllers/booking.controller.js   ·   COMPLETO
──────────────────────────────────────────────────────────── */

import { Op } from "sequelize"
import models from "../models/index.js"
import { streamCertificatePDF } from "../helpers/bookingCertificate.js"
/* ───────────── Helper – count nights ───────────── */
const diffDays = (from, to) =>
  Math.ceil((new Date(to) - new Date(from)) / 86_400_000)

/* ───────────── Helper – flattener ────────────────
   Recibe una fila de Booking (snake_case en DB) y la
   convierte al formato camelCase que usa el FE.       */
const mapStay = (row, source) => {
  // Normalizar a objetos plain
  let hotel = row.Hotel && typeof row.Hotel.toJSON === "function" ? row.Hotel.toJSON() : row.Hotel ?? null
  let room  = row.Room  && typeof row.Room.toJSON  === "function" ? row.Room.toJSON()  : row.Room  ?? null

  if (source === "tgx" && row.tgxMeta) {
    const tgxHotel = row.tgxMeta?.hotel ?? {}
    const tgxRoom  = row.tgxMeta?.rooms?.[0] ?? {}
    hotel = { ...hotel, ...tgxHotel }
    room  = { ...room,  ...tgxRoom  }
  }

  // Aceptar snake_case o camelCase por si viene mezclado
  const checkIn  = row.check_in  ?? row.checkIn  ?? null
  const checkOut = row.check_out ?? row.checkOut ?? null

  const status        = String(row.status ?? "").toLowerCase()
  const paymentStatus = String(row.payment_status ?? row.paymentStatus ?? "").toLowerCase()

  const nights = checkIn && checkOut ? diffDays(checkIn, checkOut) : null

  return {
    /* ─────────── ids & tipo ─────────── */
    id                  : row.id,
    source              : source, // "insider" | "outside" | "tgx" (si lo necesitas)
    bookingConfirmation : row.bookingConfirmation ?? row.external_ref ?? null,

    /* ─────────── hotel ─────────── */
    hotel_id   : row.hotel_id ?? hotel?.id ?? null,
    hotel_name : hotel?.name ?? null,
    location   : hotel
      ? `${hotel.city || hotel.location || ""}, ${hotel.country || ""}`.trim().replace(/, $/, "")
      : null,
    image      : hotel?.image  ?? null,
    rating     : hotel?.rating ?? null,

    /* ─────────── stay info ─────────── */
    checkIn,
    checkOut,
    nights,

    status,
    paymentStatus,

    /* ─────────── room info ─────────── */
    room_type   : row.room_type ?? room?.name ?? null,
    room_number : row.room_number ?? room?.room_number ?? null,

    /* ─────────── guests / total ───── */
    guests : (row.adults ?? 0) + (row.children ?? 0),
    total  : Number.parseFloat(row.gross_price ?? row.total ?? 0),

    /* ─────────── guest info ────────── */
    guestName     : row.guest_name      ?? row.guestName      ?? null,
    guestLastName : row.guest_last_name ?? row.guestLastName ?? null,
    guestEmail    : row.guest_email     ?? row.guestEmail     ?? null,
    guestPhone    : row.guest_phone     ?? row.guestPhone     ?? null,

    /* ─────────── raw hotel/room ────── */
    hotel,
    room,

    outside: !!row.outside,
    active : row.active ?? true,
  }
}

/* ────────────────────────────────────────────────────────────
   POST  /api/bookings
   (flujo legacy "insider/outside"; no TGX)
──────────────────────────────────────────────────────────── */
export const createBooking = async (req, res) => {
  try {
    const {
      user_id, hotel_id, room_id, checkIn, checkOut,
      adults, children, rooms,
      guestName, guestEmail, guestPhone,
      discountCode, active, outside = false
    } = req.body

    if (!hotel_id || !room_id || !checkIn || !checkOut || !guestName || !guestEmail)
      return res.status(400).json({ error: "Missing required fields" })

    /* ─── Validate discount code (optional) ─── */
    let discountPct = 0, discount_code_id = null, staff_id = null
    if (discountCode) {
      const disc = await models.DiscountCode.findOne({
        where  : { code: discountCode },
        include: "staff",
      })
      if (!disc) return res.status(404).json({ error: "Invalid discount code" })
      if (disc.endsAt && new Date(disc.endsAt) < new Date())
        return res.status(400).json({ error: "Discount code expired" })

      discountPct       = disc.percentage
      discount_code_id  = disc.id
      staff_id          = disc.staff_id
      disc.timesUsed   += 1
      await disc.save()
    }

    /* ─── Calculate total ─── */
    const room = await models.Room.findByPk(room_id)
    if (!room) return res.status(404).json({ error: "Room not found" })

    const nights = diffDays(checkIn, checkOut)
    const base   = Number(room.price) * nights * (rooms ?? 1)
    const total  = discountPct ? base * (1 - discountPct / 100) : base

    /* ─── Create booking ───
       ⚠️ El modelo usa snake_case: check_in / check_out / guest_name...
    */
    const booking = await models.Booking.create({
      user_id, hotel_id, room_id, discount_code_id,
      check_in : checkIn,
      check_out: checkOut,
      adults, children,
      guest_name : guestName,
      guest_email: guestEmail,
      guest_phone: guestPhone,
      gross_price: total,
      status        : "PENDING",
      payment_status: "UNPAID",
      active        : active ?? true,
      outside
    })

    /* ─── Staff commission (if applicable) ─── */
    if (staff_id && models.Staff && models.Commission) {
      const staff  = await models.Staff.findByPk(staff_id, { include: "role" })
      const amount = (total * staff.role.commissionPct) / 100
      await models.Commission.create({ booking_id: booking.id, staff_id, amount })
    }

    return res.status(201).json(booking)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ────────────────────────────────────────────────────────────
   GET  /api/bookings/me        (?latest=true para solo 1)
   Unifica y mapea para el FE.
──────────────────────────────────────────────────────────── */
export const getBookingsUnified = async (req, res) => {
  try {
    const { latest, status, limit = 50, offset = 0 } = req.query
    const userId = req.user.id

    // 1. Buscar usuario
    const user = await models.User.findByPk(userId)
    if (!user) return res.status(404).json({ error: "User not found" })
    const email = user.email

    // 2. Traer bookings por guest_email y (opcional) status
    const rows = await models.Booking.findAll({
      where: {
        guest_email: email,
        ...(status && { status })
      },
      include: [
        {
          model     : models.Hotel,
          attributes: [
            "id",
            "name",
            "location",
            "image",
            "city",
            "country",
            "rating",
            "address",
            "phone",
          ],
        },
        {
          model     : models.Room,
          attributes: ["id", "name", "room_number", "image", "price", "beds", "capacity"],
        },
        {
          model : models.TGXMeta,
          as    : "tgxMeta",
          required: false,
        }
      ],
      order : [["check_in","DESC"]],
      limit : latest ? 1 : Number(limit),
      offset: latest ? 0 : Number(offset)
    })

    // 3. Mapear y unificar
      const merged = rows
        .map(r => {
          const obj = r.toJSON()
          const channel =
            obj.source === "TGX"
              ? "tgx"
              : obj.source === "OUTSIDE"
              ? "outside"
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

/* ────────────────────────────────────────────────────────────
   GET  /api/bookings/legacy/me           (sólo insider)
──────────────────────────────────────────────────────────── */
export const getBookingsForUser = async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query
    const where = { user_id: req.user.id, outside: false, ...(status && { status }) }

    const rows = await models.Booking.findAll({
      where,
      include: [
        {
          model      : models.Hotel,
          attributes : ["id","name","location","image","address","city","country","rating"],
        },
        {
          model      : models.Room,
          attributes : ["id","name","image","price","beds","capacity"],
        },
        {
          model      : models.DiscountCode,
          attributes : ["id","code","percentage"],
          required   : false,
        },
      ],
      order : [["createdAt","DESC"]],
      limit : Number(limit),
      offset: Number(offset),
    })

    const result = rows.map(r => ({
      id            : r.id,
      hotelName     : r.Hotel.name,
      location      : `${r.Hotel.city || r.Hotel.location}, ${r.Hotel.country || ""}`.trim().replace(/,$/, ""),
      checkIn       : r.check_in,
      checkOut      : r.check_out,
      guests        : r.adults + r.children,
      adults        : r.adults,
      children      : r.children,
      status        : String(r.status).toLowerCase(),
      paymentStatus : String(r.payment_status).toLowerCase(),
      total         : Number.parseFloat(r.gross_price ?? 0),
      nights        : diffDays(r.check_in, r.check_out),
      rating        : r.Hotel.rating,
      image         : r.Hotel.image || r.Room.image,
      roomName      : r.Room.name,
      roomPrice     : Number.parseFloat(r.Room.price),
      beds          : r.Room.beds,
      capacity      : r.Room.capacity,
      guestName     : r.guest_name,
      guestEmail    : r.guest_email,
      guestPhone    : r.guest_phone,
      discountCode  : r.DiscountCode ? { code: r.DiscountCode.code, percentage: r.DiscountCode.percentage } : null,
      createdAt     : r.createdAt,
      updatedAt     : r.updatedAt,
    }))

    return res.json(result)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ────────────────────────────────────────────────────────────
   GET  /api/bookings/staff/me
──────────────────────────────────────────────────────────── */
export const getBookingsForStaff = async (req, res) => {
  try {
    const staffId = req.user.id
    const rows = await models.Booking.findAll({
      include: [
        { model: models.DiscountCode, where: { staff_id: staffId } },
        { model: models.Hotel, attributes: ["name"] },
        { model: models.Room,  attributes: ["name"] },
      ],
    })
    return res.json(rows)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ────────────────────────────────────────────────────────────
   GET  /api/bookings/:id       (insider & outside)
──────────────────────────────────────────────────────────── */
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params

    const booking = await models.Booking.findByPk(id, {
      include: [
        { model: models.User,         attributes: ["id", "name", "email"], required: false },
        { model: models.Hotel,        attributes: ["id", "name", "location", "image", "address", "city", "country", "rating"] },
        { model: models.Room,         attributes: ["id", "name", "price", "image", "beds", "capacity"] },
        {
          model: models.AddOn,
          through: {
            attributes: [
              "id",
              "add_on_option_id",
              "quantity",
              "unit_price",
              "payment_status",
              "status"
            ]
          },
          include: [
            { model: models.AddOnOption, attributes: ["id", "name", "price"], required: false }
          ]
        },
        { model: models.DiscountCode, attributes: ["id", "code", "percentage"], required: false },
        { model: models.TGXMeta,     as: "tgxMeta",     required: false },
        { model: models.OutsideMeta, as: "outsideMeta", required: false }
      ]
    })

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" })
    }

    // Mapeo de add-ons
    const addons = booking.AddOns.map(addon => {
      const pivot  = addon.BookingAddOn
      const option = addon.AddOnOptions?.find(o => o.id === pivot.add_on_option_id) || null

      return {
        bookingAddOnId: pivot.id,
        addOnId       : addon.id,
        addOnName     : addon.name,
        addOnSlug     : addon.slug,
        quantity      : pivot.quantity,
        unitPrice     : Number(pivot.unit_price),
        paymentStatus : pivot.payment_status,
        status        : pivot.status,
        optionId      : option?.id    ?? null,
        optionName    : option?.name  ?? null,
        optionPrice   : option?.price ?? null,
      }
    })

    // Seleccionar meta según canal
    const meta =
      booking.source === "OUTSIDE"
        ? booking.outsideMeta
        : booking.source === "TGX"
        ? booking.tgxMeta
        : null

    let hotel = booking.Hotel ? booking.Hotel.get ? booking.Hotel.get({ plain: true }) : booking.Hotel : null
    let room  = booking.Room  ? booking.Room.get  ? booking.Room.get({ plain: true })  : booking.Room  : null

    if (booking.source === "TGX" && booking.tgxMeta) {
      hotel = { ...hotel, ...(booking.tgxMeta?.hotel ?? {}) }
      room  = { ...room,  ...(booking.tgxMeta?.rooms?.[0] ?? {}) }
    }

    return res.json({
      id               : booking.id,
      externalRef      : booking.external_ref,
      user             : booking.User ?? null,
      hotel,
      room,
      checkIn          : booking.check_in,
      checkOut         : booking.check_out,
      nights           : diffDays(booking.check_in, booking.check_out),
      adults           : booking.adults,
      children         : booking.children,
      guestName        : booking.guest_name,
      guestEmail       : booking.guest_email,
      guestPhone       : booking.guest_phone,
      grossPrice       : Number(booking.gross_price),
      netCost          : Number(booking.net_cost ?? 0),
      currency         : booking.currency,
      status           : String(booking.status).toLowerCase(),
      paymentStatus    : String(booking.payment_status).toLowerCase(),
      discountCode     : booking.DiscountCode ?? null,
      meta,  // TGXMeta u OutsideMeta
      addons,
      source: booking.source
    })
  } catch (err) {
    console.error("getBookingById:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ────────────────────────────────────────────────────────────
   PUT  /api/bookings/:id/cancel
   (este endpoint cancela reservas legacy; para TGX usar su flow)
──────────────────────────────────────────────────────────── */
export const cancelBooking = async (req, res) => {
  try {
    const { id }  = req.params
    const userId  = req.user.id

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
      status         : "CANCELLED",
      payment_status : booking.payment_status === "PAID" ? "REFUNDED" : "UNPAID",
      cancelled_at   : new Date(),
    })

    return res.json({
      message: "Booking cancelled successfully",
      booking: {
        id            : booking.id,
        status        : String(booking.status).toLowerCase(),
        paymentStatus : String(booking.payment_status).toLowerCase(),
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ────────────────────────────────────────────────────────────
   Public helpers for “outside” bookings (transformed)
──────────────────────────────────────────────────────────── */
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

    /* ──────────────── 1. Load booking (+relations) ──────────────── */
    const bk = await models.Booking.findOne({
      where: { id, source: "OUTSIDE" },
      include: [
        {
          model      : models.User,
          attributes : ["id", "name", "email"],
        },
        {
          model      : models.Hotel,
          attributes : [
            "id","name","location","address","city","country","image","phone","price",
            "rating","star_rating","category","amenities","lat","lng","description"
          ],
        },
        {
          model      : models.AddOn,
          attributes : ["id","name","slug","description","price"],
          through    : {
            attributes: [
              "id","quantity","unit_price","payment_status","add_on_option_id","status"
            ],
          },
          include    : [
            { model: models.AddOnOption, attributes: ["id","name","price"] }
          ],
        },
        {
          model      : models.Room,
          attributes : [
            "id","room_number","name","description","image","price","capacity",
            "beds","amenities","available"
          ],
        }
      ]
    })
    if (!bk) return res.status(404).json({ error: "Booking not found" })

    /* ──────────────── 2. Map add-ons for FE ──────────────── */
    const addons = bk.AddOns.map(addon => {
      const pivot  = addon.BookingAddOn
      const option = addon.AddOnOptions?.find(o => o.id === pivot.add_on_option_id) || null
      return {
        bookingAddOnId: pivot.id,
        addOnId       : addon.id,
        addOnName     : addon.name,
        addOnSlug     : addon.slug,
        qty           : pivot.qty,
        unitPrice     : Number(pivot.unit_price),
        paymentStatus : pivot.payment_status,
        status        : pivot.status,
        optionId      : option?.id    ?? null,
        optionName    : option?.name  ?? null,
        optionPrice   : option?.price ?? null,
      }
    })

    /* ──────────────── 3. Hotel + rooms plain ──────────────── */
    const hotelPlain = bk.Hotel.get({ plain: true })
    const roomRows   = await models.Room.findAll({
      where      : { hotel_id: hotelPlain.id },
      attributes : [
        "id","room_number","name","description","image","price","capacity",
        "beds","amenities","available"
      ],
    })
    hotelPlain.rooms = roomRows.map(r => r.get({ plain: true }))

    /* ──────────────── 4. Response ──────────────── */
    return res.json({
      id                  : bk.id,
      bookingConfirmation : bk.external_ref, // usamos external_ref
      guestName           : bk.guest_name,
      guestLastName       : bk.meta?.guest_last_name ?? null,
      guestEmail          : bk.guest_email,
      guestRoomType       : bk.Room?.name ?? null,
      guestPhone          : bk.guest_phone,
      checkIn             : bk.check_in,
      checkOut            : bk.check_out,
      status              : String(bk.status).toLowerCase(),
      paymentStatus       : String(bk.payment_status).toLowerCase(),
      user                : bk.User,
      hotel               : hotelPlain,
      addons,
      source              : "OUTSIDE"
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
        { model: models.User,   as: "user",   attributes: ["name", "email", "phone", "country"] },
        { model: models.Hotel,  as: "hotel",  attributes: ["name","hotelName","address","city","country","phone"] },
        { model: models.Room,   as: "room",   attributes: ["name","description"] },
      ],
    })
    if (!booking) return res.status(404).json({ error: "Booking not found" })

    const payload = {
      id           : booking.id,
      bookingCode  : booking.bookingCode || booking.reference || booking.id,
      guestName    : booking.guestName || booking.user?.name,
      guests       : { adults: booking.adults || 2, children: booking.children || 0 },
      roomsCount   : booking.rooms || 1,
      checkIn      : booking.checkIn || booking.check_in,
      checkOut     : booking.checkOut || booking.check_out,
      hotel        : {
        name    : booking.hotel?.name || booking.hotel?.hotelName,
        address : booking.hotel?.address,
        city    : booking.hotel?.city,
        country : booking.hotel?.country,
        phone   : booking.hotel?.phone,
      },
      country      : booking.user?.country || "",
      propertyContact: booking.hotel?.phone,
      currency     : (booking.currency || "USD").toUpperCase(),
      totals       : {
        nights       : booking.nights,
        ratePerNight : booking.ratePerNight || booking.rate || 0,
        taxes        : booking.taxes || 0,
        total        : booking.totalAmount || booking.total || 0,
      },
      payment: {
        method : booking.paymentMethod || booking.payment_type || "Credit Card",
        last4  : booking.cardLast4 || null,
      },
    }

    return streamCertificatePDF(payload, res)
  } catch (err) {
    console.error("downloadCertificate error:", err)
    return res.status(500).json({ error: "Could not generate certificate" })
  }
}