import { Router } from "express";
import { authenticate, authorizeRoles } from "../middleware/auth.js";
import { getHostDashboard, getHostListings, getHostCalendar } from "../controllers/host.controller.js";

const router = Router();

router.use(authenticate, authorizeRoles(6));

router.get("/dashboard", getHostDashboard);
router.get("/listings", getHostListings);
router.get("/calendar", getHostCalendar);

export default router;
