/* ────────────────────────────────────────────────────────────────
   src/routes/auth.routes.js — COMPLETO, SIN LÍNEAS OMITIDAS
   ──────────────────────────────────────────────────────────────── */
import { Router } from "express";
import { body }   from "express-validator";

/* ---------- controladores ---------- */
import {
  /* Staff  */
  registerStaff,
  loginStaff,

  /* Users  */
  registerUser,
  loginUser,
  verifyEmail,

  /* Magic-link  */
  setPasswordWithToken,
  validateToken,
  hireStaff,
  listByHotel,

  /* Google (GIS popup + code exchange) */
  googleExchange,
} from "../controllers/auth.controller.js";

import { autoSignupOrLogin } from "../controllers/auth.auto.controller.js";

const router = Router();

/* ════════════════════════════════════════════════════════════════
   STAFF AUTH
   ════════════════════════════════════════════════════════════════ */
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

/* ════════════════════════════════════════════════════════════════
   USER AUTH (local)
   ════════════════════════════════════════════════════════════════ */
router.post(
  "/user/register",
  [
    body("name").notEmpty(),
    body("email").isEmail(),
    body("password").isLength({ min: 6 }),
  ],
  registerUser,
);

router.post("/user/login", loginUser);

/* ════════════════════════════════════════════════════════════════
   SOCIAL LOGIN — Google (GIS popup + Authorization Code con PKCE)
   ════════════════════════════════════════════════════════════════ */
router.post(
  "/google/exchange",
  [ body("code").notEmpty() ],
  googleExchange,
);

/* ════════════════════════════════════════════════════════════════
   AUTO-SIGNUP (outside bookings)  →  crea/relaciona usuario
   ════════════════════════════════════════════════════════════════ */
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

/* ════════════════════════════════════════════════════════════════
   MAGIC-LINK — establecer contraseña con token
   ════════════════════════════════════════════════════════════════ */
router.post(
  "/set-password",
  [
    body("token").notEmpty(),
    body("password").isLength({ min: 6 }),
  ],
  setPasswordWithToken,
);

/* ════════════════════════════════════════════════════════════════
   VALIDAR TOKEN (solo lectura) — usado antes de mostrar el form
   ════════════════════════════════════════════════════════════════ */
router.get("/validate-token/:token", validateToken);

/* ════════════════════════════════════════════════════════════════
   VERIFY EMAIL
   ════════════════════════════════════════════════════════════════ */
router.get("/verify-email/:token", verifyEmail);

/* ════════════════════════════════════════════════════════════════
   STAFF: crear/vincular y listar
   ════════════════════════════════════════════════════════════════ */
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

router.get(
  "/by-hotel/:hotelId",
  listByHotel,
);

/* ---------------------------------------------------------------- */
export default router;
