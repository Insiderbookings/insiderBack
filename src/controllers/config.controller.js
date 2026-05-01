const guestWalletHotelsEnabled =
  String(process.env.GUEST_WALLET_HOTELS_ENABLED || "false").trim().toLowerCase() === "true";

const parseBoolean = (value, defaultValue = false) => {
  if (value == null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
};

const parseInteger = (value, defaultValue) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const parseOptionalString = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

const buildIosStoreUrl = () => {
  const explicitUrl = parseOptionalString(process.env.MOBILE_IOS_STORE_URL);
  if (explicitUrl) return explicitUrl;

  const appStoreId = parseOptionalString(process.env.MOBILE_IOS_APP_STORE_ID);
  if (!appStoreId) return null;

  return `https://apps.apple.com/app/id${appStoreId}`;
};

const buildAndroidStoreUrl = () => {
  const explicitUrl = parseOptionalString(process.env.MOBILE_ANDROID_STORE_URL);
  if (explicitUrl) return explicitUrl;

  const packageName =
    parseOptionalString(process.env.MOBILE_ANDROID_PACKAGE) || "com.bookinggpt.app";
  return `https://play.google.com/store/apps/details?id=${packageName}`;
};

const buildPlatformUpdateConfig = (platform) => {
  const upperPlatform = platform.toUpperCase();

  return {
    latestVersion: parseOptionalString(
      process.env[`MOBILE_${upperPlatform}_LATEST_VERSION`]
    ),
    minimumVersion: parseOptionalString(
      process.env[`MOBILE_${upperPlatform}_MINIMUM_VERSION`]
    ),
    storeUrl: platform === "ios" ? buildIosStoreUrl() : buildAndroidStoreUrl(),
    softMessage: parseOptionalString(
      process.env[`MOBILE_${upperPlatform}_SOFT_MESSAGE`]
    ),
    forceMessage: parseOptionalString(
      process.env[`MOBILE_${upperPlatform}_FORCE_MESSAGE`]
    ),
  };
};

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

export const getMobileUpdateConfig = (_req, res) => {
  const updatesEnabled = parseBoolean(process.env.MOBILE_UPDATES_ENABLED, true);

  res.json({
    success: true,
    data: {
      enabled: updatesEnabled,
      recheckIntervalMinutes: Math.max(
        5,
        parseInteger(process.env.MOBILE_UPDATE_RECHECK_MINUTES, 15)
      ),
      android: buildPlatformUpdateConfig("android"),
      ios: buildPlatformUpdateConfig("ios"),
    },
  });
};
