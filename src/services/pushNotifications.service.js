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

export const sendPushToUser = async ({ userId, title, body, data }) => {
  if (!userId) return;
  const rows = await models.PushToken.findAll({ where: { user_id: userId } });
  if (!rows.length) return;
  const tokens = rows.map((row) => row.token).filter(Boolean);
  if (!tokens.length) return;

  const messages = tokens.map((token) => ({
    to: token,
    title: title || "New message",
    body: body || "You have a new message.",
    data: data || {},
  }));

  const headers = buildHeaders();
  for (const batch of chunk(messages)) {
    try {
      const response = await axios.post(EXPO_PUSH_URL, batch, { headers });
      const results = Array.isArray(response?.data?.data) ? response.data.data : [];
      await purgeInvalidTokens(batch.map((m) => m.to), results);
    } catch (err) {
      console.warn("[push] send failed:", err?.message || err);
    }
  }
};
