// src/services/payoutProviders.js
// Provider adapter: test mode simulates payouts; Stripe integration for real payouts in test/live keys.

const isTestMode = String(process.env.PAYOUT_TEST_MODE || "true").toLowerCase() === "true";

let stripeClientPromise = null;
export const getStripeClient = async () => {
  const key =
    process.env.STRIPE_SECRET_TEST ||
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_SECRET ||
    null;
  if (!key) return null;
  if (stripeClientPromise) return stripeClientPromise;
  stripeClientPromise = import("stripe").then(({ default: Stripe }) => new Stripe(key, { apiVersion: "2024-06-20" }));
  return stripeClientPromise;
};

const payWithStripe = async ({ account, amount, currency }) => {
  const stripe = await getStripeClient();
  if (!stripe) throw new Error("Stripe secret key not configured");

  const connectedAccountId = account.external_customer_id || account.externalAccountId || account.external_account_id;
  const externalAccountId = account.external_account_id || account.externalAccountId;
  if (!connectedAccountId) {
    throw new Error("Missing Stripe connected account id (externalCustomerId)");
  }

  const cents = Math.max(0, Math.round(Number(amount || 0) * 100));
  if (!cents) throw new Error("Invalid amount for Stripe payout");

  // Create payout on the connected account; assumes the account has balance in test mode.
  const payout = await stripe.payouts.create(
    {
      amount: cents,
      currency: String(currency || "usd").toLowerCase(),
      description: "Host payout",
      ...(externalAccountId ? { destination: externalAccountId } : {}),
    },
    { stripeAccount: connectedAccountId }
  );

  const status = payout.status && payout.status.toUpperCase() === "PAID" ? "PAID" : "PROCESSING";
  const paidAt = payout.arrival_date ? new Date(payout.arrival_date * 1000) : null;
  return {
    status,
    providerPayoutId: payout.id,
    paidAt,
    raw: payout,
  };
};

export const sendPayout = async ({ provider, account, item, stay, amount }) => {
  const providerNorm = String(provider || "BANK").toUpperCase();

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
    });
  }

  throw new Error(`Provider ${providerNorm} not integrated. Enable PAYOUT_TEST_MODE=true for sandbox or configure provider.`);
};

export default {
  sendPayout,
  getStripeClient,
};
