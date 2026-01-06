// src/controllers/auth.controller.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { validationResult } from "express-validator";
import models from "../models/index.js";
import dotenv from "dotenv";
import { Op } from "sequelize";
import { sequelize } from "../models/index.js";
import { random4 } from "../utils/random4.js";
import transporter from "../services/transporter.js";
import sendPasswordResetEmail from "../services/sendPasswordResetEmail.js";
import { OAuth2Client } from "google-auth-library";
import { createRemoteJWKSet, jwtVerify } from "jose"; // ← para Google Sign-In
import { getBaseEmailTemplate } from "../emailTemplates/base-template.js";
import { ReferralError, linkReferralCodeForUser } from "../services/referralRewards.service.js";
import { emitAdminActivity } from "../websocket/emitter.js";

dotenv.config();

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || process.env.APPLE_BUNDLE_ID;
const appleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

const USER_SAFE_ATTRIBUTES = [
  "id",
  "name",
  "email",
  "phone",
  "role",
  "avatar_url",
  "is_active",
  "country_code",
  "residence_country_code",
  "referred_by_influencer_id",
  "referred_by_code",
  "referred_at",
  "last_login_at",
  "discount_code_prompted_at",
  "discount_code_reminder_at",
  "discount_code_locked_at",
  "discount_code_entered_at",
  "user_code",
];
const USER_INCLUDES = [
  { model: models.HostProfile, as: "hostProfile" },
  { model: models.GuestProfile, as: "guestProfile" },
];

const presentUser = (user) => {
  if (!user) return null;
  const plain = typeof user.get === "function" ? user.get({ plain: true }) : user;
  return {
    id: plain.id,
    name: plain.name,
    email: plain.email,
    phone: plain.phone,
    role: plain.role ?? 0,
    avatar_url: plain.avatar_url ?? null,
    is_active: plain.is_active ?? true,
    countryCode: plain.country_code ?? null,
    countryOfResidenceCode: plain.residence_country_code ?? null,
    referredByInfluencerId: plain.referred_by_influencer_id ?? null,
    referredByCode: plain.referred_by_code ?? null,
    referredAt: plain.referred_at ?? null,
    lastLoginAt: plain.last_login_at ?? null,
    discountCodePromptedAt: plain.discount_code_prompted_at ?? null,
    discountCodeReminderAt: plain.discount_code_reminder_at ?? null,
    discountCodeLockedAt: plain.discount_code_locked_at ?? null,
    discountCodeEnteredAt: plain.discount_code_entered_at ?? null,
    user_code: plain.user_code ?? null,
    hostProfile: plain.hostProfile || null,
    guestProfile: plain.guestProfile || null,
  };
};

const normalizeAppleBool = (value) => value === true || value === "true";

const resolveAppleName = (fullName, fallbackEmail) => {
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  if (fullName && typeof fullName === "object") {
    const parts = [fullName.givenName, fullName.middleName, fullName.familyName]
      .filter(Boolean)
      .map((part) => String(part).trim())
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  if (fallbackEmail) return String(fallbackEmail).split("@")[0];
  return "Apple User";
};

const loadSafeUser = async (id) => {
  if (!id) return null;
  const user = await models.User.findByPk(id, {
    attributes: USER_SAFE_ATTRIBUTES,
    include: USER_INCLUDES,
  });
  return presentUser(user);
};

const ensureGuestProfile = async (userId) => {
  if (!userId || !models.GuestProfile) return null;
  const [profile] = await models.GuestProfile.findOrCreate({
    where: { user_id: userId },
  });
  return profile;
};

export const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });

/* ────────────────────────────────────────────────────────────────
   STAFF: REGISTER
   ──────────────────────────────────────────────────────────────── */
