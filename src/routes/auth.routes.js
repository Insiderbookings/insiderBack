import { Router } from "express";
import { body } from "express-validator";

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
} from "../controllers/auth.controller.js";

import { autoSignupOrLogin } from "../controllers/auth.auto.controller.js";
import { authenticate } from "../middleware/auth.js";

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
  [
    body("name").notEmpty(),
    body("email").isEmail(),
    body("password").isLength({ min: 6 }),
    body("countryCode").isInt().withMessage("countryCode is required"),
    body("countryOfResidenceCode").isInt().withMessage("countryOfResidenceCode is required"),
    body("referralCode").optional().isString(),
  ],
  registerUser,
);
router.post("/user/login", loginUser);
router.post(
  "/user/forgot-password",
  [body("email").isEmail()],
  requestPasswordReset,
);

// Social login
router.post("/google/exchange", [body("code").notEmpty()], googleExchange);
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
router.post("/refresh", refreshSession);
router.post("/logout", logoutSession);
router.post("/logout-all", authenticate, logoutAllSessions);

// Token validation and email verify
router.get("/validate-token/:token", validateToken);
router.get("/verify-email/:token", verifyEmail);

// Staff helpers
router.post(
  "/hire",
  [
    body("firstName").notEmpty(),
    body("lastName").notEmpty(),
    body("email").isEmail(),
    body("staff_role_id").isInt(),
    body("hotelId").isInt(),
  ],
  hireStaff,
);
router.get("/by-hotel/:hotelId", listByHotel);

export default router;
