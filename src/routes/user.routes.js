import { Router } from "express"
import { getCurrentUser, updateUserProfile, changePassword, deleteAccount } from "../controllers/user.controller.js"
import { authenticate } from "../middleware/auth.js"

const router = Router()

// Todas las rutas requieren autenticación
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
