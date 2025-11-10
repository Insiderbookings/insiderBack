import { Router } from "express";
import { authenticate, authorizeRoles } from "../middleware/auth.js";
import { getHostDashboard, getHostListings, getHostCalendar, getHostBookingsList } from "../controllers/host.controller.js";
import { getHostCalendarDetail, upsertHostCalendarDay } from "../controllers/home.controller.js";

const router = Router();

router.use(authenticate, authorizeRoles(6));

router.get("/dashboard", getHostDashboard);
router.get("/listings", getHostListings);
router.get("/calendar", getHostCalendar);
router.get("/calendar/:homeId", getHostCalendarDetail);
router.patch("/calendar/:homeId/day", upsertHostCalendarDay);
router.get("/bookings", getHostBookingsList);

export default router;
