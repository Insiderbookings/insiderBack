import axios from "axios";

const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
const TWILIO_VERIFY_SERVICE_SID = String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim();
const TWILIO_VERIFY_BASE_URL = String(
  process.env.TWILIO_VERIFY_BASE_URL || "https://verify.twilio.com/v2"
).trim();
const IS_PRODUCTION = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const PHONE_VERIFICATION_DEV_BYPASS_RAW = String(
  process.env.PHONE_VERIFICATION_DEV_BYPASS || (IS_PRODUCTION ? "false" : "true")
)
  .trim()
  .toLowerCase();
const PHONE_VERIFICATION_DEV_BYPASS = ["1", "true", "yes", "on", "y"].includes(
  PHONE_VERIFICATION_DEV_BYPASS_RAW
);
const PHONE_VERIFICATION_DEV_CODE = String(
  process.env.PHONE_VERIFICATION_DEV_CODE || "000000"
).trim();

const asError = (message, status = 500, code = null) => {
  const error = new Error(message || "Phone verification failed.");
  error.status = status;
  if (code) error.code = code;
  return error;
};

const hasTwilioConfiguration = () =>
  Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID);

const canUseDevBypass = () => Boolean(!IS_PRODUCTION && PHONE_VERIFICATION_DEV_BYPASS);

const ensureConfigured = () => {
  if (hasTwilioConfiguration() || canUseDevBypass()) return;
  throw asError(
    "Phone verification is temporarily unavailable.",
    503,
    "PHONE_VERIFICATION_UNAVAILABLE"
  );
};

const buildHeaders = () => {
  const encoded = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
};

const serviceUrl = () => `${TWILIO_VERIFY_BASE_URL}/Services/${TWILIO_VERIFY_SERVICE_SID}`;

const toFormBody = (payload = {}) => {
  const params = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.append(key, String(value));
  });
  return params.toString();
};

const normalizeChannel = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "call" ? "call" : "sms";
};

const parseProviderError = (error, fallbackMessage) => {
  const status = Number(error?.response?.status || 500);
  const providerData = error?.response?.data;
  const providerMessage =
    typeof providerData?.message === "string" && providerData.message.trim()
      ? providerData.message.trim()
      : null;
  const message = providerMessage || fallbackMessage || "Phone verification failed.";
  const code =
    providerData?.code != null && String(providerData.code).trim()
      ? String(providerData.code).trim()
      : null;
  return asError(message, status, code);
};

export const isPhoneVerificationConfigured = () =>
  Boolean(hasTwilioConfiguration() || canUseDevBypass());

export const requestPhoneVerificationCode = async ({ phoneNumber, channel = "sms" }) => {
  ensureConfigured();
  const normalizedChannel = normalizeChannel(channel);

  if (!hasTwilioConfiguration() && canUseDevBypass()) {
    return {
      sid: `dev_vs_${Date.now()}`,
      status: "pending",
      channel: normalizedChannel,
      mode: "dev_bypass",
    };
  }

  try {
    const response = await axios.post(
      `${serviceUrl()}/Verifications`,
      toFormBody({
        To: phoneNumber,
        Channel: normalizedChannel,
      }),
      {
        headers: buildHeaders(),
        timeout: 10000,
      }
    );
    const data = response?.data || {};
    return {
      sid: data.sid || null,
      status: String(data.status || "pending").toLowerCase(),
      channel: normalizedChannel,
    };
  } catch (error) {
    throw parseProviderError(error, "Unable to send phone verification code.");
  }
};

export const confirmPhoneVerificationCode = async ({ phoneNumber, code }) => {
  ensureConfigured();

  if (!hasTwilioConfiguration() && canUseDevBypass()) {
    const candidate = String(code || "").trim();
    const expected = String(PHONE_VERIFICATION_DEV_CODE || "000000");
    const valid = Boolean(candidate && expected && candidate === expected);
    return {
      sid: `dev_check_${Date.now()}`,
      status: valid ? "approved" : "denied",
      valid,
      mode: "dev_bypass",
    };
  }

  try {
    const response = await axios.post(
      `${serviceUrl()}/VerificationCheck`,
      toFormBody({
        To: phoneNumber,
        Code: code,
      }),
      {
        headers: buildHeaders(),
        timeout: 10000,
      }
    );
    const data = response?.data || {};
    return {
      sid: data.sid || null,
      status: String(data.status || "").toLowerCase(),
      valid: String(data.status || "").toLowerCase() === "approved",
    };
  } catch (error) {
    throw parseProviderError(error, "Invalid verification code.");
  }
};
