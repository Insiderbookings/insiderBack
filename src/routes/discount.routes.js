// src/routes/discount.js
import { Router } from "express";
import {
  validateDiscount,
  createCustomCode,
} from "../controllers/discount.controller.js";
import {
  authenticate,      // ← verifica JWT y pone req.user
  authorizeStaff,    // ← permite sólo “staff”
} from "../middleware/auth.js"; // ajusta el path si es distinto

const router = Router();

/* Público (no requiere login) ------------------------------------ */
router.post("/validate", validateDiscount);

/* Privado – sólo staff con JWT ----------------------------------- */
router.post(
  "/createCustom",
  authenticate,       // 1) token válido
  authorizeStaff,     // 2) user.type === "staff"
  createCustomCode,   // 3) controlador
);

export default router;
