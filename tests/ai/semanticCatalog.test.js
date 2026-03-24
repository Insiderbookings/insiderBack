import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSemanticIntentProfile,
  resolveSemanticCatalogContext,
} from "../../src/modules/ai/ai.semanticCatalog.js";

test("buildSemanticIntentProfile maps buena zona into enterprise area traits", () => {
  const profile = buildSemanticIntentProfile({
    plan: {
      location: { city: "Buenos Aires", country: "Argentina" },
      areaIntent: "GOOD_AREA",
    },
    latestUserMessage: "quiero un hotel en una buena zona",
  });

  assert.equal(profile.confidence, "MEDIUM");
  assert.equal(profile.fallbackMode, "EXPAND_WITH_NOTICE");
  assert.equal(profile.inferenceMode, "TRAIT_PROFILE");
  assert.deepEqual(profile.userRequestedZones, []);
  assert.deepEqual(profile.userRequestedLandmarks, []);
  assert.deepEqual(
    profile.userRequestedAreaTraits.sort(),
    ["SAFE", "UPSCALE_AREA", "WALKABLE"].sort(),
  );
  assert.ok(Array.isArray(profile.candidateZones));
});

test("buildSemanticIntentProfile resolves curated zones from explicit place targets", () => {
  const profile = buildSemanticIntentProfile({
    plan: {
      location: { city: "Buenos Aires", country: "Argentina" },
      geoIntent: "NEAR_AREA",
      placeTargets: [
        {
          rawText: "Recoleta",
          normalizedName: "Recoleta",
          type: "NEIGHBORHOOD",
        },
      ],
    },
    latestUserMessage: "quiero un hotel cerca de recoleta",
  });

  assert.equal(profile.confidence, "HIGH");
  assert.equal(profile.inferenceMode, "EXPLICIT_GEO");
  assert.deepEqual(profile.userRequestedZones, ["ba-recoleta"]);
  assert.deepEqual(profile.userRequestedLandmarks, []);
  assert.deepEqual(profile.requestedZones, ["ba-recoleta"]);
  assert.deepEqual(profile.requestedLandmarks, []);
});

test("resolveSemanticCatalogContext promotes curated candidate zones from requested traits", () => {
  const context = resolveSemanticCatalogContext({
    plan: {
      location: { city: "Buenos Aires", country: "Argentina" },
      areaIntent: "GOOD_AREA",
      semanticSearch: {
        intentProfile: {
          userRequestedAreaTraits: ["SAFE", "WALKABLE", "UPSCALE_AREA"],
          requestedAreaTraits: ["SAFE", "WALKABLE", "UPSCALE_AREA"],
          requestedZones: [],
          requestedLandmarks: [],
          confidence: "MEDIUM",
          fallbackMode: "EXPAND_WITH_NOTICE",
          inferenceMode: "TRAIT_PROFILE",
        },
      },
    },
  });

  assert.equal(context.cityCatalog?.city, "Buenos Aires");
  assert.ok(Array.isArray(context.candidateZones));
  assert.ok(
    context.candidateZones.some((zone) => zone.id === "ba-recoleta"),
    "expected Recoleta to be one of the curated candidate zones",
  );
  assert.ok(
    context.candidateZones.some((zone) => zone.id === "ba-puerto-madero"),
    "expected Puerto Madero to be one of the curated candidate zones",
  );
});

test("buildSemanticIntentProfile keeps locked trait-only intent canonical", () => {
  const profile = buildSemanticIntentProfile({
    plan: {
      location: { city: "Buenos Aires", country: "Argentina" },
      areaIntent: "GOOD_AREA",
      areaTraits: ["QUIET", "WALKABLE", "SAFE", "UPSCALE_AREA"],
      semanticSearch: {
        userIntentLock: {
          userRequestedAreaTraits: ["QUIET", "WALKABLE"],
          userRequestedZones: [],
          userRequestedLandmarks: [],
          inferenceMode: "TRAIT_PROFILE",
        },
      },
    },
    latestUserMessage: "quiero un hotel tranquilo y caminable en buenos aires",
  });

  assert.deepEqual(
    profile.userRequestedAreaTraits.sort(),
    ["QUIET", "WALKABLE"].sort(),
  );
  assert.ok(!profile.userRequestedAreaTraits.includes("SAFE"));
  assert.ok(!profile.userRequestedAreaTraits.includes("UPSCALE_AREA"));
  assert.equal(profile.inferenceMode, "TRAIT_PROFILE");
  assert.ok(
    profile.candidateZones.includes("ba-belgrano"),
    "expected Belgrano to remain a candidate zone for quiet + walkable",
  );
});
