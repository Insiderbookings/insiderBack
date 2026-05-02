import { Router } from "express";
import {
  getFeatureFlags,
  getMobileUpdateConfig,
} from "../controllers/config.controller.js";

const router = Router();

router.get("/features", getFeatureFlags);
router.get("/mobile-updates", getMobileUpdateConfig);

export default router;
