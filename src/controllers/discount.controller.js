// ─────────────────────────────────────────────────────────────
// src/controllers/discount.controller.js
// 100 % COMPLETO — TODAS LAS LÍNEAS
// ─────────────────────────────────────────────────────────────
import { Op }  from "sequelize";
import models  from "../models/index.js";

/* ----------------------------------------------------------- */
/* POST /api/discounts/validate                                */
/* ----------------------------------------------------------- */
export const validateDiscount = async (req, res) => {
  try {
    const payload = req.body.code?.code ? req.body.code : req.body;
    const { code, checkIn, checkOut } = payload;

    if (!code || code.length !== 4)
      return res.status(400).json({ error: "Code must be 4 digits" });

    const discount = await models.DiscountCode.findOne({
      where  : { code: code.toUpperCase() },
      include: [
        { model: models.Staff, as: "staff", attributes: ["name"] },
        { model: models.Hotel, attributes: ["id", "name", "image", "location"] },
      ],
    });
    if (!discount) return res.status(404).json({ error: "Invalid discount code" });
  

    discount.timesUsed += 1;
    await discount.save();

    res.json({
      percentage : discount.percentage,
      validatedBy: discount.staff?.name || "Staff",
      hotel      : discount.Hotel,
    });
  } catch (err) {
    console.error("validateDiscount:", err);
    res.status(500).json({ error: "Server error" });
  }
};

/* ----------------------------------------------------------- */
/* POST /api/discounts/createCustom                            */
/* Genera códigos especiales — sólo manager (role id 3)        */
/* ----------------------------------------------------------- */
export const createCustomCode = async (req, res) => {
  try {
    /* Body sólo trae porcentaje, hotel y (opcional) fechas / usos */
    const {
      percentage,     // libre 1-100 %
      hotelId,
      startsAt,
      endsAt,
      maxUses = 1,
    } = req.body;

    if (!hotelId)    return res.status(400).json({ error: "hotelId missing" });
    if (!percentage) return res.status(400).json({ error: "percentage missing" });

    if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100)
      return res.status(400).json({ error: "percentage must be an integer 1-100" });

    /* ───────── Tomar datos del JWT ───────── */
    const authUser = req.user || {};                 // viene de authenticate
    const staffId  = authUser.id;                    // obligatorio en token
    if (!staffId) return res.status(401).json({ error: "Unauthorized" });

    /* Rol manager (tres formas posibles) */
    const isManager =

      authUser.roleName === 'Hotel Manager';

    if (!isManager)
      return res.status(403).json({ error: "Insufficient privileges" });

    /* ───────── Generar código único de 4 dígitos ───────── */
    const genCode = () => Math.floor(1000 + Math.random() * 9000).toString();
    let code;
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await models.DiscountCode.findOne({ where: { code: (code = genCode()) } });
      if (!exists) break;
      if (i === 9) return res.status(500).json({ error: "Could not generate unique code" });
    }

    /* ───────── Crear registro ───────── */
    const discount = await models.DiscountCode.create({
      code,
      percentage,
      staff_id : staffId,
      hotel_id : hotelId,
      startsAt : startsAt ? new Date(startsAt) : new Date(),
      endsAt   : endsAt   ? new Date(endsAt)   : new Date(Date.now() + 24 * 60 * 60 * 1000),
      maxUses,
    });

    /* ───────── Responder ───────── */
    res.status(201).json({
      message   : "Custom discount code created",
      code      : discount.code,
      percentage: discount.percentage,
      expiresAt : discount.endsAt,
      maxUses   : discount.maxUses,
    });
  } catch (err) {
    console.error("createCustomCode:", err);
    if (err.name === "SequelizeValidationError")
      return res.status(400).json({ error: err.errors?.[0]?.message || "Validation error" });

    res.status(500).json({ error: "Server error" });
  }
};
