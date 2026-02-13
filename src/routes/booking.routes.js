import { Router } from "express"
import {
  quoteHomeBooking,
  createHomeBooking,
  getBookingsUnified,
  getLatestStayForUser,
  getBookingById,
  saveHotelConfirmationSnapshot,
  listBookingInvites,
  getBookingInvite,
  inviteBookingMember,
  acceptBookingInvite,
  declineBookingInvite,
  cancelBooking,
  getHomeBookingsForUser,
} from "../controllers/booking.controller.js"
import { authenticate, requireVerifiedEmail } from "../middleware/auth.js"

const router = Router()

/* ---- Home bookings ---- */
router.post("/homes/quote", authenticate, quoteHomeBooking)
router.post("/homes", authenticate, requireVerifiedEmail, createHomeBooking)
router.get("/homes/me", authenticate, getHomeBookingsForUser)

/* ---- Booking invites (homes only) ---- */
router.get("/invites", authenticate, listBookingInvites)
router.get("/invites/:token", getBookingInvite)
router.post("/invites/accept", authenticate, acceptBookingInvite)
router.post("/invites/decline", authenticate, declineBookingInvite)
router.post("/:id/invite", authenticate, inviteBookingMember)

/* ---- Unified user list & latest ---- */
router.get("/me",         authenticate, getBookingsUnified)      // full or ?latest=true
router.get("/me/latest",  authenticate, getLatestStayForUser)    // explicit shortcut

/* ---- Single booking / cancel ---- */
router.get("/:id",              authenticate, getBookingById)
router.post("/:id/confirmation-snapshot", authenticate, requireVerifiedEmail, saveHotelConfirmationSnapshot)
router.put("/:id/cancel",       authenticate, cancelBooking)

export default router
