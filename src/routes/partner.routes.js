import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  activatePartnerInvoiceController,
  claimPartnerHotelController,
  getOrCreatePartnerVerificationCodeController,
  getMyPartnerHotelProfileController,
  getMyPartnerClaimsController,
  listPartnerPlans,
  partnerControllerMiddleware,
  previewPartnerVerificationCodeController,
  searchPartnerHotelsController,
  selectPartnerSubscriptionController,
  updateMyPartnerHotelProfileController,
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
router.post("/verification/lookup", partnerPublicLimiter, previewPartnerVerificationCodeController);
router.post("/claim", partnerPublicLimiter, claimPartnerHotelController);

router.get("/me", partnerControllerMiddleware.authenticate, getMyPartnerClaimsController);
router.get(
  "/me/profile",
  partnerControllerMiddleware.authenticate,
  getMyPartnerHotelProfileController,
);
router.put(
  "/me/profile",
  partnerControllerMiddleware.authenticate,
  updateMyPartnerHotelProfileController,
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

export default router;
