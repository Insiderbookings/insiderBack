// src/controllers/auth.controller.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { validationResult } from "express-validator";
import models from "../models/index.js";
import dotenv from "dotenv";
import { sequelize } from "../models/index.js";
import { random4 } from "../utils/random4.js";
import transporter from "../services/transporter.js";
import sendPasswordResetEmail from "../services/sendPasswordResetEmail.js";
import { OAuth2Client } from "google-auth-library";
import { createRemoteJWKSet, jwtVerify } from "jose"; // ← para Google Sign-In
import { getBaseEmailTemplate } from "../emailTemplates/base-template.js";
import { ReferralError, linkReferralCodeForUser } from "../services/referralRewards.service.js";
import { emitAdminActivity } from "../websocket/emitter.js";
import { getCaseInsensitiveLikeOp } from "../utils/sequelizeHelpers.js";
import { buildHostOnboardingState } from "../utils/hostOnboarding.js";
import { deriveRoleCodes } from "../utils/userCapabilities.js";
import { resolveMailFrom } from "../helpers/mailFrom.js";
import { resolveBookingGptClientUrl } from "../helpers/appUrls.js";
import {
  confirmPhoneVerificationCode,
  isPhoneVerificationConfigured,
  requestPhoneVerificationCode,
} from "../services/phoneVerification.service.js";
import { maskPhone, normalizePhoneE164, samePhoneIdentity } from "../utils/phone.js";

dotenv.config();

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
const iLikeOp = getCaseInsensitiveLikeOp();
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TTL || "15m";
const STAFF_TOKEN_TTL = process.env.JWT_STAFF_TTL || "7d";
const REFRESH_TOKEN_DAYS_RAW = Number(process.env.JWT_REFRESH_TTL_DAYS || 30);
const REFRESH_TOKEN_DAYS = Number.isFinite(REFRESH_TOKEN_DAYS_RAW) ? REFRESH_TOKEN_DAYS_RAW : 30;
const REFRESH_TOKEN_TTL = `${REFRESH_TOKEN_DAYS}d`;
const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_DAYS * 24 * 60 * 60;
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "insider_rt";
const IS_PROD = process.env.NODE_ENV === "production";
const normalizeCookieDomain = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.replace(/^#+/, "") || null;
};
const REFRESH_COOKIE_DOMAIN = normalizeCookieDomain(
  IS_PROD
    ? process.env.REFRESH_COOKIE_DOMAIN || ".insiderbookings.com"
    : process.env.REFRESH_COOKIE_DOMAIN || ""
);
const REFRESH_COOKIE_SAMESITE_RAW = String(
  process.env.REFRESH_COOKIE_SAMESITE || (IS_PROD ? "none" : "lax")
)
  .trim()
  .toLowerCase();
const REFRESH_COOKIE_SAMESITE =
  REFRESH_COOKIE_SAMESITE_RAW === "none"
    ? "None"
    : REFRESH_COOKIE_SAMESITE_RAW === "strict"
      ? "Strict"
      : "Lax";
const REFRESH_COOKIE_SECURE =
  process.env.REFRESH_COOKIE_SECURE === "true" ||
  (process.env.REFRESH_COOKIE_SECURE !== "false" &&
    (IS_PROD || REFRESH_COOKIE_SAMESITE === "None"));
const DEBUG_AUTH_LOGIN_TOKEN = process.env.DEBUG_AUTH_LOGIN_TOKEN === "true";
const EMAIL_VERIFICATION_TTL_MINUTES_RAW = Number(process.env.EMAIL_VERIFICATION_TTL_MINUTES);
const EMAIL_VERIFICATION_TTL_MINUTES =
  Number.isFinite(EMAIL_VERIFICATION_TTL_MINUTES_RAW) && EMAIL_VERIFICATION_TTL_MINUTES_RAW > 0
    ? EMAIL_VERIFICATION_TTL_MINUTES_RAW
    : 10;
const EMAIL_VERIFICATION_RESEND_SECONDS_RAW = Number(process.env.EMAIL_VERIFICATION_RESEND_SECONDS);
const EMAIL_VERIFICATION_RESEND_SECONDS =
  Number.isFinite(EMAIL_VERIFICATION_RESEND_SECONDS_RAW) && EMAIL_VERIFICATION_RESEND_SECONDS_RAW > 0
    ? EMAIL_VERIFICATION_RESEND_SECONDS_RAW
    : 60;
const EMAIL_VERIFICATION_MAX_ATTEMPTS_RAW = Number(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS);
const EMAIL_VERIFICATION_MAX_ATTEMPTS =
  Number.isFinite(EMAIL_VERIFICATION_MAX_ATTEMPTS_RAW) && EMAIL_VERIFICATION_MAX_ATTEMPTS_RAW > 0
    ? EMAIL_VERIFICATION_MAX_ATTEMPTS_RAW
    : 5;
const EMAIL_VERIFICATION_SECRET = process.env.EMAIL_VERIFICATION_SECRET || process.env.JWT_SECRET;
const PHONE_CHANNELS = new Set(["sms", "call"]);
const PHONE_CODE_PATTERN = /^\d{4,10}$/;
const PHONE_RESEND_SECONDS_RAW = Number(process.env.PHONE_VERIFICATION_RESEND_SECONDS);
const PHONE_RESEND_SECONDS =
  Number.isFinite(PHONE_RESEND_SECONDS_RAW) && PHONE_RESEND_SECONDS_RAW >= 30
    ? Math.min(PHONE_RESEND_SECONDS_RAW, 300)
    : 60;
const PHONE_SIGNUP_TICKET_SECRET =
  process.env.PHONE_SIGNUP_TICKET_SECRET || process.env.JWT_SECRET;
const PHONE_SIGNUP_TICKET_TTL_MINUTES_RAW = Number(
  process.env.PHONE_SIGNUP_TICKET_TTL_MINUTES
);
const PHONE_SIGNUP_TICKET_TTL_MINUTES =
  Number.isFinite(PHONE_SIGNUP_TICKET_TTL_MINUTES_RAW) &&
  PHONE_SIGNUP_TICKET_TTL_MINUTES_RAW > 0
    ? Math.min(PHONE_SIGNUP_TICKET_TTL_MINUTES_RAW, 60)
    : 15;
const PHONE_SIGNUP_TICKET_TTL = `${PHONE_SIGNUP_TICKET_TTL_MINUTES}m`;
const PHONE_SIGNUP_TICKET_TYPE = "phone-signup-ticket";
const phoneVerificationCooldowns = new Map();

const DEFAULT_GOOGLE_ANDROID_CLIENT_ID =
  "991272630331-46dbrise1ms2rvmctru26rlg36poanca.apps.googleusercontent.com";
const DEFAULT_GOOGLE_IOS_CLIENT_ID =
  "991272630331-ucd9j3tqkvgnnbqe38b3a7mlr3gckn8p.apps.googleusercontent.com";
