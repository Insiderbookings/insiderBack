import { Router } from "express"
import { createSubscription } from "../controllers/subscriber.controller.js"

const router = Router()

// Public endpoint to capture newsletter subscriptions
router.post("/", createSubscription)

export default router

