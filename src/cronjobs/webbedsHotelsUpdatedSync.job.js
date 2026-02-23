import { runWebbedsHotelsSyncJob } from "./webbedsSync.shared.js";

const webbedsHotelsUpdatedSyncJob = {
  name: "webbeds-hotels-updated-sync",
  defaults: {
    enabled: false,
    cronExpression: "0 */6 * * *",
    timezone: "UTC",
  },
  handler: async ({ source, triggeredBy }) => {
    const summary = await runWebbedsHotelsSyncJob({
      jobName: "webbeds-hotels-updated-sync",
      mode: "updated",
    });
    if (summary?.skipped) {
      console.log("[job:webbeds-hotels-updated-sync] skipped", { source, triggeredBy, ...summary });
      return;
    }

    console.log("[job:webbeds-hotels-updated-sync] executed", { source, triggeredBy, ...summary });
  },
};

export default webbedsHotelsUpdatedSyncJob;
