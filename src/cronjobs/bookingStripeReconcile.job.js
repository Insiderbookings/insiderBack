import { runPendingStripeReconciliationSweep } from "../services/bookingCleanupScheduler.js";

const bookingStripeReconcileJob = {
  name: "booking-stripe-reconcile",
  defaults: {
    enabled: true,
    cronExpression: "*/30 * * * *",
    timezone: "UTC",
  },
  handler: async ({ source }) => {
    const stats = await runPendingStripeReconciliationSweep();
    console.log("[job:booking-stripe-reconcile] executed", {
      source,
      scanned: stats?.scanned ?? 0,
      checked: stats?.checked ?? 0,
      confirmed: stats?.confirmed ?? 0,
      cancelled: stats?.cancelled ?? 0,
      keptPending: stats?.keptPending ?? 0,
      skipped: stats?.skipped ?? 0,
      errors: stats?.errors ?? 0,
    });
  },
};

export default bookingStripeReconcileJob;

