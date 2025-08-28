// src/controllers/auth.controller.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { validationResult } from "express-validator";
import models from "../models/index.js";
import dotenv from "dotenv";
import { sequelize } from "../models/index.js";
import { random4 } from "../utils/random4.js";
import transporter from "../services/transporter.js";
import { OAuth2Client } from "google-auth-library"; // ← para Google Sign-In
import { getBaseEmailTemplate } from "../emailTemplates/base-template.js";

dotenv.config();

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

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
  const { name, email, password } = req.body;
  try {
    const exists = await models.User.findOne({ where: { email } });
    if (exists) return res.status(409).json({ error: "Email taken" });

    const hash = await bcrypt.hash(password, 10);

    const user = await models.User.create({
      name,
      email,
      password_hash: hash,
    });
    // generate verification token valid for 1 day
    const verifyToken = jwt.sign(
      { id: user.id, type: "user", action: "verify-email" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    const link = `${process.env.API_URL || process.env.CLIENT_URL}/auth/verify-email/${verifyToken}`;

    try {
      const content = `
        <p style="color:#4a5568;margin:0 0 16px;font-size:16px;">Hola ${name.split(" ")[0]},</p>
        <p style="color:#4a5568;margin:0 0 24px;font-size:16px;">Haz clic en el botón para verificar tu cuenta.</p>
        <table role="presentation" style="margin:16px 0;">
          <tr>
            <td align="center">
              <a href="${link}"
                 style="display:inline-block;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Verificar correo</a>
            </td>
          </tr>
        </table>
        <p style="color:#718096;margin:24px 0 0;font-size:14px;">Si no solicitaste esta cuenta, puedes ignorar este correo.</p>
      `

      const html = getBaseEmailTemplate(content, "Verifica tu correo")

      await transporter.sendMail({
        to: email,
        subject: "Verifica tu correo",
        html,
      });
    } catch (mailErr) {
      console.error(mailErr);
    }

    return res.status(201).json({ message: "Usuario registrado. Verifique su correo." });
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
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  /*   if (!user.email_verified) {
      return res.status(403).json({ error: "Verifique su correo" });
    } */

    /* 3 ▸ Emitir JWT */
    const token = signToken({ id: user.id, type: "user", role: user.role });
    return res.json({ token, user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

/* ────────────────────────────────────────────────────────────────
   TOKEN: Validar token (lectura)
   ──────────────────────────────────────────────────────────────── */
export const validateToken = (req, res) => {
  const { token } = req.params;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    /* opcional: limitar solo a ciertos tipos de token
       if (decoded.action !== "set-password") …           */

    return res.json({ valid: true, payload: decoded });
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

    if (decoded.type !== "user" || decoded.action !== "set-password")
      return res.status(400).json({ error: "Invalid token" });

    /* 2. encontrar usuario ----------------------- */
    const user = await models.User.findByPk(decoded.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    /* 3. hashear y guardar nueva contraseña ------- */
    const hash = await bcrypt.hash(password, 10);
    // ⚠️ tu columna es snake_case: password_hash
    await user.update({ password_hash: hash });

    /* 4. emitir JWT de sesión -------------------- */
    const sessionToken = signToken({ id: user.id, type: "user" });

    /* 5. respuesta                                 */
    return res.json({
      token: sessionToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
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
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Missing code" });

    // 1) Intercambio code → tokens (incluye id_token)
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: "postmessage", // GIS popup usa 'postmessage'
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

    // 4) Emitir JWT (mismo formato que login local)
    const token = signToken({ id: user.id, type: "user", role: user.role });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar_url: user.avatar_url,
      },
    });
  } catch (err) {
    console.error("googleExchange error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
};
