import { Router } from "express"
import {
  createBooking,
  getBookingsForUser,
  getBookingsForStaff,
  getBookingById,
  cancelBooking,
  getOutsideBookingByConfirmation,
  getOutsideBookingWithAddOns
} from "../controllers/booking.controller.js"
import { authenticate, authorizeStaff } from "../middleware/auth.js"

const router = Router()

router.post("/", createBooking)
router.get("/me", authenticate, getBookingsForUser)
router.get("/staff/me", authenticate, authorizeStaff, getBookingsForStaff)

// ───────── Ruta para obtener una reserva por su ID ─────────
router.get("/:id", getBookingById)

// ───────── Ruta para cancelar una reserva ─────────
router.put("/:id/cancel", authenticate, cancelBooking)

router.get("/outside/:confirmation", getOutsideBookingByConfirmation);
router.get("/outside/id/:id", getOutsideBookingWithAddOns)

export default router
