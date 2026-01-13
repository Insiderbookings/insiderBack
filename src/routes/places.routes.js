import { Router } from "express";
import { autocompletePlaces, geocodePlace, nearbyPlaces, placePhoto } from "../controllers/places.controller.js";

const router = Router();
console.log("[places.routes] loaded");

router.get("/autocomplete", autocompletePlaces);
router.get("/geocode", geocodePlace);
router.get("/nearby", nearbyPlaces);
router.get("/photo", placePhoto);

router.use((req, res) => {
  console.warn("[places.routes] unhandled", req.method, req.originalUrl);
  res.status(404).json({ error: "Places route not found" });
});

export default router;
