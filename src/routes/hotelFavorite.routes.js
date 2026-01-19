import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  addHotelFavoriteToList,
  createHotelFavoriteList,
  getHotelFavoriteListDetail,
  getHotelRecentViews,
  listHotelFavoriteLists,
  recordHotelRecentView,
  removeHotelFavoriteFromList,
} from "../controllers/hotelFavorite.controller.js";

const router = Router();

router.use(authenticate);

router.get("/lists", listHotelFavoriteLists);
router.post("/lists", createHotelFavoriteList);
router.get("/lists/:listId", getHotelFavoriteListDetail);
router.post("/lists/:listId/items", addHotelFavoriteToList);
router.get("/recent", getHotelRecentViews);
router.delete("/lists/:listId/items/:hotelId", removeHotelFavoriteFromList);
router.post("/recent/:hotelId", recordHotelRecentView);

export default router;
