export const getFeatureFlags = (req, res) => {
  res.json({
    success: true,
    data: {
      homesEnabled: process.env.FEATURE_HOMES_ENABLED !== "false",
      hostEnabled: process.env.FEATURE_HOST_ENABLED !== "false",
    },
  });
};
