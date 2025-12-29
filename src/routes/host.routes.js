import { Router } from "express";
import { authenticate, authorizeRoles } from "../middleware/auth.js";
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
router.put("/payout-methods", updatePayoutMethod);
router.get("/payout-account", getPayoutAccount);
router.put("/payout-account", upsertPayoutAccount);
router.get("/payouts", listHostPayouts);
router.post("/payout-account/stripe/link", createStripeOnboardingLink);
router.post("/payout-account/stripe/update-link", createStripeAccountUpdateLink);
router.post("/payout-account/stripe/refresh", refreshStripeAccountStatus);
router.post("/payout-account/payoneer/link", createPayoneerOnboardingLink);

export default router;
