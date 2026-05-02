import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  activatePartnerInvoiceController,
  approvePartnerClaimReviewController,
  claimPartnerHotelController,
  createPartnerInquiryController,
  downloadMyPartnerMonthlyReportController,
  getOrCreatePartnerVerificationCodeController,
  getMyPartnerHotelProfileController,
  getMyPartnerMonthlyReportsController,
  getMyPartnerClaimsController,
  listPartnerClaimsAdminController,
  listPartnerPlans,
  partnerControllerMiddleware,
  previewPartnerVerificationCodeController,
  searchPartnerHotelsController,
  selectPartnerSubscriptionController,
  simulatePartnerClaimTrialController,
  loadMyPartnerHotelProfileClaimController,
  uploadMyPartnerHotelProfileGalleryController,
  updateMyPartnerHotelProfileController,
} from "../controllers/partner.controller.js";
import { uploadImagesArray } from "../middleware/s3UploadArray.js";

const router = Router();
const partnerPublicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PARTNER_PUBLIC_RATE_LIMIT_MAX || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many partner requests. Please slow down." },
});

router.get("/plans", listPartnerPlans);
router.get("/hotels/search", partnerPublicLimiter, searchPartnerHotelsController);
router.post("/verification/lookup", partnerPublicLimiter, previewPartnerVerificationCodeController);
router.post("/claim", partnerPublicLimiter, claimPartnerHotelController);
router.post("/inquiries", partnerPublicLimiter, createPartnerInquiryController);

router.get("/me", partnerControllerMiddleware.authenticate, getMyPartnerClaimsController);
router.get(
  "/me/profile",
  partnerControllerMiddleware.authenticate,
  getMyPartnerHotelProfileController,
);
router.get(
  "/me/reports/monthly",
  partnerControllerMiddleware.authenticate,
  getMyPartnerMonthlyReportsController,
);
router.get(
  "/me/reports/monthly/:reportMonth/download",
  partnerControllerMiddleware.authenticate,
  downloadMyPartnerMonthlyReportController,
);
router.put(
  "/me/profile",
  partnerControllerMiddleware.authenticate,
  updateMyPartnerHotelProfileController,
);
router.post(
  "/me/profile/gallery/upload",
  partnerControllerMiddleware.authenticate,
  loadMyPartnerHotelProfileClaimController,
  uploadImagesArray("photos", {
    folder: "partners",
    maxFiles: 12,
    resolveOwnerId: (req) =>
      req.user?.id && req.partnerHotelId
        ? `partner-${req.user.id}/hotel-${req.partnerHotelId}`
        : req.user?.id
          ? `partner-${req.user.id}`
          : "public",
  }),
  uploadMyPartnerHotelProfileGalleryController,
);
router.post(
  "/subscriptions/select",
  partnerControllerMiddleware.authenticate,
  selectPartnerSubscriptionController,
);
router.post(
  "/admin/hotels/:hotelId/verification-code",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  getOrCreatePartnerVerificationCodeController,
);
router.post(
  "/admin/claims/:claimId/activate-invoice",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  activatePartnerInvoiceController,
);
router.post(
  "/admin/claims/:claimId/approve-review",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  approvePartnerClaimReviewController,
);
router.get(
  "/admin/claims",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  listPartnerClaimsAdminController,
);
router.post(
  "/admin/claims/:claimId/simulate-trial",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  simulatePartnerClaimTrialController,
);

export default router;
