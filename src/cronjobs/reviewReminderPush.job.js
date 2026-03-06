import { runReviewReminderSweep } from "../services/reviewReminder.service.js";

const reviewReminderPushJob = {
  name: "review-reminder-push",
  defaults: {
    enabled: true,
    cronExpression: "*/30 * * * *",
    timezone: "UTC",
  },
  handler: async ({ source }) => {
    const result = await runReviewReminderSweep();
    console.log("[job:review-reminder-push] executed", { source, ...result });
  },
};

export default reviewReminderPushJob;
