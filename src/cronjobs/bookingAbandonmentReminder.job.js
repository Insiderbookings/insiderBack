import { runBookingAbandonmentReminderSweep } from "../services/bookingAbandonmentReminder.service.js";

const BOOKING_ABANDONMENT_JOB_CRON =
  String(process.env.BOOKING_ABANDONMENT_JOB_CRON || "*/15 * * * *").trim() || "*/15 * * * *";

const bookingAbandonmentReminderJob = {
  name: "booking-abandonment-reminder",
  defaults: {
    enabled: true,
    cronExpression: BOOKING_ABANDONMENT_JOB_CRON,
    timezone: "UTC",
  },
  handler: async ({ source }) => {
    const result = await runBookingAbandonmentReminderSweep();
    console.log("[job:booking-abandonment-reminder] executed", { source, ...result });
  },
};

export default bookingAbandonmentReminderJob;
