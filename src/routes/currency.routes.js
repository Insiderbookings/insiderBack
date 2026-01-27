import { Router } from "express"
import { convertCurrencyAmount, getCurrencyOptions, getCurrencyRate } from "../controllers/currency.controller.js"

const router = Router()

router.get("/rate", getCurrencyRate)
router.get("/convert", convertCurrencyAmount)
router.get("/options", getCurrencyOptions)

export default router
