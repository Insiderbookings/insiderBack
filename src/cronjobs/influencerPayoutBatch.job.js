import { runInfluencerPayoutBatchSweep } from "../services/influencerPayoutScheduler.js";

const DAY_TO_CRON = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const parseTime = (value, fallbackHour = 3, fallbackMinute = 0) => {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return { hour: fallbackHour, minute: fallbackMinute };
  return {
    hour: Math.min(23, Math.max(0, Number(match[1]))),
    minute: Math.min(59, Math.max(0, Number(match[2] || 0))),
  };
};

const buildDefaults = () => {
  const dayRaw = String(
    process.env.INFLUENCER_PAYOUT_BATCH_DAY || process.env.PAYOUT_BATCH_DAY || "MON"
  )
    .trim()
    .toUpperCase()
    .slice(0, 3);
  const day = DAY_TO_CRON[dayRaw] ?? 1;
  const { hour, minute } = parseTime(
    process.env.INFLUENCER_PAYOUT_BATCH_TIME || process.env.PAYOUT_BATCH_TIME || "03:00"
  );
  const timezone = String(
    process.env.INFLUENCER_PAYOUT_BATCH_TZ || process.env.PAYOUT_BATCH_TZ || "America/New_York"
  ).trim() || "UTC";
  return {
    enabled: true,
    cronExpression: `${minute} ${hour} * * ${day}`,
    timezone,
  };
};

const influencerPayoutBatchJob = {
  name: "influencer-payout-batch",
  defaults: buildDefaults(),
  handler: async ({ source }) => {
    const result = await runInfluencerPayoutBatchSweep();
    console.log("[job:influencer-payout-batch] executed", { source, result });
  },
};

export default influencerPayoutBatchJob;

