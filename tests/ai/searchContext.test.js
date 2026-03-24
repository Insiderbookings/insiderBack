import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSearchContextKey,
  shouldResetSearchContextForNewDestination,
  resetDestinationScopedSearchState,
} from "../../src/modules/ai/ai.searchContext.js";

test("shouldResetSearchContextForNewDestination returns true when destination changes", () => {
  const shouldReset = shouldResetSearchContextForNewDestination({
    state: {
      destination: { name: "Buenos Aires" },
      searchPlan: {
        location: { city: "Buenos Aires", country: "Argentina" },
      },
    },
    nextPlan: {
      location: { city: "Dubai", country: "United Arab Emirates" },
      semanticSearch: {
        intentProfile: {
          inferenceMode: "NONE",
        },
      },
    },
  });

  assert.equal(shouldReset, true);
});

test("shouldResetSearchContextForNewDestination returns false when destination stays the same", () => {
  const shouldReset = shouldResetSearchContextForNewDestination({
    state: {
      destination: { name: "Buenos Aires" },
      searchPlan: {
        location: { city: "Buenos Aires", country: "Argentina" },
      },
    },
    nextPlan: {
      location: { city: "Buenos Aires", country: "Argentina" },
      semanticSearch: {
        intentProfile: {
          inferenceMode: "TRAIT_PROFILE",
          userRequestedAreaTraits: ["QUIET", "WALKABLE"],
        },
      },
    },
  });

  assert.equal(shouldReset, false);
});

test("resetDestinationScopedSearchState clears destination-bound search state and preserves unrelated state", () => {
  const reset = resetDestinationScopedSearchState({
    destination: { name: "Buenos Aires", lat: -34.6, lon: -58.4 },
    searchPlan: {
      location: { city: "Buenos Aires", country: "Argentina" },
    },
    lastShownInventorySummary: { hotels: [{ id: "1" }] },
    lastResultsContext: { shownIds: ["1"], searchContextKey: "old" },
    lastReferencedHotelIds: ["1"],
    lastSearchParams: { location: { city: "Buenos Aires" } },
    currentSearchContextKey: "old",
    tripContext: { destination: "keep" },
    locks: { bookingFlowLocked: false },
  });

  assert.deepEqual(reset.destination, { name: null, lat: null, lon: null });
  assert.deepEqual(reset.searchPlan, {});
  assert.equal(reset.lastShownInventorySummary, null);
  assert.equal(reset.lastResultsContext, null);
  assert.deepEqual(reset.lastReferencedHotelIds, []);
  assert.equal(reset.lastSearchParams, null);
  assert.equal(reset.currentSearchContextKey, null);
  assert.deepEqual(reset.tripContext, { destination: "keep" });
  assert.deepEqual(reset.locks, { bookingFlowLocked: false });
});

test("buildSearchContextKey includes destination and semantic signature", () => {
  const key = buildSearchContextKey({
    location: { city: "Buenos Aires", country: "Argentina" },
    areaIntent: "QUIET",
    semanticSearch: {
      intentProfile: {
        inferenceMode: "TRAIT_PROFILE",
        userRequestedAreaTraits: ["QUIET", "WALKABLE"],
      },
    },
  });

  const parsed = JSON.parse(key);
  assert.equal(parsed.destination, "buenos aires|argentina");
  assert.equal(parsed.semantic.inferenceMode, "TRAIT_PROFILE");
  assert.equal(parsed.semantic.requestedTraits, "QUIET,WALKABLE");
});
