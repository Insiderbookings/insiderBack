// src/routes/addon.routes.js
import { Router } from "express"
import {
  getAddOns,
  saveOutsideAddOns,
  requestAddOn,
  confirmAddOnRequest,
  getRequestedAddOns,
  markOutsideAddOnReady,
  getRequestedAddOnsByStaff,    // ← NEW
} from "../controllers/addon.controller.js"
import { authenticate, authorizeStaff } from "../middleware/auth.js"

const router = Router()

/* catalogue & public endpoints */
router.get("/", getAddOns)

/* outside-booking bulk save (existing) */
router.post("/bookings/outside/:id", saveOutsideAddOns)

/* ----- NEW FLOW --------------------------------------------------------- */
/* guest requests an add-on when booking is already confirmed */
router.post("/request", authenticate, requestAddOn)

/* staff dashboard: confirm / reject */
router.put(
  "/request/:id/confirm",
  authenticate,
  authorizeStaff,
  confirmAddOnRequest
)
router.get(
  "/requests",
  authenticate,
  authorizeStaff,
  getRequestedAddOns
)

/* staff dashboard: mark an outside-booking add-on as “ready” */
router.put(
  "/bookings/outside/ready/:id",
  authenticate,
  markOutsideAddOnReady
)


router.get(
  "/staff-requests",
  authenticate,
  authorizeStaff,
getRequestedAddOnsByStaff
)
export default router
