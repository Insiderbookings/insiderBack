const toSafeString = (value) => {
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
};

const AI_EVENT_LOGS_ENABLED =
  String(process.env.AI_EVENT_LOGS || "").trim().toLowerCase() === "true";

/** Do not pass message content or full assistant reply in payload — only metadata (ids, counts, timings). */
export const logAiEvent = (label, payload = {}) => {
  if (!AI_EVENT_LOGS_ENABLED) return;
  const safePayload = payload && typeof payload === "object" ? payload : { value: payload };
  console.log(`[ai] ${label}`, toSafeString(safePayload));
};
