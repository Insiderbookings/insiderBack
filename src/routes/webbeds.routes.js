import { Router } from "express"
import { listStaticHotels, search } from "../controllers/webbeds.controller.js"

const router = Router()

router.get("/search", search)
router.get("/static/hotels", listStaticHotels)

export default router
