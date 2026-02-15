import { sequelize } from "../models/index.js";
import { runPendingStripeReconciliationSweep } from "../services/bookingCleanupScheduler.js";

const main = async () => {
  try {
    await sequelize.authenticate();
    const stats = await runPendingStripeReconciliationSweep();
    console.log("[booking-reconcile] manual sweep", stats);
    process.exit(0);
  } catch (err) {
    console.error("[booking-reconcile] manual sweep failed:", err?.message || err);
    process.exit(1);
  } finally {
    try {
      await sequelize.close();
    } catch {
      // noop
    }
  }
};

main();
