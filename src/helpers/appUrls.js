const DEFAULT_INSIDER_CLIENT_URL = "https://insiderbookings.com";
const DEFAULT_BOOKINGGPT_CLIENT_URL = "https://bookinggpt.app";

const trimUrl = (value) => String(value || "").trim().replace(/\/+$/g, "");

const firstNonEmptyUrl = (...values) => {
  for (const value of values) {
    const normalized = trimUrl(value);
    if (normalized) return normalized;
  }
  return "";
};

const normalizePathSegments = (value) =>
  String(value || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

const appendRelativePath = (baseUrl, relativePath = "", extraParams = null) => {
  const url = new URL(trimUrl(baseUrl));
  const pathSegments = [
    ...normalizePathSegments(url.pathname),
    ...normalizePathSegments(relativePath),
  ];
  url.pathname = pathSegments.length ? `/${pathSegments.join("/")}` : "/";
  if (extraParams instanceof URLSearchParams) {
    extraParams.forEach((value, key) => {
      if (value == null) return;
      url.searchParams.set(key, String(value));
    });
  } else if (extraParams && typeof extraParams === "object") {
    Object.entries(extraParams).forEach(([key, value]) => {
      if (value == null) return;
      const normalized = String(value).trim();
      if (!normalized) return;
      url.searchParams.set(key, normalized);
    });
  }
  const pathname = url.pathname === "/" ? "" : url.pathname;
  return `${url.origin}${pathname}${url.search}${url.hash}`;
};

const resolveUrlHostname = (value) => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const isLocalHost = (host) =>
  host === "localhost" ||
  host === "127.0.0.1" ||
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

const matchesConfiguredHost = (host, baseUrl) => {
  const normalizedHost = String(host || "").trim().toLowerCase();
  if (!normalizedHost) return false;
  const configuredHost = resolveUrlHostname(baseUrl);
  if (!configuredHost) return false;
  return (
    normalizedHost === configuredHost ||
    normalizedHost.endsWith(`.${configuredHost}`)
  );
};

export const resolveInsiderClientUrl = () =>
  firstNonEmptyUrl(
    process.env.INSIDER_CLIENT_URL,
    process.env.CLIENT_URL,
    process.env.WEBAPP_URL,
    process.env.FRONTEND_URL,
  ) || DEFAULT_INSIDER_CLIENT_URL;

export const resolveBookingGptClientUrl = () =>
  firstNonEmptyUrl(process.env.BOOKINGGPT_CLIENT_URL) ||
  DEFAULT_BOOKINGGPT_CLIENT_URL;

export const resolvePartnerClientUrl = () =>
  firstNonEmptyUrl(process.env.PARTNERS_CLIENT_URL) ||
  appendRelativePath(resolveBookingGptClientUrl(), "partners");

export const resolveOperatorPanelUrl = () => {
  const explicit = firstNonEmptyUrl(process.env.OPERATOR_PANEL_URL);
  if (explicit) {
    return explicit.toLowerCase().endsWith("/operator")
      ? explicit
      : appendRelativePath(explicit, "operator");
  }
  return appendRelativePath(resolveInsiderClientUrl(), "operator");
};

export const resolveBookingInviteBaseUrl = () =>
  firstNonEmptyUrl(
    process.env.BOOKING_INVITE_APP_URL,
    process.env.APP_DEEPLINK_URL,
    process.env.MOBILE_APP_URL,
    process.env.APP_URL,
    process.env.BOOKINGGPT_CLIENT_URL,
  ) || DEFAULT_BOOKINGGPT_CLIENT_URL;

export const resolveHostIdentityReturnUrl = () =>
  firstNonEmptyUrl(
    process.env.HOST_IDENTITY_RETURN_URL,
    process.env.STRIPE_IDENTITY_RETURN_URL,
  ) || appendRelativePath(resolveBookingGptClientUrl(), "host-identity/complete");

export const resolveInfluencerIdentityReturnUrl = () =>
  firstNonEmptyUrl(
    process.env.INFLUENCER_IDENTITY_RETURN_URL,
    process.env.STRIPE_INFLUENCER_IDENTITY_RETURN_URL,
    process.env.STRIPE_IDENTITY_RETURN_URL,
  ) ||
  appendRelativePath(resolveBookingGptClientUrl(), "influencer-identity/complete");

export const isBookingGptHost = (host) => {
  const normalizedHost = String(host || "").trim().toLowerCase();
  if (!normalizedHost) return false;
  return (
    matchesConfiguredHost(normalizedHost, resolveBookingGptClientUrl()) ||
    matchesConfiguredHost(normalizedHost, resolvePartnerClientUrl()) ||
    (!process.env.BOOKINGGPT_CLIENT_URL &&
      (normalizedHost === "bookinggpt.app" ||
        normalizedHost.endsWith(".bookinggpt.app")))
  );
};

export const isInsiderHost = (host) => {
  const normalizedHost = String(host || "").trim().toLowerCase();
  if (!normalizedHost) return false;
  return (
    matchesConfiguredHost(normalizedHost, resolveInsiderClientUrl()) ||
    matchesConfiguredHost(normalizedHost, resolveOperatorPanelUrl()) ||
    (!process.env.INSIDER_CLIENT_URL &&
      !process.env.CLIENT_URL &&
      (normalizedHost === "insiderbookings.com" ||
        normalizedHost.endsWith(".insiderbookings.com")))
  );
};

export const resolvePayoutAudienceFromRequest = (req) => {
  const path = String(
    req?.originalUrl || req?.baseUrl || req?.path || "",
  ).toLowerCase();
  if (path.includes("/hosts/")) return "host";
  if (path.includes("/influencer/")) return "influencer";
  return "generic";
};

export const resolveStripeConnectDefaultUrls = ({ audience = "generic" } = {}) => {
  if (audience === "host") {
    return {
      refreshUrl:
        firstNonEmptyUrl(
          process.env.HOST_PAYOUT_REFRESH_URL,
          process.env.STRIPE_CONNECT_REFRESH_URL,
        ) || appendRelativePath(resolveBookingGptClientUrl(), "host/payouts"),
      returnUrl:
        firstNonEmptyUrl(
          process.env.HOST_PAYOUT_RETURN_URL,
          process.env.STRIPE_CONNECT_RETURN_URL,
        ) || appendRelativePath(resolveBookingGptClientUrl(), "host/payouts"),
    };
  }

  if (audience === "influencer") {
    return {
      refreshUrl:
        firstNonEmptyUrl(
          process.env.INFLUENCER_PAYOUT_REFRESH_URL,
          process.env.STRIPE_CONNECT_REFRESH_URL,
        ) ||
        appendRelativePath(resolveBookingGptClientUrl(), "influencer/payouts"),
      returnUrl:
        firstNonEmptyUrl(
          process.env.INFLUENCER_PAYOUT_RETURN_URL,
          process.env.STRIPE_CONNECT_RETURN_URL,
        ) ||
        appendRelativePath(resolveBookingGptClientUrl(), "influencer/payouts"),
    };
  }

  return {
    refreshUrl:
      firstNonEmptyUrl(process.env.STRIPE_CONNECT_REFRESH_URL) ||
      appendRelativePath(resolveBookingGptClientUrl(), "profile"),
    returnUrl:
      firstNonEmptyUrl(process.env.STRIPE_CONNECT_RETURN_URL) ||
      appendRelativePath(resolveBookingGptClientUrl(), "profile"),
  };
};

export const buildInsiderUrl = (relativePath = "", params = null) =>
  appendRelativePath(resolveInsiderClientUrl(), relativePath, params);

export const buildBookingGptUrl = (relativePath = "", params = null) =>
  appendRelativePath(resolveBookingGptClientUrl(), relativePath, params);

export const buildPartnerPortalUrl = (relativePath = "", params = null) =>
  appendRelativePath(resolvePartnerClientUrl(), relativePath, params);

export const buildOperatorPanelUrl = (params = null) =>
  appendRelativePath(resolveOperatorPanelUrl(), "", params);

export const buildBookingInviteUrl = (token) => {
  if (!token) return null;
  return appendRelativePath(resolveBookingInviteBaseUrl(), "booking-invite", {
    token,
  });
};

export const isAllowedBookingGptRedirectHost = (host) => {
  const normalizedHost = String(host || "").trim().toLowerCase();
  return isLocalHost(normalizedHost) || isBookingGptHost(normalizedHost);
};
