import axios from "axios";
import models from "../models/index.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH = 100;

const chunk = (items = [], size = MAX_BATCH) => {
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
};

const buildHeaders = () => {
  const headers = { "Content-Type": "application/json" };
  const accessToken = process.env.EXPO_PUSH_ACCESS_TOKEN;
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else {
    console.warn("[push] Warning: EXPO_PUSH_ACCESS_TOKEN is missing in environment variables.");
  }
  return headers;
};

const purgeInvalidTokens = async (tokens = [], responseData = []) => {
  const invalid = new Set();
  responseData.forEach((item, index) => {
    if (item?.status === "error" && item?.details?.error === "DeviceNotRegistered") {
      const token = tokens[index];
      if (token) invalid.add(token);
    }
  });
  if (!invalid.size) return;
  await models.PushToken.destroy({ where: { token: Array.from(invalid) } });
};

export const sendPushToUser = async ({ userId, title, body, data, debug = false }) => {
  if (!userId) return debug ? { ok: false, reason: "MISSING_USER" } : undefined;
  const rows = await models.PushToken.findAll({ where: { user_id: userId } });
  if (!rows.length) {
    return debug ? { ok: false, reason: "NO_TOKENS", tokenCount: 0 } : undefined;
  }
  const tokens = rows.map((row) => row.token).filter(Boolean);
  if (!tokens.length) {
    return debug ? { ok: false, reason: "NO_TOKENS", tokenCount: 0 } : undefined;
  }

  const messages = tokens.map((token) => ({
    to: token,
    title: title || "New message",
    body: body || "You have a new message.",
    data: data || {},
    channelId: "default",
  }));

  const headers = buildHeaders();
  const summary = {
    ok: true,
    tokenCount: tokens.length,
    batches: 0,
    okCount: 0,
    errorCount: 0,
    errors: [],
  };
  if (debug) console.log("[push] Sending to tokens:", tokens);
  for (const batch of chunk(messages)) {
    summary.batches += 1;
    try {
      const response = await axios.post(EXPO_PUSH_URL, batch, { headers });
      const results = Array.isArray(response?.data?.data) ? response.data.data : [];
      results.forEach((item) => {
        if (item?.status === "ok") {
          summary.okCount += 1;
        } else if (item?.status === "error") {
          summary.errorCount += 1;
          if (item?.details?.error) {
            summary.errors.push(item.details.error);
          }
        }
      });
      await purgeInvalidTokens(batch.map((m) => m.to), results);
    } catch (err) {
      const errorData = err?.response?.data;
      console.warn("[push] send failed:", {
        message: err?.message || err,
        data: errorData || "no_response_data",
        stack: err?.stack?.split("\n")[0],
      });
      summary.ok = false;
      summary.errorCount += batch.length;
      summary.errors.push(errorData?.errors?.[0]?.message || err?.message || "request_failed");
    }
  }

  if (!debug) return;
  if (summary.errors.length > 5) summary.errors = summary.errors.slice(0, 5);
  return summary;
};
