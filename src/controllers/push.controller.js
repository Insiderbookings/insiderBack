import models from "../models/index.js";
import { sendPushToUser } from "../services/pushNotifications.service.js";

export const registerPushToken = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { token, platform = null, deviceId = null } = req.body || {};
    const trimmedToken = String(token || "").trim();
    if (!trimmedToken) return res.status(400).json({ error: "Push token is required" });

    const payload = {
      user_id: userId,
      token: trimmedToken,
      platform: platform ? String(platform).trim() : null,
      device_id: deviceId ? String(deviceId).trim() : null,
      last_seen_at: new Date(),
    };

    await models.PushToken.upsert(payload);
    return res.json({ ok: true });
  } catch (err) {
    console.error("registerPushToken:", err?.message || err);
    return res.status(500).json({ error: "Server error" });
  }
};

export const unregisterPushToken = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { token } = req.body || {};
    const trimmedToken = String(token || "").trim();
    if (!trimmedToken) return res.status(400).json({ error: "Push token is required" });

    await models.PushToken.destroy({ where: { user_id: userId, token: trimmedToken } });
    return res.json({ ok: true });
  } catch (err) {
    console.error("unregisterPushToken:", err?.message || err);
    return res.status(500).json({ error: "Server error" });
  }
};

export const sendTestPush = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { title, body } = req.body || {};
    await sendPushToUser({
      userId,
      title: typeof title === "string" && title.trim() ? title.trim() : "Test notification",
      body: typeof body === "string" && body.trim() ? body.trim() : "This is a test push notification.",
      data: { type: "TEST" },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("sendTestPush:", err?.message || err);
    return res.status(500).json({ error: "Server error" });
  }
};
