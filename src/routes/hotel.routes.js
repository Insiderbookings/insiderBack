import { Router } from "express";
import { searchHotels } from "../controllers/hotelSearch.controller.js";
const router = Router();

router.get("/search", searchHotels);

export default router;
