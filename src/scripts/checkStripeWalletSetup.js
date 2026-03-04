import "dotenv/config";
import Stripe from "stripe";

const normalizeHost = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\$\{[^}]+\}/g, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");

const parseCsvHosts = (value) =>
  String(value || "")
    .split(",")
    .map((item) => normalizeHost(item))
    .filter(Boolean);

const collectExpectedHosts = () => {
  const hosts = new Set();
  const addFromUrl = (value) => {
    const host = normalizeHost(value);
    if (host) hosts.add(host);
  };

  addFromUrl(process.env.CLIENT_URL);
  addFromUrl(process.env.FRONTEND_URL);
  addFromUrl(process.env.WEBAPP_URL);
  addFromUrl(process.env.CORS_ORIGIN);
  parseCsvHosts(process.env.CORS_ALLOWED_ORIGINS).forEach((host) => hosts.add(host));
  return Array.from(hosts);
};

const isLocalLikeHost = (host) =>
  host === "localhost" ||
  host === "127.0.0.1" ||
  host.startsWith("192.168.") ||
  host.startsWith("10.") ||
  host.startsWith("172.");

const readNested = (obj, path = []) =>
  path.reduce((acc, key) => (acc == null ? null : acc[key]), obj);

const readMethodPreference = (configuration, method) => {
  const paths = [
    [method, "display_preference", "preference"],
    [method, "display_preference", "value"],
    [method, "display_preference"],
    ["display_preference", method, "preference"],
    ["display_preference", method, "value"],
    ["display_preference", method],
    [method, "enabled"],
    [method, "available"],
  ];
  for (const path of paths) {
    const value = readNested(configuration, path);
    if (value === null || value === undefined || value === "") continue;
    return value;
  }
  return "unknown";
};

const choosePrimaryConfiguration = (configurations = []) =>
  configurations.find((item) => item?.is_default) ||
  configurations.find((item) => item?.active) ||
  configurations[0] ||
  null;

const main = async () => {
  const stripeSecretKey =
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_SECRET_TEST ||
    process.env.STRIPE_SECRET_KEY_TEST ||
    "";
  if (!stripeSecretKey) {
    console.error("[stripe-wallet-check] missing STRIPE_SECRET_KEY");
    process.exit(1);
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2022-11-15" });
  const expectedHosts = collectExpectedHosts();

  try {
    const [account, domainsResp, configResp] = await Promise.all([
      stripe.accounts.retrieve(),
      stripe.paymentMethodDomains.list({ limit: 100 }),
      stripe.paymentMethodConfigurations.list({ limit: 25 }),
    ]);

    const configurations = Array.isArray(configResp?.data) ? configResp.data : [];
    const primaryConfiguration = choosePrimaryConfiguration(configurations);
    const domains = Array.isArray(domainsResp?.data) ? domainsResp.data : [];
    const domainByHost = new Map(
      domains.map((domain) => [normalizeHost(domain?.domain_name), domain])
    );

    const methods = ["card", "paypal", "google_pay", "apple_pay"].map((method) => ({
      method,
      preference: readMethodPreference(primaryConfiguration, method),
    }));

    const expectedDomainChecks = expectedHosts.map((host) => {
      const domain = domainByHost.get(host) || null;
      return {
        host,
        required: !isLocalLikeHost(host),
        found: Boolean(domain),
        enabled: domain?.enabled ?? false,
        applePayStatus:
          domain?.apple_pay?.status ??
          domain?.apple_pay?.state ??
          domain?.apple_pay ??
          "unknown",
      };
    });

    const blockers = [];
    if (!primaryConfiguration) {
      blockers.push("No Stripe payment method configuration found.");
    }
    const warnings = [];
    expectedDomainChecks.forEach((check) => {
      if (!check.found && check.required) {
        blockers.push(`Missing payment method domain: ${check.host}`);
      }
      if (!check.found && !check.required) {
        warnings.push(`Optional local domain not found: ${check.host}`);
      }
      if (check.found && !check.enabled) {
        blockers.push(`Payment method domain disabled: ${check.host}`);
      }
    });

    const preferenceByMethod = Object.fromEntries(
      methods.map((entry) => [entry.method, String(entry.preference || "").toLowerCase()])
    );
    const isMethodOff = (method) => {
      const value = preferenceByMethod[method];
      return value === "off" || value === "disabled" || value === "false";
    };
    if (isMethodOff("paypal")) blockers.push("PayPal is disabled in Stripe configuration.");
    if (isMethodOff("google_pay")) blockers.push("Google Pay is disabled in Stripe configuration.");
    if (isMethodOff("apple_pay")) blockers.push("Apple Pay is disabled in Stripe configuration.");

    const summary = {
      accountId: account?.id || null,
      livemode: Boolean(account?.livemode),
      capabilities: account?.capabilities || {},
      expectedHosts,
      domainsFound: domains.length,
      configurationId: primaryConfiguration?.id || null,
      methods,
      expectedDomainChecks,
      blockers,
      warnings,
    };

    console.log("[stripe-wallet-check] summary");
    console.log(JSON.stringify(summary, null, 2));

    if (blockers.length) {
      process.exit(1);
    }
    process.exit(0);
  } catch (error) {
    console.error("[stripe-wallet-check] failed:", error?.message || error);
    process.exit(1);
  }
};

main();
