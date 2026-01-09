import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { registerPushToken, unregisterPushToken, sendTestPush } from "../controllers/push.controller.js";

const router = Router();

router.use(authenticate);

router.post("/register", registerPushToken);
router.post("/unregister", unregisterPushToken);
router.post("/test", sendTestPush);

export default router;
