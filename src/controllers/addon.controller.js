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
export const requestAddOn = async (req, res) => {
  const userId = req.user.id;
  const {
    bookingId = null,      // puede venir o no
    addOnId,
    optionId = null,
    qty      = 1,
  } = req.body;

  /* ─────────────────── Validaciones iniciales ─────────────────── */
  if (!addOnId)
    return res.status(400).json({ error: "Missing addOnId" });

  /* 1. Localizar la reserva del usuario
        – si viene bookingId se usa;
        – si no, se busca la última con status = confirmed           */
  const whereBooking = {
    user_id: userId,
    status : { [Op.eq]: "confirmed" },
  };
  if (bookingId) whereBooking.id = bookingId;

  const booking = await models.OutsideBooking.findOne({
    where  : whereBooking,
    include: [{ model: models.Hotel }],
    order  : [["createdAt", "DESC"]],
  });

  if (!booking)
    return res
      .status(404)
      .json({ error: "Booking not found or not eligible" });

  /* 2. Localizar el add-on                                        */
  const addOn = await models.AddOn.findByPk(addOnId);
  if (!addOn)
    return res.status(404).json({ error: "Add-on not found" });

  /* 3. Variante (opcional) y precio                               */
  let unitPrice = Number(addOn.price);
  if (optionId) {
    const opt = await models.AddOnOption.findByPk(optionId);
    if (!opt)
      return res.status(404).json({ error: "Option not found" });
    unitPrice = Number(opt.price);
  }

  /* 4‒6. Crear pivote, notificar y responder                      */
  try {
    /* 4. Crear la fila pivote en outsidebooking_add_on            */
    const pivot = await models.OutsideBookingAddOn.create({
      outsidebooking_id : booking.id,
      add_on_id         : addOn.id,
      add_on_option_id  : optionId,
      qty,
      unitPrice,
      paymentStatus     : "unpaid",
    });

    /* 5. Notificar al hotel                                       */
    if (booking.Hotel?.email) {
      try {
        await transporter.sendMail({
          from   : `"Insider Bookings" <${process.env.SMTP_USER}>`,
          to     : "ramiro.alet@hotmail.com",
          subject: `New add-on request – ${addOn.name}`,
          text   : `Guest ${req.user.name || req.user.email} requested ${addOn.name}
for booking #${booking.bookingConfirmation ?? booking.id}.`,
        });
      } catch (mailErr) {
        console.error("Send mail error:", mailErr);
        /* No corta el flujo: si el mail falla, igual respondemos  */
      }
    }

    /* 6. Respuesta al cliente                                     */
    return res
      .status(201)
      .json({ ok: true, bookingAddOnId: pivot.id });
  } catch (e) {
    /* Detalle del error de Postgres / Sequelize                   */
    console.error("PG error:", e.original || e);
    return res.status(500).json({
      error : "Could not save add-on",
      detail: e.original?.detail || e.message,
    });
  }
};

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
        paymentStatus     : "unpaid",
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
  const id = Number(req.params.id);
  const { approved } = req.body;

  const reqRow = await models.AddOnRequest.findByPk(id, {
    include: [
      { model: models.Booking, include: [models.User, models.Hotel] },
      models.AddOn,
    ],
  });
  if (!reqRow)  return res.status(404).json({ error: "Request not found" });
  if (reqRow.status !== "pending")
    return res.status(400).json({ error: "Already processed" });

  reqRow.status = approved ? "confirmed" : "rejected";
  await reqRow.save();

  /* e-mail al huésped */
  const guestMail = reqRow.Booking.User?.email;
  if (guestMail) {
    try {
      await transporter.sendMail({
        from   : `"${reqRow.Booking.Hotel.name}" <${process.env.SMTP_USER}>`,
        to     : guestMail,
        subject: `Your add-on ${approved ? "was confirmed" : "could not be added"}`,
        text   : approved
          ? `Your ${reqRow.AddOn.name} add-on is confirmed.
Please open the Insider app to complete payment.`
          : `Unfortunately we could not add ${reqRow.AddOn.name} to your booking.`,
      });
    } catch (e) { console.error("Mail guest:", e); }
  }

  return res.json({ ok: true, status: reqRow.status });
};