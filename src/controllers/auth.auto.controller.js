// src/controllers/auth.auto.controller.js
import bcrypt from "bcrypt";
import { v4 as uuid } from "uuid";
import models from "../models/index.js";
import { signToken } from "./auth.controller.js";   // re-usamos helper existente
import sendMagicLink from "../services/sendMagicLink.js";

const { User, OutsideBooking } = models;

export const autoSignupOrLogin = async (req, res) => {
  const { email, firstName, lastName, phone, outsideBookingId } = req.body;

  if (!email || !firstName || !lastName)
    return res.status(400).json({ error: "Missing data" });

  try {
    /* 1. Buscar (o crear) usuario ----------------------------- */
    let user = await User.findOne({ where: { email } });

    if (!user) {
      const fakePass = await bcrypt.hash(uuid(), 10);      // placeholder
      user = await User.create({
        name : `${firstName} ${lastName}`,
        email,
        passwordHash: fakePass,
        phone,
      });

      // magic-link para que establezca contraseña
      await sendMagicLink(user);
    }

    /* 2. Adoptar la OutsideBooking ---------------------------- */
    if (outsideBookingId) {
      await OutsideBooking.update(
        { user_id: user.id },
        { where: { id: outsideBookingId, user_id: null } },
      );
    }

    /* 3. JWT -------------------------------------------------- */
    const token = signToken({ id: user.id, type: "user" });

    return res.json({ token, user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

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