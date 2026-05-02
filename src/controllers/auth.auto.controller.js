// src/controllers/auth.auto.controller.js
import bcrypt from "bcrypt";
import { v4 as uuid } from "uuid";
import models from "../models/index.js";
import { issueUserSession, loadSafeUser, shouldExposeRefreshToken } from "./auth.controller.js";
import { resolveStoredPhone } from "../utils/phone.js";

const { User, Booking } = models;

export const autoSignupOrLogin = async (req, res) => {
  const { email, firstName, lastName, phone, bookingId } = req.body;

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    let user = await User.findOne({ where: { email } });
    const phoneState = resolveStoredPhone(phone);
    let createPhoneState = phoneState;

    if (!user && phoneState.phoneE164) {
      const existingPhoneUser = await User.findOne({
        where: { phone_e164: phoneState.phoneE164 },
        attributes: ["id"],
      });
      if (existingPhoneUser) {
        createPhoneState = {
          phone: phoneState.phone,
          phoneE164: null,
        };
      }
    }

    if (!user) {
      const tempPassword = uuid();
      const password_hash = await bcrypt.hash(tempPassword, 10);

      user = await User.create({
        name: `${firstName} ${lastName}`.trim(),
        first_name: firstName,
        last_name: lastName,
        email,
        phone: createPhoneState.phone,
        phone_e164: createPhoneState.phoneE164,
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
