// src/routes/staffAddon.routes.js
import { Router } from "express"
import { body, param } from "express-validator"
import {
  listStaffByHotel,
  listAssignments,
  putAssignments,
} from "../controllers/staffAddon.controller.js"

const r = Router()

// ── staff de un hotel
r.get("/hotel/:hotelId/staff",
  param("hotelId").isInt(),
  listStaffByHotel,
)

// ── staff asignado a un add-on concreto
r.get("/hotel-addon/:hotelAddOnId/staff",
  param("hotelAddOnId").isInt(),
  listAssignments,
)

// ── sobrescribe asignación (array de staff_id) para ese add-on
r.put("/hotel-addon/:hotelAddOnId/staff",
  [
    param("hotelAddOnId").isInt(),
    body("staffIds").isArray(),
    body("staffIds.*").isInt(),
  ],
  putAssignments,
)

export default r
