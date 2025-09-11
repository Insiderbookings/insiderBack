import { Router } from "express"
import { authenticate, authorizeRoles } from "../middleware/auth.js"
import { createTenant, listTenants, updateTenant, deleteTenant, listAccounts, linkAccountToTenant, unlinkAccountFromTenant } from "../controllers/admin.controller.js"
import { adminCreateCards, adminApprove, adminListCards , adminMarkPaid} from "../controllers/vcc.controller.js"
import {
  adminListRoleRequests,
  adminApproveInitial,
  adminApproveKyc,
  adminApproveFinal,
  adminRejectRequest,
  adminListUsers,
} from "../controllers/roleRequest.controller.js"

const router = Router()

router.get("/tenants", authenticate, authorizeRoles(100), listTenants)
router.post("/tenants", authenticate, authorizeRoles(100), createTenant)
router.put("/tenants/:id", authenticate, authorizeRoles(100), updateTenant)
router.delete("/tenants/:id", authenticate, authorizeRoles(100), deleteTenant)
router.get("/accounts", authenticate, authorizeRoles(100), listAccounts)
router.post("/accounts/:accountId/tenants/:tenantId", authenticate, authorizeRoles(100), linkAccountToTenant)
router.delete("/accounts/:accountId/tenants/:tenantId", authenticate, authorizeRoles(100), unlinkAccountFromTenant)

// VCC admin
router.get("/vcc/cards", authenticate, authorizeRoles(100), adminListCards)
router.post("/vcc/cards", authenticate, authorizeRoles(100), adminCreateCards)
router.post("/vcc/cards/:id/approve", authenticate, authorizeRoles(100), adminApprove)
router.post("/vcc/cards/:id/reject", authenticate, authorizeRoles(100), (req, res, next) => { req.query.action = 'reject'; next() }, adminApprove)
router.post("/vcc/cards/:id/mark-paid", authenticate, authorizeRoles(100), adminMarkPaid)

// Users and role requests
router.get("/users", authenticate, authorizeRoles(100), adminListUsers)
router.get("/role-requests", authenticate, authorizeRoles(100), adminListRoleRequests)
router.post("/role-requests/:id/approve-initial", authenticate, authorizeRoles(100), adminApproveInitial)
router.post("/role-requests/:id/approve-kyc", authenticate, authorizeRoles(100), adminApproveKyc)
router.post("/role-requests/:id/approve-final", authenticate, authorizeRoles(100), adminApproveFinal)
router.post("/role-requests/:id/reject", authenticate, authorizeRoles(100), adminRejectRequest)

export default router
