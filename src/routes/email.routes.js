import { Router }        from "express";
import {
  sendReservationEmail,
} from "../controllers/email.controller.js";

const router = Router();

router.post("/reservation", sendReservationEmail);

export default router;
