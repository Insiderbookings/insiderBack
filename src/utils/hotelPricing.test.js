import assert from "node:assert/strict";

import {
  decorateHotelPricingForDisplay,
  resolveHotelCanonicalDisplayAmount,
  resolveHotelCanonicalPricing,
  resolveHotelCanonicalPricingFromObject,
  resolveHotelMarkupRate,
  resolveHotelPricingRole,
  resolveHotelPricingTier,
  resolveHotelStayNights,
} from "./hotelPricing.js";

const tests = [
  {
    name: "hotel pricing tier resolves from user entitlement",
    run: () => {
      assert.equal(resolveHotelPricingTier({ role: 100 }), "ADMIN");
      assert.equal(resolveHotelPricingTier({ role: "100" }), "ADMIN");
      assert.equal(resolveHotelPricingTier({ role: 10 }), "TRAVEL_AGENT");
      assert.equal(resolveHotelPricingTier({ role: "10" }), "TRAVEL_AGENT");
      assert.equal(resolveHotelPricingTier({ hotel_pricing_tier: "TRAVEL_AGENT" }), "TRAVEL_AGENT");
      assert.equal(resolveHotelPricingRole({ role: 100 }), 100);
      assert.equal(resolveHotelPricingRole({ role: 10 }), 10);
      assert.equal(resolveHotelPricingRole({ hotel_pricing_tier: "TRAVEL_AGENT" }), 10);
      assert.equal(resolveHotelPricingRole({ role: 5 }), 20);
      assert.equal(resolveHotelPricingRole(null), 20);
    },
  },
  {
    name: "hotel markup is fixed for standard and travel agent users",
    run: () => {
      assert.equal(resolveHotelMarkupRate({ providerAmount: 99.99 }), 0.2);
      assert.equal(resolveHotelMarkupRate({ providerAmount: 100 }), 0.2);
      assert.equal(resolveHotelMarkupRate({ providerAmount: 300 }), 0.2);
      assert.equal(resolveHotelMarkupRate({ providerAmount: 300.01 }), 0.2);
      assert.equal(resolveHotelMarkupRate({ providerAmount: 300.01, user: { role: 10 } }), 0.1);
      assert.equal(
        resolveHotelMarkupRate({ providerAmount: 300.01, user: { hotel_pricing_tier: "TRAVEL_AGENT" } }),
        0.1,
      );
      assert.equal(resolveHotelMarkupRate({ providerAmount: 300.01, user: { role: 100 } }), 0);
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
      assert.equal(pricing.publicMarkupRate, 0.2);
      assert.equal(pricing.publicMarkupAmount, 16);
      assert.equal(pricing.publicMarkedAmount, 96);
      assert.equal(pricing.minimumSelling, 150);
      assert.equal(pricing.effectiveAmount, 150);
    },
  },
  {
    name: "travel agents see the fixed 10 percent markup",
    run: () => {
      const pricing = resolveHotelCanonicalPricing({
        providerAmount: 200,
        minimumSelling: 0,
        user: { hotel_pricing_tier: "TRAVEL_AGENT" },
      });

      assert.equal(pricing.providerAmount, 200);
      assert.equal(pricing.publicMarkupRate, 0.1);
      assert.equal(pricing.publicMarkupAmount, 20);
      assert.equal(pricing.publicMarkedAmount, 220);
      assert.equal(pricing.effectiveAmount, 220);
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
      assert.equal(pricing.publicMarkedAmount, 108);
      assert.equal(pricing.minimumSelling, 120);
      assert.equal(pricing.effectiveAmount, 120);
      assert.equal(
        resolveHotelCanonicalDisplayAmount({
          publicMarkedAmount: 108,
          minimumSelling: 120,
        }),
        120
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
    name: "stay nights resolve from explicit value or date range",
    run: () => {
      assert.equal(resolveHotelStayNights({ stayNights: 3 }), 3);
      assert.equal(
        resolveHotelStayNights({
          checkIn: "2026-04-27",
          checkOut: "2026-04-29",
        }),
        2,
      );
      assert.equal(resolveHotelStayNights({}), 1);
    },
  },
  {
    name: "display pricing decoration keeps total canonical and nightly derived",
    run: () => {
      const decorated = decorateHotelPricingForDisplay(
        {
          id: "hotel-1",
          currency: "USD",
          hotelDetails: { hotelCode: "hotel-1" },
        },
        {
          providerAmount: 200,
          pricingRole: 20,
          stayNights: 2,
        },
      );

      assert.equal(decorated.providerAmount, 200);
      assert.equal(decorated.publicMarkupRate, 0.2);
      assert.equal(decorated.publicMarkedAmount, 240);
      assert.equal(decorated.effectiveAmount, 240);
      assert.equal(decorated.bestPrice, 240);
      assert.equal(decorated.pricePerNight, 120);
      assert.equal(decorated.nightlyPrice, 120);
      assert.equal(decorated.stayNights, 2);
      assert.equal(decorated.hotelDetails.bestPrice, 240);
      assert.equal(decorated.hotelDetails.pricePerNight, 120);
    },
  },
  {
    name: "display pricing decoration respects admin net pricing and minimum selling",
    run: () => {
      const decorated = decorateHotelPricingForDisplay(
        {
          id: "hotel-2",
          currency: "USD",
        },
        {
          providerAmount: 123.45,
          minimumSelling: 150,
          pricingRole: 100,
          stayNights: 1,
        },
      );

      assert.equal(decorated.providerAmount, 123.45);
      assert.equal(decorated.publicMarkupRate, 0);
      assert.equal(decorated.publicMarkedAmount, 123.45);
      assert.equal(decorated.effectiveAmount, 150);
      assert.equal(decorated.bestPrice, 150);
      assert.equal(decorated.pricePerNight, 150);
      assert.equal(decorated.stayNights, 1);
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