const toTrimmedString = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};
const normalizeUrlOrigin = (value) => {
  const normalized = toTrimmedString(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).origin;
  } catch {
    return null;
  }
};
const GOOGLE_WEB_CLIENT_ID = toTrimmedString(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_WEB_CLIENT_SECRET = toTrimmedString(process.env.GOOGLE_CLIENT_SECRET);
const GOOGLE_ANDROID_CLIENT_ID =
  toTrimmedString(process.env.GOOGLE_ANDROID_CLIENT_ID) ||
  DEFAULT_GOOGLE_ANDROID_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID =
  toTrimmedString(process.env.GOOGLE_IOS_CLIENT_ID) || DEFAULT_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_EXPO_CLIENT_ID = toTrimmedString(process.env.GOOGLE_EXPO_CLIENT_ID);
const GOOGLE_ALLOWED_CLIENT_IDS = Array.from(
  new Set([
    GOOGLE_WEB_CLIENT_ID,
    GOOGLE_ANDROID_CLIENT_ID,
    GOOGLE_IOS_CLIENT_ID,
    GOOGLE_EXPO_CLIENT_ID,
  ].filter(Boolean)),
);
const googleClient = new OAuth2Client(GOOGLE_WEB_CLIENT_ID || undefined);
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || process.env.APPLE_BUNDLE_ID;
const appleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

const USER_SAFE_ATTRIBUTES = [
  "id",
  "name",
  "first_name",
  "last_name",
  "email",
  "password_hash",
  "phone",
  "phone_e164",
  "phone_verified",
  "phone_verified_at",
  "role",
  "avatar_url",
  "is_active",
  "email_verified",
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
  "referral_credit_total_minor",
  "referral_credit_available_minor",
  "referral_credit_used_minor",
  "referral_credit_granted_at",
  "referral_credit_expires_at",
  "referral_credit_source_influencer_id",
  "referral_credit_source_code",
  "user_code",
];
const USER_INCLUDES = [
  { model: models.HostProfile, as: "hostProfile" },
  { model: models.GuestProfile, as: "guestProfile" },
];

const maskToken = (token) => {
  if (!token) return null;
  const value = String(token);
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
};

const logLoginToken = (label, token) => {
  if (!DEBUG_AUTH_LOGIN_TOKEN || !token) return;
  console.log(`[auth.login] ${label}:`, maskToken(token));
};

const normalizeNamePart = (value) => {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : null;
};

const normalizeFullName = (value) => {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : null;
};

const splitFullName = (value) => {
  const fullName = normalizeFullName(value);
  if (!fullName) return { fullName: null, firstName: null, lastName: null };
  const parts = fullName.split(" ");
  const firstName = parts[0] || null;
  const lastName = parts.slice(1).join(" ") || null;
  return { fullName, firstName, lastName };
};

const resolveNameParts = ({ name, firstName, lastName }) => {
  const normalizedFirst = normalizeNamePart(firstName);
  const normalizedLast = normalizeNamePart(lastName);
  let fullName = normalizeFullName(name);

  if (!fullName && (normalizedFirst || normalizedLast)) {
    fullName = [normalizedFirst, normalizedLast].filter(Boolean).join(" ").trim() || null;
  }

  let resolvedFirst = normalizedFirst;
  let resolvedLast = normalizedLast;

  if (fullName && (!resolvedFirst || !resolvedLast)) {
    const derived = splitFullName(fullName);
    if (!resolvedFirst) resolvedFirst = derived.firstName;
    if (!resolvedLast) resolvedLast = derived.lastName;
    if (!fullName) fullName = derived.fullName;
  }

  return { fullName, firstName: resolvedFirst, lastName: resolvedLast };
};

const presentUser = (user) => {
  if (!user) return null;
  const plain = typeof user.get === "function" ? user.get({ plain: true }) : user;
  const derivedName = resolveNameParts({
    name: plain.name,
    firstName: plain.first_name,
    lastName: plain.last_name,
  });
  return {
    id: plain.id,
    name: derivedName.fullName || plain.name,
    firstName: derivedName.firstName,
    lastName: derivedName.lastName,
    email: plain.email,
    hasPassword: Boolean(plain.password_hash),
    phone: plain.phone,
    phoneE164: plain.phone_e164 ?? null,
    phoneVerified: plain.phone_verified ?? false,
    phoneVerifiedAt: plain.phone_verified_at ?? null,
    role: plain.role ?? 0,
    roleCodes: deriveRoleCodes(plain),
    avatar_url: plain.avatar_url ?? null,
    is_active: plain.is_active ?? true,
    emailVerified: plain.email_verified ?? false,
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
    referralCreditTotalMinor: plain.referral_credit_total_minor ?? 0,
    referralCreditAvailableMinor: plain.referral_credit_available_minor ?? 0,
    referralCreditUsedMinor: plain.referral_credit_used_minor ?? 0,
    referralCreditGrantedAt: plain.referral_credit_granted_at ?? null,
    referralCreditExpiresAt: plain.referral_credit_expires_at ?? null,
    referralCreditSourceInfluencerId: plain.referral_credit_source_influencer_id ?? null,
    referralCreditSourceCode: plain.referral_credit_source_code ?? null,
    user_code: plain.user_code ?? null,
    hostProfile: plain.hostProfile || null,
    guestProfile: plain.guestProfile || null,
  };
};

const normalizeAppleBool = (value) => value === true || value === "true";

const isAppleRelayEmail = (value) =>
  typeof value === "string" && /@privaterelay\.appleid\.com$/i.test(value.trim());

const isPlaceholderAppleName = (name, email, providerSub) => {
  if (!name) return true;
  const trimmed = String(name).trim();
  if (!trimmed) return true;
  if (/^apple user$/i.test(trimmed)) return true;
  if (providerSub && trimmed === String(providerSub)) return true;
  if (email) {
    const local = String(email).split("@")[0];
    if (local && trimmed === local) return true;
  }
  if (/^[a-f0-9]{10,}$/i.test(trimmed)) return true;
  return false;
};

const resolveAppleName = (fullName, fallbackEmail) => {
  if (typeof fullName === "string") {
    const normalized = normalizeFullName(fullName);
    if (normalized) return normalized;
  }
  if (fullName && typeof fullName === "object") {
    const parts = [fullName.givenName, fullName.middleName, fullName.familyName]
      .filter(Boolean)
      .map((part) => normalizeFullName(part))
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  if (fallbackEmail) {
    const email = String(fallbackEmail).trim();
    if (email) {
      if (isAppleRelayEmail(email)) return "Apple User";
      const local = email.split("@")[0];
      if (/[a-zA-Z]/.test(local)) return local;
    }
  }
  return "Apple User";
};

export const loadSafeUser = async (id) => {
  if (!id) return null;
  const user = await models.User.findByPk(id, {
    attributes: USER_SAFE_ATTRIBUTES,
    include: USER_INCLUDES,
  });
  return presentUser(user);
};

const ensureGuestProfile = async (userId, transaction = null) => {
  if (!userId || !models.GuestProfile) return null;
  const [profile] = await models.GuestProfile.findOrCreate({
    where: { user_id: userId },
    ...(transaction ? { transaction } : {}),
  });
  return profile;
};

const normalizeDeviceId = (value) => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 120);
};

const getRequestIpAddress = (req) => {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (Array.isArray(forwarded)) return forwarded[0] || null;
  return forwarded || req?.socket?.remoteAddress || null;
};

const asPlainObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeVerificationCode = (value) => String(value || "").trim();
const normalizePhoneChannel = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  return PHONE_CHANNELS.has(raw) ? raw : "sms";
};
const resolvePhoneNumberInput = (body) =>
  normalizePhoneE164(body?.phoneNumber || body?.phone || null);

const generateEmailVerificationCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const hashEmailVerificationCode = (code) => {
  if (!EMAIL_VERIFICATION_SECRET) {
    throw new Error("Missing EMAIL_VERIFICATION_SECRET or JWT_SECRET for email verification codes");
  }
  return crypto
    .createHmac("sha256", EMAIL_VERIFICATION_SECRET)
    .update(code)
    .digest("hex");
};

