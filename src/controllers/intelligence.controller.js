import { generateTripAddons, generateAndSaveTripIntelligence } from "../services/aiAssistant.service.js";
import { buildTripHubContext } from "../services/tripHubContext.service.js";
import { getTripWeather } from "../services/tripHubWeather.service.js";
import { runAiTurn } from "../modules/ai/ai.service.js";
import models from "../models/index.js";

const { StayIntelligence } = models;
const TRIP_HUB_DEBUG = process.env.TRIP_HUB_DEBUG === "true";
const debugTripHub = (...args) => {
    if (TRIP_HUB_DEBUG) console.log("[tripHub.debug]", ...args);
};

const isIntelligenceReady = (intelligence) => {
    if (!intelligence) return false;
    const insights = Array.isArray(intelligence.insights) ? intelligence.insights : [];
    const preparation = Array.isArray(intelligence.preparation) ? intelligence.preparation : [];
    const metadata = intelligence.metadata || {};
    const suggestions = Array.isArray(metadata.suggestions) ? metadata.suggestions : [];
    const localPulse = Array.isArray(metadata.localPulse) ? metadata.localPulse : [];
    const itinerary = Array.isArray(metadata.itinerary) ? metadata.itinerary : [];
    return Boolean(
        insights.length ||
        preparation.length ||
        suggestions.length ||
        localPulse.length ||
        itinerary.length ||
        metadata.localLingo ||
        metadata.timeContext
    );
};

const shouldAttemptRegen = (metadata) => {
    const raw = metadata?.regenAttemptedAt;
    if (!raw) return true;
    const lastAttempt = new Date(raw).getTime();
    if (!Number.isFinite(lastAttempt)) return true;
    return Date.now() - lastAttempt > 10 * 60 * 1000;
};

/**
 * Controller to handle proactive trip intelligence.
 */
