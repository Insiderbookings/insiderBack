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
  listVaultOperatorNames,
  uploadGovId,
  uploadBusinessDocs,
} from "../controllers/roleRequest.controller.js"
import { uploadImagesToS3Fields } from "../middleware/s3UploadFields.js"

const router = Router()

// Partner stats (auth required)
router.get("/me/influencer/stats", authenticate, authorizeRoles(2), getInfluencerStats)
router.get("/me/influencer/commissions", authenticate, authorizeRoles(2), getInfluencerCommissions)
router.post("/admin/influencer/payouts/create", authenticate, authorizeRoles(100), adminCreateInfluencerPayoutBatch)

router.post("/request-info", requestPartnerInfo)

// Role request flow
router.post("/role-requests", authenticate, createUserRoleRequest)
router.get("/role-requests/my-latest", authenticate, getMyLatestRequest)
router.post("/role-requests/:id/submit-info", authenticate, submitUserRoleInfo)
router.get("/role-requests/vault-operator/names", authenticate, listVaultOperatorNames)

router.post(
  "/role-requests/upload-id",
  authenticate,
  uploadImagesToS3Fields({ gov_id: "govIdUrl" }, { folder: 'kyc' }),
  uploadGovId,
)

router.post(
  "/role-requests/upload-business",
  authenticate,
  uploadImagesToS3Fields({ llc_articles: "llcArticlesUrl", ein_letter: "einLetterUrl", bank_doc: "bankDocUrl" }, { folder: 'kyc' }),
  uploadBusinessDocs,
)

// All below require authenticate
router.use(authenticate)

// User profile
router.get("/me", getCurrentUser)
router.put("/me", updateUserProfile)
router.put("/me/password", changePassword)
router.delete("/me", deleteAccount)

export default router
