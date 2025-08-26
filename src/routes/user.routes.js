// src/routes/user.routes.js
import { Router } from "express"
import {
  getCurrentUser,
  updateUserProfile,
  changePassword,
  deleteAccount,
  getInfluencerStats,
  requestPartnerInfo,
} from "../controllers/user.controller.js"
import { authenticate, authorizeRoles } from "../middleware/auth.js"

const router = Router()

/** ⚠️ TEMP: ruta pública (sin authenticate) */
router.get("/me/influencer/stats",authenticate, authorizeRoles(2), getInfluencerStats)

router.post("/request-info", requestPartnerInfo)

// Todas las demás requieren autenticación
router.use(authenticate)

// GET /api/users/me - Obtener datos del usuario actual
router.get("/me", getCurrentUser)

// PUT /api/users/me - Actualizar perfil del usuario
router.put("/me", updateUserProfile)

// PUT /api/users/me/password - Cambiar contraseña
router.put("/me/password", changePassword)

// DELETE /api/users/me - Eliminar cuenta
router.delete("/me", deleteAccount)

export default router
