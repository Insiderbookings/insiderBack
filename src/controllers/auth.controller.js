import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { validationResult } from "express-validator";
import models from "../models/index.js";
import dotenv from "dotenv";
import { sequelize } from "../models/index.js"
dotenv.config();

export const signToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });

export const registerStaff = async (req, res) => {
  /* 0. Validación de inputs */
  const errors = validationResult(req);
  if (!errors.isEmpty()) 
   { 
    console.log("here1")
    return res.status(400).json({ errors: errors.array() });}

  const { name, email, password, staff_role_id, hotelIds = [] } = req.body;

  try {
    /* 1. Verificar role y email */
    const role = await models.StaffRole.findByPk(staff_role_id);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const exists = await models.Staff.findOne({ where: { email } });
    if (exists) return res.status(409).json({ error: "Email already registered" });

    /* 2. Verificar array hotelIds */
    if (!Array.isArray(hotelIds) || hotelIds.length === 0) {
      console.log("her2")
      return res.status(400).json({ error: "hotelIds array required (≥1)" });}

    const foundHotels = await models.Hotel.findAll({ where: { id: hotelIds } });
    if (foundHotels.length !== hotelIds.length)
      return res.status(404).json({ error: "One or more hotels not found" });

    /* 3. Hash de contraseña */
    const passwordHash = await bcrypt.hash(password, 10);

    /* 4. Transacción global */
    await sequelize.transaction(async (t) => {
      /* 4.1 Crear staff */
      const staff = await models.Staff.create(
        { name, email, passwordHash, staff_role_id },
        { transaction: t }
      );

      /* 4.2 Asignar hoteles + códigos individuales */
      const codeMap = {};
      for (const hotel_id of hotelIds) {
        /* Generar código único de 4 dígitos para ese hotel */
        let staffCode;
        do {
          staffCode = Math.floor(1000 + Math.random() * 9000).toString();
        } while (
          await models.HotelStaff.findOne({
            where: { hotel_id, staff_code: staffCode },
            transaction: t,
          })
        );

        /* Pivote */
        await models.HotelStaff.create(
          {
            hotel_id,
            staff_id: staff.id,
            staff_code: staffCode,
            is_primary: false,
          },
          { transaction: t }
        );

        /* DiscountCode asociado al hotel (si tu modelo lo soporta) */
        await models.DiscountCode.create(
          {
            code: staffCode,
            percentage: role.defaultDiscountPct,
            staff_id: staff.id,
            hotel_id,               // asegúrate de tener esta FK en DiscountCode
            startsAt: new Date(),
          },
          { transaction: t }
        );

        codeMap[hotel_id] = staffCode;
      }

      const links = await models.HotelStaff.findAll({
      where: { staff_id: staff.id },
      include: {
        association: "hotel",                // alias definido en HotelStaff
        attributes : ["id", "name", "image", "city", "country"],
      },
      attributes: ["staff_code", "is_primary"],
    });

    /* 3.a. Formatear resultado */
    const hotels = links.map((l) => {
      const h = l.hotel;                     // ← minúsculas
      return {
        id       : h.id,
        name     : h.name,
        image    : h.image,
        city     : h.city,
        country  : h.country,
        staffCode: l.staff_code,
        isPrimary: l.is_primary,
      };
    });

      /* 4.3 Token + respuesta */
      const token = signToken({ id: staff.id, type: "staff", roleName: role.name });
      res.status(201).json({ token, codesPerHotel: codeMap, staff, hotels });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

export const loginStaff = async (req, res) => {
  const { email, password } = req.body;

  try {
    /* 1. Buscar staff + rol */
    const staff = await models.Staff.findOne({
      where   : { email },
      include : { model: models.StaffRole, as: "role" },
    });
    if (!staff) return res.status(404).json({ error: "Not found" });

    /* 2. Validar contraseña */
    const ok = await bcrypt.compare(password, staff.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    /* 3. Traer hoteles asignados + códigos */
    const links = await models.HotelStaff.findAll({
      where: { staff_id: staff.id },
      include: {
        association: "hotel",                // alias definido en HotelStaff
        attributes : ["id", "name", "image", "city", "country"],
      },
      attributes: ["staff_code", "is_primary"],
    });

    /* 3.a. Formatear resultado */
    const hotels = links.map((l) => {
      const h = l.hotel;                     // ← minúsculas
      return {
        id       : h.id,
        name     : h.name,
        image    : h.image,
        city     : h.city,
        country  : h.country,
        staffCode: l.staff_code,
        isPrimary: l.is_primary,
      };
    });

    /* 4. JWT */
    const token = signToken({
      id      : staff.id,
      type    : "staff",
      roleName: staff.role.name,
    });

    /* 5. Respuesta */
    console.log(hotels, "hotels")
    res.json({ token, staff, hotels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

export const registerUser = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const exists = await models.User.findOne({ where: { email } });
    if (exists) return res.status(409).json({ error: "Email taken" });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await models.User.create({ name, email, passwordHash });
    const token = signToken({ id: user.id, type: "user" });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

export const loginUser = async (req, res) => {
  console.log("auth")
  const { email, password } = req.body;
  try {
    const user = await models.User.findOne({ where: { email } });
    console.log(user, "user")
    if (!user) return res.status(404).json({ error: "Not found" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    const token = signToken({ id: user.id, type: "user" });
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

