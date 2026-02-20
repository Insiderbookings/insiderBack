import { processInfluencerPayoutBatch } from "../controllers/influencerPayout.controller.js";

const DEFAULT_LIMIT = 100;

export const runInfluencerPayoutBatchSweep = async () => {
  const limit = Number(process.env.INFLUENCER_PAYOUT_BATCH_LIMIT || DEFAULT_LIMIT);
  const result = await processInfluencerPayoutBatch({
    limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
  });
  return result;
};

export default {
  runInfluencerPayoutBatchSweep,
};
