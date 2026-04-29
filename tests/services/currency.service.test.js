import test from "node:test";
import assert from "node:assert/strict";

import models from "../../src/models/index.js";
import cache from "../../src/services/cache.js";
import { getExchangeRateMeta } from "../../src/services/currency.service.js";

test("getExchangeRateMeta falls back when the fx lookup cannot reach the database", async (t) => {
  const cacheKey = "currency:rate-meta:USD:EUR:apilayer";
  await cache.del(cacheKey);

  const originalFindOne = models.FxRate.findOne;
  let calls = 0;
  models.FxRate.findOne = async () => {
    calls += 1;
    throw new Error("db unavailable");
  };

  t.after(async () => {
    models.FxRate.findOne = originalFindOne;
    await cache.del(cacheKey);
  });

  const meta = await getExchangeRateMeta("EUR");

  assert.equal(calls, 1);
  assert.equal(meta.source, "fallback");
  assert.equal(meta.missing, true);
  assert.equal(meta.currency, "EUR");
  assert.equal(meta.rate, 0.95);
});
