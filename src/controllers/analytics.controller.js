
import models from "../models/index.js";

export const trackEvent = async (req, res) => {
    try {
        const { event_type, metadata, url } = req.body;

        // Optional: get user ID if authenticated
        const userId = req.user?.id || null;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        if (!event_type) {
            return res.status(400).json({ error: "event_type is required" });
        }

        await models.AnalyticsEvent.create({
            event_type,
            user_id: userId,
            metadata,
            url,
            ip_address: ip
        });

        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error("Analytics Error:", error);
        // Don't block the client, just return 200/500 but keeps it silent usually
        return res.status(500).json({ error: "Tracking failed" });
    }
};
