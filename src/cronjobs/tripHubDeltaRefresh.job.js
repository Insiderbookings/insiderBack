import { runTripHubDeltaRefreshSweep } from "../services/tripHubPacksQueue.service.js";

const tripHubDeltaRefreshJob = {
  name: "triphub-delta-refresh",
  defaults: {
    enabled: true,
    cronExpression: "*/45 * * * *",
    timezone: "UTC",
  },
  handler: async ({ source }) => {
    const result = await runTripHubDeltaRefreshSweep();
    console.log("[job:triphub-delta-refresh] executed", { source, ...result });
  },
};

export default tripHubDeltaRefreshJob;