const recordAuthAnalyticsEvent = async ({
  req,
  eventType,
  userId = null,
  metadata = null,
}) => {
  if (!models.AnalyticsEvent || !eventType) return;
  try {
    await models.AnalyticsEvent.create({
      event_type: String(eventType).slice(0, 50),
      user_id: userId || null,
      session_id: normalizeDeviceId(req?.headers?.["x-device-id"]),
      metadata,
      url: req?.originalUrl || req?.url || null,
      ip_address: getRequestIpAddress(req),
    });
  } catch (error) {
    console.error("recordAuthAnalyticsEvent error:", error);
  }
};

const getPhoneRequestCooldownRemainingSeconds = (phoneNumber) => {
  if (!phoneNumber) return 0;
  const requestedAtMs = Number(phoneVerificationCooldowns.get(phoneNumber) || 0);
  if (!requestedAtMs) return 0;
  const expiresAtMs = requestedAtMs + PHONE_RESEND_SECONDS * 1000;
  if (expiresAtMs <= Date.now()) {
    phoneVerificationCooldowns.delete(phoneNumber);
    return 0;
  }
  return Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
};

const notePhoneRequestCooldown = (phoneNumber) => {
  if (!phoneNumber) return;
  phoneVerificationCooldowns.set(phoneNumber, Date.now());
};

const signPhoneSignupTicket = ({ phoneNumber, verifiedAt = new Date() }) => {
  if (!PHONE_SIGNUP_TICKET_SECRET) {
    throw new Error("Missing PHONE_SIGNUP_TICKET_SECRET or JWT_SECRET");
  }
  const resolvedVerifiedAt =
    verifiedAt instanceof Date ? verifiedAt : new Date(verifiedAt || Date.now());
  return jwt.sign(
    {
      type: PHONE_SIGNUP_TICKET_TYPE,
      phoneNumber,
      verifiedAt: resolvedVerifiedAt.toISOString(),
    },
    PHONE_SIGNUP_TICKET_SECRET,
    { expiresIn: PHONE_SIGNUP_TICKET_TTL }
  );
};

const verifyPhoneSignupTicket = (ticket) => {
  if (!PHONE_SIGNUP_TICKET_SECRET) {
    throw new Error("Missing PHONE_SIGNUP_TICKET_SECRET or JWT_SECRET");
  }
  const decoded = jwt.verify(ticket, PHONE_SIGNUP_TICKET_SECRET);
  if (decoded?.type !== PHONE_SIGNUP_TICKET_TYPE) {
    throw new Error("Invalid phone signup ticket");
  }
  const phoneNumber = normalizePhoneE164(decoded?.phoneNumber);
  if (!phoneNumber) {
    throw new Error("Invalid phone signup ticket");
  }
  return {
    phoneNumber,
    verifiedAt: decoded?.verifiedAt ? new Date(decoded.verifiedAt) : new Date(),
  };
};

const getClientType = (req) =>
  String(req?.headers?.["x-client-type"] || req?.headers?.["x-client-platform"] || "")
    .trim()
    .toLowerCase();

export const shouldExposeRefreshToken = (req) => {
  const clientType = getClientType(req);
  return (
    clientType === "web" ||
    clientType === "mobile" ||
    clientType === "app" ||
    clientType === "react-native"
  );
};

const readCookie = (req, name) => {
  const raw = req?.headers?.cookie;
  if (!raw) return null;
  const parts = String(raw)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (!part.startsWith(`${name}=`)) continue;
    return decodeURIComponent(part.slice(name.length + 1));
  }
  return null;
};

const getRefreshTokenFromRequest = (req) => {
  const headerToken = req?.headers?.["x-refresh-token"];
  if (headerToken) return String(headerToken).trim();
  const bodyToken = req?.body?.refreshToken;
  if (bodyToken) return String(bodyToken).trim();
  return readCookie(req, REFRESH_COOKIE_NAME);
};

