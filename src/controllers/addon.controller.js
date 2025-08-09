/* ────────────────────────────────────────────────────────────────────────────
   src/controllers/addon.controller.js
──────────────────────────────────────────────────────────────────────────── */

import models from "../models/index.js";
import { Op } from "sequelize";
import nodemailer from "nodemailer";

/* ═══════════════════════════════════════════════════════════════════════════
   SMTP TRANSPORT
   ═════════════════════════════════════════════════════════════════════════ */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const getGuestMail = (bk) =>
  bk?.User?.email      // insider  (Booking → User)
  ?? bk?.guestEmail    // outsider
  ?? null;

const getGuestName = (bk) =>
  bk?.User?.name
  ?? bk?.guestName
  ?? "Guest";
/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═════════════════════════════════════════════════════════════════════════ */
const iconFromSlug = (slug) => {
  const root = slug.split("-")[0];
  switch (root) {
    case "incidentals": return "ShieldCheck";
    case "late": return "Clock";
    case "early": return "Sun";
    case "room": return "BedDouble";
    case "breakfast": return "Utensils";
    case "welcome": return "Gift";
    case "valet": return "Car";
    case "airport": return "Bus";
    case "laundry": return "Shirt";
    case "beach": return "Umbrella";
    case "miami": return "TreePalm";
    default: return "Gift";
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET  /api/addons
   ═════════════════════════════════════════════════════════════════════════ */
/* ──────────────────────────────────────────────────────────────
   GET  /api/addons/:hotelId/hotel-addons
   Devuelve el catálogo de add-ons para un hotel, incluyendo:
     • datos base del AddOn global
     • override/visibilidad del pivote hotel_add_on
     • (opcional) override de precio en cada opción
   ──────────────────────────────────────────────────────────── */
export const getHotelAddOns = async (req, res) => {
  try {
    const { hotelId } = req.params
    const { withOptions = 'true', q } = req.query
    const includeOpts = withOptions !== 'false'

    /** 1 ▪ Filtro de búsqueda **/
    const whereFilter = q && q.trim()
      ? { name: { [Op.iLike]: `%${q.trim()}%` } }
      : {}

    /** 2 ▪ Traer catálogo + pivote + opciones **/
    const addons = await models.AddOn.findAll({
      where: whereFilter,
      order: [['id', 'ASC']],
      attributes: [
        'id', 'slug', 'name', 'description', 'price',
        'type', 'defaultQty', 'icon', 'subtitle', 'footnote',
      ],
      include: [
        {
          model: models.HotelAddOn,
          required: true,
          where: { hotel_id: hotelId },
          attributes: [
            'id', 'price', 'defaultQty', 'name',
            'description', 'icon', 'subtitle', 'footnote', 'active'
          ]
        },
        ...(includeOpts ? [{
          model: models.AddOnOption,
          as: 'AddOnOptions',
          attributes: ['id', 'name', 'price'],
          include: [{
            model: models.HotelAddOnOption,
            required: false,
            attributes: ['price'],
            include: [{
              model: models.HotelAddOn,
              required: true,
              attributes: [],
              where: { hotel_id: hotelId }
            }]
          }]
        }] : [])
      ]
    })

    /** 3 ▪ Extraer IDs de pivote **/
    const pivotIds = addons
      .map(a => a.HotelAddOns?.[0]?.id)
      .filter(Boolean)

    /** 4 ▪ Cargar todas las asignaciones staff ↔ pivote **/
    const links = await models.HotelStaffAddOn.findAll({
      where: { hotel_add_on_id: pivotIds },
      attributes: ['hotel_add_on_id', 'staff_id']
    })

    /** 5 ▪ Construir mapa pivotId → [staffId,…] **/
    const staffMap = {}
    pivotIds.forEach(id => { staffMap[id] = [] })
    links.forEach(link => {
      staffMap[link.hotel_add_on_id].push(link.staff_id)
    })

    /** 6 ▪ Armar respuesta final – con id = hotelAddOn.id **/
    const payload = addons.map(a => {
      const ha = a.HotelAddOns?.[0] || {}

      const title = ha.name ?? a.name
      const description = ha.description ?? a.description
      const price = Number(ha.price ?? a.price)
      const iconName = ha.icon ?? a.icon
      const subtitle = ha.subtitle ?? a.subtitle
      const footnote = ha.footnote ?? a.footnote
      const defaultQty = a.type === 'quantity'
        ? ha.defaultQty ?? a.defaultQty ?? 1
        : null

      const options = (a.AddOnOptions || []).map(o => ({
        id: o.id,
        label: o.name,
        price: Number(o.HotelAddOnOptions?.[0]?.price ?? o.price)
      }))

      let type = a.type
      if (options.length && type !== 'options') type = 'options'

      const staffIds = staffMap[ha.id] || []

      return {
        id: a.id,        // ahora el ID es el de HotelAddOn
        hoteladdonId: ha.id,         // si necesitas el base AddOn ID
        slug: a.slug,
        hotelAddOnId: ha.id,
        active: ha.active ?? true,
        title,
        description,
        price,
        iconName,
        subtitle,
        footnote,
        staffIds,
        type,
        defaultQty,
        options,
      }
    })

    return res.json(payload)
  }
  catch (err) {
    console.error('🔥 Error fetching hotel add‑ons:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   POST /api/addons/request   (guest – insider booking)
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * Helper to calculate nights between two dates (inclusive start, exclusive end)
 */
const diffDays = (from, to) =>
  Math.max(1, Math.ceil((new Date(to) - new Date(from)) / 86_400_000))

export const requestAddOn = async (req, res) => {
  const userId = req.user.id
  const {
    bookingId = null,
    addOnId,
    optionId = null,
    qty = 1,
    roomId = null,
    id
  } = req.body

  console.log(req.body, "body")

  /* ───────── Validations ───────── */
  if (!addOnId) {
    return res.status(400).json({ error: "Missing addOnId" })
  }

  /* 1. Load booking (with hotel & user) */
  const booking = await models.Booking.findOne({
    where: {
      id: bookingId,
      status: { [Op.eq]: "confirmed" }
    },
    include: [
      { model: models.Hotel },
      { model: models.User, attributes: ["name", "email"] },
      { model: models.Room }
    ],
    order: [["createdAt", "DESC"]],
  })
  if (!booking) {
    return res.status(404).json({ error: "Booking not found or not eligible" })
  }

  /* 2. Load add-on */
  const addOn = await models.AddOn.findByPk(addOnId)
  if (!addOn) {
    return res.status(404).json({ error: "Add-on not found" })
  }

  /* 3. If roomUpgrade, validate roomId and load newRoom */
  let newRoom = null
  if (addOn.slug === "roomUpgrade") {
    if (!roomId) {
      return res.status(400).json({ error: "Missing roomId for roomUpgrade" })
    }
    newRoom = await models.Room.findOne({
      where: { id: roomId, hotel_id: booking.hotel_id }
    })
    if (!newRoom) {
      return res.status(404).json({ error: "Room not found in this hotel" })
    }
  }

  /* 4. Calculate unitPrice */
  let unitPrice = parseFloat(addOn.price)
  if (addOn.slug === "roomUpgrade") {
    const originalRoom = await models.Room.findOne({
      where: { id: booking.room_id }
    })
    if (!originalRoom) {
      return res.status(500).json({ error: "Original room data missing" })
    }
    const nights = diffDays(booking.checkIn, booking.checkOut)
    unitPrice = (parseFloat(newRoom.price) - parseFloat(originalRoom.price)) * nights
  } else if (optionId) {
    const opt = await models.AddOnOption.findByPk(optionId)
    if (!opt) {
      return res.status(404).json({ error: "Option not found" })
    }
    unitPrice = parseFloat(opt.price)
  }

  /* 5. Create pivot */
  let pivot
  try {
    pivot = await models.BookingAddOn.create({
      booking_id        : booking.id,
      add_on_id         : addOn.id,
      add_on_option_id  : optionId,
      room_id           : addOn.slug === "roomUpgrade" ? roomId : null,
      qty,
      unitPrice,
      paymentStatus     : "unpaid",
    })
  } catch (e) {
    console.error("DB error:", e.original || e)
    return res.status(500).json({
      error : "Could not save add-on",
      detail: e.original?.detail || e.message,
    })
  }

  /* 6. If roomUpgrade, update booking */
  if (addOn.slug === "roomUpgrade") {
    await booking.update({ room_id: newRoom.id })
  }

  /* 7. Build email details */
  const guestName = booking.User?.name || booking.User?.email || "Guest"
  const hotel     = booking.Hotel
  const detailLines = [
    `Hotel: ${hotel.name}`,
    hotel.address && `Address: ${hotel.address}`,
    hotel.city && `City: ${hotel.city}`,
    `Check-in: ${booking.checkIn}`,
    `Check-out: ${booking.checkOut}`,
    `Booking #: ${booking.id}`,
    `Add-on: ${addOn.name}`,
  ].filter(Boolean)

  if (addOn.slug === "roomUpgrade") {
    const nights = diffDays(booking.checkIn, booking.checkOut)
    const oldRoomName = booking.Room?.name || "Current room"
    detailLines.push(`Upgraded from "${oldRoomName}" to "${newRoom.name}"`)
    detailLines.push(`Price diff for ${nights} night(s): $${unitPrice.toFixed(2)}`)
  } else if (addOn.type === "options" && optionId) {
    const opt = await models.AddOnOption.findByPk(optionId)
    detailLines.push(`Option: ${opt.name} — $${parseFloat(opt.price).toFixed(2)}`)
    detailLines.push(`Quantity: 1 — Subtotal: $${unitPrice.toFixed(2)}`)
  } else if (addOn.type === "quantity") {
    detailLines.push(`Quantity: ${qty} × $${parseFloat(addOn.price).toFixed(2)}`)
    detailLines.push(`Subtotal: $${(qty * parseFloat(addOn.price)).toFixed(2)}`)
  } else {
    detailLines.push(`Price: $${unitPrice.toFixed(2)}`)
  }

  /* 8. Find all staff assigned to this add-on */
  const assignments = await models.HotelStaffAddOn.findAll({
    where: { hotel_add_on_id: id },
    include: [{
      model: models.Staff,
      as: "staff",
      attributes: ["email", "name"]
    }]
  })

  const staffEmails = assignments
    .map(a => a.staff?.email)
    .filter(Boolean)

  /* 9. Send email to Insider + assigned staff */
  const toEmails = [
    "ramiro.alet@gmail.com",
    ...new Set(staffEmails)
  ].join(", ")

  try {
    await transporter.sendMail({
      from   : `"Insider Bookings" <${process.env.SMTP_USER}>`,
      to     : toEmails,
      subject: `🔔 New add-on request – ${addOn.name} for ${hotel.name}`,
      text   : [`Guest: ${guestName}`, ...detailLines].join("\n"),
      html   : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #2c5aa0; margin: 0; font-size: 24px;">🔔 New Add-on Request</h1>
              <p style="color: #666; margin: 10px 0 0 0; font-size: 16px;">Action required from hotel staff</p>
            </div>
            <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #2196f3; margin-bottom: 25px;">
              <h3 style="color: #1976d2; margin: 0 0 10px 0; font-size: 18px;">👤 Guest Information</h3>
              <p style="color: #333; margin: 0; font-size: 16px; font-weight: bold;">${guestName}</p>
            </div>
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #2c5aa0; margin: 0 0 15px 0; font-size: 18px;">📋 Booking & Add-on Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                ${detailLines.map(line => {
                  const [label, ...valueParts] = line.split(": ")
                  const value = valueParts.join(": ")
                  return `
                    <tr>
                      <td style="padding: 8px 0; color: #666; font-weight: bold; width: 35%; vertical-align: top;">${label}:</td>
                      <td style="padding: 8px 0; color: #333; vertical-align: top;">${value}</td>
                    </tr>`
                }).join("")}
              </table>
            </div>
            <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107; margin-bottom: 25px;">
              <h3 style="color: #856404; margin: 0 0 10px 0; font-size: 18px;">⚡ Action Required</h3>
              <p style="color: #856404; margin: 0; font-size: 16px;">
                Please review this request and approve/reject it through the hotel management system.
              </p>
            </div>
            <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; text-align: center;">
              <p style="color: #666; font-size: 14px; margin: 0;">
                <strong>Insider Bookings</strong> - Hotel Management System
              </p>
              <p style="color: #999; font-size: 12px; margin: 10px 0 0 0;">
                This is an automated notification. Please do not reply to this email.
              </p>
            </div>
          </div>
        </div>`,
    })
  } catch (e) {
    console.error("DB error:", e.original || e)
    return res.status(500).json({
      error : "Could not save add-on",
      detail: e.original?.detail || e.message,
    })
  }
  return res.status(201).json({ ok: true, bookingAddOnId: pivot.id })
}


/* ═══════════════════════════════════════════════════════════════════════════
   POST /api/addons/bookings/outside/:id   (outside booking)
   ═════════════════════════════════════════════════════════════════════════ */
export const saveBookingAddOns = async (req, res) => {
  const bookingId = Number(req.params.id);
  const { addons, discount = false } = req.body;

  if (!bookingId || !Array.isArray(addons)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const booking = await models.Booking.findByPk(bookingId);
  if (!booking) {
    return res.status(404).json({ error: "Booking not found" });
  }

  const t = await models.BookingAddOn.sequelize.transaction();
  try {
    // 1. Eliminar add-ons previos
    await models.BookingAddOn.destroy({
      where: { booking_id: bookingId },
      transaction: t,
    });

    // 2. Insertar los nuevos
    for (const item of addons) {
      const addOn = await models.AddOn.findOne({
        where: { slug: item.id },
        transaction: t,
      });
      if (!addOn) continue;

      let optionId = null;
      let unitPrice = Number(addOn.price);
      const quantity = Number(item.qty ?? 1);

      if (item.optionId) {
        const opt = await models.AddOnOption.findByPk(item.optionId, {
          transaction: t,
        });
        if (opt) {
          optionId = opt.id;
          unitPrice = Number(opt.price);
        }
      }

      await models.BookingAddOn.create(
        {
          booking_id       : bookingId,
          add_on_id        : addOn.id,
          add_on_option_id : optionId,
          quantity         : quantity,
          unit_price       : unitPrice,
          payment_status   : "paid",
          status           : "ready",
        },
        { transaction: t }
      );
    }

    // 3. Actualizar estado si hubo descuento
    if (discount) {
      await booking.update(
        { status: "discount" },
        { transaction: t }
      );
    }

    await t.commit();
    return res.status(201).json({
      ok: true,
      count: addons.length,
      statusUpdate: discount ? "discount" : booking.status,
    });
  } catch (err) {
    await t.rollback();
    console.error("saveBookingAddOns:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
export const confirmAddOnRequest = async (req, res) => {
  const id = Number(req.params.id)
  const approved = true // siempre "confirm" en esta ruta

  const pivot = await models.BookingAddOn.findByPk(id, {
    include: [
      {
        model: models.Booking,
        as: "booking",
        include: [
          { model: models.User, attributes: ["name", "email"], as: "User" },
          { model: models.Hotel, attributes: ["name"], as: "Hotel" },
        ],
      },
      { model: models.AddOn, as: "addOn" },
    ],
  })

  if (!pivot) return res.status(404).json({ error: "Request not found" })

  if (pivot.status !== "pending") return res.status(400).json({ error: "Already processed" })

  pivot.status = approved ? "confirmed" : "rejected"
  await pivot.save()

  /* -------- correo al huésped ------------------------------------------ */
  const guestMail = getGuestMail(pivot.booking)
  if (guestMail) {
    const guestName = getGuestName(pivot.booking)
    const hotelName = "Insider Bookings"
    const addOnName = pivot.addOn?.name ?? "add-on"

    const isApproved = approved
    const statusIcon = isApproved ? "✅" : "❌"
    const statusColor = isApproved ? "#28a745" : "#dc3545"
    const statusBg = isApproved ? "#d4edda" : "#f8d7da"

    const mailOpts = {
      from: `"${hotelName}" <${process.env.SMTP_USER}>`,
      to: guestMail,
      subject: `${statusIcon} Your add-on request has been ${approved ? "approved" : "rejected"}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: ${statusColor}; margin: 0; font-size: 24px;">
                ${statusIcon} Request ${isApproved ? "Approved" : "Rejected"}
              </h1>
            </div>
            <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
              Hi <strong>${guestName}</strong>,
            </p>
            <div style="background-color: ${statusBg}; padding: 20px; border-radius: 8px; border-left: 4px solid ${statusColor}; margin-bottom: 25px;">
              <p style="font-size: 16px; color: #333; line-height: 1.6; margin: 0;">
                ${isApproved
          ? `Good news! Your request for "<strong>${addOnName}</strong>" has been approved.`
          : `Unfortunately we couldn't add "<strong>${addOnName}</strong>" to your booking.`
        }
              </p>
            </div>
            ${isApproved
          ? `
            <div style="text-align: center; margin: 30px 0;">
              <div style="background-color: #007bff; color: white; padding: 15px 30px; border-radius: 25px; display: inline-block; font-weight: bold; font-size: 16px;">
                📱 Open Insider App to Complete Payment
              </div>
            </div>`
          : `
            <div style="text-align: center; margin: 30px 0;">
              <p style="color: #666; font-size: 16px; font-style: italic;">
                Sorry for the inconvenience. Please contact us if you have any questions.
              </p>
            </div>`}
            <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; text-align: center;">
              <p style="color: #666; font-size: 14px; margin: 0;">
                Thank you,<br>
                <strong>${hotelName}</strong>
              </p>
            </div>
          </div>
        </div>`,
      text: approved
        ? `Hi ${guestName},

Good news! Your request for "${addOnName}" has been approved.

Open the Insider app to complete the payment.

Thank you,
${hotelName}`
        : `Hi ${guestName},

Unfortunately we couldn't add "${addOnName}" to your booking.

Sorry for the inconvenience,
${hotelName}`,
    }

    transporter.sendMail(mailOpts).catch(console.error)
  }

  return res.json({ ok: true, status: pivot.status })
}


export const getRequestedAddOns = async (req, res) => {
  try {
    const requests = await models.BookingAddOn.findAll({
      include: [
        {
          model: models.Booking,
          as: "booking",
          include: [
            { model: models.User,  attributes: ["id", "name", "email"] },
            { model: models.Hotel, attributes: ["id", "name"] },
            { model: models.Room,  attributes: ["name", "roomNumber"] },
          ],
        },
        { model: models.AddOn, as: "addOn", attributes: ["id", "name", "slug"] },
      ],
      order: [["createdAt", "DESC"]],
    })

    const payload = requests.map((r) => ({
      id: r.id,
      status: r.status,
      guestName:    r.booking.User?.name       ?? r.booking.guestName ?? null,
      bookingConfirmation: r.booking.bookingConfirmation ?? r.booking.id,
      roomType:     r.booking.room_type        ?? r.booking.Room?.name       ?? null,
      roomNumber:   r.booking.room_number      ?? r.booking.Room?.roomNumber ?? null,
      addOnName:    r.addOn.name,
    }))

    return res.json(payload)
  } catch (err) {
    console.error("Error fetching requests:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

// src/controllers/addon.controller.js



/**
 * PUT /api/addons/bookings/outside/ready/:id

 */
export const markBookingAddOnReady = async (req, res) => {
  try {
    const id = Number(req.params.id)

    if (!id) {
      return res.status(400).json({ error: "Invalid add-on ID" })
    }

    /* 1 ▪ Buscar el pivote BookingAddOn (+ Booking + Hotel + User) */
    const pivot = await models.BookingAddOn.findByPk(id, {
      include: [
        {
          model : models.Booking,
          as    : "booking",
          include: [
            { model: models.User,  as: "User",  attributes: ["name", "email"] },
            { model: models.Hotel, as: "Hotel", attributes: ["name"] },
          ],
        },
        { model: models.AddOn, as: "addOn", attributes: ["name"] },
      ],
    })

    if (!pivot)
      return res.status(404).json({ error: "Add-on request not found" })

    if (pivot.status === "ready")
      return res.status(400).json({ error: "Already marked ready" })

    /* 2 ▪ Actualizar estado */
    pivot.status = "ready"
    await pivot.save()

    /* 3 ▪ Notificar al huésped (si hay correo) */
    const guestMail = getGuestMail(pivot.booking)
    if (guestMail) {
      const guestName = getGuestName(pivot.booking)
      const hotelName = pivot.booking.Hotel?.name ?? "Our Hotel"
      const addOnName = pivot.addOn?.name       ?? "add-on"

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Add-on ready</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr><td style="padding:32px;text-align:center;">
          <h1 style="margin:0 0 18px 0;font-size:24px;color:#2c5aa0;">🎉 Your add-on is ready!</h1>
          <p style="margin:0 0 24px 0;font-size:16px;color:#333;">Hi <strong>${guestName}</strong>, your <strong>${addOnName}</strong> is now ready for payment.</p>
          <table role="presentation" width="100%" style="background:#f8f9fa;border-radius:6px;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 6px 0;font-weight:bold;color:#666;">Hotel:</p>
              <p style="margin:0;color:#333;">${hotelName}</p>
              <p style="margin:12px 0 6px 0;font-weight:bold;color:#666;">Booking #:</p>
              <p style="margin:0;color:#333;">${pivot.booking.bookingConfirmation || pivot.booking.id}</p>
            </td></tr>
          </table>
          <a href="${process.env.CLIENT_URL}/payment/addons?booking=${pivot.booking.id}"
             style="display:inline-block;padding:12px 24px;background:#28a745;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">
            Pay now
          </a>
          <p style="margin:24px 0 0 0;font-size:12px;color:#888;">Thank you for choosing ${hotelName}.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

      const text = `Hi ${guestName},

Your "${addOnName}" add-on for booking #${pivot.booking.bookingConfirmation || pivot.booking.id} at ${hotelName} is ready for payment.

Please open the Insider app to complete the payment.

Thank you for choosing ${hotelName}.`

      await transporter.sendMail({
        from   : `"Insider Bookings" <${process.env.SMTP_USER}>`,
        to     : guestMail,
        subject: `✅ Your ${addOnName} is ready for payment`,
        html,
        text,
      }).catch(err => console.error("Mail error:", err))
    }

    /* 4 ▪ Responder OK */
    return res.json({
      ok    : true,
      id    : pivot.id,
      status: pivot.status,
    })
  } catch (err) {
    console.error("markBookingAddOnReady:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   GET  /api/addons/staff-requests?hotelIds=12,11
        /api/addons/staff-requests?hotelIds=12&hotelIds=11
        /api/addons/staff-requests?hotelIds[]=12&hotelIds[]=11
──────────────────────────────────────────────────────────────────────────── */
export const getRequestedAddOnsByStaff = async (req, res) => {
  try {
    /* 1 ▪ hotelIds desde query */
    let raw = req.query.hotelIds ?? req.query["hotelIds[]"] ?? []
    if (!Array.isArray(raw)) raw = [raw]
    const hotelIds = raw.map(Number).filter(id => !Number.isNaN(id))
    if (!hotelIds.length)
      return res.status(400).json({ error: "Missing or invalid hotelIds" })

    /* 2 ▪ datos del usuario */
    const roleId  = Number(req.user.roleId)
    const staffId = Number(req.user.id)

    /* ══════════ MANAGER (rol 3) → todo de esos hoteles ══════════ */
    if (roleId === 3) {
      const insider = await models.BookingAddOn.findAll({
        include: [
          {
            model    : models.Booking,
            as       : "booking",
            required : true,
            where    : { hotel_id: { [Op.in]: hotelIds } },
            attributes: [
              "id", "hotel_id", "room_id",
              "guestName", "checkIn", "checkOut",
            ],
            include: [
              { model: models.Room, attributes: ["name", "roomNumber"] },
            ],
          },
          {
            model    : models.AddOn,
            as       : "addOn",
            include  : [{ model: models.AddOnOption, as: "AddOnOptions" }],
          },
          { model: models.AddOnOption, as: "option" },
        ],
        order: [["createdAt", "DESC"]],
      })

      return res.json({ insider })
    }

    /* ══════════ STAFF normal → solo add-ons asignados ══════════ */
    /* a) IDs de add_on asignados a este staff */
    const assigned = await models.HotelStaffAddOn.findAll({
      where   : { staff_id: staffId },
      include : [{
        model      : models.HotelAddOn,
        as         : "hotelAddOn",
        attributes : ["add_on_id"],
      }],
    })

    const assignedAddOnIds = assigned
      .map(a => a.hotelAddOn?.add_on_id)
      .filter(id => Number.isInteger(id))

    if (!assignedAddOnIds.length)
      return res.json({ insider: [] })

    /* b) traer BookingAddOn filtrados por esos IDs + hoteles */
    const insider = await models.BookingAddOn.findAll({
      where: { add_on_id: { [Op.in]: assignedAddOnIds } },
      include: [
        {
          model    : models.Booking,
          as       : "booking",
          required : true,
          where    : { hotel_id: { [Op.in]: hotelIds } },
          attributes: [
            "id", "hotel_id", "room_id",
            "guestName", "checkIn", "checkOut",
          ],
          include: [{ model: models.Room, attributes: ["name", "roomNumber"] }],
        },
        {
          model    : models.AddOn,
          as       : "addOn",
          include  : [{ model: models.AddOnOption, as: "AddOnOptions" }],
        },
        { model: models.AddOnOption, as: "option" },
      ],
      order: [["createdAt", "DESC"]],
    })

    return res.json({ insider })
  } catch (err) {
    console.error("getRequestedAddOnsByStaff:", err)
    return res.status(500).json({ error: "Server error" })
  }
}
/* ────────────────────────────────────────────────────────────────
   LIST  /api/addons/:hotelId/manage-addons
   Devuelve **todos** los add-ons (activos o no) con los overrides
   del hotel para que el staff pueda editarlos.
───────────────────────────────────────────────────────────────── */
export const listHotelAddOnsForEdit = async (req, res) => {
  try {
    const { hotelId } = req.params
    const { q = "" } = req.query
    const whereAddOn = q ? { name: { [Op.iLike]: `%${q.trim()}%` } } : {}

    const records = await models.AddOn.findAll({
      where: whereAddOn,
      order: [["id", "ASC"]],
      attributes: ["id", "slug", "name", "description", "price", "icon"],
      include: [
        {
          model: models.HotelAddOn,
          required: false,                  // ← incluimos aunque no exista override
          where: { hotel_id: hotelId },
          attributes: [
            "id", "price", "name", "description",
            "icon", "subtitle", "footnote",
            "defaultQty", "active",
          ],
        },
        {
          model: models.AddOnOption,
          as: "AddOnOptions",
          attributes: ["id", "name", "price"],
          include: [
            {
              model: models.HotelAddOnOption,
              required: false,
              attributes: ["id", "price"],
              include: [
                {
                  model: models.HotelAddOn,
                  required: true,
                  attributes: [],
                  where: { hotel_id: hotelId },
                },
              ],
            },
          ],
        },
      ],
    })

    const payload = records.map((a) => {
      const ha = a.HotelAddOns?.[0] || {}
      const opts = a.AddOnOptions?.map((o) => ({
        id: o.id,
        label: o.name,
        basePrice: Number(o.price),
        overridePrice: Number(o.HotelAddOnOptions?.[0]?.price ?? o.price),
      })) ?? []

      return {
        id: a.id,
        slug: a.slug,
        baseName: a.name,
        baseDesc: a.description,
        basePrice: Number(a.price),
        override: {
          id: ha.id || null,
          active: ha.active ?? false,
          name: ha.name ?? null,
          description: ha.description ?? null,
          price: ha.price ?? null,
          icon: ha.icon ?? null,
          subtitle: ha.subtitle ?? null,
          footnote: ha.footnote ?? null,
          defaultQty: ha.defaultQty ?? null,
        },
        options: opts,
      }
    })

    return res.json(payload)
  } catch (err) {
    console.error("listHotelAddOnsForEdit:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ────────────────────────────────────────────────────────────────
   PUT /api/addons/:hotelId/manage-addons/:addOnId
   Crea (o actualiza) el pivot hotel_add_on con los campos enviados.
   Body permitido: { active, price, name, description, icon, subtitle,
                     footnote, defaultQty }
───────────────────────────────────────────────────────────────── */
export const updateHotelAddOn = async (req, res) => {
  const { hotelId, id } = req.params;
  const { description, price, active, staffIds } = req.body;

  try {
    const pivot = await models.HotelAddOn.findOne({
      where: { id, hotel_id: hotelId },
    });
    if (!pivot) {
      return res.status(404).json({ error: "Hotel‑add‑on not found" });
    }

    const t = await pivot.sequelize.transaction();
    try {
      const updates = {};
      if (description !== undefined) updates.description = description;
      if (price !== undefined) updates.price = price;
      if (active !== undefined) updates.active = active;
      if (Object.keys(updates).length) {
        await pivot.update(updates, { transaction: t });
      }

      if (Array.isArray(staffIds)) {
        const currentStaff = await pivot.getAssignedStaff({ transaction: t });
        const currentIds = currentStaff.map(s => s.id);

        const toAdd = staffIds.filter(sid => !currentIds.includes(sid));
        const toRemove = currentIds.filter(cid => !staffIds.includes(cid));

        if (toRemove.length) {
          await models.HotelStaffAddOn.destroy({
            where: { hotel_add_on_id: pivot.id, staff_id: toRemove },
            force: true,
            transaction: t
          });
        }
        for (const staffId of toAdd) {
          await models.HotelStaffAddOn.create({
            hotel_add_on_id: pivot.id,
            staff_id: staffId
          }, { transaction: t });
        }
      }

      await t.commit();
    } catch (syncErr) {
      await t.rollback();
      throw syncErr;
    }

    const updated = await models.HotelAddOn.findOne({
      where: { id, hotel_id: hotelId },
      include: [{
        model: models.Staff,
        as: "assignedStaff",
        attributes: ["id", "name", "email"]
      }]
    });

    return res.json({ ok: true, hotelAddOn: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

/* ────────────────────────────────────────────────────────────────
   PUT /api/addons/:hotelId/manage-addons/:addOnId/options/:optionId
   Actualiza SOLO el precio override de una opción concreta.
   Body: { price: 12.34 }
───────────────────────────────────────────────────────────────── */
export const updateHotelAddOnOption = async (req, res) => {
  try {
    const { hotelId, addOnId, optionId } = req.params
    const { price } = req.body
    if (typeof price !== "number")
      return res.status(400).json({ error: "Invalid price" })

    /* buscamos (o creamos) pivote hotel_add_on */
    const [ha] = await models.HotelAddOn.findOrCreate({
      where: { hotel_id: hotelId, add_on_id: addOnId },
      defaults: { active: true },
    })

    /* buscamos (o creamos) pivote option */
    const [hao] = await models.HotelAddOnOption.findOrCreate({
      where: { hotel_add_on_id: ha.id, add_on_option_id: optionId },
      defaults: { price },
    })

    hao.price = price
    await hao.save()

    return res.json({ ok: true, id: hao.id, price })
  } catch (err) {
    console.error("updateHotelAddOnOption:", err)
    return res.status(500).json({ error: "Server error" })
  }
}


