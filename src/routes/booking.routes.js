import { Router } from "express"
import {
  createBooking,
  createHomeBooking,
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
  lookupBookingPublic,
  startGuestAccess,
  verifyGuestAccess,
  listGuestBookings,
  linkGuestBookingsToUser,
  getHomeBookingsForUser,
} from "../controllers/booking.controller.js"
import { authenticate, authorizeStaff, authenticateGuest } from "../middleware/auth.js"

const router = Router()

/* ---- Create ---- */
router.post("/", authenticate, createBooking)
router.post("/homes", authenticate, createHomeBooking)
router.get("/homes/me", authenticate, getHomeBookingsForUser)

/* ---- Public single-booking lookup (email + ref) ---- */
router.get("/lookup", lookupBookingPublic)

/* ---- Guest OTP flow ---- */
router.post("/guest/start", startGuestAccess)
router.post("/guest/verify", verifyGuestAccess)
router.get("/guest", authenticateGuest, listGuestBookings)
router.post("/link", authenticate, linkGuestBookingsToUser)

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

// Descarga del certificado PDF de una reserva
// Estaba montado erróneamente como "/bookings/:id/certificate.pdf" y, al
// estar este router bajo "/api/bookings", resultaba en "/api/bookings/bookings/:id/certificate.pdf".
// Lo correcto es exponerlo como "/api/bookings/:id/certificate.pdf".
router.get("/:id/certificate.pdf", downloadBookingCertificate)

export default router
