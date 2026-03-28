const guestWalletHotelsEnabled =
  String(process.env.GUEST_WALLET_HOTELS_ENABLED || "false").trim().toLowerCase() === "true";

export const getFeatureFlags = (req, res) => {
  res.json({
    success: true,
    data: {
      homesEnabled: process.env.FEATURE_HOMES_ENABLED !== "false",
      hostEnabled: process.env.FEATURE_HOST_ENABLED !== "false",
      guestWalletHotelsEnabled,
    },
  });
};
