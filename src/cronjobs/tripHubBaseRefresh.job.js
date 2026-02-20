import { runTripHubBaseRefreshSweep } from "../services/tripHubPacksQueue.service.js";

const tripHubBaseRefreshJob = {
  name: "triphub-base-refresh",
  defaults: {
    enabled: true,
    cronExpression: "0 0 * * *",
    timezone: "UTC",
  },
  handler: async ({ source }) => {
    const result = await runTripHubBaseRefreshSweep();
    console.log("[job:triphub-base-refresh] executed", { source, ...result });
  },
};

export default tripHubBaseRefreshJob;

