import models from "../models/index.js"

/* ───────────── Helpers ───────────── */
const diffDays = (from, to) => {
  const ms = new Date(to) - new Date(from)
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

/* ───────────── POST /api/bookings ───────────── */
export const createBooking = async (req, res) => {
  try {
    const {
      user_id,
      hotel_id,
      room_id,
      checkIn,
      checkOut,
      adults,
      children,
      rooms, // ← viene del frontend
      guestName,
      guestEmail,
      guestPhone,
      discountCode, // string (opcional)
    } = req.body

    console.log(user_id, hotel_id, room_id, checkIn, checkOut, guestName, guestEmail)

    /* ── Validación básica ───────────────────────────── */
    if (!hotel_id || !room_id || !checkIn || !checkOut || !guestName || !guestEmail) {
      console.log("aqui")
      return res.status(400).json({ error: "Missing required fields" })
    }

    /* ── Validar y aplicar descuento ─────────────────── */
    let discount = null
    let discountPct = 0
    let discount_code_id = null
    let staff_id = null

    if (discountCode) {
      discount = await models.DiscountCode.findOne({
        where: { code: discountCode },
        include: "staff",
      })
      if (!discount) return res.status(404).json({ error: "Invalid discount code" })
      if (discount.endsAt && new Date(discount.endsAt) < new Date())
        return res.status(400).json({ error: "Discount code expired" })

      discountPct = discount.percentage
      discount_code_id = discount.id
      staff_id = discount.staff_id

      discount.timesUsed += 1
      await discount.save()
    }

    /* ── Obtener habitación y calcular total ─────────── */
    const room = await models.Room.findByPk(room_id)
    if (!room) return res.status(404).json({ error: "Room not found" })

    const nights = diffDays(checkIn, checkOut)
    const numRooms = rooms ?? 1
    const base = Number(room.price) * nights * numRooms
    const total = discountPct ? base * (1 - discountPct / 100) : base

    /* ── Crear booking ──────────────────────────────── */
    const booking = await models.Booking.create({
      user_id,
      hotel_id,
      room_id,
      discount_code_id,
      checkIn,
      checkOut,
      adults,
      children,
      guestName,
      guestEmail,
      guestPhone,
      total,
      status: "pending",
      paymentStatus: "unpaid",
    })

    /* ── Registrar comisión (descuentos staff) ──────── */
    if (staff_id) {
      const staff = await models.Staff.findByPk(staff_id, {
        include: "role",
      })
      const commissionAmt = (total * staff.role.commissionPct) / 100

      await models.Commission.create({
        booking_id: booking.id,
        staff_id,
        amount: commissionAmt,
      })
    }

    return res.status(201).json(booking)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ───────────── GET /api/bookings/me ───────────── */
export const getBookingsForUser = async (req, res) => {
  console.log("aqui")
  try {
    const { status, limit = 50, offset = 0 } = req.query

    // Construir filtros
    const whereClause = { user_id: req.user.id }
    if (status) {
      whereClause.status = status
    }

    const bookings = await models.Booking.findAll({
      where: whereClause,
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
      limit: Number.parseInt(limit),
      offset: Number.parseInt(offset),
    })

    // Formatear datos para el frontend
    const formattedBookings = bookings.map((booking) => {
      const nights = diffDays(booking.checkIn, booking.checkOut)

      return {
        id: booking.id,
        hotelName: booking.Hotel.name,
        location: `${booking.Hotel.city || booking.Hotel.location}, ${booking.Hotel.country || ""}`
          .trim()
          .replace(/,$/, ""),
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        guests: booking.adults + booking.children,
        adults: booking.adults,
        children: booking.children,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        total: Number.parseFloat(booking.total),
        nights,
        rating: booking.Hotel.rating,
        image: booking.Hotel.image || booking.Room.image,
        roomName: booking.Room.name,
        roomPrice: Number.parseFloat(booking.Room.price),
        beds: booking.Room.beds,
        capacity: booking.Room.capacity,
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        guestPhone: booking.guestPhone,
        discountCode: booking.DiscountCode
          ? {
              code: booking.DiscountCode.code,
              percentage: booking.DiscountCode.percentage,
            }
          : null,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
      }
    })

    return res.json(formattedBookings)
  } catch (err) {
    console.error("Error getting user bookings:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ───────────── GET /api/bookings/staff/me ───────────── */
export const getBookingsForStaff = async (req, res) => {
  try {
    const staffId = req.user.id
    const bookings = await models.Booking.findAll({
      include: [
        { model: models.DiscountCode, where: { staff_id: staffId } },
        { model: models.Hotel, attributes: ["name"] },
        { model: models.Room, attributes: ["name"] },
      ],
    })
    return res.json(bookings)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ───────────── GET /api/bookings/:id ───────────── */
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params

    const booking = await models.Booking.findByPk(id, {
      include: [
        // datos del usuario
        { model: models.User, attributes: ["id", "name", "email"] },
        // datos del hotel
        {
          model: models.Hotel,
          attributes: ["id", "name", "location", "image", "address", "city", "country", "rating"],
        },
        // datos de la habitación
        { model: models.Room, attributes: ["id", "name", "price", "image", "beds", "capacity"] },
        // código de descuento si existe
        {
          model: models.DiscountCode,
          attributes: ["id", "code", "percentage"],
          required: false,
        },
      ],
    })

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" })
    }

    // Formatear respuesta
    const nights = diffDays(booking.checkIn, booking.checkOut)
    const formattedBooking = {
      id: booking.id,
      user: booking.User,
      hotel: booking.Hotel,
      room: booking.Room,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights,
      adults: booking.adults,
      children: booking.children,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      guestPhone: booking.guestPhone,
      total: Number.parseFloat(booking.total),
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      discountCode: booking.DiscountCode,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    }

    return res.json(formattedBooking)
  } catch (err) {
    console.error("Error al recuperar booking:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ───────────── PUT /api/bookings/:id/cancel ───────────── */
export const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.id

    const booking = await models.Booking.findOne({
      where: { id, user_id: userId },
    })

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" })
    }

    // Verificar que la reserva se pueda cancelar
    if (booking.status === "cancelled") {
      return res.status(400).json({ error: "Booking is already cancelled" })
    }

    if (booking.status === "completed") {
      return res.status(400).json({ error: "Cannot cancel completed booking" })
    }

    // Verificar que no sea muy tarde para cancelar (ej: 24 horas antes)
    const checkInDate = new Date(booking.checkIn)
    const now = new Date()
    const hoursUntilCheckIn = (checkInDate - now) / (1000 * 60 * 60)

    if (hoursUntilCheckIn < 24) {
      return res.status(400).json({
        error: "Cannot cancel booking less than 24 hours before check-in",
      })
    }

    // Actualizar estado
    await booking.update({
      status: "cancelled",
      paymentStatus: booking.paymentStatus === "paid" ? "refunded" : "unpaid",
    })

    return res.json({
      message: "Booking cancelled successfully",
      booking: {
        id: booking.id,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
      },
    })
  } catch (err) {
    console.error("Error cancelling booking:", err)
    return res.status(500).json({ error: "Server error" })
  }
}
