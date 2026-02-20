import demoLogJob from "./demoLog.job.js";
import fxRatesSyncJob from "./fxRatesSync.job.js";
import bookingPendingExpireJob from "./bookingPendingExpire.job.js";
import bookingStripeReconcileJob from "./bookingStripeReconcile.job.js";
import payoutBatchJob from "./payoutBatch.job.js";
import influencerPayoutBatchJob from "./influencerPayoutBatch.job.js";
import tripHubBaseRefreshJob from "./tripHubBaseRefresh.job.js";
import tripHubDeltaRefreshJob from "./tripHubDeltaRefresh.job.js";

const registry = [
  demoLogJob,
  fxRatesSyncJob,
  bookingPendingExpireJob,
  bookingStripeReconcileJob,
  payoutBatchJob,
  influencerPayoutBatchJob,
  tripHubBaseRefreshJob,
  tripHubDeltaRefreshJob,
];

export const JOB_DEFINITIONS = registry.map((job) => ({
  name: String(job.name || "").trim().toLowerCase(),
  defaults: {
    enabled: Boolean(job?.defaults?.enabled),
    cronExpression: String(job?.defaults?.cronExpression || "").trim() || null,
    timezone: String(job?.defaults?.timezone || "").trim() || "UTC",
  },
  handler: job.handler,
}));

export const JOB_HANDLERS = JOB_DEFINITIONS.reduce((acc, job) => {
  if (job.name && typeof job.handler === "function") acc[job.name] = job.handler;
  return acc;
}, {});

export default {
  JOB_DEFINITIONS,
  JOB_HANDLERS,
};
