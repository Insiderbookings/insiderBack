import { Router } from "express"
import { listStaticHotels, search, getRooms, listCountries } from "../controllers/webbeds.controller.js"

const router = Router()

router.get("/search", search)
router.get("/rooms", getRooms)
router.get("/static/hotels", listStaticHotels)
router.get("/countries", listCountries)

export default router
