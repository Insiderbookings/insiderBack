// src/controllers/booking.controller.js
import Booking from "../models/Booking.js";
import models from "../models/index.js";

/* ───────────── Helpers ───────────── */
const diffDays = (from, to) => {
  const ms = new Date(to) - new Date(from);
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
};

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
      rooms,          // ← viene del frontend
      guestName,
      guestEmail,
      guestPhone,
      discountCode,   // string (opcional)
    } = req.body;

    console.log(user_id, hotel_id, room_id, checkIn, checkOut, guestName, guestEmail)

    /* ── Validación básica ───────────────────────────── */
    if (
       !hotel_id || !room_id ||
      !checkIn  || !checkOut || !guestName || !guestEmail
    ) {
      console.log("aqui")
      return res.status(400).json({ error: "Missing required fields" });
    }

    /* ── Validar y aplicar descuento ─────────────────── */
    let discount       = null;
    let discountPct    = 0;
    let discount_code_id = null;
    let staff_id       = null;

    if (discountCode) {
      discount = await models.DiscountCode.findOne({
        where  : { code: discountCode },
        include: "staff",
      });
      if (!discount)
        return res.status(404).json({ error: "Invalid discount code" });
      if (discount.endsAt && new Date(discount.endsAt) < new Date())
        return res.status(400).json({ error: "Discount code expired" });

      discountPct       = discount.percentage;
      discount_code_id  = discount.id;
      staff_id          = discount.staff_id;

      discount.timesUsed += 1;
      await discount.save();
    }

    /* ── Obtener habitación y calcular total ─────────── */
    const room = await models.Room.findByPk(room_id);
    if (!room) return res.status(404).json({ error: "Room not found" });

    const nights = diffDays(checkIn, checkOut);
    const numRooms = rooms ?? 1;
    const base  = Number(room.price) * nights * numRooms;
    const total = discountPct ? base * (1 - discountPct / 100) : base;

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
      status       : "pending",
      paymentStatus: "unpaid",
    });

    /* ── Registrar comisión (descuentos staff) ──────── */
    if (staff_id) {
      const staff = await models.Staff.findByPk(staff_id, {
        include: "role",
      });
      const commissionAmt =
        (total * staff.role.commissionPct) / 100;

      await models.Commission.create({
        booking_id: booking.id,
        staff_id,
        amount: commissionAmt,
      });
    }

    return res.status(201).json(booking);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

/* ───────────── GET /api/bookings/me ───────────── */
export const getBookingsForUser = async (req, res) => {
  try {
    const bookings = await models.Booking.findAll({
      where: { user_id: req.user.id },
      include: [
        { model: models.Hotel, attributes: ["name", "location", "image"] },
        { model: models.Room,  attributes: ["name", "image", "price"] },
      ],
    });
    return res.json(bookings);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

/* ───────────── GET /api/bookings/staff/me ───────────── */
export const getBookingsForStaff = async (req, res) => {
  try {
    const staffId  = req.user.id;
    const bookings = await models.Booking.findAll({
      include: [
        { model: models.DiscountCode, where: { staff_id: staffId } },
        { model: models.Hotel, attributes: ["name"] },
        { model: models.Room,  attributes: ["name"] },
      ],
    });
    return res.json(bookings);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await models.Booking.findByPk(id, {
      include: [
        // datos del usuario
        { model: models.User,  attributes: ["id", "name", "email"] },
        // datos del hotel
        { model: models.Hotel, attributes: ["id", "name", "location", "image"] },
        // datos de la habitación
        { model: models.Room,  attributes: ["id", "name", "price", "image"] },
      ],
    });

    if (!booking) {
      return res.status(404).json({ error: "Booking no encontrado" });
    }

    return res.json(booking);
  } catch (err) {
    console.error("Error al recuperar booking:", err);
    return res.status(500).json({ error: "Server error" });
  }
};