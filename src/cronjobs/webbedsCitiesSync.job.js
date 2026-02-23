import { runWebbedsCitiesCatalogSyncJob } from "./webbedsSync.shared.js";

const webbedsCitiesSyncJob = {
  name: "webbeds-cities-sync",
  defaults: {
    enabled: false,
    cronExpression: "0 1 * * 0",
    timezone: "UTC",
  },
  handler: async ({ source, triggeredBy }) => {
    const summary = await runWebbedsCitiesCatalogSyncJob({ jobName: "webbeds-cities-sync" });
    if (summary?.skipped) {
      console.log("[job:webbeds-cities-sync] skipped", { source, triggeredBy, ...summary });
      return;
    }

    console.log("[job:webbeds-cities-sync] executed", { source, triggeredBy, ...summary });
  },
};

export default webbedsCitiesSyncJob;
