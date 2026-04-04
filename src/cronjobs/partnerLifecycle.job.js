import { runPartnerLifecycleSweep } from "../services/partnerLifecycle.service.js";

const PARTNER_LIFECYCLE_JOB_CRON =
  String(process.env.PARTNER_LIFECYCLE_JOB_CRON || "0 13 * * *").trim() || "0 13 * * *";

const partnerLifecycleJob = {
  name: "partner-lifecycle",
  defaults: {
    enabled: true,
    cronExpression: PARTNER_LIFECYCLE_JOB_CRON,
    timezone: "UTC",
  },
  handler: async ({ source }) => {
    const result = await runPartnerLifecycleSweep();
    console.log("[job:partner-lifecycle] executed", { source, ...result });
  },
};

export default partnerLifecycleJob;
