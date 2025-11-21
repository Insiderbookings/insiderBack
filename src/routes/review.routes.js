import { Router } from "express";
import {
  createHomeReview,
  createGuestReview,
  getGuestReviews,
  getHomeReviews,
  getHostReviews,
  getPendingReviews,
} from "../controllers/review.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.get("/home/:homeId", getHomeReviews);
router.get("/host/:hostId", getHostReviews);
router.get("/guest/:guestId", getGuestReviews);
router.get("/pending", authenticate, getPendingReviews);

router.post("/home", authenticate, createHomeReview);
router.post("/guest", authenticate, createGuestReview);

export default router;
