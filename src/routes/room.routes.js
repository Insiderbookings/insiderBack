import { Router } from "express";
import { createRoom, getRoomsByHotel } from "../controllers/room.controller.js";
import { authenticate, authorizeAdmin } from "../middleware/auth.js";
const router = Router({ mergeParams: true });

router.get("/", getRoomsByHotel);
router.post("/", authenticate, authorizeAdmin, createRoom);

export default router;
