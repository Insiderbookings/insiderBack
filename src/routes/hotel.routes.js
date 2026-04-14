import { Router } from "express";
import { autocompleteHotels, searchHotels } from "../controllers/hotelSearch.controller.js";
const router = Router();

router.get("/autocomplete", autocompleteHotels);
router.get("/search", searchHotels);

export default router;
