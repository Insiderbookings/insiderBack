// src/routes/user.routes.js
import { Router } from "express"
import {
  getCurrentUser,
  updateUserProfile,
  changePassword,
  deleteAccount,
  getInfluencerStats,
  requestPartnerInfo,
  getInfluencerCommissions,
  adminCreateInfluencerPayoutBatch,
} from "../controllers/user.controller.js"
import { authenticate, authorizeRoles } from "../middleware/auth.js"
import {
  createUserRoleRequest,
  getMyLatestRequest,
  submitUserRoleInfo,
} from "../controllers/roleRequest.controller.js"

const router = Router()

/** ⚠️ TEMP: ruta pública (sin authenticate) */
router.get("/me/influencer/stats",authenticate, authorizeRoles(2), getInfluencerStats)
router.get("/me/influencer/commissions", authenticate, authorizeRoles(2), getInfluencerCommissions)
router.post("/admin/influencer/payouts/create", authenticate, authorizeRoles(100), adminCreateInfluencerPayoutBatch)

router.post("/request-info", requestPartnerInfo)

// Role request flow (authenticated)
router.post("/role-requests", authenticate, createUserRoleRequest)
router.get("/role-requests/my-latest", authenticate, getMyLatestRequest)
router.post("/role-requests/:id/submit-info", authenticate, submitUserRoleInfo)

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
