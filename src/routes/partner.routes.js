import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  activatePartnerInvoiceController,
  cancelPartnerSubscriptionController,
  claimPartnerHotelController,
  createPartnerMetricAdjustmentController,
  downloadPartnerMonthlyReportController,
  ensurePartnerVerificationCodeController,
  getMyPartnerClaimsController,
  listPartnerMetricAdjustmentsController,
  listPartnerPlans,
  partnerControllerMiddleware,
  previewPartnerDestinationEmailController,
  searchPartnerHotelsController,
  sendPartnerDestinationEmailTestController,
  submitPartnerInquiryController,
  trackPartnerMetricEventController,
  updatePartnerAccountManagerController,
  updatePartnerProfileController,
  verifyPartnerHotelController,
  selectPartnerSubscriptionController,
} from "../controllers/partner.controller.js";

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
router.post("/claim", partnerPublicLimiter, claimPartnerHotelController);
router.post("/verify", partnerPublicLimiter, verifyPartnerHotelController);
router.post("/metrics/track", partnerPublicLimiter, trackPartnerMetricEventController);
router.post("/inquiries", partnerPublicLimiter, submitPartnerInquiryController);

router.get("/me", partnerControllerMiddleware.authenticate, getMyPartnerClaimsController);
router.get(
  "/reports/monthly/:hotelId/download",
  partnerControllerMiddleware.authenticate,
  downloadPartnerMonthlyReportController,
);
router.post("/profile", partnerControllerMiddleware.authenticate, updatePartnerProfileController);
router.post(
  "/subscriptions/select",
  partnerControllerMiddleware.authenticate,
  selectPartnerSubscriptionController,
);
router.post(
  "/subscriptions/cancel",
  partnerControllerMiddleware.authenticate,
  cancelPartnerSubscriptionController,
);
router.post(
  "/admin/claims/:claimId/activate-invoice",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  activatePartnerInvoiceController,
);
router.post(
  "/admin/claims/:claimId/account-manager",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  updatePartnerAccountManagerController,
);
router.post(
  "/admin/hotels/:hotelId/verification-code",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  ensurePartnerVerificationCodeController,
);
router.get(
  "/admin/hotels/:hotelId/reach-adjustments",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  listPartnerMetricAdjustmentsController,
);
router.post(
  "/admin/hotels/:hotelId/reach-adjustments",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  createPartnerMetricAdjustmentController,
);
router.get(
  "/admin/destination-emails/preview",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  previewPartnerDestinationEmailController,
);
router.post(
  "/admin/destination-emails/send-test",
  partnerControllerMiddleware.authenticate,
  partnerControllerMiddleware.authorizeAdmin,
  sendPartnerDestinationEmailTestController,
);

export default router;
