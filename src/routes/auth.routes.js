import { Router } from "express";
import { body } from "express-validator";
import rateLimit from "express-rate-limit";
import { normalizePhoneE164 } from "../utils/phone.js";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.AUTH_REGISTER_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many accounts created from this IP, please try again later" },
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.AUTH_RESET_RATE_LIMIT_MAX || 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset attempts, please try again later" },
});

const normalizePhoneLimiterValue = (req) => {
  const normalized = normalizePhoneE164(req.body?.phoneNumber || req.body?.phone || null);
  if (normalized) return normalized;
  const fallback = String(req.body?.phoneNumber || req.body?.phone || "").trim();
  return fallback ? fallback.slice(0, 40) : "unknown-phone";
};

const normalizeDeviceLimiterValue = (req) => {
  const value = String(req.headers?.["x-device-id"] || "").trim();
  return value ? value.slice(0, 80) : "unknown-device";
};

const buildPhoneLimiterKey = (req, prefix) =>
  [
    prefix,
    req.ip || "unknown-ip",
    normalizePhoneLimiterValue(req),
    normalizeDeviceLimiterValue(req),
  ].join("|");

const phoneRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.AUTH_PHONE_REQUEST_RATE_LIMIT_MAX || 5),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => buildPhoneLimiterKey(req, "phone-request"),
  message: { error: "Too many phone verification requests, please try again later" },
});

const phoneConfirmLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.AUTH_PHONE_CONFIRM_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => buildPhoneLimiterKey(req, "phone-confirm"),
  message: { error: "Too many phone verification attempts, please try again later" },
});

const phoneRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.AUTH_PHONE_REGISTER_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    [
      "phone-register",
      req.ip || "unknown-ip",
      String(req.body?.email || "").trim().toLowerCase() || "unknown-email",
      normalizeDeviceLimiterValue(req),
    ].join("|"),
  message: { error: "Too many phone signup attempts, please try again later" },
});

const phoneLinkRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.AUTH_PHONE_LINK_REQUEST_RATE_LIMIT_MAX || 5),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    [
      "phone-link-request",
      req.user?.id || "unknown-user",
      normalizePhoneLimiterValue(req),
      normalizeDeviceLimiterValue(req),
    ].join("|"),
  message: { error: "Too many phone link requests, please try again later" },
});

const phoneLinkConfirmLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.AUTH_PHONE_LINK_CONFIRM_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    [
      "phone-link-confirm",
      req.user?.id || "unknown-user",
      normalizePhoneLimiterValue(req),
      normalizeDeviceLimiterValue(req),
    ].join("|"),
  message: { error: "Too many phone link attempts, please try again later" },
});

import {
  registerStaff,
  loginStaff,
  registerUser,
  loginUser,
  requestPasswordReset,
  verifyEmail,
  setPasswordWithToken,
  validateToken,
  hireStaff,
  listByHotel,
  googleExchange,
  appleExchange,
  refreshSession,
  logoutSession,
  logoutAllSessions,
  requestEmailVerificationCode,
  confirmEmailVerificationCode,
  requestPhoneAuthCode,
  confirmPhoneAuthCode,
  registerUserFromPhoneTicket,
  requestCurrentUserPhoneVerificationCode,
  confirmCurrentUserPhoneVerificationCode,
} from "../controllers/auth.controller.js";

import { autoSignupOrLogin } from "../controllers/auth.auto.controller.js";
import { authenticate, authorizeRoles } from "../middleware/auth.js";

const router = Router();

// Staff auth
router.post(
  "/staff/register",
  [
    body("name").notEmpty(),
    body("email").isEmail(),
    body("password").isLength({ min: 6 }),
    body("staff_role_id").isInt(),
  ],
  registerStaff,
);
router.post("/staff/login", loginStaff);

// User auth (local)
router.post(
  "/user/register",
  registerLimiter,
  [
    body("email").isEmail(),
    body("password").isLength({ min: 6 }),
    body("countryCode").isInt().withMessage("countryCode is required"),
    body("countryOfResidenceCode").isInt().withMessage("countryOfResidenceCode is required"),
    body("referralCode").optional().isString(),
    body("name").optional().isString(),
    body("firstName").optional().isString(),
    body("lastName").optional().isString(),
    body().custom((_, { req }) => {
      const name = String(req.body?.name || "").trim();
      const firstName = String(req.body?.firstName || "").trim();
      const lastName = String(req.body?.lastName || "").trim();
      if (name || (firstName && lastName)) return true;
      throw new Error("Name is required");
    }),
  ],
  registerUser,
);
router.post("/user/login", loginLimiter, loginUser);
router.post(
  "/user/forgot-password",
  passwordResetLimiter,
  [body("email").isEmail()],
  requestPasswordReset,
);

