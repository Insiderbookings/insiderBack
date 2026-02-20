const demoLogJob = {
  name: "demo-log",
  defaults: {
    enabled: false,
    cronExpression: "*/5 * * * *",
    timezone: "UTC",
  },
  handler: async ({ source }) => {
    console.log("[job:demo-log] executed", {
      source,
      at: new Date().toISOString(),
    });
  },
};

export default demoLogJob;

