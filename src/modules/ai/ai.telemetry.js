import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";

const toSafeString = (value) => {
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
};

const isTruthyEnvFlag = (value) =>
  new Set(["1", "true", "yes", "on"]).has(
    String(value || "").trim().toLowerCase(),
  );

const AI_EVENT_LOGS_ENABLED = isTruthyEnvFlag(process.env.AI_EVENT_LOGS);
const AI_FILE_DEBUG_ENABLED = isTruthyEnvFlag(process.env.AI_FILE_DEBUG);
const AI_FILE_DEBUG_PATH = path.resolve(
  process.cwd(),
  String(process.env.AI_FILE_DEBUG_PATH || "./logs/ai-semantic-debug.txt").trim(),
);
const AI_FILE_DEBUG_MAX_DEPTH = Math.max(
  2,
  Math.min(8, Number(process.env.AI_FILE_DEBUG_MAX_DEPTH || 6)),
);
const AI_FILE_DEBUG_MAX_ARRAY_ITEMS = Math.max(
  5,
  Math.min(50, Number(process.env.AI_FILE_DEBUG_MAX_ARRAY_ITEMS || 12)),
);
const AI_FILE_DEBUG_MAX_OBJECT_KEYS = Math.max(
  10,
  Math.min(80, Number(process.env.AI_FILE_DEBUG_MAX_OBJECT_KEYS || 30)),
);
const AI_FILE_DEBUG_MAX_STRING_LENGTH = Math.max(
  120,
  Math.min(4000, Number(process.env.AI_FILE_DEBUG_MAX_STRING_LENGTH || 1200)),
);

let aiFileDebugInitPromise = null;
let aiFileDebugWriteQueue = Promise.resolve();
let aiFileDebugWarningShown = false;

const ensureAiFileDebugDirectory = async () => {
  if (!aiFileDebugInitPromise) {
    aiFileDebugInitPromise = mkdir(path.dirname(AI_FILE_DEBUG_PATH), {
      recursive: true,
    }).catch((error) => {
      aiFileDebugInitPromise = null;
      throw error;
    });
  }
  return aiFileDebugInitPromise;
};

const sanitizeAiDebugValue = (value, depth = 0, seen = new WeakSet()) => {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > AI_FILE_DEBUG_MAX_STRING_LENGTH
      ? `${value.slice(0, AI_FILE_DEBUG_MAX_STRING_LENGTH)}...[truncated]`
      : value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (depth >= AI_FILE_DEBUG_MAX_DEPTH) {
    if (Array.isArray(value)) {
      return `[Array(${value.length}) depth-limited]`;
    }
    return "[Object depth-limited]";
  }
  if (Array.isArray(value)) {
    const sliced = value
      .slice(0, AI_FILE_DEBUG_MAX_ARRAY_ITEMS)
      .map((entry) => sanitizeAiDebugValue(entry, depth + 1, seen));
    if (value.length > AI_FILE_DEBUG_MAX_ARRAY_ITEMS) {
      sliced.push({
        __truncatedItems: value.length - AI_FILE_DEBUG_MAX_ARRAY_ITEMS,
      });
    }
    return sliced;
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out = {};
    const keys = Object.keys(value);
    keys.slice(0, AI_FILE_DEBUG_MAX_OBJECT_KEYS).forEach((key) => {
      out[key] = sanitizeAiDebugValue(value[key], depth + 1, seen);
    });
    if (keys.length > AI_FILE_DEBUG_MAX_OBJECT_KEYS) {
      out.__truncatedKeys = keys.length - AI_FILE_DEBUG_MAX_OBJECT_KEYS;
    }
    seen.delete(value);
    return out;
  }
  return String(value);
};

export const logAiFileDebug = (stage, payload = {}, meta = {}) => {
  if (!AI_FILE_DEBUG_ENABLED || !stage) return;
  const entry = {
    ts: new Date().toISOString(),
    stage: String(stage).trim(),
    ...sanitizeAiDebugValue(meta),
    payload: sanitizeAiDebugValue(payload),
  };
  const line = `${JSON.stringify(entry)}\n`;

  aiFileDebugWriteQueue = aiFileDebugWriteQueue
    .then(async () => {
      await ensureAiFileDebugDirectory();
      await appendFile(AI_FILE_DEBUG_PATH, line, "utf8");
    })
    .catch((error) => {
      if (aiFileDebugWarningShown) return;
      aiFileDebugWarningShown = true;
      console.warn("[ai] file debug logger failed", error?.message || error);
    });
};

/**
 * Do not pass message content or full assistant reply here by default.
 * Keep this event logger metadata-oriented.
 */
export const logAiEvent = (label, payload = {}) => {
  if (!AI_EVENT_LOGS_ENABLED) return;
  const safePayload =
    payload && typeof payload === "object" ? payload : { value: payload };
  console.log(`[ai] ${label}`, toSafeString(safePayload));
  logAiFileDebug("ai_event", safePayload, { label });
};

// Circuit breaker
// Protects against OpenAI outages. Opens after FAILURE_THRESHOLD consecutive
// failures within WINDOW_MS. After HALF_OPEN_AFTER_MS, allows one probe request.
// If probe succeeds -> closes. If probe fails -> stays open.
const FAILURE_THRESHOLD = 5;
const WINDOW_MS = 60_000;
const HALF_OPEN_AFTER_MS = 30_000;

const cbState = {
  state: "CLOSED",
  failures: 0,
  lastFailureAt: 0,
  openedAt: 0,
};

export const circuitBreaker = {
  isOpen() {
    if (cbState.state === "CLOSED") return false;
    if (cbState.state === "OPEN") {
      if (Date.now() - cbState.openedAt >= HALF_OPEN_AFTER_MS) {
        cbState.state = "HALF_OPEN";
        console.info("[ai] circuit breaker -> HALF_OPEN (probing)");
        return false;
      }
      return true;
    }
    return false;
  },

  onSuccess() {
    if (cbState.state !== "CLOSED") {
      console.info("[ai] circuit breaker -> CLOSED (recovered)", {
        previousState: cbState.state,
      });
    }
    cbState.state = "CLOSED";
    cbState.failures = 0;
    cbState.lastFailureAt = 0;
  },

  onFailure(context = {}) {
    const now = Date.now();
    if (now - cbState.lastFailureAt > WINDOW_MS) {
      cbState.failures = 0;
    }
    cbState.failures += 1;
    cbState.lastFailureAt = now;

    if (cbState.state === "HALF_OPEN" || cbState.failures >= FAILURE_THRESHOLD) {
      cbState.state = "OPEN";
      cbState.openedAt = now;
      console.error("[ai] circuit breaker -> OPEN", {
        failures: cbState.failures,
        ...context,
      });
    }
  },

  status() {
    return {
      state: cbState.state,
      failures: cbState.failures,
      openedAt: cbState.openedAt || null,
    };
  },
};
