const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on", "si"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
};

const parseNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const AI_FLAGS = {
  chatEnabled: parseBoolean(process.env.AI_CHAT_ENABLED, true),
  contextEnabled: parseBoolean(process.env.AI_CONTEXT_ENABLED, false),
  bookingAssistEnabled: parseBoolean(process.env.AI_BOOKING_ASSIST_ENABLED, false),
};

export const AI_LIMITS = {
  maxResults: Math.max(1, Math.min(20, parseNumber(process.env.AI_MAX_RESULTS, 5))),
  maxMessages: Math.max(10, Math.min(200, parseNumber(process.env.AI_MAX_MESSAGES, 60))),
  maxToolsPerTurn: Math.max(1, Math.min(5, parseNumber(process.env.AI_MAX_TOOLS_PER_TURN, 3))),
};

export const AI_DEFAULTS = {
  language: process.env.AI_DEFAULT_LANGUAGE || "es",
};
