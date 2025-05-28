// src/routes/booking.routes.js
import { Router } from "express";
import {
  createBooking,
  getBookingsForUser,
  getBookingsForStaff,
  getBookingById    // ← importamos el nuevo controlador
} from "../controllers/booking.controller.js";
import { authenticate, authorizeStaff } from "../middleware/auth.js";

const router = Router();

router.post("/",                 createBooking);
router.get("/me",               authenticate,           getBookingsForUser);
router.get("/staff/me",         authenticate, authorizeStaff, getBookingsForStaff);

// ───────── Ruta para obtener una reserva por su ID ─────────
router.get("/:id", getBookingById);

export default router;
