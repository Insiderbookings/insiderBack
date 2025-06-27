import { Router } from "express"
import {
  getAddOns,
  saveOutsideAddOns,
  requestAddOn,          // ← NEW
  confirmAddOnRequest,   // ← NEW (staff side, included for completeness)
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
router.put("/request/:id/confirm", authenticate, authorizeStaff, confirmAddOnRequest)

export default router
