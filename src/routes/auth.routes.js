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

  /* Magic-link  */
  setPasswordWithToken,
  validateToken,
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
   USER AUTH
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

/* ---------------------------------------------------------------- */
export default router;