const setRefreshCookie = (res, token) => {
  if (!res || !token) return;
  const parts = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${REFRESH_COOKIE_SAMESITE}`,
    `Max-Age=${REFRESH_TOKEN_TTL_SECONDS}`,
  ];
  if (REFRESH_COOKIE_SECURE) {
    parts.push("Secure");
  }
  if (REFRESH_COOKIE_DOMAIN) {
    parts.push(`Domain=${REFRESH_COOKIE_DOMAIN}`);
  }
  res.append("Set-Cookie", parts.join("; "));
};

const clearRefreshCookie = (res) => {
  if (!res) return;
  const parts = [
    `${REFRESH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${REFRESH_COOKIE_SAMESITE}`,
    "Max-Age=0",
  ];
  if (REFRESH_COOKIE_SECURE) {
    parts.push("Secure");
  }
  if (REFRESH_COOKIE_DOMAIN) {
    parts.push(`Domain=${REFRESH_COOKIE_DOMAIN}`);
  }
  res.append("Set-Cookie", parts.join("; "));
};

const buildUserAccessPayload = (user, referral = {}) => {
  const plain = typeof user?.get === "function" ? user.get({ plain: true }) : user;
  return {
    id: plain.id,
    type: "user",
    role: plain.role,
    roleCodes: deriveRoleCodes(plain),
    countryCode: plain.country_code ?? null,
    countryOfResidenceCode: plain.residence_country_code ?? null,
    referredByInfluencerId: referral.influencerId ?? plain.referred_by_influencer_id ?? null,
    referredByCode: referral.code ?? plain.referred_by_code ?? null,
    referredAt: referral.at ?? plain.referred_at ?? null,
  };
};

export const signUserAccessToken = (payload) =>
  jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });

export const signStaffToken = (payload) =>
  jwt.sign(payload, ACCESS_SECRET, { expiresIn: STAFF_TOKEN_TTL });

const signRefreshToken = (payload) =>
  jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });

export const issueUserSession = async ({ user, req, res, referral, deviceId }) => {
  const resolvedDeviceId = normalizeDeviceId(deviceId || req?.headers?.["x-device-id"]) || crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  const refreshToken = signRefreshToken({
    jti: tokenId,
    type: "refresh",
    userId: user.id,
    deviceId: resolvedDeviceId,
  });

  await models.RefreshToken.create({
    user_id: user.id,
    token_id: tokenId,
    device_id: resolvedDeviceId,
    expires_at: expiresAt,
    last_used_at: now,
  });

  setRefreshCookie(res, refreshToken);

  const accessToken = signUserAccessToken(buildUserAccessPayload(user, referral));

  return {
    accessToken,
    refreshToken,
    deviceId: resolvedDeviceId,
  };
};

const buildAuthenticatedSessionResponse = async ({
  user,
  req,
  res,
  referral,
  logLabel = null,
}) => {
  await ensureGuestProfile(user.id);
  await user.update({ last_login_at: new Date() });
  const { accessToken, refreshToken } = await issueUserSession({
    user,
    req,
    res,
    referral,
  });
  if (logLabel) logLoginToken(logLabel, accessToken);
  const safeUser = await loadSafeUser(user.id);
  const response = {
    status: "authenticated",
    token: accessToken,
    user: safeUser,
  };
  if (shouldExposeRefreshToken(req)) response.refreshToken = refreshToken;
  return { response, safeUser };
};

const revokeRefreshTokens = async ({ userId, deviceId }) => {
  if (!userId) return 0;
  const where = { user_id: userId, revoked_at: null };
  if (deviceId) where.device_id = deviceId;
  const [count] = await models.RefreshToken.update(
    { revoked_at: new Date() },
    { where },
  );
  return count;
};

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
      const token = signStaffToken({ id: staff.id, type: "staff", roleName: role.name });
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
    const token = signStaffToken({
      id: staff.id,
      type: "staff",
      roleName: staff.role.name,
      roleId: staff.role.id,
    });
    logLoginToken("staff", token);

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
    firstName,
    lastName,
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
    const resolvedName = resolveNameParts({ name, firstName, lastName });
    if (!resolvedName.fullName) {
      return res.status(400).json({ error: "Name is required" });
    }

    const normalizedReferral = referralCode ? String(referralCode).trim().toUpperCase() : "";
    let referral = { influencerId: null, code: null, at: null };
    let userId = null;

    try {
      await sequelize.transaction(async (transaction) => {
        const user = await models.User.create(
          {
            name: resolvedName.fullName,
            first_name: resolvedName.firstName,
            last_name: resolvedName.lastName,
            email,
            password_hash: hash,
            country_code: countryCode ? String(countryCode).trim() : null,
            residence_country_code: countryOfResidenceCode
              ? String(countryOfResidenceCode).trim()
              : null,
            last_login_at: new Date(),
          },
          { transaction }
        );

        userId = Number(user.id) || null;

        if (normalizedReferral) {
          await linkReferralCodeForUser({
            userId: user.id,
            referralCode: normalizedReferral,
            transaction,
          });
          await user.reload({ transaction });
          referral = {
            influencerId: user.referred_by_influencer_id ?? null,
            code: user.referred_by_code ?? normalizedReferral,
            at: user.referred_at ?? new Date(),
          };
        }

        await ensureGuestProfile(user.id, transaction);
        await user.update({ last_login_at: new Date() }, { transaction });
      });
    } catch (err) {
      if (err instanceof ReferralError) {
        return res.status(err.status).json({ error: err.message });
      }
      throw err;
    }

    if (!userId) {
      return res.status(500).json({ error: "Unable to create account" });
    }

    const user = await models.User.findByPk(userId);
    if (!user) {
      return res.status(500).json({ error: "Unable to create account" });
    }

    const { accessToken, refreshToken } = await issueUserSession({
      user,
      req,
      res,
      referral: {
        influencerId: referral.influencerId ?? null,
        code: referral.code ?? null,
        at: referral.at ? referral.at.toISOString?.() ?? referral.at : null,
      },
    })
    logLoginToken("register", accessToken);
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

    const response = { token: accessToken, user: safeUser }
    if (shouldExposeRefreshToken(req)) response.refreshToken = refreshToken
    return res.status(201).json(response)
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

/* ────────────────────────────────────────────────────────────────
   USER: LOGIN (local)
   ──────────────────────────────────────────────────────────────── */
export const loginUser = async (req, res) => {
  const { password } = req.body;
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Email is required" });
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
        error: user.phone_verified
          ? "This account does not have a local password yet. Please continue with your phone number or use social login."
          : "This account does not have a local password. Please use social login.",
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
    const { accessToken, refreshToken } = await issueUserSession({ user, req, res });
    logLoginToken("set-password", accessToken);
    logLoginToken("apple", accessToken);
    logLoginToken("user", accessToken);
    const safeUser = await loadSafeUser(user.id);
    const response = { token: accessToken, user: safeUser };
    if (shouldExposeRefreshToken(req)) response.refreshToken = refreshToken;
    return res.json(response);
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
      where: { email: { [iLikeOp]: email } },
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
export const requestPhoneAuthCode = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const phoneNumber = resolvePhoneNumberInput(req.body);
  if (!phoneNumber) {
    return res.status(400).json({
      error: "Use a valid phone number in international format (example: +14155552671).",
    });
  }

  if (!isPhoneVerificationConfigured()) {
    return res.status(503).json({
      error: "Phone verification is temporarily unavailable.",
      code: "PHONE_VERIFICATION_UNAVAILABLE",
    });
  }

  const channel = normalizePhoneChannel(req.body?.channel);
  const phoneMasked = maskPhone(phoneNumber);

  try {
    const remaining = getPhoneRequestCooldownRemainingSeconds(phoneNumber);
    if (remaining > 0) {
      return res.status(429).json({
        error: `Please wait ${remaining}s before requesting another code.`,
        resendAfterSeconds: remaining,
      });
    }

    const verification = await requestPhoneVerificationCode({ phoneNumber, channel });
    notePhoneRequestCooldown(phoneNumber);

    const existingUser = await models.User.findOne({
      where: { phone_e164: phoneNumber },
      attributes: ["id"],
    });

    await recordAuthAnalyticsEvent({
      req,
      eventType: "auth_phone_request",
      userId: existingUser?.id ?? null,
      metadata: {
        phoneMasked,
        channel,
        existingUser: Boolean(existingUser),
        providerStatus: verification.status || "pending",
      },
    });

    return res.json({
      status: "pending",
      channel,
      phoneMasked,
      resendAfterSeconds: PHONE_RESEND_SECONDS,
    });
  } catch (error) {
    const status = Number(error?.status || error?.response?.status || 500);
    const message =
      error?.message || error?.response?.data?.error || "Unable to start phone verification right now.";

    await recordAuthAnalyticsEvent({
      req,
      eventType: "auth_phone_request_fail",
      metadata: {
        phoneMasked,
        channel,
        errorCode: error?.code || null,
        status,
      },
    });

    return res.status(status).json({
      error: message,
      code: error?.code || "PHONE_AUTH_REQUEST_FAILED",
    });
  }
};

export const confirmPhoneAuthCode = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const phoneNumber = resolvePhoneNumberInput(req.body);
  if (!phoneNumber) {
    return res.status(400).json({
      error: "Use a valid phone number in international format (example: +14155552671).",
    });
  }

  const code = normalizeVerificationCode(req.body?.code);
  if (!PHONE_CODE_PATTERN.test(code)) {
    return res.status(400).json({ error: "Enter a valid verification code." });
  }

  if (!isPhoneVerificationConfigured()) {
    return res.status(503).json({
      error: "Phone verification is temporarily unavailable.",
      code: "PHONE_VERIFICATION_UNAVAILABLE",
    });
  }

  const phoneMasked = maskPhone(phoneNumber);

  try {
    const verification = await confirmPhoneVerificationCode({
      phoneNumber,
      code,
    });

    if (!verification.valid) {
      await recordAuthAnalyticsEvent({
        req,
        eventType: "auth_phone_confirm_fail",
        metadata: {
          phoneMasked,
          reason: "invalid_code",
        },
      });
      return res.status(400).json({ error: "Invalid verification code." });
    }

    const user = await models.User.findOne({
      where: { phone_e164: phoneNumber },
    });

    if (!user) {
      const signupTicket = signPhoneSignupTicket({
        phoneNumber,
        verifiedAt: new Date(),
      });

      await recordAuthAnalyticsEvent({
        req,
        eventType: "auth_phone_signup_ticket",
        metadata: {
          phoneMasked,
        },
      });

      return res.json({
        status: "signup_required",
        signupTicket,
        phoneMasked,
        expiresInMinutes: PHONE_SIGNUP_TICKET_TTL_MINUTES,
      });
    }

    const currentPhoneIdentity = user.phone_e164 || user.phone || null;
    const keepVerifiedAt =
      user.phone_verified &&
      samePhoneIdentity(currentPhoneIdentity, phoneNumber) &&
      user.phone_verified_at;

    await user.update({
      phone: phoneNumber,
      phone_e164: phoneNumber,
      phone_verified: true,
      phone_verified_at: keepVerifiedAt || new Date(),
    });

    const { response } = await buildAuthenticatedSessionResponse({
      user,
      req,
      res,
      logLabel: "phone",
    });

    await recordAuthAnalyticsEvent({
      req,
      eventType: "auth_phone_login",
      userId: user.id,
      metadata: {
        phoneMasked,
      },
    });

    return res.json(response);
  } catch (error) {
    const status = Number(error?.status || error?.response?.status || 500);
    const message =
      error?.message || error?.response?.data?.error || "Unable to verify the phone code.";

    await recordAuthAnalyticsEvent({
      req,
      eventType: "auth_phone_confirm_fail",
      metadata: {
        phoneMasked,
        errorCode: error?.code || null,
        status,
      },
    });

    return res.status(status).json({
      error: message,
      code: error?.code || "PHONE_AUTH_CONFIRM_FAILED",
    });
  }
};

export const registerUserFromPhoneTicket = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const signupTicket = String(req.body?.signupTicket || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const { name, firstName, lastName, referralCode, countryCode, countryOfResidenceCode } = req.body;
  const resolvedName = resolveNameParts({ name, firstName, lastName });

  if (!signupTicket) {
    return res.status(400).json({
      error: "Signup ticket is required.",
      code: "PHONE_SIGNUP_TICKET_REQUIRED",
    });
  }

  if (!resolvedName.fullName) {
    return res.status(400).json({ error: "Name is required" });
  }

  const normalizeCountryCode = (value) => {
    if (value === undefined || value === null || value === "") return null;
    const trimmed = String(value).trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error("Country codes must be numeric");
    }
    return trimmed;
  };

  let ticketPayload;
  try {
    ticketPayload = verifyPhoneSignupTicket(signupTicket);
  } catch (_) {
    await recordAuthAnalyticsEvent({
      req,
      eventType: "auth_phone_register_fail",
      metadata: {
        reason: "invalid_signup_ticket",
      },
    });
    return res.status(400).json({
      error: "Signup ticket is invalid or expired.",
      code: "PHONE_SIGNUP_TICKET_INVALID",
    });
  }

  const phoneNumber = ticketPayload.phoneNumber;
  const phoneMasked = maskPhone(phoneNumber);

  let normalizedCountryCode = null;
  let normalizedResidenceCode = null;
  try {
    normalizedCountryCode = normalizeCountryCode(countryCode);
    normalizedResidenceCode = normalizeCountryCode(countryOfResidenceCode);
  } catch (validationError) {
    return res.status(400).json({ error: validationError.message });
  }

  try {
    const existingPhoneUser = await models.User.findOne({
      where: { phone_e164: phoneNumber },
      attributes: ["id"],
    });
    if (existingPhoneUser) {
      await recordAuthAnalyticsEvent({
        req,
        eventType: "auth_phone_register_fail",
        userId: existingPhoneUser.id,
        metadata: {
          phoneMasked,
          reason: "phone_conflict",
        },
      });
      return res.status(409).json({
        error: "This phone number is already linked to another account.",
        code: "PHONE_ALREADY_LINKED",
      });
    }

    const existingEmailUser = await models.User.findOne({
      where: { email: { [iLikeOp]: email } },
      attributes: ["id"],
    });
    if (existingEmailUser) {
      await recordAuthAnalyticsEvent({
        req,
        eventType: "auth_phone_register_fail",
        userId: existingEmailUser.id,
        metadata: {
          phoneMasked,
          reason: "email_taken",
        },
      });
      return res.status(409).json({
        error: "Email already in use.",
        code: "EMAIL_TAKEN",
      });
    }

    const normalizedReferral = referralCode ? String(referralCode).trim().toUpperCase() : "";
    let referral = { influencerId: null, code: null, at: null };
    let userId = null;

    try {
      await sequelize.transaction(async (transaction) => {
        const user = await models.User.create(
          {
            name: resolvedName.fullName,
            first_name: resolvedName.firstName,
            last_name: resolvedName.lastName,
            email,
            phone: phoneNumber,
            phone_e164: phoneNumber,
            phone_verified: true,
            phone_verified_at: ticketPayload.verifiedAt || new Date(),
            country_code: normalizedCountryCode,
            residence_country_code: normalizedResidenceCode,
            last_login_at: new Date(),
          },
          { transaction }
        );

        userId = Number(user.id) || null;

        if (normalizedReferral) {
          await linkReferralCodeForUser({
            userId: user.id,
            referralCode: normalizedReferral,
            transaction,
          });
          await user.reload({ transaction });
          referral = {
            influencerId: user.referred_by_influencer_id ?? null,
            code: user.referred_by_code ?? normalizedReferral,
            at: user.referred_at ?? new Date(),
          };
        }

        await ensureGuestProfile(user.id, transaction);
      });
    } catch (error) {
      if (error instanceof ReferralError) {
        return res.status(error.status).json({ error: error.message });
      }
      if (error?.name === "SequelizeUniqueConstraintError") {
        return res.status(409).json({
          error: "This phone number or email is already linked to another account.",
          code: "PHONE_REGISTER_CONFLICT",
        });
      }
      throw error;
    }

    if (!userId) {
      return res.status(500).json({ error: "Unable to create account" });
    }

    const user = await models.User.findByPk(userId);
    if (!user) {
      return res.status(500).json({ error: "Unable to create account" });
    }

    const { response, safeUser } = await buildAuthenticatedSessionResponse({
      user,
      req,
      res,
      referral: {
        influencerId: referral.influencerId ?? null,
        code: referral.code ?? null,
        at: referral.at ? referral.at.toISOString?.() ?? referral.at : null,
      },
      logLabel: "phone-register",
    });

    emitAdminActivity({
      type: "user",
      user: { name: safeUser.name || "New User" },
      action: "joined Insider",
      location: safeUser.countryCode || "Global",
      status: "SUCCESS",
      timestamp: new Date(),
    });

    await recordAuthAnalyticsEvent({
      req,
      eventType: "auth_phone_register",
      userId: user.id,
      metadata: {
        phoneMasked,
        referred: Boolean(referral.code),
      },
    });

    return res.status(201).json(response);
  } catch (error) {
    console.error("registerUserFromPhoneTicket error:", error);
    await recordAuthAnalyticsEvent({
      req,
      eventType: "auth_phone_register_fail",
      metadata: {
        phoneMasked,
        reason: "server_error",
      },
    });
    return res.status(500).json({ error: "Server error" });
  }
};

export const requestCurrentUserPhoneVerificationCode = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const phoneNumber = resolvePhoneNumberInput(req.body);
  if (!phoneNumber) {
    return res.status(400).json({
      error: "Use a valid phone number in international format (example: +14155552671).",
    });
  }

  if (!isPhoneVerificationConfigured()) {
    return res.status(503).json({
      error: "Phone verification is temporarily unavailable.",
      code: "PHONE_VERIFICATION_UNAVAILABLE",
    });
  }

  const channel = normalizePhoneChannel(req.body?.channel);
  const phoneMasked = maskPhone(phoneNumber);

  try {
    const user = await models.User.findByPk(userId, {
      attributes: ["id", "phone", "phone_e164", "phone_verified"],
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const existingPhoneUser = await models.User.findOne({
      where: { phone_e164: phoneNumber },
      attributes: ["id"],
    });
    if (existingPhoneUser && Number(existingPhoneUser.id) !== userId) {
      await recordAuthAnalyticsEvent({
        req,
        eventType: "auth_phone_link_conflict",
        userId,
        metadata: {
          phoneMasked,
          stage: "request",
        },
      });
      return res.status(409).json({
        error: "This phone number is already linked to another account.",
        code: "PHONE_ALREADY_LINKED",
      });
    }

    const currentPhoneIdentity = user.phone_e164 || user.phone || null;
    if (user.phone_verified && samePhoneIdentity(currentPhoneIdentity, phoneNumber)) {
      const safeUser = await loadSafeUser(userId);
      return res.json({
        status: "approved",
        channel,
        phoneMasked,
        user: safeUser,
      });
    }

    const remaining = getPhoneRequestCooldownRemainingSeconds(phoneNumber);
    if (remaining > 0) {
      return res.status(429).json({
        error: `Please wait ${remaining}s before requesting another code.`,
        resendAfterSeconds: remaining,
      });
    }

    const verification = await requestPhoneVerificationCode({ phoneNumber, channel });
    notePhoneRequestCooldown(phoneNumber);

    await recordAuthAnalyticsEvent({
      req,
      eventType: "auth_phone_link_request",
      userId,
      metadata: {
        phoneMasked,
        channel,
        providerStatus: verification.status || "pending",
      },
    });

    return res.json({
      status: "pending",
      channel,
      phoneMasked,
      resendAfterSeconds: PHONE_RESEND_SECONDS,
    });
  } catch (error) {
    const status = Number(error?.status || error?.response?.status || 500);
    const message =
      error?.message || error?.response?.data?.error || "Unable to start phone verification right now.";

    await recordAuthAnalyticsEvent({
      req,
      eventType: "auth_phone_link_fail",
      userId,
      metadata: {
        phoneMasked,
        stage: "request",
        errorCode: error?.code || null,
        status,
      },
    });

    return res.status(status).json({
      error: message,
      code: error?.code || "PHONE_LINK_REQUEST_FAILED",
    });
  }
};

export const confirmCurrentUserPhoneVerificationCode = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const phoneNumber = resolvePhoneNumberInput(req.body);
  if (!phoneNumber) {
    return res.status(400).json({
      error: "Use a valid phone number in international format (example: +14155552671).",
    });
  }

  const code = normalizeVerificationCode(req.body?.code);
  if (!PHONE_CODE_PATTERN.test(code)) {
    return res.status(400).json({ error: "Enter a valid verification code." });
  }

  if (!isPhoneVerificationConfigured()) {
    return res.status(503).json({
      error: "Phone verification is temporarily unavailable.",
      code: "PHONE_VERIFICATION_UNAVAILABLE",
    });
  }

  const phoneMasked = maskPhone(phoneNumber);

  try {
    const user = await models.User.findByPk(userId, {
      attributes: ["id", "phone", "phone_e164", "phone_verified", "phone_verified_at"],
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const existingPhoneUser = await models.User.findOne({
      where: { phone_e164: phoneNumber },
      attributes: ["id"],
    });
    if (existingPhoneUser && Number(existingPhoneUser.id) !== userId) {
      await recordAuthAnalyticsEvent({
        req,
        eventType: "auth_phone_link_conflict",
        userId,
        metadata: {
          phoneMasked,
          stage: "confirm",
        },
      });
      return res.status(409).json({
        error: "This phone number is already linked to another account.",
        code: "PHONE_ALREADY_LINKED",
      });
    }

    const verification = await confirmPhoneVerificationCode({
      phoneNumber,
      code,
    });

    if (!verification.valid) {
      await recordAuthAnalyticsEvent({
        req,
        eventType: "auth_phone_link_fail",
        userId,
        metadata: {
          phoneMasked,
          stage: "confirm",
          reason: "invalid_code",
        },
      });
      return res.status(400).json({ error: "Invalid verification code." });
    }

    const currentPhoneIdentity = user.phone_e164 || user.phone || null;
    const keepVerifiedAt =
      user.phone_verified &&
      samePhoneIdentity(currentPhoneIdentity, phoneNumber) &&
      user.phone_verified_at;

    await user.update({
      phone: phoneNumber,
      phone_e164: phoneNumber,
      phone_verified: true,
      phone_verified_at: keepVerifiedAt || new Date(),
    });

    const safeUser = await loadSafeUser(userId);

    await recordAuthAnalyticsEvent({
      req,
      eventType: "auth_phone_link_confirm",
      userId,
      metadata: {
        phoneMasked,
      },
    });

    return res.json({
      status: "approved",
      phoneMasked,
      user: safeUser,
    });
  } catch (error) {
    const status = Number(error?.status || error?.response?.status || 500);
    const message =
      error?.message || error?.response?.data?.error || "Unable to verify the phone code.";

    await recordAuthAnalyticsEvent({
      req,
      eventType: "auth_phone_link_fail",
      userId,
      metadata: {
        phoneMasked,
        stage: "confirm",
        errorCode: error?.code || null,
        status,
      },
    });

    return res.status(status).json({
      error: message,
      code: error?.code || "PHONE_LINK_CONFIRM_FAILED",
    });
  }
};

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

    return res.json({ valid: true, payload: { type: decoded.type, action: decoded.action, exp: decoded.exp }, name, action });
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
   USER: Set password con token (set/reset password)
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
    const { accessToken, refreshToken } = await issueUserSession({ user, req, res });
    const safeUser = await loadSafeUser(user.id);

    const response = { token: accessToken, user: safeUser };
    if (shouldExposeRefreshToken(req)) response.refreshToken = refreshToken;
    return res.json(response);
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
      from: resolveMailFrom(),
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
   Body: { code, redirectUri?, codeVerifier?, clientId? }
   ──────────────────────────────────────────────────────────────── */
export const googleExchange = async (req, res) => {
  try {
    const {
      code,
      idToken: directIdToken,
      redirectUri: clientRedirectUri,
      codeVerifier: clientCodeVerifier,
      clientId: requestedClientIdRaw,
    } = req.body || {};
    const authCode = toTrimmedString(code);
    const idTokenFromClient = toTrimmedString(directIdToken);
    if (!authCode && !idTokenFromClient) {
      return res.status(400).json({ error: "Missing code or idToken" });
    }

    const requestedClientId = toTrimmedString(requestedClientIdRaw);
    const defaultClientId = GOOGLE_WEB_CLIENT_ID || GOOGLE_ALLOWED_CLIENT_IDS[0] || null;
    const clientId = requestedClientId || defaultClientId;
    if (!clientId) {
      return res.status(500).json({ error: "Google OAuth is not configured" });
    }
    if (requestedClientId && !GOOGLE_ALLOWED_CLIENT_IDS.includes(requestedClientId)) {
      return res.status(400).json({ error: "Google OAuth client is not allowed" });
    }
    const clientSecret =
      clientId === GOOGLE_WEB_CLIENT_ID ? GOOGLE_WEB_CLIENT_SECRET : null;
    const codeVerifier = toTrimmedString(clientCodeVerifier);
    if (authCode && !clientSecret && !codeVerifier) {
      return res.status(400).json({
        error: "Missing PKCE code verifier for Google OAuth client",
      });
    }
    const allowedAudiences = GOOGLE_ALLOWED_CLIENT_IDS.length
      ? GOOGLE_ALLOWED_CLIENT_IDS
      : [clientId];
    let payload = null;

    if (idTokenFromClient) {
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: idTokenFromClient,
          audience: allowedAudiences,
        });
        payload = ticket.getPayload();
      } catch (verifyErr) {
        return res.status(401).json({
          error: "Invalid Google identity token",
          detail: verifyErr?.message || "Unable to verify Google identity token",
        });
      }
    } else {
      // GIS popup mode uses the page origin as redirect_uri during code exchange.
      const requestOrigin =
        normalizeUrlOrigin(req.get("origin")) ||
        normalizeUrlOrigin(req.get("referer")) ||
        normalizeUrlOrigin(resolveBookingGptClientUrl());
      const normalizedClientRedirectUri = toTrimmedString(clientRedirectUri);
      const redirectUri =
        normalizedClientRedirectUri && normalizedClientRedirectUri !== "postmessage"
          ? normalizedClientRedirectUri
          : clientSecret
            ? requestOrigin
            : normalizedClientRedirectUri || "postmessage";
      if (!redirectUri) {
        return res.status(400).json({
          error: "Missing redirect URI for Google OAuth client",
        });
      }

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: authCode,
          client_id: clientId,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        }),
      });

      const tokens = await tokenRes.json();
      if (!tokenRes.ok) {
        return res
          .status(400)
          .json({ error: "Token exchange failed", detail: tokens });
      }

      const exchangedIdToken = toTrimmedString(tokens?.id_token);
      if (!exchangedIdToken) {
        return res.status(400).json({ error: "No id_token from Google" });
      }

      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: exchangedIdToken,
          audience: allowedAudiences,
        });
        payload = ticket.getPayload();
      } catch (verifyErr) {
        return res.status(401).json({
          error: "Invalid Google identity token",
          detail: verifyErr?.message || "Unable to verify Google identity token",
        });
      }
    }

    const sub = payload.sub; // id único Google
    const email = payload.email;
    const givenName = payload.given_name || payload.givenName || null;
    const familyName = payload.family_name || payload.familyName || null;
    const googleNameParts = resolveNameParts({
      name: payload.name || email,
      firstName: givenName,
      lastName: familyName,
    });
    const name = googleNameParts.fullName || email;
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
        const updates = {
          auth_provider: "google",
          provider_sub: sub,
          email_verified: emailVerified || user.email_verified,
          avatar_url: user.avatar_url || picture,
        };
        if ((!user.name || user.name === user.email) && name) updates.name = name;
        if (!user.first_name && googleNameParts.firstName) updates.first_name = googleNameParts.firstName;
        if (!user.last_name && googleNameParts.lastName) updates.last_name = googleNameParts.lastName;
        await user.update(updates);
      } else {
        // 3c) Crear usuario nuevo (sin password)
        user = await models.User.create({
          name,
          first_name: googleNameParts.firstName,
          last_name: googleNameParts.lastName,
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

    if (user) {
      const nameUpdates = {};
      if ((!user.name || user.name === user.email) && name) nameUpdates.name = name;
      if (!user.first_name && googleNameParts.firstName) nameUpdates.first_name = googleNameParts.firstName;
      if (!user.last_name && googleNameParts.lastName) nameUpdates.last_name = googleNameParts.lastName;
      if (Object.keys(nameUpdates).length) {
        await user.update(nameUpdates);
      }
    }

    await user.update({ last_login_at: new Date() })

    // 4) Emitir JWT (mismo formato que login local)
    const { accessToken, refreshToken } = await issueUserSession({ user, req, res })
    logLoginToken("google", accessToken);
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

    const response = { token: accessToken, user: safeUser }
    if (shouldExposeRefreshToken(req)) response.refreshToken = refreshToken
    return res.json(response);
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
      // 2. Verify signature
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
      return res.status(401).json({
        error: "Invalid Apple identity token",
        details: err.message,
        code: err.code,
        expectedAudience: APPLE_CLIENT_ID,
      });
    }

    const sub = payload?.sub;
    if (!sub) return res.status(400).json({ error: "Invalid Apple token payload" });

    const emailFromToken = payload?.email ? String(payload.email).toLowerCase() : null;
    const email = emailFromToken || (providedEmail ? String(providedEmail).toLowerCase() : null);
    const emailVerified = normalizeAppleBool(payload?.email_verified);
    const appleNameParts = resolveNameParts({
      name: resolveAppleName(fullName, email),
      firstName: fullName && typeof fullName === "object" ? fullName.givenName : null,
      lastName: fullName && typeof fullName === "object" ? fullName.familyName : null,
    });
    console.log("appleExchange details:", {
      providedEmail,
      tokenEmail: payload?.email,
      emailResolved: email,
      fullName,
      appleNameParts,
      resolvedName: resolveAppleName(fullName, email),
      emailVerified,
    });

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
        if (appleNameParts.fullName && isPlaceholderAppleName(user.name, email || user.email, sub)) {
          updates.name = appleNameParts.fullName;
        }
        if (!user.first_name && appleNameParts.firstName) updates.first_name = appleNameParts.firstName;
        if (!user.last_name && appleNameParts.lastName) updates.last_name = appleNameParts.lastName;
        await user.update(updates);
      } else {
        if (!email) {
          return res.status(400).json({
            error: "Apple account missing email. Revoke Apple access and try again.",
          });
        }
        user = await models.User.create({
          name: appleNameParts.fullName || resolveAppleName(fullName, email),
          first_name: appleNameParts.firstName,
          last_name: appleNameParts.lastName,
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
      if (appleNameParts.fullName && isPlaceholderAppleName(user.name, email || user.email, sub)) {
        updates.name = appleNameParts.fullName;
      }
      if (!user.first_name && appleNameParts.firstName) updates.first_name = appleNameParts.firstName;
      if (!user.last_name && appleNameParts.lastName) updates.last_name = appleNameParts.lastName;
      if (Object.keys(updates).length) {
        await user.update(updates);
      }
    }

    await ensureGuestProfile(user.id);
    await user.update({ last_login_at: new Date() });

    const { accessToken, refreshToken } = await issueUserSession({ user, req, res });
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

    const response = { token: accessToken, user: safeUser };
    if (shouldExposeRefreshToken(req)) response.refreshToken = refreshToken;
    return res.json(response);
  } catch (err) {
    console.error("appleExchange CRITICAL error:", err);
    return res.status(500).json({ error: "Internal error", details: err.message });
  }
};

const buildEmailVerificationTemplate = ({ name, code }) => {
  const firstName = name ? String(name).split(" ")[0] : "there";
  const spacedCode = code.split("").join(" ");
  const content = `
    <p style="color:#0f172a;margin:0 0 12px;font-size:16px;">Hi ${firstName},</p>
    <p style="color:#4b5563;margin:0 0 18px;font-size:15px;">
      Use the code below to verify your BookingGPT account.
    </p>
    <div style="background:#111827;border-radius:12px;padding:16px 20px;display:inline-block;margin-bottom:16px;">
      <span style="color:#ffffff;font-size:22px;letter-spacing:6px;font-weight:700;">${spacedCode}</span>
    </div>
    <p style="color:#6b7280;margin:0;font-size:13px;">
      This code expires in ${EMAIL_VERIFICATION_TTL_MINUTES} minutes.
    </p>
  `;
  return getBaseEmailTemplate(content, "Verify your email", {
    brandName: "BookingGPT",
    headerTitle: "BookingGPT",
    headerSubtitle: "AI-powered travel",
    primaryColor: "#0b0b10",
    accentColor: "#ff1b6d",
    backgroundColor: "#f8fafc",
    bodyBackground: "#ffffff",
    textColor: "#ffffff",
    logoUrl: "https://bookinggpt.app/bookinggpt-logo.png",
    tagline: "AI-powered booking assistant",
    supportText: "Need help? partners@insiderbookings.com",
  });
};

export const requestEmailVerificationCode = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const user = await models.User.findByPk(req.user.id, { attributes: ["id", "name", "email", "email_verified", "email_verification_sent_at"] });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.email_verified) return res.json({ message: "Email already verified." });

    const resendSeconds = EMAIL_VERIFICATION_RESEND_SECONDS;
    const lastSentAt = user.email_verification_sent_at
      ? new Date(user.email_verification_sent_at).getTime()
      : null;
    if (lastSentAt && Date.now() - lastSentAt < resendSeconds * 1000) {
      const remaining = Math.ceil((resendSeconds * 1000 - (Date.now() - lastSentAt)) / 1000);
      return res.status(429).json({ error: `Please wait ${remaining}s before requesting another code.` });
    }

    const code = generateEmailVerificationCode();
    const hash = hashEmailVerificationCode(code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MINUTES * 60 * 1000);

    await user.update({
      email_verification_code_hash: hash,
      email_verification_expires_at: expiresAt,
      email_verification_attempts: 0,
      email_verification_sent_at: now,
    });

    const html = buildEmailVerificationTemplate({ name: user.name, code });
    try {
      await transporter.sendMail({
        to: user.email,
        from: resolveMailFrom(),
        subject: "Your BookingGPT verification code",
        html,
      });
    } catch (mailErr) {
      await user.update({
        email_verification_code_hash: null,
        email_verification_expires_at: null,
        email_verification_attempts: 0,
      });
      console.error(mailErr);
      return res.status(500).json({ error: "Unable to send verification email." });
    }

    return res.json({
      message: "Verification code sent.",
      expiresInMinutes: EMAIL_VERIFICATION_TTL_MINUTES,
      resendAfterSeconds: resendSeconds,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

export const confirmEmailVerificationCode = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const code = normalizeVerificationCode(req.body?.code);
    if (!code) return res.status(400).json({ error: "Verification code is required." });

    const user = await models.User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.email_verified) return res.json({ message: "Email already verified." });

    if (!user.email_verification_code_hash || !user.email_verification_expires_at) {
      return res.status(400).json({ error: "Verification code is invalid or expired." });
    }

    const attempts = Number(user.email_verification_attempts || 0);
    if (attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many attempts. Please request a new code." });
    }

    if (new Date(user.email_verification_expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Verification code expired. Please request a new one." });
    }

    const expected = user.email_verification_code_hash;
    const actual = hashEmailVerificationCode(code);
    if (expected !== actual) {
      await user.update({ email_verification_attempts: attempts + 1 });
      return res.status(400).json({ error: "Invalid verification code." });
    }

    await sequelize.transaction(async (transaction) => {
      await user.update(
        {
          email_verified: true,
          email_verification_code_hash: null,
          email_verification_expires_at: null,
          email_verification_attempts: 0,
          email_verification_sent_at: null,
        },
        { transaction }
      );

      const hostProfile = await models.HostProfile.findOne({
        where: { user_id: user.id },
        attributes: ["id", "metadata", "kyc_status"],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!hostProfile) return;

      const metadata = asPlainObject(hostProfile.metadata);
      const existingHostOnboarding = asPlainObject(
        metadata.hostOnboarding || metadata.host_onboarding
      );

      const nextMetadata = {
        ...metadata,
        kyc_status: metadata.kyc_status || hostProfile.kyc_status || null,
        emailVerified: true,
        email_verified: true,
        realPersonConfirmed: true,
        real_person_confirmed: true,
        hostOnboarding: {
          ...existingHostOnboarding,
          confirmRealPerson: true,
          realPersonConfirmed: true,
        },
      };

      const normalizedOnboarding = buildHostOnboardingState(nextMetadata);
      nextMetadata.hostOnboarding = {
        verifyIdentity: normalizedOnboarding.steps.verifyIdentity,
        confirmRealPerson: normalizedOnboarding.steps.confirmRealPerson,
        confirmPhone: normalizedOnboarding.steps.confirmPhone,
      };

      await hostProfile.update(
        {
          metadata: nextMetadata,
        },
        { transaction }
      );
    });

    return res.json({ message: "Email verified." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

export const refreshSession = async (req, res) => {
  const refreshToken = getRefreshTokenFromRequest(req);
  if (!refreshToken) return res.status(401).json({ error: "Missing refresh token" });

  let payload;
  try {
    payload = jwt.verify(refreshToken, REFRESH_SECRET);
  } catch (err) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  if (payload?.type !== "refresh") {
    clearRefreshCookie(res);
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const userId = Number(payload.userId || payload.sub || payload.id);
  const tokenId = payload.jti;
  const deviceId = normalizeDeviceId(payload.deviceId || req?.headers?.["x-device-id"]);

  if (!userId || !tokenId) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const record = await models.RefreshToken.findOne({
    where: { token_id: tokenId, user_id: userId },
  });

  if (!record) {
    await revokeRefreshTokens({ userId, deviceId });
    clearRefreshCookie(res);
    return res.status(401).json({ error: "Refresh token revoked" });
  }

  if (record.revoked_at) {
    await revokeRefreshTokens({ userId, deviceId: record.device_id || deviceId });
    clearRefreshCookie(res);
    return res.status(401).json({ error: "Refresh token revoked" });
  }

  if (record.expires_at && new Date(record.expires_at) <= new Date()) {
    await revokeRefreshTokens({ userId, deviceId: record.device_id || deviceId });
    clearRefreshCookie(res);
    return res.status(401).json({ error: "Refresh token expired" });
  }

  const user = await models.User.findByPk(userId);
  if (!user || !user.is_active) {
    await revokeRefreshTokens({ userId, deviceId: record.device_id || deviceId });
    clearRefreshCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }

  const newTokenId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  const resolvedDeviceId = record.device_id || deviceId || crypto.randomUUID();

  const nextRefreshToken = signRefreshToken({
    jti: newTokenId,
    type: "refresh",
    userId,
    deviceId: resolvedDeviceId,
  });

  await record.update({
    revoked_at: now,
    last_used_at: now,
    replaced_by: newTokenId,
  });

  await models.RefreshToken.create({
    user_id: userId,
    token_id: newTokenId,
    device_id: resolvedDeviceId,
    expires_at: expiresAt,
    last_used_at: now,
  });

  setRefreshCookie(res, nextRefreshToken);

  const accessToken = signUserAccessToken(buildUserAccessPayload(user));
  const safeUser = await loadSafeUser(userId);
  const response = { token: accessToken, user: safeUser };
  if (shouldExposeRefreshToken(req)) response.refreshToken = nextRefreshToken;
  if (process.env.DEBUG_AUTH_REFRESH_TOKEN === "true") {
    console.log("[auth.refresh] accessToken:", maskToken(accessToken));
  }
  return res.json(response);
};

export const logoutSession = async (req, res) => {
  const refreshToken = getRefreshTokenFromRequest(req);
  let revokedCount = 0;

  if (refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, REFRESH_SECRET);
      if (payload?.type === "refresh") {
        const tokenId = payload.jti;
        const userId = Number(payload.userId || payload.sub || payload.id);
        if (tokenId && userId) {
          const [count] = await models.RefreshToken.update(
            { revoked_at: new Date() },
            { where: { token_id: tokenId, user_id: userId, revoked_at: null } },
          );
          revokedCount = count;
        }
      }
    } catch (err) {
      // ignore invalid refresh token
    }
  }

  clearRefreshCookie(res);
  return res.json({ ok: true, revoked: revokedCount });
};

export const logoutAllSessions = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const [count] = await models.RefreshToken.update(
    { revoked_at: new Date() },
    { where: { user_id: userId, revoked_at: null } },
  );

  clearRefreshCookie(res);
  return res.json({ ok: true, revoked: count });
};
