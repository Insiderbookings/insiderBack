import { Router } from "express";
import { body } from "express-validator";
import { registerStaff, loginStaff, registerUser, loginUser } from "../controllers/auth.controller.js";
import { autoSignupOrLogin } from "../controllers/auth.auto.controller.js";
const router = Router();


router.post("/staff/register", [
  body("name").notEmpty(),
  body("email").isEmail(),
  body("password").isLength({ min: 6 }),
  body("staff_role_id").isInt()
], registerStaff);

router.post("/staff/login", loginStaff);

router.post("/user/register", [
  body("name").notEmpty(),
  body("email").isEmail(),
  body("password").isLength({ min: 6 })
], registerUser);

router.post("/user/login", loginUser);

router.post("/auto-signup", autoSignupOrLogin);

export default router;
