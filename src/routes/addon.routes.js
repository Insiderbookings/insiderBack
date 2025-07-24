import { Router } from "express"
import {
  /* catálogo & flujo de reservas */
  getHotelAddOns,
  saveOutsideAddOns,
  requestAddOn,
  confirmAddOnRequest,
  getRequestedAddOns,
  markOutsideAddOnReady,
  getRequestedAddOnsByStaff,

  /* 🔧 NUEVO: edición de add-ons por hotel (staff role 3) */
  listHotelAddOnsForEdit,
  updateHotelAddOn,
  updateHotelAddOnOption,
} from "../controllers/addon.controller.js"
import { authenticate, authorizeStaff } from "../middleware/auth.js"

const router = Router()

/* ──────────── Catálogo público ──────────── */
router.get("/:hotelId/hotel-addons", getHotelAddOns)

/* ──────────── Bulk save (outside) ──────────── */
router.post("/bookings/outside/:id", saveOutsideAddOns)

/* ──────────── Flujo de requests de huésped ──────────── */
router.post("/request",              authenticate, requestAddOn)
router.put ("/request/:id/confirm",  authenticate, authorizeStaff, confirmAddOnRequest)
router.get ("/requests",             authenticate, authorizeStaff, getRequestedAddOns)

/* staff marca ready */
router.put("/bookings/outside/ready/:id", authenticate, markOutsideAddOnReady)

/* staff dashboard: listar solicitudes de sus hoteles */
router.get("/staff-requests", authenticate, authorizeStaff, getRequestedAddOnsByStaff)

/* ──────────── 🔧  NUEVO  ─ staff edita add-ons ──────────── */
router.get("/:hotelId/manage-addons",
  authenticate, authorizeStaff, listHotelAddOnsForEdit)

router.put("/:hotelId/manage-addons/:addOnId",
  authenticate, authorizeStaff, updateHotelAddOn)

router.put("/:hotelId/manage-addons/:addOnId/options/:optionId",
  authenticate, authorizeStaff, updateHotelAddOnOption)

  router.put(
  "/:hotelId/hotel-addons/:id",
  authenticate,
  authorizeStaff,
  updateHotelAddOn           // ⬅️ nuevo controlador
)

export default router
