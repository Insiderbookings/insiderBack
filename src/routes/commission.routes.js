import { Router } from "express";
import { getMyCommissions } from "../controllers/commission.controller.js";
import { authenticate, authorizeStaff } from "../middleware/auth.js";
const router = Router();
router.get("/me", authenticate, authorizeStaff, getMyCommissions);
export default router;
