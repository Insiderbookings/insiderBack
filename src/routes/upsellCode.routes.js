// src/routes/upsellCode.routes.js
import { Router } from "express";
import { generateUpsellCode, validateUpsellCode, getUpsellCode, getMyUpsellCodes } from "../controllers/upsell.controller.js";
import { authenticate, authorizeStaff } from "../middleware/auth.js";

const router = Router();

/* Staff genera código */
router.post("/", authenticate, authorizeStaff, generateUpsellCode);

/* Cliente valida código */
router.post("/validate", validateUpsellCode);

router.get(
  "/my-codes",
  authenticate,                    // ← inyecta req.user
 getMyUpsellCodes
);

/* Obtener detalles por ID (para pantalla de éxito / fallo) */
router.get("/:id", getUpsellCode);



export default router;
