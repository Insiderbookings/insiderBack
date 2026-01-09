import { Router } from "express";
import { autocompletePlaces, nearbyPlaces, placePhoto } from "../controllers/places.controller.js";

const router = Router();

router.get("/autocomplete", autocompletePlaces);
router.get("/nearby", nearbyPlaces);
router.get("/photo", placePhoto);

export default router;
