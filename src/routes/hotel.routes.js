import { Router } from "express";
import { createHotel, getHotels, getHotelById, getHotelImages, getHotelsWithRooms } from "../controllers/hotel.controller.js";
import { searchHotels } from "../controllers/hotelSearch.controller.js";
import { authenticate } from "../middleware/auth.js";
const router = Router();

router.get("/", getHotels);
router.get("/search", searchHotels);
router.get("/hotelsAndRooms", getHotelsWithRooms)
router.get("/:id", getHotelById);
router.post("/", authenticate, createHotel);
router.get("/:id/images", getHotelImages);



export default router;
