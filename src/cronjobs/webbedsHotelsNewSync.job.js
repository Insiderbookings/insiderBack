import { runWebbedsHotelsSyncJob } from "./webbedsSync.shared.js";

const webbedsHotelsNewSyncJob = {
  name: "webbeds-hotels-new-sync",
  defaults: {
    enabled: false,
    cronExpression: "30 1 * * *",
    timezone: "UTC",
  },
  handler: async ({ source, triggeredBy }) => {
    const summary = await runWebbedsHotelsSyncJob({
      jobName: "webbeds-hotels-new-sync",
      mode: "new",
    });
    if (summary?.skipped) {
      console.log("[job:webbeds-hotels-new-sync] skipped", { source, triggeredBy, ...summary });
      return;
    }

    console.log("[job:webbeds-hotels-new-sync] executed", { source, triggeredBy, ...summary });
  },
};

export default webbedsHotelsNewSyncJob;