router.post(
  "/phone/request",
  phoneRequestLimiter,
  [
    body().custom((_, { req }) => {
      if (String(req.body?.phoneNumber || req.body?.phone || "").trim()) return true;
      throw new Error("phoneNumber is required");
    }),
    body("phoneNumber").optional().isString(),
    body("phone").optional().isString(),
    body("channel").optional().isString(),
  ],
  requestPhoneAuthCode,
);
router.post(
  "/phone/confirm",
  phoneConfirmLimiter,
  [
    body().custom((_, { req }) => {
      if (String(req.body?.phoneNumber || req.body?.phone || "").trim()) return true;
      throw new Error("phoneNumber is required");
    }),
    body("phoneNumber").optional().isString(),
    body("phone").optional().isString(),
    body("code").notEmpty(),
  ],
  confirmPhoneAuthCode,
);
router.post(
  "/phone/register",
  phoneRegisterLimiter,
  [
    body("signupTicket").notEmpty(),
    body("email").isEmail(),
    body("referralCode").optional().isString(),
    body("countryCode").optional().isInt(),
    body("countryOfResidenceCode").optional().isInt(),
    body("name").optional().isString(),
    body("firstName").optional().isString(),
    body("lastName").optional().isString(),
    body().custom((_, { req }) => {
      const name = String(req.body?.name || "").trim();
      const firstName = String(req.body?.firstName || "").trim();
      const lastName = String(req.body?.lastName || "").trim();
      if (name || (firstName && lastName)) return true;
      throw new Error("Name is required");
    }),
  ],
  registerUserFromPhoneTicket,
);

// Social login
router.post(
  "/google/exchange",
  [
    body().custom((_, { req }) => {
      if (String(req.body?.code || "").trim()) return true;
      if (String(req.body?.idToken || "").trim()) return true;
      throw new Error("code or idToken is required");
    }),
    body("code").optional().isString(),
    body("idToken").optional().isString(),
    body("redirectUri").optional().isString(),
    body("codeVerifier").optional().isString(),
    body("clientId").optional().isString(),
  ],
  googleExchange,
);
router.post("/apple/exchange", [body("identityToken").notEmpty()], appleExchange);

// Auto signup for outside bookings
router.post(
  "/auto-signup",
  [
    body("email").isEmail(),
    body("firstName").notEmpty(),
    body("lastName").notEmpty(),
    body("phone").optional().isString(),
    body("outsideBookingId").optional().isInt(),
  ],
  autoSignupOrLogin,
);

// Set/reset password
router.post(
  "/set-password",
  [body("token").notEmpty(), body("password").isLength({ min: 6 })],
  setPasswordWithToken,
);

// Session refresh + logout
router.post("/refresh", loginLimiter, refreshSession);
router.post("/logout", logoutSession);
router.post("/logout-all", authenticate, logoutAllSessions);

// Email verification (code-based)
router.post("/verify-email/request", authenticate, requestEmailVerificationCode);
router.post("/verify-email/confirm", authenticate, confirmEmailVerificationCode);
router.post(
  "/me/phone/request",
  authenticate,
  phoneLinkRequestLimiter,
  [
    body().custom((_, { req }) => {
      if (String(req.body?.phoneNumber || req.body?.phone || "").trim()) return true;
      throw new Error("phoneNumber is required");
    }),
    body("phoneNumber").optional().isString(),
    body("phone").optional().isString(),
    body("channel").optional().isString(),
  ],
  requestCurrentUserPhoneVerificationCode,
);
router.post(
  "/me/phone/confirm",
  authenticate,
  phoneLinkConfirmLimiter,
  [
    body().custom((_, { req }) => {
      if (String(req.body?.phoneNumber || req.body?.phone || "").trim()) return true;
      throw new Error("phoneNumber is required");
    }),
    body("phoneNumber").optional().isString(),
    body("phone").optional().isString(),
    body("code").notEmpty(),
  ],
  confirmCurrentUserPhoneVerificationCode,
);

// Token validation and email verify
router.get("/validate-token/:token", validateToken);
router.get("/verify-email/:token", verifyEmail);

// Staff helpers
router.post(
  "/hire",
  authenticate,
  authorizeRoles(100),
  [
    body("firstName").notEmpty(),
    body("lastName").notEmpty(),
    body("email").isEmail(),
    body("staff_role_id").isInt(),
    body("hotelId").isInt(),
  ],
  hireStaff,
);
router.get("/by-hotel/:hotelId", authenticate, authorizeRoles(100), listByHotel);

export default router;