export const registerStaff = async (req, res) => {
  /* 0. Validación de inputs */
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log("here1");
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, email, password, staff_role_id, hotelIds = [] } = req.body;

  try {
    /* 1. Verificar role y email */
    const role = await models.StaffRole.findByPk(staff_role_id);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const exists = await models.Staff.findOne({ where: { email } });
    if (exists) return res.status(409).json({ error: "Email already registered" });

    /* 2. Verificar array hotelIds */
    if (!Array.isArray(hotelIds) || hotelIds.length === 0) {
      console.log("her2");
      return res.status(400).json({ error: "hotelIds array required (≥1)" });
    }

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
            hotel_id, // asegúrate de tener esta FK en DiscountCode
            startsAt: new Date(),
          },
          { transaction: t }
        );

        codeMap[hotel_id] = staffCode;
      }

      const links = await models.HotelStaff.findAll({
        where: { staff_id: staff.id },
        include: {
          association: "hotel", // alias definido en HotelStaff
          attributes: ["id", "name", "image", "city", "country"],
        },
        attributes: ["staff_code", "is_primary"],
      });

      /* 3.a. Formatear resultado */
      const hotels = links.map((l) => {
        const h = l.hotel; // ← minúsculas
        return {
          id: h.id,
          name: h.name,
          image: h.image,
          city: h.city,
          country: h.country,
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

/* ────────────────────────────────────────────────────────────────
   STAFF: LOGIN
   ──────────────────────────────────────────────────────────────── */
export const loginStaff = async (req, res) => {
  const { email, password } = req.body;

  try {
    /* 1. Buscar staff + rol */
    const staff = await models.Staff.findOne({
      where: { email },
      include: { model: models.StaffRole, as: "role" },
    });
    if (!staff) return res.status(404).json({ error: "Not found" });

    /* 2. Validar contraseña */
    const ok = await bcrypt.compare(password, staff.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    /* 3. Traer hoteles asignados + códigos */
    const links = await models.HotelStaff.findAll({
      where: { staff_id: staff.id },
      include: {
        association: "hotel", // alias definido en HotelStaff
        attributes: ["id", "name", "image", "city", "country"],
      },
      attributes: ["staff_code", "is_primary"],
    });

    /* 3.a. Formatear resultado */
    const hotels = links.map((l) => {
      const h = l.hotel; // ← minúsculas
      return {
        id: h.id,
        name: h.name,
        image: h.image,
        city: h.city,
        country: h.country,
        staffCode: l.staff_code,
        isPrimary: l.is_primary,
      };
    });

    /* 4. JWT */
    const token = signToken({
      id: staff.id,
      type: "staff",
      roleName: staff.role.name,
      roleId: staff.role.id,
    });

    /* 5. Respuesta */
    console.log(hotels, "hotels");
    res.json({ token, staff, hotels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

/* ────────────────────────────────────────────────────────────────
   USER: REGISTER (local)
   ──────────────────────────────────────────────────────────────── */
export const registerUser = async (req, res) => {
  const {
    name,
    email,
    password,
    countryCode,
    countryOfResidenceCode,
    referralCode,
  } = req.body;
  try {
    const exists = await models.User.findOne({ where: { email } });
    if (exists) return res.status(409).json({ error: "Email taken" });

    const hash = await bcrypt.hash(password, 10);

    const user = await models.User.create({
      name,
      email,
      password_hash: hash,
      country_code: countryCode ? String(countryCode).trim() : null,
      residence_country_code: countryOfResidenceCode ? String(countryOfResidenceCode).trim() : null,
      last_login_at: new Date(),
    });

    let referral = { influencerId: null, code: null, at: null };
    const normalizedReferral = referralCode ? String(referralCode).trim().toUpperCase() : "";
    if (normalizedReferral) {
      try {
        await linkReferralCodeForUser({ userId: user.id, referralCode: normalizedReferral });
        await user.reload();
        referral = {
          influencerId: user.referred_by_influencer_id ?? null,
          code: user.referred_by_code ?? normalizedReferral,
          at: user.referred_at ?? new Date(),
        };
      } catch (err) {
        if (err instanceof ReferralError) {
          return res.status(err.status).json({ error: err.message });
        }
        throw err;
      }
    }
    // generate verification token valid for 1 day
    const verifyToken = jwt.sign(
      { id: user.id, type: "user", action: "verify-email" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    const link = `${process.env.CLIENT_URL || process.env.API_URL}/auth/verify-email/${verifyToken}`;

    try {
      const content = `
        <p style="color:#334155;margin:0 0 12px;font-size:16px;">Hi ${name.split(" ")[0]},</p>
        <p style="color:#4a5568;margin:0 0 24px;font-size:16px;">Click the button below to verify your account.</p>
        <table role="presentation" style="margin:16px 0;">
          <tr>
            <td align="center">
              <a href="${link}"
                 style="display:inline-block;background:#ef4444;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Verify email</a>
            </td>
          </tr>
        </table>
        <p style="color:#94a3b8;margin:24px 0 0;font-size:12px;">If you didn't create this account, you can safely ignore this email.</p>
      `

      const html = getBaseEmailTemplate(content, "Verify your email")

      await transporter.sendMail({
        to: email,
        subject: "Verify your email",
        html,
      });
    } catch (mailErr) {
      console.error(mailErr);
    }

    // Emit a token + user to satisfy FE expectations; still send verify email above
    await ensureGuestProfile(user.id)
    await user.update({ last_login_at: new Date() })
    const token = signToken({
      id: user.id,
      type: "user",
      role: user.role,
      countryCode: user.country_code ?? null,
      countryOfResidenceCode: user.residence_country_code ?? null,
      referredByInfluencerId: referral.influencerId ?? null,
      referredByCode: referral.code ?? null,
      referredAt: referral.at ? referral.at.toISOString?.() ?? referral.at : null,
    })
    const safeUser = await loadSafeUser(user.id)

    // Emit real-time activity to Admin Dashboard
    emitAdminActivity({
      type: 'user',
      user: { name: safeUser.name || 'New User' },
      action: 'joined Insider',
      location: safeUser.countryCode || 'Global',
      status: 'SUCCESS',
      timestamp: new Date()
    });

    return res.status(201).json({ token, user: safeUser })
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

/* ────────────────────────────────────────────────────────────────
   USER: LOGIN (local)
   ──────────────────────────────────────────────────────────────── */
export const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    /* 1 ▸ Buscar usuario por email */
    const user = await models.User.findOne({ where: { email } });
    if (!user) return res.status(404).json({ error: "Invalid credentials" });

    /* 2 ▸ Comparar contraseña (usa la columna correcta password_hash) */
    // Guard: if account is Google-linked or has no local password, block local login
    if (user.auth_provider === "google") {
      return res.status(409).json({
        error: "This account was created with Google Sign-In. Please log in with Google.",
      });
    }
    if (user.auth_provider === "apple") {
      return res.status(409).json({
        error: "This account was created with Apple Sign-In. Please log in with Apple.",
      });
    }
    if (!user.password_hash) {
      return res.status(409).json({
        error: "This account does not have a local password. Please use social login.",
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    /*   if (!user.email_verified) {
        return res.status(403).json({ error: "Verifique su correo" });
      } */

    /* 3 ▸ Emitir JWT */
    await ensureGuestProfile(user.id);
    await user.update({ last_login_at: new Date() });
    const token = signToken({
      id: user.id,
      type: "user",
      role: user.role,
      countryCode: user.country_code ?? null,
      countryOfResidenceCode: user.residence_country_code ?? null,
      referredByInfluencerId: user.referred_by_influencer_id ?? null,
      referredByCode: user.referred_by_code ?? null,
      referredAt: user.referred_at ?? null,
    });
    if (process.env.NODE_ENV != "production") {
      console.log("[loginUser] issued token:", token);
    }
    const safeUser = await loadSafeUser(user.id);
    if (process.env.NODE_ENV != "production") {
      console.log("[loginUser] response user:", JSON.stringify(safeUser, null, 2));
    }
    return res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

export const requestPasswordReset = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const genericResponse = { message: "If the email exists, we sent reset instructions." };

  try {
    const user = await models.User.findOne({
      where: { email: { [Op.iLike]: email } },
    });

    if (!user || !user.password_hash) {
      return res.json(genericResponse);
    }

    if (user.auth_provider && user.auth_provider !== "local") {
      return res.json(genericResponse);
    }

    await sendPasswordResetEmail(user);

    return res.json(genericResponse);
  } catch (err) {
    console.error("requestPasswordReset error:", err);
    return res.status(500).json({ error: "Unable to process password reset" });
  }
};

/* ────────────────────────────────────────────────────────────────
   TOKEN: Validar token (lectura)
   ──────────────────────────────────────────────────────────────── */
export const validateToken = async (req, res) => {
  const { token } = req.params;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const action = decoded?.action ?? null;
    let name = null;

    if (decoded?.type === "user" && ["set-password", "reset-password"].includes(action)) {
      const user = await models.User.findByPk(decoded.id, { attributes: ["name"] });
      name = user?.name || null;
    }

    return res.json({ valid: true, payload: decoded, name, action });
  } catch (err) {
    console.log(err);
    return res.status(400).json({
      valid: false,
      error: "Token expired or invalid",
    });
  }
};

/* ────────────────────────────────────────────────────────────────
   VERIFY EMAIL
   ──────────────────────────────────────────────────────────────── */
export const verifyEmail = async (req, res) => {
  const { token } = req.params;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.action !== "verify-email") {
      return res.status(400).json({ error: "Invalid token" });
    }

    const user = await models.User.findByPk(decoded.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    await user.update({ email_verified: true });

    return res.json({ message: "Email verified" });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: "Token expired or invalid" });
  }
};

/* ────────────────────────────────────────────────────────────────
   USER: Set password con token (Magic Link)
   ──────────────────────────────────────────────────────────────── */
export const setPasswordWithToken = async (req, res) => {
  /* 0. validación body --------------------------- */
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ error: errors.array()[0].msg });

  const { token, password } = req.body;

  try {
    /* 1. verificar firma y expiración ------------- */
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== "user" || !["set-password", "reset-password"].includes(decoded.action))
      return res.status(400).json({ error: "Invalid token" });

    /* 2. encontrar usuario ----------------------- */
    const user = await models.User.findByPk(decoded.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    /* 3. hashear y guardar nueva contraseña ------- */
    const hash = await bcrypt.hash(password, 10);
    // ⚠️ tu columna es snake_case: password_hash
    await user.update({ password_hash: hash });

    /* 4. emitir JWT de sesión -------------------- */
    const sessionToken = signToken({
      id: user.id,
      type: "user",
      countryCode: user.country_code ?? null,
      countryOfResidenceCode: user.residence_country_code ?? null,
      referredByInfluencerId: user.referred_by_influencer_id ?? null,
      referredByCode: user.referred_by_code ?? null,
      referredAt: user.referred_at ?? null,
    });

    /* 5. respuesta                                 */
    return res.json({
      token: sessionToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        countryCode: user.country_code ?? null,
        countryOfResidenceCode: user.residence_country_code ?? null,
      },
    });
  } catch (err) {
    console.error("setPassword error:", err);
    return res.status(400).json({ error: "Token expired or invalid" });
  }
};

/* ────────────────────────────────────────────────────────────────
   STAFF: Hire staff
   ──────────────────────────────────────────────────────────────── */
export const hireStaff = async (req, res) => {
  /* ── validación express-validator ── */
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { firstName, lastName, email, staff_role_id, hotelId } = req.body;

  /* ── genera contraseña: apellido + 4 dígitos ── */
  const rawPassword = `${lastName.toLowerCase()}${random4()}`;
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  try {
    /* 1 ▸ crear registro Staff */
    const staff = await models.Staff.create({
      name: `${firstName} ${lastName}`,
      email,
      staff_role_id,
      passwordHash,
    });

    /* 2 ▸ generar staff_code de 4 dígitos único dentro del hotel */
    let staff_code;
    let attempts = 0;
    do {
      staff_code = String(random4());
      // verifica que no exista ya en ese hotel
      // eslint-disable-next-line no-await-in-loop
      const exists = await models.HotelStaff.findOne({
        where: { hotel_id: hotelId, staff_code },
      });
      if (!exists) break;
      attempts += 1;
    } while (attempts < 10);

    if (attempts === 10) {
      return res.status(500).json({ error: "Could not generate unique staff code" });
    }

    /* 3 ▸ vincular en tabla pivote */
    await models.HotelStaff.create({
      hotel_id: hotelId,
      staff_id: staff.id,
      staff_code,
      since: new Date(),
      is_primary: false,
    });

    /* 4 ▸ enviar e-mail */
    await transporter.sendMail({
      to: email,
      subject: "Your new staff account at Insider Hotels",
      html: `
        <h3>Welcome aboard!</h3>
        <p>Your account for Hotel #${hotelId} is ready.</p>
        <p>
          <strong>Login:</strong> ${email}<br/>
          <strong>Password:</strong> ${rawPassword}
        </p>
        <p>Please log in and change your password as soon as possible.</p>
      `,
    });

    return res.json({
      ok: true,
      staffId: staff.id,
      staffCode: staff_code,
    });
  } catch (err) {
    console.error(err);
    // manejo específico para e-mail duplicado
    if (err.name === "SequelizeUniqueConstraintError") {
      return res.status(400).json({ error: "E-mail already exists" });
    }
    return res.status(500).json({ error: "Could not create staff" });
  }
};

/* ────────────────────────────────────────────────────────────────
   STAFF: Listar por hotel
   ──────────────────────────────────────────────────────────────── */
export const listByHotel = async (req, res, next) => {
  try {
    const { hotelId } = req.params;
    if (!hotelId) return res.status(400).json({ error: "hotelId is required" });

    const staff = await models.Staff.findAll({
      attributes: ["id", "name", "email", "staff_role_id"],
      include: [
        {
          model: models.Hotel,
          as: "hotels", // ← alias del belongsToMany en Staff
          where: { id: hotelId },
          through: { attributes: [] },
        },
        { model: models.StaffRole, as: "role", attributes: ["name"] },
      ],
    });

    return res.json(staff);
  } catch (err) {
    next(err);
  }
};

/* ────────────────────────────────────────────────────────────────
   GOOGLE SIGN-IN: Exchange code → tokens → user
   (GIS popup + Authorization Code con PKCE)
   Ruta: POST /auth/google/exchange
   Body: { code }
   ──────────────────────────────────────────────────────────────── */
export const googleExchange = async (req, res) => {
  try {
    const { code, redirectUri: clientRedirectUri } = req.body;
    if (!code) return res.status(400).json({ error: "Missing code" });
    // Allow mobile / Expo to send their own redirect_uri; keep postmessage as default (web popup)
    const redirectUri = typeof clientRedirectUri === "string" && clientRedirectUri.length
      ? clientRedirectUri
      : "postmessage";

    // 1) Intercambio code → tokens (incluye id_token)
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri, // 'postmessage' para web popup; la app puede pasar su URI
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      return res
        .status(400)
        .json({ error: "Token exchange failed", detail: tokens });
    }

    const { id_token } = tokens;
    if (!id_token) return res.status(400).json({ error: "No id_token from Google" });

    // 2) Verificar id_token (firma + audiencia)
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const sub = payload.sub; // id único Google
    const email = payload.email;
    const name = payload.name || email;
    const picture = payload.picture || null;
    const emailVerified = !!payload.email_verified;

    // 3) Upsert usuario
    // 3a) ¿ya está vinculado a Google?
    let user = await models.User.findOne({
      where: { auth_provider: "google", provider_sub: sub },
    });

    const isNew = !user;
    if (!user) {
      // 3b) ¿existe por email? (posible cuenta local previa)
      user = await models.User.findOne({ where: { email } });

      if (user) {
        // Vincular proveedor (merge de cuentas)
        await user.update({
          auth_provider: "google",
          provider_sub: sub,
          email_verified: emailVerified || user.email_verified,
          avatar_url: user.avatar_url || picture,
        });
      } else {
        // 3c) Crear usuario nuevo (sin password)
        user = await models.User.create({
          name,
          email,
          password_hash: null, // social login → sin password local
          auth_provider: "google",
          provider_sub: sub,
          email_verified: emailVerified,
          avatar_url: picture,
          // is_active, role → usan defaults del modelo
        });
      }
    }

    await user.update({ last_login_at: new Date() })

    // 4) Emitir JWT (mismo formato que login local)
    const token = signToken({
      id: user.id,
      type: "user",
      role: user.role,
      countryCode: user.country_code ?? null,
      countryOfResidenceCode: user.residence_country_code ?? null,
      referredByInfluencerId: user.referred_by_influencer_id ?? null,
      referredByCode: user.referred_by_code ?? null,
      referredAt: user.referred_at ?? null,
    });

    const safeUser = await loadSafeUser(user.id)

    if (isNew) {
      emitAdminActivity({
        type: 'user',
        user: { name: safeUser.name || 'New Google User' },
        action: 'joined via Google',
        location: safeUser.countryCode || 'Global',
        status: 'SUCCESS',
        timestamp: new Date()
      });
    }

    return res.json({ token, user: safeUser });
  } catch (err) {
    console.error("googleExchange error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
};

/*
  APPLE SIGN-IN: Exchange identity token -> user
  Route: POST /auth/apple/exchange
  Body: { identityToken, fullName?, email? }
*/
export const appleExchange = async (req, res) => {
  try {
    const { identityToken, fullName, email: providedEmail } = req.body || {};

    // LOG DETAILED INFO FOR DEBUGGING
    console.log("appleExchange called with:", {
      hasToken: !!identityToken,
      hasFullName: !!fullName,
      hasEmail: !!providedEmail,
      envClientId: APPLE_CLIENT_ID
    });

    if (!identityToken) {
      return res.status(400).json({ error: "Missing identityToken" });
    }
    if (!APPLE_CLIENT_ID) {
      console.error("CRITICAL: APPLE_CLIENT_ID/APPLE_BUNDLE_ID not set in env");
      return res.status(500).json({ error: "Apple Sign-In not configured (server-side)" });
    }

    let payload;
    try {
      const verified = await jwtVerify(identityToken, appleJwks, {
        issuer: APPLE_ISSUER,
        audience: APPLE_CLIENT_ID,
      });
      payload = verified.payload;
    } catch (err) {
      console.error("appleExchange verify error:", err);
      // Log more details about the verification failure
      if (err.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
        console.error("JWT claims failed validation. Expected audience:", APPLE_CLIENT_ID);
      }
      return res.status(401).json({ error: "Invalid Apple identity token" });
    }

    const sub = payload?.sub;
    if (!sub) return res.status(400).json({ error: "Invalid Apple token payload" });

    const emailFromToken = payload?.email ? String(payload.email).toLowerCase() : null;
    const email = emailFromToken || (providedEmail ? String(providedEmail).toLowerCase() : null);
    const emailVerified = normalizeAppleBool(payload?.email_verified);

    let user = await models.User.findOne({
      where: { auth_provider: "apple", provider_sub: sub },
    });
    const isNew = !user;

    if (!user) {
      if (email) {
        user = await models.User.findOne({ where: { email } });
      }

      if (user) {
        const updates = {
          auth_provider: "apple",
          provider_sub: sub,
        };
        if (emailVerified && !user.email_verified) updates.email_verified = true;
        if (!user.name) {
          updates.name = resolveAppleName(fullName, email || user.email);
        }
        await user.update(updates);
      } else {
        if (!email) {
          return res.status(400).json({
            error: "Apple account missing email. Revoke Apple access and try again.",
          });
        }
        const name = resolveAppleName(fullName, email);
        user = await models.User.create({
          name,
          email,
          password_hash: null, // social login === sin password local
          auth_provider: "apple",
          provider_sub: sub,
          email_verified: emailVerified,
        });
      }
    } else {
      const updates = {};
      if (!user.email && email) updates.email = email;
      if (emailVerified && !user.email_verified) updates.email_verified = true;
      if (!user.name && fullName) updates.name = resolveAppleName(fullName, email || user.email);
      if (Object.keys(updates).length) {
        await user.update(updates);
      }
    }

    await ensureGuestProfile(user.id);
    await user.update({ last_login_at: new Date() });

    const token = signToken({
      id: user.id,
      type: "user",
      role: user.role,
      countryCode: user.country_code ?? null,
      countryOfResidenceCode: user.residence_country_code ?? null,
      referredByInfluencerId: user.referred_by_influencer_id ?? null,
      referredByCode: user.referred_by_code ?? null,
      referredAt: user.referred_at ?? null,
    });

    const safeUser = await loadSafeUser(user.id);

    if (isNew) {
      emitAdminActivity({
        type: "user",
        user: { name: safeUser.name || "New Apple User" },
        action: "joined via Apple",
        location: safeUser.countryCode || "Global",
        status: "SUCCESS",
        timestamp: new Date(),
      });
    }

    return res.json({ token, user: safeUser });
  } catch (err) {
    console.error("appleExchange CRITICAL error:", err);
    return res.status(500).json({ error: "Internal error", details: err.message });
  }
};
