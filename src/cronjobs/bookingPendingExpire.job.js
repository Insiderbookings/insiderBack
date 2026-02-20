import { expirePendingBookings } from "../services/bookingCleanupScheduler.js";

const bookingPendingExpireJob = {
  name: "booking-pending-expire",
  defaults: {
    enabled: true,
    cronExpression: "*/5 * * * *",
    timezone: "UTC",
  },
  handler: async ({ source }) => {
    const stats = await expirePendingBookings();
    console.log("[job:booking-pending-expire] executed", {
      source,
      scanned: stats?.scanned ?? 0,
      expired: stats?.expired ?? 0,
    });
  },
};

export default bookingPendingExpireJob;

