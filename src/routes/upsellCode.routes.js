// src/routes/upsellCode.routes.js
import { Router } from "express";
import { generateUpsellCode, validateUpsellCode, getUpsellCode } from "../controllers/upsell.controller.js";
import { authenticate, authorizeStaff } from "../middleware/auth.js";

const router = Router();

/* Staff genera código */
router.post("/", authenticate, authorizeStaff, generateUpsellCode);

/* Cliente valida código */
router.post("/validate", validateUpsellCode);

/* Obtener detalles por ID (para pantalla de éxito / fallo) */
router.get("/:id", getUpsellCode);

export default router;
