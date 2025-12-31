import { Router } from "express"
import { authenticate, authorizeRoles } from "../middleware/auth.js"
import { createTenant, listTenants, updateTenant, deleteTenant, listAccounts, linkAccountToTenant, unlinkAccountFromTenant, linkUserToTenant, unlinkUserFromTenant, unpauseTenant, getStatsOverview, getHealthStatus } from "../controllers/admin.controller.js"
import { adminCreateCards, adminApprove, adminListCards, adminMarkPaid } from "../controllers/vcc.controller.js"
import { adminListPlatforms, adminGetTenantPlatforms, adminUpsertTenantPlatform } from "../controllers/platform.controller.js"
import {
  adminListRoleRequests,
  adminApproveInitial,
  adminApproveKyc,
  adminApproveFinal,
  adminRejectRequest,
  adminListUsers,
} from "../controllers/roleRequest.controller.js"
import { adminListSubscribers, adminBroadcastEmail } from "../controllers/subscriber.controller.js"
import { adminListTransfers, adminCreateTransfer, adminCancelTransfer } from "../controllers/operatorTransfer.controller.js"
import { syncWebbedsCountriesController, syncWebbedsCitiesController, syncWebbedsHotelsController } from "../controllers/webbedsStatic.controller.js"
import { adminListContracts, adminCreateContract, adminUpdateContract, adminDeleteContract } from "../controllers/contract.controller.js"
import { runMockPayouts, runPayoutBatch } from "../controllers/payout.controller.js"

const router = Router()

router.get("/stats/overview", authenticate, authorizeRoles(100), getStatsOverview)
router.get("/health-status", authenticate, authorizeRoles(100), getHealthStatus)

router.get("/tenants", authenticate, authorizeRoles(100), listTenants)
router.post("/tenants", authenticate, authorizeRoles(100), createTenant)
router.put("/tenants/:id", authenticate, authorizeRoles(100), updateTenant)
router.delete("/tenants/:id", authenticate, authorizeRoles(100), deleteTenant)
router.post("/tenants/:id/unpause", authenticate, authorizeRoles(100), unpauseTenant)
router.get("/platforms", authenticate, authorizeRoles(100), adminListPlatforms)
router.get("/tenants/:id/platforms", authenticate, authorizeRoles(100), adminGetTenantPlatforms)
router.put("/tenants/:tenantId/platforms/:platformId", authenticate, authorizeRoles(100), adminUpsertTenantPlatform)
router.get("/accounts", authenticate, authorizeRoles(100), listAccounts)
router.post("/accounts/:accountId/tenants/:tenantId", authenticate, authorizeRoles(100), linkAccountToTenant)
router.delete("/accounts/:accountId/tenants/:tenantId", authenticate, authorizeRoles(100), unlinkAccountFromTenant)
// Link Insider User <-> Tenant (for operator access)
router.post("/users/:userId/tenants/:tenantId", authenticate, authorizeRoles(100), linkUserToTenant)
router.delete("/users/:userId/tenants/:tenantId", authenticate, authorizeRoles(100), unlinkUserFromTenant)

// Transfers admin
router.get("/transfers", authenticate, authorizeRoles(100), adminListTransfers)
router.post("/transfers", authenticate, authorizeRoles(100), adminCreateTransfer)
router.post("/transfers/:id/cancel", authenticate, authorizeRoles(100), adminCancelTransfer)

// VCC admin
router.get("/vcc/cards", authenticate, authorizeRoles(100), adminListCards)
router.post("/vcc/cards", authenticate, authorizeRoles(100), adminCreateCards)
router.post("/vcc/cards/:id/approve", authenticate, authorizeRoles(100), adminApprove)
router.post("/vcc/cards/:id/reject", authenticate, authorizeRoles(100), (req, res, next) => { req.query.action = 'reject'; next() }, adminApprove)
router.post("/vcc/cards/:id/mark-paid", authenticate, authorizeRoles(100), adminMarkPaid)
router.post("/webbeds/countries/sync", syncWebbedsCountriesController)
router.post("/webbeds/cities/sync", syncWebbedsCitiesController)
router.post("/webbeds/hotels/sync", syncWebbedsHotelsController)

// Users and role requests
router.get("/users", authenticate, authorizeRoles(100), adminListUsers)
router.get("/role-requests", authenticate, authorizeRoles(100), adminListRoleRequests)
router.post("/role-requests/:id/approve-initial", authenticate, authorizeRoles(100), adminApproveInitial)
router.post("/role-requests/:id/approve-kyc", authenticate, authorizeRoles(100), adminApproveKyc)
router.post("/role-requests/:id/approve-final", authenticate, authorizeRoles(100), adminApproveFinal)
router.post("/role-requests/:id/reject", authenticate, authorizeRoles(100), adminRejectRequest)

// Subscribers
router.get("/subscribers", authenticate, authorizeRoles(100), adminListSubscribers)
router.post("/subscribers/broadcast", authenticate, authorizeRoles(100), adminBroadcastEmail)

// Contracts
router.get("/contracts", authenticate, authorizeRoles(100), adminListContracts)
router.post("/contracts", authenticate, authorizeRoles(100), adminCreateContract)
router.put("/contracts/:id", authenticate, authorizeRoles(100), adminUpdateContract)
router.delete("/contracts/:id", authenticate, authorizeRoles(100), adminDeleteContract)

// Payouts mock (trigger manual, admin only)
router.post("/payouts/mock", authenticate, authorizeRoles(100), runMockPayouts)
router.post("/payouts/batch", authenticate, authorizeRoles(100), runPayoutBatch)

export default router

