import { Router } from "express"
import {
  createBooking,
  /* unified handlers */
  getBookingsUnified,
  getLatestStayForUser,
  /* legacy & staff extras */
  getBookingsForUser,
  getBookingsForStaff,
  getBookingById,
  cancelBooking,
  getOutsideBookingByConfirmation,
  getOutsideBookingWithAddOns,
  downloadBookingCertificate,
} from "../controllers/booking.controller.js"
import { authenticate, authorizeStaff } from "../middleware/auth.js"

const router = Router()

/* ---- Create ---- */
router.post("/", createBooking)

/* ---- Unified user list & latest ---- */
router.get("/me",         authenticate, getBookingsUnified)      // full or ?latest=true
router.get("/me/latest",  authenticate, getLatestStayForUser)    // explicit shortcut

/* ---- Legacy filtered list (optional; kept for compatibility) */
router.get("/legacy/me",  authenticate, getBookingsForUser)

/* ---- Staff list ---- */
router.get("/staff/me", authenticate, authorizeStaff, getBookingsForStaff)

/* ---- Single booking / cancel ---- */
router.get("/:id",              getBookingById)
router.put("/:id/cancel",       authenticate, cancelBooking)

/* ---- Outside-booking helpers ---- */
router.get("/confirmation/:confirmation", getOutsideBookingByConfirmation)
router.get("/outside/id/:id",        getOutsideBookingWithAddOns)

router.get("/bookings/:id/certificate.pdf", downloadBookingCertificate)

export default router
