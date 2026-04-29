import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBookingGptUrl,
  buildBookingInviteUrl,
  buildInsiderUrl,
  buildPartnerPortalUrl,
  resolveOperatorPanelUrl,
  resolvePayoutAudienceFromRequest,
  resolveStripeConnectDefaultUrls,
} from "../../src/helpers/appUrls.js";

const withEnv = async (overrides, run) => {
  const previous = new Map();
  Object.keys(overrides).forEach((key) => {
    previous.set(key, process.env[key]);
    const nextValue = overrides[key];
    if (nextValue == null) {
      delete process.env[key];
      return;
    }
    process.env[key] = String(nextValue);
  });
  try {
    await run();
  } finally {
    previous.forEach((value, key) => {
      if (value == null) {
        delete process.env[key];
        return;
      }
      process.env[key] = value;
    });
  }
};

test("maps insider and BookingGPT user flows to separate domains", async () => {
  await withEnv(
    {
      CLIENT_URL: "https://insiderbookings.com",
      BOOKINGGPT_CLIENT_URL: "https://bookinggpt.app",
      PARTNERS_CLIENT_URL: null,
      OPERATOR_PANEL_URL: null,
    },
    async () => {
      assert.equal(
        buildInsiderUrl("set-password", { token: "abc", mode: "reset" }),
        "https://insiderbookings.com/set-password?token=abc&mode=reset",
      );
      assert.equal(
        buildInsiderUrl("complete-info"),
        "https://insiderbookings.com/complete-info",
      );
      assert.equal(
        buildBookingGptUrl("host"),
        "https://bookinggpt.app/host",
      );
      assert.equal(
        buildBookingGptUrl("hotels/335115", { autoCheckRates: "1" }),
        "https://bookinggpt.app/hotels/335115?autoCheckRates=1",
      );
      assert.equal(
        buildPartnerPortalUrl("dashboard", { hotelId: "335115" }),
        "https://bookinggpt.app/partners/dashboard?hotelId=335115",
      );
      assert.equal(
        resolveOperatorPanelUrl(),
        "https://insiderbookings.com/operator",
      );
    },
  );
});

test("respects explicit partner and invite overrides without mixing audiences", async () => {
  await withEnv(
    {
      CLIENT_URL: "https://insiderbookings.com",
      BOOKINGGPT_CLIENT_URL: "https://bookinggpt.app",
      PARTNERS_CLIENT_URL: "https://partners.bookinggpt.app/partners",
      BOOKING_INVITE_APP_URL: "https://app.bookinggpt.app",
    },
    async () => {
      assert.equal(
        buildPartnerPortalUrl("dashboard", { hotelId: "9" }),
        "https://partners.bookinggpt.app/partners/dashboard?hotelId=9",
      );
      assert.equal(
        buildBookingInviteUrl("tok_123"),
        "https://app.bookinggpt.app/booking-invite?token=tok_123",
      );
    },
  );
});

test("derives stripe connect defaults from the payout audience", async () => {
  await withEnv(
    {
      BOOKINGGPT_CLIENT_URL: "https://bookinggpt.app",
      STRIPE_CONNECT_RETURN_URL: null,
      STRIPE_CONNECT_REFRESH_URL: null,
      HOST_PAYOUT_RETURN_URL: null,
      HOST_PAYOUT_REFRESH_URL: null,
      INFLUENCER_PAYOUT_RETURN_URL: null,
      INFLUENCER_PAYOUT_REFRESH_URL: null,
    },
    async () => {
      assert.equal(
        resolvePayoutAudienceFromRequest({
          originalUrl: "/api/hosts/payout-account/stripe/link",
        }),
        "host",
      );
      assert.equal(
        resolvePayoutAudienceFromRequest({
          originalUrl: "/api/users/me/influencer/payout-account/stripe/link",
        }),
        "influencer",
      );
      assert.deepEqual(resolveStripeConnectDefaultUrls({ audience: "host" }), {
        returnUrl: "https://bookinggpt.app/host/payouts",
        refreshUrl: "https://bookinggpt.app/host/payouts",
      });
      assert.deepEqual(
        resolveStripeConnectDefaultUrls({ audience: "influencer" }),
        {
          returnUrl: "https://bookinggpt.app/influencer/payouts",
          refreshUrl: "https://bookinggpt.app/influencer/payouts",
        },
      );
      assert.deepEqual(resolveStripeConnectDefaultUrls({ audience: "generic" }), {
        returnUrl: "https://bookinggpt.app/profile",
        refreshUrl: "https://bookinggpt.app/profile",
      });
    },
  );
});
