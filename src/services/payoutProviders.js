// src/services/payoutProviders.js
// Provider adapter: test mode simulates payouts; Stripe integration for real payouts in test/live keys.

const isProduction = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

const resolveTestMode = () => {
  const raw = String(process.env.PAYOUT_TEST_MODE || "").trim().toLowerCase();
  if (!raw) return !isProduction;
  return raw === "true";
};

const isTestMode = resolveTestMode();
const allowTestModeInProduction =
  String(process.env.ALLOW_PAYOUT_TEST_MODE_IN_PRODUCTION || "false").trim().toLowerCase() === "true";

const assertRuntimeModeSafety = () => {
  if (isProduction && isTestMode && !allowTestModeInProduction) {
    throw new Error("PAYOUT_TEST_MODE=true is not allowed in production");
  }
};

const resolveStripeSecretKey = () => {
  // In production we fail closed if live key is missing, instead of silently using test keys.
  if (isProduction) return process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || null;
  return process.env.STRIPE_SECRET_TEST || process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || null;
};

let stripeClientPromise = null;
export const getStripeClient = async () => {
  assertRuntimeModeSafety();
  const key = resolveStripeSecretKey();
  if (!key) return null;
  if (isProduction && /^sk_test_/i.test(String(key))) {
    throw new Error("Stripe test secret key is not allowed in production");
  }
  if (stripeClientPromise) return stripeClientPromise;
  stripeClientPromise = import("stripe").then(({ default: Stripe }) => new Stripe(key, { apiVersion: "2024-06-20" }));
  return stripeClientPromise;
};

const payWithStripe = async ({ account, amount, currency, metadata, idempotencyKey }) => {
  const stripe = await getStripeClient();
  if (!stripe) throw new Error("Stripe secret key not configured");

  const connectedAccountId = account.external_customer_id || account.externalAccountId || account.external_account_id;
  if (!connectedAccountId) {
    throw new Error("Missing Stripe connected account id (externalCustomerId)");
  }

  const cents = Math.max(0, Math.round(Number(amount || 0) * 100));
  if (!cents) throw new Error("Invalid amount for Stripe payout");

  const transferPayload = {
    amount: cents,
    currency: String(currency || "usd").toLowerCase(),
    destination: connectedAccountId,
    description: "Host payout",
    metadata: metadata || undefined,
  };
  const transferOptions = idempotencyKey ? { idempotencyKey: String(idempotencyKey) } : undefined;
  const transfer = await stripe.transfers.create(transferPayload, transferOptions);

  const status = transfer.reversed ? "FAILED" : "PROCESSING";
  return {
    status,
    providerPayoutId: transfer.id,
    paidAt: null,
    raw: transfer,
  };
};

const payWithPayoneer = async ({ account }) => {
  const payeeId = account.external_account_id || account.externalAccountId || account.external_customer_id;
  if (!payeeId) {
    throw new Error("Missing Payoneer payee id (externalAccountId)");
  }
  throw new Error("Payoneer payouts not configured. Set up Payoneer API credentials and implementation.");
};

export const sendPayout = async ({ provider, account, item, stay, amount, idempotencyKey }) => {
  const providerNorm = String(provider || "BANK").toUpperCase();
  assertRuntimeModeSafety();

  if (isTestMode) {
    // Simulate a payout in test mode
    const now = new Date();
    return {
      status: "PAID",
      providerPayoutId: `test_${providerNorm}_${item.id}`,
      paidAt: now,
      raw: { mode: "test", provider: providerNorm },
    };
  }

  if (providerNorm === "STRIPE") {
    return payWithStripe({
      account,
      amount,
      currency: stay?.currency || item?.currency || "USD",
      metadata: {
        payoutItemId: String(item?.id || ""),
        stayId: String(stay?.id || item?.stay_id || ""),
        hostId: String(account?.user_id || ""),
      },
      idempotencyKey,
    });
  }

  if (providerNorm === "PAYONEER") {
    return payWithPayoneer({ account, amount, item, stay });
  }

  throw new Error(`Provider ${providerNorm} not integrated. Enable PAYOUT_TEST_MODE=true for sandbox or configure provider.`);
};

export default {
  sendPayout,
  getStripeClient,
};
