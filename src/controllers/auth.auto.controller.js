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
