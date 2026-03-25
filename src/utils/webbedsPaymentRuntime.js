const toBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
  }
  return false;
};

export const normalizeDevicePayload = (payload) => {
  const text = String(payload || "").trim();
  return text || null;
};

export const resolveRequestIpForPreauth = (req) => {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return (
      forwarded
        .split(",")
        .map((value) => String(value || "").trim())
        .find(Boolean) || null
    );
  }
  if (Array.isArray(forwarded)) {
    return (
      forwarded
        .flatMap((value) => String(value || "").split(","))
        .map((value) => value.trim())
        .find(Boolean) || null
    );
  }
  return (
    req?.headers?.["x-real-ip"] ||
    req?.ip ||
    req?.socket?.remoteAddress ||
    req?.connection?.remoteAddress ||
    null
  );
};

export const resolveClientDevicePayloadForPreauth = (body = {}) => {
  const candidates = [
    body?.devicePayload,
    body?.payment?.devicePayload,
    body?.paymentContext?.devicePayload,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDevicePayload(candidate);
    if (normalized) return normalized;
  }
  return null;
};

export const resolveClientIpOverrideForPreauth = (body = {}) => {
  const candidates = [
    body?.endUserIPAddress,
    body?.endUserIPv4Address,
    body?.payment?.endUserIPAddress,
    body?.payment?.endUserIPv4Address,
    body?.paymentContext?.endUserIPAddress,
    body?.paymentContext?.endUserIPv4Address,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) return normalized;
  }
  return null;
};

const resolvePaymentContextMode = (env = process.env) =>
  String(env.WEBBEDS_PAYMENT_CONTEXT_MODE || "guest")
    .trim()
    .toLowerCase();

const resolvePaymentDevMode = (env = process.env) => toBoolean(env.WEBBEDS_PAYMENT_DEV);

export const resolvePreauthPaymentRuntime = async ({
  body = {},
  req,
  env = process.env,
  getMerchantPaymentContext = async () => null,
} = {}) => {
  const envPayload = normalizeDevicePayload(env.WEBBEDS_DEVICE_PAYLOAD);
  const envIp = String(env.WEBBEDS_DEFAULT_IP || "").trim() || null;

  if (resolvePaymentDevMode(env)) {
    if (!envPayload) {
      throw Object.assign(
        new Error("WEBBEDS_PAYMENT_DEV requires WEBBEDS_DEVICE_PAYLOAD."),
        { status: 503, code: "MISSING_WEBBEDS_DEVICE_PAYLOAD" },
      );
    }
    if (!envIp) {
      throw Object.assign(
        new Error("WEBBEDS_PAYMENT_DEV requires WEBBEDS_DEFAULT_IP."),
        { status: 503, code: "MISSING_WEBBEDS_DEFAULT_IP" },
      );
    }

    return {
      devicePayload: envPayload,
      devicePayloadSource: "dev-env",
      endUserIPAddress: envIp,
      endUserIPAddressSource: "dev-env",
    };
  }

  const requestPayload = resolveClientDevicePayloadForPreauth(body);
  const requestIp = resolveRequestIpForPreauth(req);
  const clientIpOverride = resolveClientIpOverrideForPreauth(body);

  if (resolvePaymentContextMode(env) === "merchant") {
    const merchantContext = await getMerchantPaymentContext();
    const merchantPayload = normalizeDevicePayload(merchantContext?.devicePayload);
    const merchantIp =
      String(env.WEBBEDS_MERCHANT_PUBLIC_IP || "").trim() ||
      String(env.WEBBEDS_DEFAULT_IP || "").trim() ||
      null;

    if (!merchantPayload && !envPayload) {
      throw Object.assign(
        new Error(
          "Missing merchant device payload. Capture one in /ops/webbeds-payment-context or set WEBBEDS_DEVICE_PAYLOAD.",
        ),
        { status: 503, code: "MISSING_MERCHANT_DEVICE_PAYLOAD" },
      );
    }
    if (!merchantIp) {
      throw Object.assign(
        new Error("Missing merchant public IP. Set WEBBEDS_MERCHANT_PUBLIC_IP for merchant mode."),
        { status: 503, code: "MISSING_MERCHANT_PUBLIC_IP" },
      );
    }

    return {
      devicePayload: merchantPayload || envPayload,
      devicePayloadSource: merchantPayload
        ? "merchant-cache"
        : envPayload
          ? "merchant-env"
          : "missing",
      endUserIPAddress: merchantIp,
      endUserIPAddressSource: "merchant-env",
    };
  }

  return {
    devicePayload: requestPayload || envPayload || "static-device",
    devicePayloadSource: requestPayload
      ? "request"
      : envPayload
        ? "env"
        : "fallback",
    endUserIPAddress: clientIpOverride || requestIp || envIp || "127.0.0.1",
    endUserIPAddressSource: clientIpOverride
      ? "request.override"
      : requestIp
        ? "request"
        : envIp
          ? "env"
          : "fallback",
  };
};
