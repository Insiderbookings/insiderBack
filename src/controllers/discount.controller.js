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
  console.log("validating log")

  try {
    /* ---------- payload ---------- */
    const payload = req.body.code?.code ? req.body.code : req.body
    const { code, checkIn, checkOut } = payload    // checkIn/out reservados para validaciones futuras

    if (!code || code.length !== 4)
      return res.status(400).json({ error: "Code must be 4 digits" })

    /* ---------- buscar código en hotel_staff ---------- */
    const hotelStaff = await models.HotelStaff.findOne({
      where  : { staff_code: code.toUpperCase() },
      include: [
        /* Staff + rol (para % de descuento / comisión) */
        {
          model     : models.Staff,
          as        : "staff",
          attributes: ["name", "staff_role_id"],
          include   : [
            {
              model     : models.StaffRole,
              as        : "role",
              attributes: ["defaultDiscountPct", "commissionPct"],
            },
          ],
        },
        /* Hotel relacionado */
        {
          model     : models.Hotel,
          as        : "hotel",
          attributes: ["id", "name", "image", "location"],
        },
      ],
    })

    if (!hotelStaff)
      return res.status(404).json({ error: "Invalid discount code" })

    /* ---------- armar respuesta ---------- */
    const discountPct =
      hotelStaff.staff?.role?.defaultDiscountPct ?? null       // p.ej. 15
    const staffName   = hotelStaff.staff?.name || "Staff"
    const hotelData   = hotelStaff.hotel                       // { id, name, ... }

    return res.json({
      percentage           : discountPct,
      validatedBy          : staffName,
      hotel                : hotelData,
      specialDiscountPrice : null,          // por ahora sin precio especial
    })
  } catch (err) {
    console.error("validateDiscount:", err)
    return res.status(500).json({ error: "Server error" })
  }
}
/* ----------------------------------------------------------- */
/* POST /api/discounts/createCustom                            */
/* Genera códigos especiales — sólo manager (role id 3)        */
/* ----------------------------------------------------------- */
export const createCustomCode = async (req, res) => {
  try {
    /* Body trae precio final, hotel y (opcional) fechas / usos */
    const {
      specialDiscountPrice, // importe final (10-200 000)
      hotelId,
      startsAt,
      endsAt,
      maxUses = 1,
    } = req.body;

    if (!hotelId)              return res.status(400).json({ error: "hotelId missing" });
    if (!specialDiscountPrice) return res.status(400).json({ error: "specialDiscountPrice missing" });

    if (
      !Number.isInteger(specialDiscountPrice) ||
      specialDiscountPrice < 10 ||
      specialDiscountPrice > 200000
    )
      return res
        .status(400)
        .json({ error: "specialDiscountPrice must be an integer 10-200000" });

    /* ───────── Tomar datos del JWT ───────── */
    const authUser = req.user || {}; // viene de middleware authenticate
    const staffId  = authUser.id;
    if (!staffId) return res.status(401).json({ error: "Unauthorized" });

    /* Sólo hotel-manager puede crear */
    const isManager = authUser.roleName === "Hotel Manager";
    if (!isManager) return res.status(403).json({ error: "Insufficient privileges" });

    /* ───────── Generar código único de 4 dígitos ───────── */
    const genCode = () => Math.floor(1000 + Math.random() * 9000).toString();
    let code;
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await models.DiscountCode.findOne({
        where: { code: (code = genCode()) },
      });
      if (!exists) break;
      if (i === 9) return res.status(500).json({ error: "Could not generate unique code" });
    }

    /* ───────── Crear registro ───────── */
    const discount = await models.DiscountCode.create({
      code,
      specialDiscountPrice,
      percentage: 1,
      staff_id : staffId,
      hotel_id : hotelId,
      startsAt : startsAt ? new Date(startsAt) : new Date(),
      endsAt   : endsAt   ? new Date(endsAt)   : new Date(Date.now() + 24 * 60 * 60 * 1000),
      default: false,
      maxUses,
    });

    /* ───────── Responder ───────── */
    res.status(201).json({
      message             : "Custom discount code created",
      code                : discount.code,
      specialDiscountPrice: discount.specialDiscountPrice,
      expiresAt           : discount.endsAt,
      maxUses             : discount.maxUses,
    });
  } catch (err) {
    console.error("createCustomCode:", err);
    if (err.name === "SequelizeValidationError")
      return res
        .status(400)
        .json({ error: err.errors?.[0]?.message || "Validation error" });

    res.status(500).json({ error: "Server error" });
  }
};
