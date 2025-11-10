import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  createHomeDraft,
  updateHomeBasics,
  upsertHomeAddress,
  updateHomeAmenities,
  updateHomePricing,
  attachHomeMedia,
  updateHomePolicies,
  updateHomeSecurity,
  updateHomeDiscounts,
  getHomeCatalogs,
  publishHome,
  getPublicHome,
  respondUploadedMedia,
  getHomeById,
  listHostHomes,
  listExploreHomes,
  getHomeRecommendations,
} from "../controllers/home.controller.js";
import { loadHostHome } from "../middleware/ensureHomeOwner.js";
import { uploadImagesArray } from "../middleware/s3UploadArray.js";

const router = Router();

router.get("/explore", listExploreHomes);
router.get("/recommendations", getHomeRecommendations);

router.get("/public/:id", getPublicHome);
router.use(authenticate);

router.get("/catalogs", getHomeCatalogs);
router.post("/", createHomeDraft);
router.get("/me", listHostHomes);
router.get("/:id", getHomeById);
router.patch("/:id/basics", updateHomeBasics);
router.patch("/:id/address", upsertHomeAddress);
router.patch("/:id/amenities", updateHomeAmenities);
router.patch("/:id/pricing", updateHomePricing);
router.patch("/:id/policies", updateHomePolicies);
router.patch("/:id/security", updateHomeSecurity);
router.put("/:id/discounts", updateHomeDiscounts);
router.post(
  "/:id/media/upload",
  loadHostHome,
  uploadImagesArray("photos", { folder: "homes", maxFiles: 20 }),
  respondUploadedMedia
);
router.put("/:id/media", loadHostHome, attachHomeMedia);
router.post("/:id/publish", publishHome);

export default router;
