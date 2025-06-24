// src/routes/addon.routes.js
import { Router }    from "express"
import { getAddOns, saveOutsideAddOns } from "../controllers/addon.controller.js"

const router = Router()

router.get("/", getAddOns)
router.post("/bookings/outside/:id", saveOutsideAddOns)

export default router
