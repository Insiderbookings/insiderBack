import { Router } from "express"
import { authenticate } from "../middleware/auth.js"
import { getGuestProfile, updateGuestProfile } from "../controllers/guestProfile.controller.js"

const router = Router()

router.get("/:guestId/profile", getGuestProfile)
router.put("/me/profile", authenticate, updateGuestProfile)

export default router
