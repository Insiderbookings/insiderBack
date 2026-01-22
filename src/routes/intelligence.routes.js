import express from "express";
import * as IntelligenceController from "../controllers/intelligence.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

/**
 * @route GET /api/intelligence/trip/:bookingId
 * @desc Get proactive intelligence (insights, prep) for a trip
 */
router.post("/trip/:bookingId", authenticate, IntelligenceController.getTripIntelligence);

/**
 * @route POST /api/intelligence/trip/:bookingId/refresh-weather
 * @desc Refresh cached weather for a trip
 */
router.post("/trip/:bookingId/refresh-weather", authenticate, IntelligenceController.refreshTripWeather);

/**
 * @route GET /api/intelligence/trip/:bookingId/context
 * @desc Debug trip hub context assembly
 */
router.get("/trip/:bookingId/context", IntelligenceController.getTripHubContext);

/**
 * @route POST /api/intelligence/consult
 * @desc Consult the AI from a specific widget context
 */
router.post("/consult", authenticate, IntelligenceController.consultWidget);

export default router;
