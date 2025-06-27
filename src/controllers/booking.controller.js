/* ────────────────────────────────────────────────────────────
   src/controllers/booking.controller.js   ·   COMPLETO
──────────────────────────────────────────────────────────── */

import { Op }   from "sequelize"
import models   from "../models/index.js"

/* ───────────── Helper – count nights ───────────── */
const diffDays = (from, to) =>
  Math.ceil((new Date(to) - new Date(from)) / 86_400_000)

/* ───────────── Helper – flattener ────────────────
   Recibe una fila de Booking  | OutsideBooking y la
   convierte en el formato que usa todo el FE            */
const mapStay = (row, source) => {
  const hotel = row.Hotel ?? null            // siempre presente con include
  const nights = diffDays(row.checkIn, row.checkOut)

  return {
    /* ─────────── ids & tipo ─────────── */
    id              : row.id,
    source,                                  // "insider" | "outside"
    bookingConfirmation:
      source === "outside" ? row.bookingConfirmation : undefined,

    /* ─────────── hotel ─────────── */
    hotel_id        : row.hotel_id,
    hotel_name      : hotel?.name ?? null,
    location        : hotel
      ? `${hotel.city || hotel.location}, ${hotel.country || ""}`.trim().replace(/,$/, "")
      : null,
    image           : hotel?.image  ?? null,
    rating          : hotel?.rating ?? null,

    /* ─────────── stay info ─────────── */
    checkIn         : row.checkIn,
    checkOut        : row.checkOut,
    nights,

    status          : row.status,
    paymentStatus   : row.paymentStatus,

    /* ─────────── room info ─────────── */
    room_type       : row.room_type      ?? row.Room?.name   ?? null,
    room_number     : row.room_number    ?? null,

    /* ─────────── guests / total ───── */
    guests          : row.adults ? row.adults + row.children : null,
    total           : Number.parseFloat(row.total ?? 0),
  }
}

