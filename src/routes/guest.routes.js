import { Router } from "express"
import { authenticate } from "../middleware/auth.js"
import { uploadImagesToS3Fields } from "../middleware/s3UploadFields.js"
import { getGuestProfile, updateGuestProfile } from "../controllers/guestProfile.controller.js"

const router = Router()

router.use(authenticate)

router.get("/:guestId/profile", getGuestProfile)
router.put("/me/profile", updateGuestProfile)
router.post(
  "/me/profile/avatar",
  uploadImagesToS3Fields({ avatar: "avatarUrl" }, { folder: "avatars", quality: 82 }),
  updateGuestProfile,
)

export default router
