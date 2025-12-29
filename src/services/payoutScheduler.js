import { processPayoutBatch } from "../controllers/payout.controller.js";

const DEFAULT_BATCH_DAY = "MON";
const DEFAULT_BATCH_TIME = "03:00";
const DEFAULT_BATCH_TZ = "America/New_York";
const DEFAULT_TICK_MS = 5 * 60 * 1000;

const DAY_INDEX = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const parseTime = (value) => {
  const raw = String(value || DEFAULT_BATCH_TIME).trim();
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return { hour: 3, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2] || 0)));
  return { hour, minute };
};

const getDateParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const lookup = (type) => parts.find((p) => p.type === type)?.value;
  const weekdayRaw = (lookup("weekday") || "").slice(0, 3).toUpperCase();
  return {
    year: Number(lookup("year")),
    month: Number(lookup("month")),
    day: Number(lookup("day")),
    hour: Number(lookup("hour")),
    minute: Number(lookup("minute")),
    weekday: DAY_INDEX[weekdayRaw],
  };
};

export const startPayoutScheduler = () => {
  const enabled = String(process.env.PAYOUT_SCHEDULER_ENABLED || "true").toLowerCase() === "true";
  if (!enabled) {
    console.log("[payout-scheduler] disabled by PAYOUT_SCHEDULER_ENABLED");
    return;
  }

  const dayRaw = String(process.env.PAYOUT_BATCH_DAY || DEFAULT_BATCH_DAY).trim().toUpperCase();
  const day = DAY_INDEX[dayRaw.slice(0, 3)] ?? DAY_INDEX[DEFAULT_BATCH_DAY];
  const { hour, minute } = parseTime(process.env.PAYOUT_BATCH_TIME || DEFAULT_BATCH_TIME);
  const timeZone = process.env.PAYOUT_BATCH_TZ || DEFAULT_BATCH_TZ;
  const limit = Number(process.env.PAYOUT_BATCH_LIMIT || 250);
  const tickMs = Number(process.env.PAYOUT_SCHEDULER_TICK_MS || DEFAULT_TICK_MS);

  let lastRunKey = null;
  let isRunning = false;

  const tick = async () => {
    if (isRunning) return;
    const now = new Date();
    const parts = getDateParts(now, timeZone);
    if (parts.weekday !== day) return;
    if (parts.hour < hour || (parts.hour === hour && parts.minute < minute)) return;

    const runKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    if (lastRunKey === runKey) return;

    isRunning = true;
    try {
      const result = await processPayoutBatch({ limit });
      console.log("[payout-scheduler] batch result", result);
    } catch (err) {
      console.error("[payout-scheduler] batch error", err?.message || err);
    } finally {
      lastRunKey = runKey;
      isRunning = false;
    }
  };

  console.log("[payout-scheduler] started", {
    day: dayRaw,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    timeZone,
    limit,
    tickMs,
  });

  setInterval(() => {
    tick().catch((err) => console.error("[payout-scheduler] tick error", err?.message || err));
  }, tickMs);

  tick().catch((err) => console.error("[payout-scheduler] initial tick error", err?.message || err));
};

export default {
  startPayoutScheduler,
};