/* ────────────────────────────────────────────────────────────
   POST  /api/bookings
──────────────────────────────────────────────────────────── */
export const createBooking = async (req, res) => {
  try {
    const {
      user_id, hotel_id, room_id, checkIn, checkOut,
      adults, children, rooms,
      guestName, guestEmail, guestPhone,
      discountCode,
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

    /* ─── Create booking ─── */
    const booking = await models.Booking.create({
      user_id, hotel_id, room_id, discount_code_id,
      checkIn, checkOut, adults, children,
      guestName, guestEmail, guestPhone,
      total,
      status       : "pending",
      paymentStatus: "unpaid",
    })

    /* ─── Staff commission (if applicable) ─── */
    if (staff_id) {
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
──────────────────────────────────────────────────────────── */
export const getBookingsUnified = async (req, res) => {
  try {
    const { latest, status, limit = 50, offset = 0 } = req.query
    const { id: userId, email } = req.user

    /* ─── Insider bookings ─── */
    const insiderRows = await models.Booking.findAll({
      where : { user_id: userId, ...(status && { status }) },
      include: [
        {
          model      : models.Hotel,
          attributes : ["id","name","location","image","city","country","rating"],
        },
        { model: models.Room,  attributes: ["name"] },
      ],
      order : [["checkIn","DESC"]],
      limit : latest ? 1 : Number(limit),
      offset: latest ? 0 : Number(offset),
    })

    /* ─── Outside bookings ─── */
    const outsideWhere = { ...(status && { status }) }
    if (email) {
      outsideWhere[Op.or] = [{ user_id: userId }, { guestEmail: email }]
    } else {
      outsideWhere.user_id = userId
    }

    const outsideRows = await models.OutsideBooking.findAll({
      where : outsideWhere,
      include: [
        {
          model      : models.Hotel,
          attributes : ["id","name","location","image","city","country","rating"],
        },
        {
          model      : models.User,
          attributes : ["id","name","email"],
        },
      ],
      order : [["checkIn","DESC"]],
      limit : latest ? 1 : Number(limit),
      offset: latest ? 0 : Number(offset),
    })

    /* ─── Merge & sort ─── */
    const merged = [
      ...insiderRows.map(r  => mapStay(r, "insider")),
      ...outsideRows.map(r => mapStay(r, "outside")),
    ].sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn))

    return res.json(latest ? merged[0] ?? null : merged)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* alias explícito */
export const getLatestStayForUser = (req, res) =>
  (req.query.latest = "true", getBookingsUnified(req, res))

/* ────────────────────────────────────────────────────────────
   GET  /api/bookings/legacy/me           (sólo insider)
──────────────────────────────────────────────────────────── */
export const getBookingsForUser = async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query
    const where = { user_id: req.user.id, ...(status && { status }) }

    const rows = await models.Booking.findAll({
      where,
      include: [
        {
          model      : models.Hotel,
          attributes : [
            "id","name","location","image","address",
            "city","country","rating"
          ],
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
      location      : `${r.Hotel.city || r.Hotel.location}, ${r.Hotel.country || ""}`
                        .trim().replace(/,$/, ""),
      checkIn       : r.checkIn,
      checkOut      : r.checkOut,
      guests        : r.adults + r.children,
      adults        : r.adults,
      children      : r.children,
      status        : r.status,
      paymentStatus : r.paymentStatus,
      total         : Number.parseFloat(r.total),
      nights        : diffDays(r.checkIn, r.checkOut),
      rating        : r.Hotel.rating,
      image         : r.Hotel.image || r.Room.image,
      roomName      : r.Room.name,
      roomPrice     : Number.parseFloat(r.Room.price),
      beds          : r.Room.beds,
      capacity      : r.Room.capacity,
      guestName     : r.guestName,
      guestEmail    : r.guestEmail,
      guestPhone    : r.guestPhone,
      discountCode  : r.DiscountCode
        ? { code: r.DiscountCode.code, percentage: r.DiscountCode.percentage }
        : null,
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
   GET  /api/bookings/:id       (insider only)
──────────────────────────────────────────────────────────── */
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const r = await models.Booking.findByPk(id, {
      include: [
        { model: models.User,  attributes: ["id", "name", "email"] },
        { model: models.Hotel, attributes: ["id","name","location","image","address","city","country","rating"] },
        { model: models.Room,  attributes: ["id","name","price","image","beds","capacity"] },
        {
          model     : models.AddOn,                 // ★ NEW block
          include   : [
            { model: models.AddOnOption, attributes:["id","name","price"] },
          ],
        },
        { model: models.DiscountCode, attributes: ["id","code","percentage"], required:false },
      ],
    });
    if (!r) return res.status(404).json({ error: "Booking not found" });

    /* ------- Transform Add-Ons so el FE los entiende ------- */
    const addons = r.AddOns.map(addon => {
      const pivot  = addon.BookingAddOn;          // alias de tu modelo pivote
      const option = addon.AddOnOptions?.find(
        o => o.id === pivot.add_on_option_id
      ) || null;

      return {
        bookingAddOnId: pivot.id,
        addOnId       : addon.id,
        addOnName     : addon.name,
        addOnSlug     : addon.slug,
        unitPrice     : Number(pivot.unitPrice),
        paymentStatus : pivot.paymentStatus,
        status        : pivot.status,             // ★ NEW
        optionId      : option?.id    ?? null,
        optionName    : option?.name  ?? null,
        optionPrice   : option?.price ?? null,
      };
    });

    return res.json({
      /* …campos que ya enviabas… */
      id           : r.id,
      hotel        : r.Hotel,
      room         : r.Room,
      checkIn      : r.checkIn,
      checkOut     : r.checkOut,
      nights       : diffDays(r.checkIn, r.checkOut),
      adults       : r.adults,
      children     : r.children,
      guestName    : r.guestName,
      guestEmail   : r.guestEmail,
      guestPhone   : r.guestPhone,
      total        : Number.parseFloat(r.total),
      status       : r.status,
      paymentStatus: r.paymentStatus,
      discountCode : r.DiscountCode,
      createdAt    : r.createdAt,
      updatedAt    : r.updatedAt,
      addons,                                // ★ NEW
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};


/* ────────────────────────────────────────────────────────────
   PUT  /api/bookings/:id/cancel
──────────────────────────────────────────────────────────── */
export const cancelBooking = async (req, res) => {
  try {
    const { id }  = req.params
    const userId  = req.user.id

    const booking = await models.Booking.findOne({ where: { id, user_id: userId } })
    if (!booking) return res.status(404).json({ error: "Booking not found" })
    if (booking.status === "cancelled")
      return res.status(400).json({ error: "Booking is already cancelled" })
    if (booking.status === "completed")
      return res.status(400).json({ error: "Cannot cancel completed booking" })

    const hoursUntilCI = (new Date(booking.checkIn) - new Date()) / 36e5
    if (hoursUntilCI < 24)
      return res.status(400).json({ error: "Cannot cancel booking less than 24 hours before check-in" })

    await booking.update({
      status       : "cancelled",
      paymentStatus: booking.paymentStatus === "paid" ? "refunded" : "unpaid",
    })

    return res.json({
      message: "Booking cancelled successfully",
      booking: { id: booking.id, status: booking.status, paymentStatus: booking.paymentStatus },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ────────────────────────────────────────────────────────────
   Outside-booking helpers
──────────────────────────────────────────────────────────── */
export const getOutsideBookingByConfirmation = async (req, res) => {
  try {
    const { confirmation } = req.params
    if (!confirmation)
      return res.status(400).json({ error: "bookingConfirmation is required" })

    const ob = await models.OutsideBooking.findOne({
      where: { bookingConfirmation: confirmation },
    })
    if (!ob) return res.status(404).json({ error: "OutsideBooking not found" })

    return res.json(ob)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const getOutsideBookingWithAddOns = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid outsideBooking ID" });

    const ob = await models.OutsideBooking.findByPk(id, {
      include: [
        { model: models.User,  attributes: ["id", "name", "email"] },
        { model: models.Hotel },
        {
          model     : models.AddOn,
          attributes: ["id", "name", "slug", "description", "price"],
          through   : {                       // ★ NEW → pedimos status
            attributes: [
              "id",
              "qty",
              "unitPrice",
              "paymentStatus",
              "add_on_option_id",
              "status"                     // ★ NEW
            ],
          },
          include   : [
            { model: models.AddOnOption, attributes: ["id", "name", "price"] },
          ],
        },
      ],
    });
    if (!ob) return res.status(404).json({ error: "OutsideBooking not found" });

    const addons = ob.AddOns.map(addon => {
      const pivot  = addon.OutsideBookingAddOn;
      const option = addon.AddOnOptions?.find(
        o => o.id === pivot.add_on_option_id
      ) || null;

      return {
        bookingAddOnId: pivot.id,
        addOnId       : addon.id,
        addOnName     : addon.name,
        addOnSlug     : addon.slug,
        qty           : pivot.qty,
        unitPrice     : Number(pivot.unitPrice),
        paymentStatus : pivot.paymentStatus,
        status        : pivot.status,       // ★ NEW
        optionId      : option?.id    ?? null,
        optionName    : option?.name  ?? null,
        optionPrice   : option?.price ?? null,
      };
    });

    return res.json({
      id                 : ob.id,
      bookingConfirmation: ob.bookingConfirmation,
      guestName          : ob.guestName,
      guestLastName      : ob.guestLastName,
      guestEmail         : ob.guestEmail,
      guestPhone         : ob.guestPhone,
      checkIn            : ob.checkIn,
      checkOut           : ob.checkOut,
      status             : ob.status,
      paymentStatus      : ob.paymentStatus,
      user               : ob.User,
      hotel              : ob.Hotel,
      addons,                                // ← ya con status
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};
