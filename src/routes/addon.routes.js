import { Router } from "express"
import {
  /* catálogo & flujo de reservas */
  getHotelAddOns,
  requestAddOn,
  confirmAddOnRequest,
  getRequestedAddOns,
  markBookingAddOnReady,
  getRequestedAddOnsByStaff,

  /* 🔧 edición de add-ons por hotel (staff role 3) */
  listHotelAddOnsForEdit,
  updateHotelAddOn,
  updateHotelAddOnOption,
  saveBookingAddOns,
} from "../controllers/addon.controller.js"
import { authenticate, authorizeStaff } from "../middleware/auth.js"

const router = Router()

/* ──────────── Catálogo público ──────────── */
router.get("/:hotelId/hotel-addons", getHotelAddOns)

/* ──────────── Bulk save add-ons de una reserva ──────────── */
router.post("/bookings/:id", saveBookingAddOns)

/* ──────────── Flujo de requests de huésped ──────────── */
router.post("/request",             authenticate, requestAddOn)
router.put ("/request/:id/confirm", authenticate, authorizeStaff, confirmAddOnRequest)
router.get ("/requests",            authenticate, authorizeStaff, getRequestedAddOns)

/* staff marca add-on listo para pagar */
router.put("/bookings/ready/:id", authenticate, markBookingAddOnReady)

/* staff dashboard: listar solicitudes de sus hoteles */
router.get("/staff-requests", authenticate, authorizeStaff, getRequestedAddOnsByStaff)

/* ──────────── 🔧 staff edita add-ons ──────────── */
router.get("/:hotelId/manage-addons",
  authenticate, authorizeStaff, listHotelAddOnsForEdit)

router.put("/:hotelId/manage-addons/:addOnId",
  authenticate, authorizeStaff, updateHotelAddOn)

router.put("/:hotelId/manage-addons/:addOnId/options/:optionId",
  authenticate, authorizeStaff, updateHotelAddOnOption)

/* update overrides desde la vista de catálogo */
router.put("/:hotelId/hotel-addons/:id",
  authenticate, authorizeStaff, updateHotelAddOn)

export default router
