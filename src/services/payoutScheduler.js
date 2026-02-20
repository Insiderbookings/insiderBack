import { processPayoutBatch } from "../controllers/payout.controller.js";

const DEFAULT_LIMIT = 250;

export const runPayoutBatchSweep = async () => {
  const limit = Number(process.env.PAYOUT_BATCH_LIMIT || DEFAULT_LIMIT);
  const result = await processPayoutBatch({
    limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
  });
  return result;
};

export default {
  runPayoutBatchSweep,
};
