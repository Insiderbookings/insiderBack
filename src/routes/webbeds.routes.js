import { Router } from "express"
import { search } from "../controllers/webbeds.controller.js"

const router = Router()

router.get("/search", search)

export default router
