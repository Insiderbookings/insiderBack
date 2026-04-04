import assert from "node:assert/strict";

import {
  resolveHotelCanonicalDisplayAmount,
  resolveHotelCanonicalPricing,
  resolveHotelCanonicalPricingFromObject,
  resolveHotelMarkupRate,
  resolveHotelPricingRole,
} from "./hotelPricing.js";

const tests = [
  {
    name: "hotel pricing role only bypasses net rate for admin",
    run: () => {
      assert.equal(resolveHotelPricingRole({ role: 100 }), 100);
      assert.equal(resolveHotelPricingRole({ role: "100" }), 100);
      assert.equal(resolveHotelPricingRole({ role: 5 }), 0);
      assert.equal(resolveHotelPricingRole(null), 0);
    },
  },
  {
    name: "hotel markup tiers stay stable",
    run: () => {
      assert.equal(resolveHotelMarkupRate({ providerAmount: 99.99 }), 0.5);
      assert.equal(resolveHotelMarkupRate({ providerAmount: 100 }), 0.4);
      assert.equal(resolveHotelMarkupRate({ providerAmount: 300 }), 0.4);
      assert.equal(resolveHotelMarkupRate({ providerAmount: 300.01 }), 0.3);
    },
  },
  {
    name: "canonical hotel pricing keeps provider, markup and effective values separate",
    run: () => {
      const pricing = resolveHotelCanonicalPricing({
        providerAmount: 80,
        minimumSelling: 150,
        user: { role: 0 },
      });

      assert.equal(pricing.providerAmount, 80);
      assert.equal(pricing.publicMarkupRate, 0.5);
      assert.equal(pricing.publicMarkupAmount, 40);
      assert.equal(pricing.publicMarkedAmount, 120);
      assert.equal(pricing.minimumSelling, 150);
      assert.equal(pricing.effectiveAmount, 150);
    },
  },
  {
    name: "admin hotel pricing stays net",
    run: () => {
      const pricing = resolveHotelCanonicalPricing({
        providerAmount: 123.45,
        minimumSelling: 150,
        user: { role: 100 },
      });

      assert.equal(pricing.providerAmount, 123.45);
      assert.equal(pricing.publicMarkupRate, 0);
      assert.equal(pricing.publicMarkupAmount, 0);
      assert.equal(pricing.publicMarkedAmount, 123.45);
      assert.equal(pricing.effectiveAmount, 150);
    },
  },
  {
    name: "canonical pricing can be resolved from rate objects",
    run: () => {
      const pricing = resolveHotelCanonicalPricingFromObject({
        bestPrice: "$90.00",
        minimumSellingFormatted: "$120.00",
      });

      assert.equal(pricing.providerAmount, 90);
      assert.equal(pricing.publicMarkedAmount, 135);
      assert.equal(pricing.minimumSelling, 120);
      assert.equal(pricing.effectiveAmount, 135);
      assert.equal(
        resolveHotelCanonicalDisplayAmount({
          publicMarkedAmount: 135,
          minimumSelling: 120,
        }),
        135
      );
    },
  },
  {
    name: "canonical display amount prefers backend-resolved fields when present",
    run: () => {
      assert.equal(
        resolveHotelCanonicalDisplayAmount({
          minimumSelling: 150,
        }),
        null
      );
      assert.equal(
        resolveHotelCanonicalDisplayAmount({
          effectiveAmount: 155,
          publicMarkedAmount: 135,
          minimumSelling: 120,
        }),
        155
      );
      assert.equal(
        resolveHotelCanonicalDisplayAmount({
          publicMarkedAmount: 135,
          minimumSelling: 150,
        }),
        150
      );
    },
  },
  {
    name: "invalid amounts stay neutral",
    run: () => {
      const pricing = resolveHotelCanonicalPricing({
        providerAmount: "not-a-number",
        minimumSelling: null,
        user: { role: 0 },
      });

      assert.equal(pricing.providerAmount, null);
      assert.equal(pricing.publicMarkedAmount, null);
      assert.equal(pricing.effectiveAmount, null);
    },
  },
];

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exitCode = 1;
  console.error(`hotelPricing.test.js failed with ${failures} error${failures === 1 ? "" : "s"}`);
}
