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
export const logAiFileDebug = () => {};

/**
 * Do not pass message content or full assistant reply here by default.
 * Keep this event logger metadata-oriented.
 */
export const logAiEvent = (label, payload = {}) => {
  if (!AI_EVENT_LOGS_ENABLED) return;
  const safePayload =
    payload && typeof payload === "object" ? payload : { value: payload };
  console.log(`[ai] ${label}`, toSafeString(safePayload));
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
