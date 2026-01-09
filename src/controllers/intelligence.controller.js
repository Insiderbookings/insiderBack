import { generateTripAddons, generateAndSaveTripIntelligence } from "../services/aiAssistant.service.js";
import { runAiTurn } from "../modules/ai/ai.service.js";
import models from "../models/index.js";

const { StayIntelligence } = models;

/**
 * Controller to handle proactive trip intelligence.
 */
export const getTripIntelligence = async (req, res) => {
    try {
        const startedAt = Date.now();
        const { bookingId } = req.params;
        const { tripContext, lang } = req.body;

        if (!bookingId) {
            return res.status(400).json({ error: "Missing bookingId" });
        }

        // 1. Check if we already have intelligence for this stay
        let intelligence = await StayIntelligence.findOne({ where: { stayId: bookingId } });

        if (intelligence) {
            console.log("[perf] tripHub.fetch", {
                bookingId,
                status: "cached",
                durationMs: Date.now() - startedAt,
            });
            return res.json({
                bookingId,
                intelligence: {
                    insights: intelligence.insights || [],
                    preparation: intelligence.preparation || [],
                    weather: intelligence.metadata?.weather || null,
                    timeContext: intelligence.metadata?.timeContext || null,
                    localPulse: intelligence.metadata?.localPulse || [],
                    localLingo: intelligence.metadata?.localLingo || null,
                    suggestions: intelligence.metadata?.suggestions || [],
                    updatedAt: intelligence.lastGeneratedAt
                }
            });
        }

        // 2. If not found and we have context, generate it (Legacy/Fallback)
        if (tripContext) {
            intelligence = await generateAndSaveTripIntelligence({
                stayId: bookingId,
                tripContext,
                lang: lang || "en"
            });

            if (intelligence) {
                console.log("[perf] tripHub.fetch", {
                    bookingId,
                    status: "generated",
                    durationMs: Date.now() - startedAt,
                });
                return res.json({
                    bookingId,
                    intelligence: {
                        insights: intelligence.insights || [],
                        preparation: intelligence.preparation || [],
                        weather: intelligence.metadata?.weather || null,
                        timeContext: intelligence.metadata?.timeContext || null,
                        localPulse: intelligence.metadata?.localPulse || [],
                        localLingo: intelligence.metadata?.localLingo || null,
                        suggestions: intelligence.metadata?.suggestions || [],
                        updatedAt: intelligence.lastGeneratedAt
                    }
                });
            }
        }

        console.log("[perf] tripHub.fetch", {
            bookingId,
            status: "missing",
            durationMs: Date.now() - startedAt,
        });
        return res.status(404).json({ error: "Intelligence not found and no context provided" });
    } catch (error) {
        console.error("[IntelligenceController] Error:", error);
        return res.status(500).json({ error: "Failed to fetch trip intelligence" });
    }
};

/**
 * Specialized handler for in-place consultations.
 */
export const consultWidget = async (req, res) => {
    try {
        const { sessionId, userId, query, context } = req.body;

        const result = await runAiTurn({
            sessionId,
            userId,
            message: query,
            context,
            // We can force a specific tone or limit for widget responses here
        });

        return res.json(result);
    } catch (error) {
        console.error("[IntelligenceController] Consult Error:", error);
        return res.status(500).json({ error: "Consultation failed" });
    }
};
