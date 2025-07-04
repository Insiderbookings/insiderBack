/* ────────────────────────────────────────────────────────────────────────────
   src/controllers/addon.controller.js
──────────────────────────────────────────────────────────────────────────── */

import models         from "../models/index.js";
import { Op }         from "sequelize";
import nodemailer     from "nodemailer";

/* ═══════════════════════════════════════════════════════════════════════════
   SMTP TRANSPORT
   ═════════════════════════════════════════════════════════════════════════ */
const transporter = nodemailer.createTransport({
  host  : process.env.SMTP_HOST,
  port  : Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth  : {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const getGuestMail = (bk) =>
  bk?.User?.email      // insider  (Booking → User)
  ?? bk?.guestEmail    // outsider (OutsideBooking.guestEmail)
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
    case "late":        return "Clock";
    case "early":       return "Sun";
    case "room":        return "BedDouble";
    case "breakfast":   return "Utensils";
    case "welcome":     return "Gift";
    case "valet":       return "Car";
    case "airport":     return "Bus";
    case "laundry":     return "Shirt";
    case "beach":       return "Umbrella";
    case "miami":       return "TreePalm";
    default:            return "Gift";
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET  /api/addons
   ═════════════════════════════════════════════════════════════════════════ */
export const getAddOns = async (req, res) => {
  try {
    const { withOptions, q } = req.query;
    const includeOpts = withOptions === "false" ? false : true;

    const where = q
      ? { name: { [Op.iLike]: `%${q.trim()}%` } }
      : {};

    const addons = await models.AddOn.findAll({
      where,
      order      : [["id", "ASC"]],
      attributes : [
        "id", "slug", "name", "description", "price",
        "type", "defaultQty", "icon", "subtitle", "footnote",
      ],
      include: includeOpts
        ? [{
            model      : models.AddOnOption,
            as         : "AddOnOptions",
            attributes : ["id", "name", "price"],
            order      : [["price", "ASC"]],
          }]
        : [],
    });

    const payload = addons.map(a => {
      const opts = a.AddOnOptions ?? [];
      let   type = a.type;
      if (opts.length && type !== "options") type = "options";

      return {
        id          : a.id,
        slug        : a.slug,
        title       : a.name,
        description : a.description,
        price       : Number(a.price),
        iconName    : a.icon || iconFromSlug(a.slug),
        subtitle    : a.subtitle,
        footnote    : a.footnote,
        type,
        defaultQty  : type === "quantity" ? a.defaultQty ?? 1 : null,
        options     : opts.map(o => ({
          id    : o.id,
          label : o.name,
          price : Number(o.price),
        })),
      };
    });

    return res.json(payload);
  } catch (err) {
    console.error("Error fetching add-ons:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

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

  const { bookingId = null, addOnId, optionId = null, qty = 1, roomId = null } = req.body

  console.log(req.body, "body")
  console.log(userId, "userid")

  /* ───────── Validations ───────── */
  if (!addOnId) return res.status(400).json({ error: "Missing addOnId" })

  /* 1. Load booking (with hotel & user) */
  const whereBooking = { id: bookingId, status: { [Op.eq]: "confirmed" } }
  const booking = await models.OutsideBooking.findOne({
    where: whereBooking,
    include: [{ model: models.Hotel }, { model: models.User, attributes: ["name", "email"] }],
    order: [["createdAt", "DESC"]],
  })

  console.log(booking, "booking")

  if (!booking) return res.status(404).json({ error: "Booking not found or not eligible" })

  /* 2. Load add-on */
  const addOn = await models.AddOn.findByPk(addOnId)

  if (!addOn) return res.status(404).json({ error: "Add-on not found" })

  /* 3. If roomUpgrade, validate roomId and load newRoom */
  let newRoom = null
  if (addOn.slug === "roomUpgrade") {
    if (!roomId) return res.status(400).json({ error: "Missing roomId for roomUpgrade" })

    newRoom = await models.Room.findOne({
      where: { id: roomId, hotel_id: booking.hotel_id },
    })

    if (!newRoom) return res.status(404).json({ error: "Room not found in this hotel" })
  }

  /* 4. Calculate unitPrice */
  let unitPrice = Number.parseFloat(addOn.price)

  if (addOn.slug === "roomUpgrade") {
    const originalRoom = await models.Room.findOne({
      where: {
        hotel_id: booking.hotel_id,
        name: booking.room_type,
      },
    })

    if (!originalRoom) return res.status(500).json({ error: "Original room data missing" })

    const nights = diffDays(booking.checkIn, booking.checkOut)
    unitPrice = (Number.parseFloat(newRoom.price) - Number.parseFloat(originalRoom.price)) * nights
  } else if (optionId) {
    const opt = await models.AddOnOption.findByPk(optionId)
    if (!opt) return res.status(404).json({ error: "Option not found" })

    unitPrice = Number.parseFloat(opt.price)
  }

  /* 5. Create pivot */
  try {
    const pivot = await models.OutsideBookingAddOn.create({
      outsidebooking_id: booking.id,
      add_on_id: addOn.id,
      add_on_option_id: optionId,
      room_id: addOn.slug === "roomUpgrade" ? roomId : null,
      qty,
      unitPrice,
      paymentStatus: "unpaid",
    })

    /* 6. If roomUpgrade, update booking */
    if (addOn.slug === "roomUpgrade") {
      await booking.update({
        room_type: newRoom.name,
        room_number: newRoom.roomNumber,
      })
    }

    /* 7. Build email details */
    const guestName = booking.User?.name || booking.User?.email || "Guest"
    const hotel = booking.Hotel
    const detailLines = []

    // Hotel & booking info
    detailLines.push(`Hotel: ${hotel.name}`)
    if (hotel.address) detailLines.push(`Address: ${hotel.address}`)
    if (hotel.city) detailLines.push(`City: ${hotel.city}`)
    detailLines.push(`Check-in: ${booking.checkIn}`)
    detailLines.push(`Check-out: ${booking.checkOut}`)
    detailLines.push(`Booking #: ${booking.bookingConfirmation || booking.id}`)

    // Add-on specifics
    detailLines.push(`Add-on: ${addOn.name}`)

    if (addOn.slug === "roomUpgrade") {
      const nights = diffDays(booking.checkIn, booking.checkOut)
      detailLines.push(`Upgraded from "${booking.room_type}" to "${newRoom.name}"`)
      detailLines.push(`Price diff for ${nights} night(s): $${unitPrice.toFixed(2)}`)
    } else if (addOn.type === "options" && optionId) {
      const opt = await models.AddOnOption.findByPk(optionId)
      detailLines.push(`Option: ${opt.name} — $${Number.parseFloat(opt.price).toFixed(2)}`)
      detailLines.push(`Quantity: 1 — Subtotal: $${unitPrice.toFixed(2)}`)
    } else if (addOn.type === "quantity") {
      detailLines.push(`Quantity: ${qty} × $${Number.parseFloat(addOn.price).toFixed(2)}`)
      detailLines.push(`Subtotal: $${(qty * Number.parseFloat(addOn.price)).toFixed(2)}`)
    } else {
      detailLines.push(`Price: $${unitPrice.toFixed(2)}`)
    }

    /* 8. Send email */
    const emailHotel = "developers@insiderbookings.com"
    if (emailHotel) {
      const subject = `🔔 New add-on request – ${addOn.name} for ${hotel.name}`

      await transporter
        .sendMail({
          from: `"Insider Bookings" <${process.env.SMTP_USER}>`,
          to: emailHotel,
          subject,
          html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              
              <!-- Header -->
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #2c5aa0; margin: 0; font-size: 24px;">🔔 New Add-on Request</h1>
                <p style="color: #666; margin: 10px 0 0 0; font-size: 16px;">Action required from hotel staff</p>
              </div>

              <!-- Guest Info -->
              <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #2196f3; margin-bottom: 25px;">
                <h3 style="color: #1976d2; margin: 0 0 10px 0; font-size: 18px;">👤 Guest Information</h3>
                <p style="color: #333; margin: 0; font-size: 16px; font-weight: bold;">${guestName}</p>
              </div>

              <!-- Booking Details -->
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
                <h3 style="color: #2c5aa0; margin: 0 0 15px 0; font-size: 18px;">📋 Booking & Add-on Details</h3>
                
                <table style="width: 100%; border-collapse: collapse;">
                  ${detailLines
                    .map((line) => {
                      const [label, ...valueParts] = line.split(": ")
                      const value = valueParts.join(": ")
                      return `
                      <tr>
                        <td style="padding: 8px 0; color: #666; font-weight: bold; width: 35%; vertical-align: top;">${label}:</td>
                        <td style="padding: 8px 0; color: #333; vertical-align: top;">${value}</td>
                      </tr>
                    `
                    })
                    .join("")}
                </table>
              </div>

              <!-- Action Required -->
              <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107; margin-bottom: 25px;">
                <h3 style="color: #856404; margin: 0 0 10px 0; font-size: 18px;">⚡ Action Required</h3>
                <p style="color: #856404; margin: 0; font-size: 16px;">
                  Please review this request and approve/reject it through the hotel management system.
                </p>
              </div>

              <!-- Footer -->
              <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; text-align: center;">
                <p style="color: #666; font-size: 14px; margin: 0;">
                  <strong>Insider Bookings</strong> - Hotel Management System
                </p>
                <p style="color: #999; font-size: 12px; margin: 10px 0 0 0;">
                  This is an automated notification. Please do not reply to this email.
                </p>
              </div>

            </div>
          </div>
        `,
          text: [`Guest: ${guestName}`, ...detailLines].join("\n"),
        })
        .catch((err) => console.error("Mail error:", err))
    }

    /* 9. Respond */
    return res.status(201).json({ ok: true, bookingAddOnId: pivot.id })
  } catch (e) {
    console.error("DB error:", e.original || e)
    return res.status(500).json({
      error: "Could not save add-on",
      detail: e.original?.detail || e.message,
    })
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   POST /api/addons/bookings/outside/:id   (outside booking)
   ═════════════════════════════════════════════════════════════════════════ */
export const saveOutsideAddOns = async (req, res) => {
  const outsideId = Number(req.params.id);
  const { addons } = req.body;               // [{ id:slug , optionId , qty }]

  if (!outsideId || !Array.isArray(addons))
    return res.status(400).json({ error: "Invalid payload" });

  const booking = await models.OutsideBooking.findByPk(outsideId);
  if (!booking)
    return res.status(404).json({ error: "Outside-booking not found" });

  const t = await models.OutsideBookingAddOn.sequelize.transaction();
  try {
    /* limpiamos lo anterior */
    await models.OutsideBookingAddOn.destroy({
      where       : { outsidebooking_id: outsideId },
      transaction : t,
    });

    /* volvemos a insertar */
    for (const item of addons) {
      const addOn = await models.AddOn.findOne({
        where       : { slug: item.id },
        transaction : t,
      });
      if (!addOn) continue;

      let optionId  = null;
      let unitPrice = Number(addOn.price);
      const qty     = item.qty ?? 1;

      if (item.optionId) {
        const opt = await models.AddOnOption.findByPk(item.optionId, { transaction: t });
        if (opt) {
          optionId  = opt.id;
          unitPrice = Number(opt.price);
        }
      }

      await models.OutsideBookingAddOn.create({
        outsidebooking_id : outsideId,
        add_on_id         : addOn.id,
        add_on_option_id  : optionId,
        qty,
        unitPrice,
        paymentStatus     : "paid",
        status: "Ready"
      }, { transaction: t });
    }

    await t.commit();
    return res.status(201).json({ ok: true, count: addons.length });
  } catch (err) {
    await t.rollback();
    console.error("Save OutsideBookingAddOns:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
export const confirmAddOnRequest = async (req, res) => {
  const id = Number(req.params.id)
  const approved = true // siempre "confirm" en esta ruta

  const pivot = await models.OutsideBookingAddOn.findByPk(id, {
    include: [
      {
        model: models.OutsideBooking,
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
            
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: ${statusColor}; margin: 0; font-size: 24px;">
                ${statusIcon} Request ${isApproved ? "Approved" : "Rejected"}
              </h1>
            </div>

            <!-- Greeting -->
            <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
              Hi <strong>${guestName}</strong>,
            </p>

            <!-- Status Message -->
            <div style="background-color: ${statusBg}; padding: 20px; border-radius: 8px; border-left: 4px solid ${statusColor}; margin-bottom: 25px;">
              <p style="font-size: 16px; color: #333; line-height: 1.6; margin: 0;">
                ${
                  isApproved
                    ? `Good news! Your request for "<strong>${addOnName}</strong>" has been approved.`
                    : `Unfortunately we couldn't add "<strong>${addOnName}</strong>" to your booking.`
                }
              </p>
            </div>

            ${
              isApproved
                ? `
              <!-- Action for Approved -->
              <div style="text-align: center; margin: 30px 0;">
                <div style="background-color: #007bff; color: white; padding: 15px 30px; border-radius: 25px; display: inline-block; font-weight: bold; font-size: 16px;">
                  📱 Open Insider App to Complete Payment
                </div>
              </div>
            `
                : `
              <!-- Message for Rejected -->
              <div style="text-align: center; margin: 30px 0;">
                <p style="color: #666; font-size: 16px; font-style: italic;">
                  Sorry for the inconvenience. Please contact us if you have any questions.
                </p>
              </div>
            `
            }

            <!-- Footer -->
            <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; text-align: center;">
              <p style="color: #666; font-size: 14px; margin: 0;">
                Thank you,<br>
                <strong>${hotelName}</strong>
              </p>
            </div>

          </div>
        </div>
      `,
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
    const requests = await models.OutsideBookingAddOn.findAll({
      include: [
        {
          model: models.OutsideBooking,
          include: [
            { model: models.User, attributes: ["id", "name", "email"] },
            { model: models.Hotel, attributes: ["id", "name"] },
          ],
        },
        { model: models.AddOn, attributes: ["id", "name", "slug"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    const payload = requests.map((r) => ({
      id: r.id,
      status: r.status,
      guestName: r.OutsideBooking.User?.name,
      bookingConfirmation: r.OutsideBooking.bookingConfirmation,
      roomType: r.OutsideBooking.room_type,
      roomNumber: r.OutsideBooking.room_number,
      addOnName: r.AddOn.name,
    }));

    return res.json(payload);
  } catch (err) {
    console.error("Error fetching requests:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

// src/controllers/addon.controller.js



/**
 * PUT /api/addons/bookings/outside/ready/:id
 * Mark an OutsideBookingAddOn as ready and notify the guest.
 */
export const markOutsideAddOnReady = async (req, res) => {
  try {
    const id = Number(req.params.id)

    if (!id) {
      return res.status(400).json({ error: "Invalid add-on ID" })
    }

    // Fetch the pivot row, eager-loading via the defined aliases:
    const pivot = await models.OutsideBookingAddOn.findByPk(id, {
      include: [
        {
          model: models.OutsideBooking,
          as: "booking", // must match the alias in associate()
          include: [
            { model: models.User, attributes: ["name", "email"], as: "User" },
            { model: models.Hotel, attributes: ["name"], as: "Hotel" },
          ],
        },
        {
          model: models.AddOn,
          as: "addOn", // alias defined in associate()
          attributes: ["name"],
        },
      ],
    })

    if (!pivot) {
      return res.status(404).json({ error: "Add-on request not found" })
    }

    if (pivot.status === "ready") {
      return res.status(400).json({ error: "Already marked ready" })
    }

    // 1) Update status
    pivot.status = "ready"
    await pivot.save()

    // 2) Notify guest (optional)
    const guestMail = getGuestMail(pivot.booking)
    if (guestMail) {
      const guestName = getGuestName(pivot.booking)
      const hotelName = "Insider Bookings"
      const addOnName = pivot.addOn?.name ?? "add-on"

      const mailOpts = {
        from: `"Insider Bookings" <${process.env.SMTP_USER}>`,
        to: guestMail,
        subject: `✅ Your add-on is ready for payment`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              
              <!-- Header -->
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #2c5aa0; margin: 0; font-size: 24px;">🎉 Great News!</h1>
                <p style="color: #666; margin: 10px 0 0 0; font-size: 16px;">Your add-on is ready for payment</p>
              </div>

              <!-- Greeting -->
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                Hi <strong>${guestName}</strong>,
              </p>

              <p style="font-size: 16px; color: #333; line-height: 1.6; margin-bottom: 25px;">
                Great news! Your purchase has been processed successfully and is now ready for payment.
              </p>

              <!-- Details Box -->
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745; margin-bottom: 25px;">
                <h3 style="color: #2c5aa0; margin: 0 0 15px 0; font-size: 18px;">📋 Booking Details</h3>
                
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #666; font-weight: bold; width: 30%;">Hotel:</td>
                    <td style="padding: 8px 0; color: #333;">${hotelName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666; font-weight: bold;">Booking #:</td>
                    <td style="padding: 8px 0; color: #333;">${pivot.booking.bookingConfirmation}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666; font-weight: bold;">Add-on:</td>
                    <td style="padding: 8px 0; color: #333; font-weight: bold;">${addOnName}</td>
                  </tr>
                </table>
              </div>

              <!-- Action Button -->
              <div style="text-align: center; margin: 30px 0;">
                <div style="background-color: #28a745; color: white; padding: 15px 30px; border-radius: 25px; display: inline-block; font-weight: bold; font-size: 16px;">
                  💳 Open Insider App to Complete Payment
                </div>
              </div>

              <!-- Footer -->
              <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; text-align: center;">
                <p style="color: #666; font-size: 14px; margin: 0;">
                  Thank you for choosing <strong>Insider Bookings</strong>!
                </p>
                <p style="color: #999; font-size: 12px; margin: 10px 0 0 0;">
                  You can view the updated details in the Insider app at any time.
                </p>
              </div>

            </div>
          </div>
        `,
        text: `Hi ${guestName},

Great news! Your purchase has been processed successfully.

Hotel: ${hotelName}
Booking #: ${pivot.booking.bookingConfirmation}
Add-on: ${addOnName}

You can view the updated details in the Insider app at any time.

Thank you for choosing Insider Bookings!`,
      }

      transporter.sendMail(mailOpts).catch((err) => console.error("Mail error:", err))
    }

    // 3) Return updated pivot
    return res.json({
      ok: true,
      id: pivot.id,
      status: pivot.status,
    })
  } catch (err) {
    console.error("Error in markOutsideAddOnReady:", err)
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
    /* ───── 1) Normalizar y validar los IDs de hotel ────────────────────── */
    let raw = req.query.hotelIds
            ?? req.query["hotelIds[]"]        // forma ?hotelIds[]=12
            ?? [];                            // undefined → []

    if (!Array.isArray(raw)) raw = String(raw).split(",");   // "12,11" → ["12","11"]

    const hotelIds = raw.map(Number).filter(Boolean);        // [12,11]

    if (!hotelIds.length) {
      return res.status(400).json({ error: "Missing or invalid hotelIds" });
    }

    /* ───── 2) INSIDER  (BookingAddOn → Booking) ────────────────────────── */
    const insider = await models.BookingAddOn.findAll({
  include : [
    {
      model     : models.Booking,
      as        : "booking",
      required  : true,
      where     : { hotel_id: { [Op.in]: hotelIds } },
      attributes: [
        "id",          // PK de la reserva
        "hotel_id",    // para saber a qué hotel pertenece
        "room_id",     // FK a la habitación
        "guestName",   // nombre del huésped
        "checkIn",
        "checkOut",
      ],
      include: [
        {                 // podemos traer la habitación para mostrar nombre / nº
          model     : models.Room,
          attributes: ["name", "roomNumber"],
        },
      ],
    },
    {
      model : models.AddOn,
      as    : "addOn",
      include: [{ model: models.AddOnOption, as: "AddOnOptions" }],
    },
    { model: models.AddOnOption, as: "option" },
  ],
  order   : [["createdAt", "DESC"]],
});

    /* ───── 3) OUTSIDE (OutsideBookingAddOn → OutsideBooking) ───────────── */
    const outside = await models.OutsideBookingAddOn.findAll({
      include : [
        {
          model     : models.OutsideBooking,
          as        : "booking",
          required  : true,
          where     : { hotel_id: { [Op.in]: hotelIds } },
          attributes: [
            "id", "hotel_id", "bookingConfirmation",
            "room_type", "room_number", "guestName"
          ],
        },
        {
          model : models.AddOn,
          as    : "addOn",
          include: [{ model: models.AddOnOption, as: "AddOnOptions" }],
        },
        { model: models.AddOnOption, as: "option" },
        { model: models.Room,        as: "room"   },
      ],
      order   : [["createdAt", "DESC"]],
    });
      console.log(insider, outside, "addons")
    /* ───── 4) Respuesta ─────────────────────────────────────────────────── */
    return res.json({ insider, outside });

  } catch (err) {
    console.error("getRequestedAddOnsByStaff:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
