import {
  reconcileLockedBalance,
  releaseStaleHolds,
} from "../services/guestWallet.service.js";

const guestWalletHoldCleanupJob = {
  name: "guest-wallet-hold-cleanup",
  defaults: {
    enabled: true,
    cronExpression: "0 * * * *", // every hour at :00
    timezone: "UTC",
  },
  handler: async ({ source }) => {
    const staleResult = await releaseStaleHolds({
      staleAfterHours: Number(process.env.WALLET_HOLD_STALE_AFTER_HOURS || 24),
      limit: 50,
    });
    console.log("[job:guest-wallet-hold-cleanup] stale holds", {
      source,
      ...staleResult,
    });

    const reconcileResult = await reconcileLockedBalance({ limit: 100 });
    console.log("[job:guest-wallet-hold-cleanup] reconcile", {
      source,
      ...reconcileResult,
    });
  },
};

export default guestWalletHoldCleanupJob;
