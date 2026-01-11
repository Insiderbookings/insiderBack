// src/controllers/auth.auto.controller.js
import bcrypt from "bcrypt";
import { v4 as uuid } from "uuid";
import models from "../models/index.js";
import { issueUserSession, loadSafeUser, shouldExposeRefreshToken } from "./auth.controller.js";

const { User, Booking } = models;

export const autoSignupOrLogin = async (req, res) => {
  const { email, firstName, lastName, phone, bookingId } = req.body;

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    let user = await User.findOne({ where: { email } });

    if (!user) {
      const tempPassword = uuid();
      const password_hash = await bcrypt.hash(tempPassword, 10);

      user = await User.create({
        name: `${firstName} ${lastName}`.trim(),
        email,
        phone,
        password_hash,
      });
    }

    if (bookingId) {
      await Booking.update(
        { user_id: user.id },
        { where: { id: bookingId, user_id: null } },
      );
    }

    await user.update({ last_login_at: new Date() });

    const { accessToken, refreshToken } = await issueUserSession({ user, req, res });
    const safeUser = await loadSafeUser(user.id);

    const response = { token: accessToken, user: safeUser };
    if (shouldExposeRefreshToken(req)) response.refreshToken = refreshToken;

    return res.json(response);
  } catch (err) {
    console.error("autoSignupOrLogin:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
