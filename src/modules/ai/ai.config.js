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

const clampInteger = (value, { fallback, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

export const AI_FLAGS = {
  chatEnabled: parseBoolean(process.env.AI_CHAT_ENABLED, true),
  contextEnabled: parseBoolean(process.env.AI_CONTEXT_ENABLED, false),
  bookingAssistEnabled: parseBoolean(process.env.AI_BOOKING_ASSIST_ENABLED, false),
};

export const AI_LIMITS = {
  maxResults: Math.max(1, Math.min(50, parseNumber(process.env.AI_MAX_RESULTS, 20))),
  maxMessages: Math.max(10, Math.min(200, parseNumber(process.env.AI_MAX_MESSAGES, 60))),
  maxToolsPerTurn: Math.max(1, Math.min(5, parseNumber(process.env.AI_MAX_TOOLS_PER_TURN, 3))),
};

export const AI_RATE_LIMITS = {
  windowMs: 60 * 1000,
  chatPerMinute: clampInteger(process.env.AI_RATE_LIMIT_CHAT_PER_MIN ?? process.env.AI_RATE_LIMIT_MAX, {
    fallback: 30,
    min: 1,
    max: 500,
  }),
  sessionReadPerMinute: clampInteger(process.env.AI_RATE_LIMIT_SESSION_READ_PER_MIN, {
    fallback: 60,
    min: 1,
    max: 1000,
  }),
  sessionWritePerMinute: clampInteger(process.env.AI_RATE_LIMIT_SESSION_WRITE_PER_MIN, {
    fallback: 20,
    min: 1,
    max: 500,
  }),
};

export const AI_CHAT_HISTORY_LIMITS = {
  listDefault: 25,
  listMax: clampInteger(process.env.AI_CHAT_LIST_LIMIT_MAX, {
    fallback: 50,
    min: 1,
    max: 200,
  }),
  detailDefault: 200,
  detailMax: clampInteger(process.env.AI_CHAT_DETAIL_LIMIT_MAX, {
    fallback: 200,
    min: 1,
    max: 500,
  }),
  contextDefault: clampInteger(process.env.AI_CHAT_CONTEXT_LIMIT_DEFAULT, {
    fallback: AI_LIMITS.maxMessages,
    min: 10,
    max: 200,
  }),
  contextMax: clampInteger(process.env.AI_CHAT_CONTEXT_LIMIT_MAX, {
    fallback: AI_LIMITS.maxMessages,
    min: 10,
    max: 200,
  }),
};

export const AI_CHAT_REQUEST_LIMITS = {
  bodyLimit: process.env.AI_CHAT_BODY_LIMIT || "256kb",
  maxMessageChars: clampInteger(process.env.AI_CHAT_MAX_MESSAGE_CHARS, {
    fallback: 4000,
    min: 100,
    max: 20000,
  }),
  maxMessagesInput: clampInteger(process.env.AI_CHAT_MAX_MESSAGES_INPUT, {
    fallback: 20,
    min: 1,
    max: 100,
  }),
  maxContextChars: clampInteger(process.env.AI_CHAT_MAX_CONTEXT_CHARS, {
    fallback: 6000,
    min: 200,
    max: 50000,
  }),
  maxContextRecentChats: clampInteger(process.env.AI_CHAT_MAX_CONTEXT_CHATS, {
    fallback: 8,
    min: 0,
    max: 50,
  }),
  maxRecentChatTitleChars: clampInteger(process.env.AI_CHAT_MAX_RECENT_CHAT_TITLE_CHARS, {
    fallback: 120,
    min: 20,
    max: 500,
  }),
  maxSessionIdChars: clampInteger(process.env.AI_CHAT_MAX_SESSION_ID_CHARS, {
    fallback: 120,
    min: 16,
    max: 255,
  }),
  maxLimitValue: clampInteger(process.env.AI_CHAT_MAX_LIMIT_VALUE, {
    fallback: 120,
    min: 1,
    max: 500,
  }),
};

export const AI_CHAT_QUOTAS = {
  maxSessionsPerUser: clampInteger(process.env.AI_CHAT_MAX_SESSIONS_PER_USER, {
    fallback: 50,
    min: 1,
    max: 500,
  }),
  maxMessagesPerSession: clampInteger(process.env.AI_CHAT_MAX_MESSAGES_PER_SESSION, {
    fallback: 500,
    min: 10,
    max: 5000,
  }),
};

export const AI_DEFAULTS = {
  language: process.env.AI_DEFAULT_LANGUAGE || "es",
};
