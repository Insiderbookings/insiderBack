import { Router } from "express"
import {
  createBooking,
  quoteHomeBooking,
  createHomeBooking,
  /* unified handlers */
  getBookingsUnified,
  getLatestStayForUser,
  /* legacy & staff extras */
  getBookingsForUser,
  getBookingsForStaff,
  getBookingById,
  saveHotelConfirmationSnapshot,
  listBookingInvites,
  getBookingInvite,
  inviteBookingMember,
  acceptBookingInvite,
  declineBookingInvite,
  cancelBooking,
  confirmBooking,
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
import { authenticate, authorizeStaff, authenticateGuest, requireVerifiedEmail } from "../middleware/auth.js"

const router = Router()

/* ---- Create ---- */
router.post("/", authenticate, requireVerifiedEmail, createBooking)
router.post("/homes/quote", authenticate, quoteHomeBooking)
router.post("/homes", authenticate, requireVerifiedEmail, createHomeBooking)
router.get("/homes/me", authenticate, getHomeBookingsForUser)

/* ---- Public single-booking lookup (email + ref) ---- */
router.get("/lookup", lookupBookingPublic)

/* ---- Guest OTP flow ---- */
router.post("/guest/start", startGuestAccess)
router.post("/guest/verify", verifyGuestAccess)
router.get("/guest", authenticateGuest, listGuestBookings)
router.post("/link", authenticate, linkGuestBookingsToUser)

/* ---- Booking invites (homes only) ---- */
router.get("/invites", authenticate, listBookingInvites)
router.get("/invites/:token", getBookingInvite)
router.post("/invites/accept", authenticate, acceptBookingInvite)
router.post("/invites/decline", authenticate, declineBookingInvite)
router.post("/:id/invite", authenticate, inviteBookingMember)

/* ---- Unified user list & latest ---- */
router.get("/me",         authenticate, getBookingsUnified)      // full or ?latest=true
router.get("/me/latest",  authenticate, getLatestStayForUser)    // explicit shortcut

/* ---- Legacy filtered list (optional; kept for compatibility) */
router.get("/legacy/me",  authenticate, getBookingsForUser)

/* ---- Staff list ---- */
router.get("/staff/me", authenticate, authorizeStaff, getBookingsForStaff)

/* ---- Single booking / cancel ---- */
router.get("/:id",              authenticate, getBookingById)
router.post("/:id/confirmation-snapshot", authenticate, requireVerifiedEmail, saveHotelConfirmationSnapshot)
router.put("/:id/cancel",       authenticate, cancelBooking)
router.put("/:id/confirm",      authenticate, requireVerifiedEmail, confirmBooking)

/* ---- Outside-booking helpers ---- */
router.get("/confirmation/:confirmation", getOutsideBookingByConfirmation)
router.get("/outside/id/:id",        getOutsideBookingWithAddOns)

// Descarga del certificado PDF de una reserva
// Estaba montado erróneamente como "/bookings/:id/certificate.pdf" y, al
// estar este router bajo "/api/bookings", resultaba en "/api/bookings/bookings/:id/certificate.pdf".
// Lo correcto es exponerlo como "/api/bookings/:id/certificate.pdf".
router.get("/:id/certificate.pdf", downloadBookingCertificate)

export default router
