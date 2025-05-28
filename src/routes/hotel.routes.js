import { Router } from "express";
import { createHotel, getHotels, getHotelById } from "../controllers/hotel.controller.js";
import { authenticate, authorizeAdmin } from "../middleware/auth.js";
const router = Router();

router.get("/", getHotels);
router.get("/:id", getHotelById);
router.post("/", authenticate, authorizeAdmin, createHotel);

export default router;
