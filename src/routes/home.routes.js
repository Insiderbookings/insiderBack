import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  createHomeDraft,
  updateHomeBasics,
  upsertHomeAddress,
  updateHomeAmenities,
  updateHomePricing,
  attachHomeMedia,
  getHomeById,
  listHostHomes,
} from "../controllers/home.controller.js";

const router = Router();

router.use(authenticate);

router.post("/", createHomeDraft);
router.get("/me", listHostHomes);
router.get("/:id", getHomeById);
router.patch("/:id/basics", updateHomeBasics);
router.patch("/:id/address", upsertHomeAddress);
router.patch("/:id/amenities", updateHomeAmenities);
router.patch("/:id/pricing", updateHomePricing);
router.put("/:id/media", attachHomeMedia);

export default router;
