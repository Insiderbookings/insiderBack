import { performance } from "node:perf_hooks"

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"])
const ENV_ENABLED = TRUTHY_VALUES.has(
  String(process.env.API_DEBUG_TIMINGS || "").trim().toLowerCase(),
)

const roundDuration = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return 0
  return Math.round(numeric * 10) / 10
}

const asBool = (value) =>
  TRUTHY_VALUES.has(String(value || "").trim().toLowerCase())

const createTraceId = (prefix = "req") => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

const encodeServerTimingEntry = ({ name, dur, desc }) => {
  const parts = [String(name || "step"), `dur=${roundDuration(dur)}`]
  if (desc) {
    parts.push(`desc="${String(desc).replace(/"/g, "'")}"`)
  }
  return parts.join(";")
}

export const isRequestTimingEnabled = (req) =>
  ENV_ENABLED ||
  asBool(req?.headers?.["x-debug-timings"]) ||
  asBool(req?.query?.debugTimings)

export const createRequestTimer = (req, label) => {
  const enabled = isRequestTimingEnabled(req)
  if (!enabled) {
    return {
      enabled,
      traceId: null,
      track: async (_name, fn) => fn(),
      trackSync: (_name, fn) => fn(),
      record: () => {},
      flush: () => null,
    }
  }

  const traceId = createTraceId(
    String(label || "req")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-"),
  )
  const startedAt = performance.now()
  const entries = []

  const record = (name, durationMs, desc = null) => {
    if (!name) return
    entries.push({
      name: String(name).trim().replace(/\s+/g, "-"),
      dur: roundDuration(durationMs),
      desc: desc ? String(desc) : null,
    })
  }

  const track = async (name, fn, desc = null) => {
    const stepStartedAt = performance.now()
    try {
      return await fn()
    } finally {
      record(name, performance.now() - stepStartedAt, desc)
    }
  }

  const trackSync = (name, fn, desc = null) => {
    const stepStartedAt = performance.now()
    try {
      return fn()
    } finally {
      record(name, performance.now() - stepStartedAt, desc)
    }
  }

  const flush = (res, extra = {}) => {
    const totalMs = roundDuration(performance.now() - startedAt)
    const timingEntries = [...entries, { name: "total", dur: totalMs, desc: null }]
    if (res && !res.headersSent) {
      res.set("Server-Timing", timingEntries.map(encodeServerTimingEntry).join(", "))
      res.set("X-Debug-Trace", traceId)
    }
    console.info(`[timing][${label}]`, {
      traceId,
      totalMs,
      steps: timingEntries.map(({ name, dur, desc }) => ({
        name,
        durMs: dur,
        ...(desc ? { desc } : {}),
      })),
      ...extra,
    })
    return { traceId, totalMs, entries: timingEntries }
  }

  return {
    enabled,
    traceId,
    track,
    trackSync,
    record,
    flush,
  }
}
