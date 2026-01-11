import { Router } from "express";
import { authenticate, authorizeRoles, requireVerifiedEmail } from "../middleware/auth.js";
import {
  getHostDashboard,
  getHostBookingDetail,
  getHostListings,
  getHostCalendar,
  getHostBookingsList,
  getHostEarnings,
  updatePayoutMethod,
} from "../controllers/host.controller.js";
import { getHostCalendarDetail, upsertHostCalendarDay, getArrivalGuide, updateArrivalGuide } from "../controllers/home.controller.js";
import {
  getPayoutAccount,
  upsertPayoutAccount,
  listHostPayouts,
  createStripeOnboardingLink,
  createStripeAccountUpdateLink,
  refreshStripeAccountStatus,
  createPayoneerOnboardingLink,
} from "../controllers/payout.controller.js";

const router = Router();

router.use(authenticate, authorizeRoles(6));

router.get("/dashboard", getHostDashboard);
router.get("/bookings/:stayId", getHostBookingDetail);
router.get("/earnings", getHostEarnings);
router.get("/listings", getHostListings);
router.get("/calendar", getHostCalendar);
router.get("/calendar/:homeId", getHostCalendarDetail);
router.patch("/calendar/:homeId/day", upsertHostCalendarDay);
router.get("/listings/:homeId/arrival-guide", getArrivalGuide);
router.put("/listings/:homeId/arrival-guide", updateArrivalGuide);
router.get("/bookings", getHostBookingsList);
router.put("/payout-methods", requireVerifiedEmail, updatePayoutMethod);
router.get("/payout-account", requireVerifiedEmail, getPayoutAccount);
router.put("/payout-account", requireVerifiedEmail, upsertPayoutAccount);
router.get("/payouts", requireVerifiedEmail, listHostPayouts);
router.post("/payout-account/stripe/link", requireVerifiedEmail, createStripeOnboardingLink);
router.post("/payout-account/stripe/update-link", requireVerifiedEmail, createStripeAccountUpdateLink);
router.post("/payout-account/stripe/refresh", requireVerifiedEmail, refreshStripeAccountStatus);
router.post("/payout-account/payoneer/link", requireVerifiedEmail, createPayoneerOnboardingLink);

export default router;
