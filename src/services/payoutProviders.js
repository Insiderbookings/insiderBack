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

const payWithStripe = async ({ account, amount, currency, metadata }) => {
  const stripe = await getStripeClient();
  if (!stripe) throw new Error("Stripe secret key not configured");

  const connectedAccountId = account.external_customer_id || account.externalAccountId || account.external_account_id;
  if (!connectedAccountId) {
    throw new Error("Missing Stripe connected account id (externalCustomerId)");
  }

  const cents = Math.max(0, Math.round(Number(amount || 0) * 100));
  if (!cents) throw new Error("Invalid amount for Stripe payout");

  const transfer = await stripe.transfers.create({
    amount: cents,
    currency: String(currency || "usd").toLowerCase(),
    destination: connectedAccountId,
    description: "Host payout",
    metadata: metadata || undefined,
  });

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
      metadata: {
        payoutItemId: String(item?.id || ""),
        stayId: String(stay?.id || item?.stay_id || ""),
        hostId: String(account?.user_id || ""),
      },
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
