import { Router } from "express"
import { authenticate, authorizeRoles } from "../middleware/auth.js"
import { createTenant, listTenants, updateTenant, deleteTenant } from "../controllers/admin.controller.js"

const router = Router()

router.get("/tenants", authenticate, authorizeRoles(100), listTenants)
router.post("/tenants", authenticate, authorizeRoles(100), createTenant)
router.put("/tenants/:id", authenticate, authorizeRoles(100), updateTenant)
router.delete("/tenants/:id", authenticate, authorizeRoles(100), deleteTenant)

export default router
