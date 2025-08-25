import { Router } from "express"
import { authenticate, authorizeAdmin } from "../middleware/auth.js"
import { createTenant, listTenants, updateTenant, deleteTenant } from "../controllers/admin.controller.js"

const router = Router()

router.get("/tenants", authenticate, authorizeAdmin, listTenants)
router.post("/tenants", authenticate, authorizeAdmin, createTenant)
router.put("/tenants/:id", authenticate, authorizeAdmin, updateTenant)
router.delete("/tenants/:id", authenticate, authorizeAdmin, deleteTenant)

export default router
