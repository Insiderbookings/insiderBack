import { runWebbedsHotelsSyncJob } from "./webbedsSync.shared.js";

const webbedsHotelsFullSyncJob = {
  name: "webbeds-hotels-full-sync",
  defaults: {
    enabled: false,
    cronExpression: "0 3 * * 0",
    timezone: "UTC",
  },
  handler: async ({ source, triggeredBy }) => {
    const summary = await runWebbedsHotelsSyncJob({
      jobName: "webbeds-hotels-full-sync",
      mode: "full",
    });
    if (summary?.skipped) {
      console.log("[job:webbeds-hotels-full-sync] skipped", { source, triggeredBy, ...summary });
      return;
    }

    console.log("[job:webbeds-hotels-full-sync] executed", { source, triggeredBy, ...summary });
  },
};

export default webbedsHotelsFullSyncJob;
