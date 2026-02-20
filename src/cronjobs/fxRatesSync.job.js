import { fetchAndStoreFxRatesFromApiLayer } from "../services/fxRatesDb.service.js";

const fxRatesSyncJob = {
  name: "fx-rates-sync",
  defaults: {
    enabled: false,
    cronExpression: "*/30 * * * *",
    timezone: "UTC",
  },
  handler: async ({ source, triggeredBy }) => {
    const result = await fetchAndStoreFxRatesFromApiLayer({ source, triggeredBy });
    console.log("[job:fx-rates-sync] executed", {
      source,
      provider: result.provider,
      baseCurrency: result.baseCurrency,
      rateDate: result.rateDate,
      count: result.count,
      changedCount: result.changedCount,
      fetchedAt: result.fetchedAt,
    });
  },
};

export default fxRatesSyncJob;
