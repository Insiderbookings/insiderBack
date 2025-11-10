import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  addFavoriteToList,
  createFavoriteList,
  getFavoriteListDetail,
  listFavoriteLists,
  recordHomeRecentView,
  getRecentViews,
  removeFavoriteFromList,
} from "../controllers/favorite.controller.js";

const router = Router();

router.use(authenticate);

router.get("/lists", listFavoriteLists);
router.post("/lists", createFavoriteList);
router.get("/lists/:listId", getFavoriteListDetail);
router.post("/lists/:listId/items", addFavoriteToList);
router.get("/recent", getRecentViews);
router.delete("/lists/:listId/items/:homeId", removeFavoriteFromList);
router.post("/recent/:homeId", recordHomeRecentView);

export default router;
