// src/controllers/auth.auto.controller.js
import bcrypt from "bcrypt";
import { v4 as uuid } from "uuid";
import jwt from "jsonwebtoken";
import { validationResult } from "express-validator";
import models from "../models/index.js";
import { signToken } from "./auth.controller.js";   // re-usamos helper existente
import sendMagicLink from "../services/sendMagicLink.js";

const { User, Booking } = models;

export const autoSignupOrLogin = async (req, res) => {
  const { email, firstName, lastName, phone, bookingId } = req.body

  // 1. Validar datos mínimos
  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: 'Missing data' })
  }

  try {
    const { User, Booking } = models

    // 2. Buscar usuario existente
    let user = await User.findOne({ where: { email } })

    // 3. Si no existe, crearlo con password_hash no nulo
    if (!user) {
      // Generar contraseña temporal y hashearla
      const tempPassword  = uuid()
      const password_hash = await bcrypt.hash(tempPassword, 10)

      // Crear el usuario
      user = await User.create({
        name          : `${firstName} ${lastName}`.trim(),
        email,
        phone,
        password_hash  // cumple la restricción NOT NULL
      })

      // Enviar magic link para que el usuario establezca su contraseña definitiva
      await sendMagicLink(user)
    }

    // 4. Asociar la reserva si viene bookingId y está sin usuario
    if (bookingId) {
      await Booking.update(
        { user_id: user.id },
        { where: { id: bookingId, user_id: null } }
      )
    }

    // 5. Generar JWT para el usuario
    const token = signToken({ id: user.id, type: 'user' })

    return res.json({ token, user })
  } catch (err) {
    console.error('autoSignupOrLogin:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

export const setPasswordWithToken = async (req, res) => {
  /* 0. validación body --------------------------- */
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ error: errors.array()[0].msg });

  const { token, password } = req.body;

  try {
    /* 1. verificar firma y expiración ------------- */
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type !== "user" || decoded.action !== "set-password")
      return res.status(400).json({ error: "Invalid token" });

    /* 2. encontrar usuario ----------------------- */
    const user = await User.findByPk(decoded.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    /* 3. hashear y guardar nueva contraseña ------- */
    const hash = await bcrypt.hash(password, 10);
    await user.update({ passwordHash: hash });

    /* 4. emitir JWT de sesión -------------------- */
    const sessionToken = signToken({ id: user.id, type: "user" });

    /* 5. respuesta                                 */
    return res.json({
      token: sessionToken,
      user : {
        id   : user.id,
        name : user.name,
        email: user.email,
        phone: user.phone,
        role : user.role,
      },
    });
  } catch (err) {
    console.error("setPassword error:", err);
    return res.status(400).json({ error: "Token expired or invalid" });
  }
};
