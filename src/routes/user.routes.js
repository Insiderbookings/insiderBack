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
  getInfluencerReferrals,
  becomeHost,
  recordDiscountCodeStatus,
  applyDiscountCode,
  getInfluencerGoals,
} from "../controllers/user.controller.js"
import {
  getPayoutAccount,
  createStripeOnboardingLink,
  createStripeAccountUpdateLink,
  refreshStripeAccountStatus,
} from "../controllers/payout.controller.js"
import {
  getInfluencerPayouts,
  runInfluencerPayoutBatch,
} from "../controllers/influencerPayout.controller.js"
import { authenticate, authorizeRoles, requireVerifiedEmail } from "../middleware/auth.js"
import {
  createUserRoleRequest,
  getMyLatestRequest,
  submitUserRoleInfo,
  listVaultOperatorNames,
  uploadGovId,
  uploadBusinessDocs,
} from "../controllers/roleRequest.controller.js"
import { uploadImagesToS3Fields } from "../middleware/s3UploadFields.js"
import { getUserContracts, getUserContractsSummary, acceptContract } from "../controllers/contract.controller.js"

const router = Router()

// Partner stats (auth required)
router.get("/me/influencer/stats", authenticate, authorizeRoles(2), getInfluencerStats)
router.get("/me/influencer/goals", authenticate, authorizeRoles(2), getInfluencerGoals)
router.get("/me/influencer/commissions", authenticate, authorizeRoles(2), getInfluencerCommissions)
router.get("/me/influencer/payouts", authenticate, authorizeRoles(2), getInfluencerPayouts)
router.get("/me/influencer/payout-account", authenticate, authorizeRoles(2), requireVerifiedEmail, getPayoutAccount)
router.post("/me/influencer/payout-account/stripe/link", authenticate, authorizeRoles(2), requireVerifiedEmail, createStripeOnboardingLink)
router.post("/me/influencer/payout-account/stripe/update-link", authenticate, authorizeRoles(2), requireVerifiedEmail, createStripeAccountUpdateLink)
router.post("/me/influencer/payout-account/stripe/refresh", authenticate, authorizeRoles(2), requireVerifiedEmail, refreshStripeAccountStatus)
router.get("/", authenticate, authorizeRoles(2), getInfluencerReferrals)
router.post("/admin/influencer/payouts/create", authenticate, authorizeRoles(100), adminCreateInfluencerPayoutBatch)
router.post("/admin/influencer/payouts/batch", authenticate, authorizeRoles(100), runInfluencerPayoutBatch)

router.post("/request-info", requestPartnerInfo)

// Role request flow
router.post("/role-requests", authenticate, createUserRoleRequest)
router.get("/role-requests/my-latest", authenticate, getMyLatestRequest)
router.post("/role-requests/:id/submit-info", authenticate, submitUserRoleInfo)
router.get("/role-requests/vault-operator/names", authenticate, listVaultOperatorNames)

router.post(
  "/role-requests/upload-id",
  authenticate,
  // Accept legacy single file (gov_id) and new front/back fields
  uploadImagesToS3Fields({
    gov_id: "govIdUrl",
    gov_id_front: "govIdFrontUrl",
    gov_id_back: "govIdBackUrl",
    selfie: "selfieUrl",
  }, { folder: 'kyc' }),
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

router.post("/me/discount-code/status", recordDiscountCodeStatus)
router.post("/me/discount-code", applyDiscountCode)

// Contracts
router.get("/contracts", getUserContracts)
router.get("/contracts/summary", getUserContractsSummary)
router.post("/contracts/:id/accept", acceptContract)

// User profile
router.get("/me", getCurrentUser)
router.put("/me", requireVerifiedEmail, updateUserProfile)
router.put("/me/password", requireVerifiedEmail, changePassword)
router.delete("/me", deleteAccount)
router.post("/me/become-host", requireVerifiedEmail, becomeHost)

export default router
