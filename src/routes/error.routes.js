import { Router } from "express";
import { getErrorLogs, getErrorConfig, updateErrorConfig, testAlert } from "../controllers/error.controller.js";
// You might want to add auth/admin middleware here
// import { isAdmin } from "../middleware/auth.middleware.js";

const router = Router();

// Assuming this is mounted under /api/admin/errors
router.get("/", getErrorLogs);
router.get("/config", getErrorConfig);
router.put("/config", updateErrorConfig);
router.post("/test-alert", testAlert);

export default router;
