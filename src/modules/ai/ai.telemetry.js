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

// ── Circuit Breaker ──────────────────────────────────────────────────────────
// Protects against OpenAI outages. Opens after FAILURE_THRESHOLD consecutive
// failures within WINDOW_MS. After HALF_OPEN_AFTER_MS, allows one probe request.
// If probe succeeds → closes. If probe fails → stays open.
const FAILURE_THRESHOLD = 5;          // consecutive failures to open
const WINDOW_MS = 60_000;             // failures must occur within 60s
const HALF_OPEN_AFTER_MS = 30_000;    // try again after 30s

const _cb = {
  state: "CLOSED",       // CLOSED | OPEN | HALF_OPEN
  failures: 0,
  lastFailureAt: 0,
  openedAt: 0,
};

export const circuitBreaker = {
  /**
   * Returns true if the circuit allows requests to pass through.
   * Call this before making OpenAI calls.
   */
  isOpen() {
    if (_cb.state === "CLOSED") return false;
    if (_cb.state === "OPEN") {
      if (Date.now() - _cb.openedAt >= HALF_OPEN_AFTER_MS) {
        _cb.state = "HALF_OPEN";
        console.info("[ai] circuit breaker → HALF_OPEN (probing)");
        return false; // allow one probe
      }
      return true; // still open
    }
    // HALF_OPEN — one probe already in flight, block others
    return false;
  },

  /** Call on every successful OpenAI response. */
  onSuccess() {
    if (_cb.state !== "CLOSED") {
      console.info("[ai] circuit breaker → CLOSED (recovered)", { previousState: _cb.state });
    }
    _cb.state = "CLOSED";
    _cb.failures = 0;
    _cb.lastFailureAt = 0;
  },

  /** Call on every OpenAI error/timeout. */
  onFailure(context = {}) {
    const now = Date.now();
    // Reset failure count if last failure was outside the window
    if (now - _cb.lastFailureAt > WINDOW_MS) {
      _cb.failures = 0;
    }
    _cb.failures += 1;
    _cb.lastFailureAt = now;

    if (_cb.state === "HALF_OPEN" || _cb.failures >= FAILURE_THRESHOLD) {
      _cb.state = "OPEN";
      _cb.openedAt = now;
      console.error("[ai] circuit breaker → OPEN", {
        failures: _cb.failures,
        ...context,
      });
    }
  },

  /** Current state snapshot for health checks. */
  status() {
    return {
      state: _cb.state,
      failures: _cb.failures,
      openedAt: _cb.openedAt || null,
    };
  },
};
