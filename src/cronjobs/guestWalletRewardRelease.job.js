import { releaseDueRewards } from "../services/guestWallet.service.js";

const guestWalletRewardReleaseJob = {
  name: "guest-wallet-reward-release",
  defaults: {
    enabled: true,
    cronExpression: "*/15 * * * *",
    timezone: "UTC",
  },
  handler: async ({ source }) => {
    const result = await releaseDueRewards();
    console.log("[job:guest-wallet-reward-release] executed", {
      source,
      ...result,
    });
  },
};

export default guestWalletRewardReleaseJob;