export const getTripIntelligence = async (req, res) => {
    try {
        const startedAt = Date.now();
        const { bookingId } = req.params;
        const { tripContext, lang } = req.body;
        const forceRegen =
            req.query?.forceRegen === "true" ||
            req.body?.forceRegen === true ||
            process.env.TRIP_HUB_FORCE_REGEN === "true";

        if (!bookingId) {
            return res.status(400).json({ error: "Missing bookingId" });
        }

        // 1. Check if we already have intelligence for this stay
        let intelligence = await StayIntelligence.findOne({ where: { stayId: bookingId } });
        debugTripHub("fetch.request", {
            bookingId,
            hasTripContext: Boolean(tripContext),
            lang: lang || "en",
            hasCached: Boolean(intelligence),
            forceRegen,
        });

        if (intelligence) {
            const metadata = intelligence.metadata || {};
            debugTripHub("fetch.cached", {
                bookingId,
                ready: isIntelligenceReady(intelligence),
                insights: Array.isArray(intelligence.insights) ? intelligence.insights.length : 0,
                preparation: Array.isArray(intelligence.preparation) ? intelligence.preparation.length : 0,
                suggestions: Array.isArray(metadata.suggestions) ? metadata.suggestions.length : 0,
                localPulse: Array.isArray(metadata.localPulse) ? metadata.localPulse.length : 0,
                itinerary: Array.isArray(metadata.itinerary) ? metadata.itinerary.length : 0,
                hasWeather: Boolean(metadata.weather),
                hasLocalLingo: Boolean(metadata.localLingo),
                hasTimeContext: Boolean(metadata.timeContext),
            });
            if (!isIntelligenceReady(intelligence) && tripContext && (forceRegen || shouldAttemptRegen(metadata))) {
                debugTripHub("fetch.regen", {
                    bookingId,
                    reason: forceRegen ? "force" : "cache_incomplete",
                });
                try {
                    await intelligence.update({
                        metadata: { ...metadata, regenAttemptedAt: new Date().toISOString() },
                    });
                } catch (regenMetaErr) {
                    console.warn("[IntelligenceController] regen metadata update failed", regenMetaErr?.message || regenMetaErr);
                }
                const regenerated = await generateAndSaveTripIntelligence({
                    stayId: bookingId,
                    tripContext,
                    lang: lang || "en",
                });
                if (regenerated) {
                    intelligence = regenerated;
                    debugTripHub("fetch.regen.complete", { bookingId });
                }
            }

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
                    itinerary: intelligence.metadata?.itinerary || [],
                    updatedAt: intelligence.lastGeneratedAt
                }
            });
        }

        // 2. If not found and we have context, generate it (Legacy/Fallback)
        if (tripContext) {
            debugTripHub("fetch.generate", { bookingId, reason: "cache_miss" });
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
                    itinerary: intelligence.metadata?.itinerary || [],
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

/**
 * Refreshes weather for a trip hub (cached by location).
 */
export const refreshTripWeather = async (req, res) => {
    try {
        const { bookingId } = req.params;
        if (!bookingId) return res.status(400).json({ error: "Missing bookingId" });

        const booking = await models.Booking.findByPk(bookingId, {
            include: [
                {
                    model: models.StayHotel,
                    as: "hotelStay",
                    required: false,
                    include: [
                        {
                            model: models.Hotel,
                            as: "hotel",
                            attributes: ["id", "name", "city", "country", "image", "lat", "lng", "address"],
                        },
                        {
                            model: models.WebbedsHotel,
                            as: "webbedsHotel",
                            attributes: [
                                "hotel_id",
                                "name",
                                "city_name",
                                "country_name",
                                "address",
                                "lat",
                                "lng",
                            ],
                        },
                    ],
                },
                {
                    model: models.StayHome,
                    as: "homeStay",
                    required: false,
                    include: [
                        {
                            model: models.Home,
                            as: "home",
                            attributes: ["id", "title", "host_id"],
                            include: [
                                {
                                    model: models.HomeAddress,
                                    as: "address",
                                    attributes: [
                                        "address_line1",
                                        "address_line2",
                                        "city",
                                        "state",
                                        "country",
                                        "latitude",
                                        "longitude",
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        });

        if (!booking) return res.status(404).json({ error: "Booking not found" });

        const intelligence = await models.StayIntelligence.findOne({ where: { stayId: bookingId } });
        const context = buildTripHubContext({ booking, intelligence });
        const locationPayload = {
            ...(context?.tripContext?.location || {}),
            locationText: context?.tripContext?.locationText || null,
        };
        const force = req.query?.force === "true" || req.body?.force === true;

        const { weather, cached, cacheKey } = await getTripWeather({
            location: locationPayload,
            timeZone: context?.derived?.timeZone || null,
            force,
        });

        if (weather) {
            if (intelligence) {
                const metadata = intelligence.metadata || {};
                await intelligence.update({
                    metadata: { ...metadata, weather },
                    lastGeneratedAt: intelligence.lastGeneratedAt || new Date(),
                });
            } else {
                await models.StayIntelligence.create({
                    stayId: bookingId,
                    insights: [],
                    preparation: [],
                    metadata: { weather },
                    lastGeneratedAt: new Date(),
                });
            }
        }

        return res.json({
            bookingId,
            cached,
            cacheKey,
            weather: weather || null,
        });
    } catch (error) {
        console.error("[IntelligenceController] refreshTripWeather error:", error);
        return res.status(500).json({ error: "Failed to refresh weather" });
    }
};

/**
 * Debug endpoint to validate trip hub context assembly.
 */
export const getTripHubContext = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const userId = Number(req.user?.id);
        if (!bookingId) return res.status(400).json({ error: "Missing bookingId" });
        const role = Number(req.user?.role);
        const isStaff = role === 1 || role === 100;

        const booking = await models.Booking.findByPk(bookingId, {
            include: [
                {
                    model: models.StayHotel,
                    as: "hotelStay",
                    required: false,
                    include: [
                        {
                            model: models.Hotel,
                            as: "hotel",
                            attributes: ["id", "name", "city", "country", "image", "lat", "lng", "address"],
                        },
                        {
                            model: models.WebbedsHotel,
                            as: "webbedsHotel",
                            attributes: [
                                "hotel_id",
                                "name",
                                "city_name",
                                "country_name",
                                "address",
                                "lat",
                                "lng",
                                "images",
                                "hotel_check_in",
                                "hotel_check_out",
                            ],
                        },
                    ],
                },
                {
                    model: models.StayHome,
                    as: "homeStay",
                    required: false,
                    include: [
                        {
                            model: models.Home,
                            as: "home",
                            attributes: ["id", "title", "host_id"],
                            include: [
                                {
                                    model: models.HomeAddress,
                                    as: "address",
                                    attributes: [
                                        "address_line1",
                                        "address_line2",
                                        "city",
                                        "state",
                                        "country",
                                        "latitude",
                                        "longitude",
                                    ],
                                },
                                {
                                    model: models.HomeMedia,
                                    as: "media",
                                    attributes: ["url", "is_cover", "order"],
                                    separate: true,
                                    limit: 4,
                                    order: [
                                        ["is_cover", "DESC"],
                                        ["order", "ASC"],
                                        ["id", "ASC"],
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    model: models.BookingUser,
                    as: "members",
                    required: false,
                    attributes: ["user_id", "status"],
                },
            ],
        });

        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        if (Number.isFinite(userId)) {
            const isOwner = Number(booking.user_id) === userId;
            const isHost = Number(booking.homeStay?.host_id) === userId;
            const isMember = Array.isArray(booking.members)
                ? booking.members.some(
                    (member) =>
                        Number(member.user_id) === userId &&
                        String(member.status || "").toUpperCase() === "ACCEPTED"
                )
                : false;

            if (!isOwner && !isHost && !isStaff && !isMember) {
                return res.status(403).json({ error: "Forbidden" });
            }
        }

        const intelligence = await models.StayIntelligence.findOne({ where: { stayId: bookingId } });
        const includeSuggestions = req.query?.includeSuggestions === "true";
        const context = buildTripHubContext({ booking, intelligence });
        if (includeSuggestions) {
            const metadata = intelligence?.metadata || {};
            context.suggestions = Array.isArray(metadata.suggestions) ? metadata.suggestions : [];
        }
        return res.json(context);
    } catch (error) {
        console.error("[IntelligenceController] getTripHubContext error:", error);
        return res.status(500).json({ error: "Failed to fetch trip hub context" });
    }
};
