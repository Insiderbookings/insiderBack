import test from "node:test";
import assert from "node:assert/strict";

import { buildPlanFromToolArgs } from "../../src/modules/ai/ai.tools.js";
import { resolvePlaceReference } from "../../src/modules/ai/tools/tool.places.js";

test("resolvePlaceReference asks for clarification for Buenos Aires airport", async () => {
  const resolution = await resolvePlaceReference({
    query: "aeropuerto",
    city: "Buenos Aires",
    country: "Argentina",
    place_type_hint: "AIRPORT",
    language: "es",
  });

  assert.equal(resolution?.status, "AMBIGUOUS");
  assert.equal(resolution?.confidence, "MEDIUM");
  assert.equal(resolution?.resolved_place, null);
  assert.ok(Array.isArray(resolution?.candidates));
  assert.deepEqual(
    resolution.candidates.map((candidate) => candidate.id),
    ["ba-airport-aep", "ba-airport-eze"],
  );
  assert.match(
    String(resolution?.clarification_question || "").toLowerCase(),
    /aeropuerto/,
  );
  resolution.candidates.forEach((candidate) => {
    assert.notEqual(candidate.lat, 0);
    assert.notEqual(candidate.lng, 0);
    assert.ok(Number.isFinite(Number(candidate.lat)));
    assert.ok(Number.isFinite(Number(candidate.lng)));
  });
});

test("resolvePlaceReference resolves Aeroparque directly", async () => {
  const resolution = await resolvePlaceReference({
    query: "Aeroparque",
    city: "Buenos Aires",
    country: "Argentina",
    place_type_hint: "AIRPORT",
    language: "es",
  });

  assert.equal(resolution?.status, "RESOLVED");
  assert.equal(resolution?.confidence, "HIGH");
  assert.equal(resolution?.resolved_place?.id, "ba-airport-aep");
  assert.ok(Number.isFinite(Number(resolution?.resolved_place?.lat)));
  assert.ok(Number.isFinite(Number(resolution?.resolved_place?.lng)));
  assert.notEqual(Number(resolution?.resolved_place?.lat), 0);
  assert.notEqual(Number(resolution?.resolved_place?.lng), 0);
});

test("resolvePlaceReference resolves Ezeiza directly", async () => {
  const resolution = await resolvePlaceReference({
    query: "Ezeiza",
    city: "Buenos Aires",
    country: "Argentina",
    place_type_hint: "AIRPORT",
    language: "es",
  });

  assert.equal(resolution?.status, "RESOLVED");
  assert.equal(resolution?.resolved_place?.id, "ba-airport-eze");
  assert.ok(Number.isFinite(Number(resolution?.resolved_place?.lat)));
  assert.ok(Number.isFinite(Number(resolution?.resolved_place?.lng)));
});

test("buildPlanFromToolArgs drops placeholder place coordinates", () => {
  const plan = buildPlanFromToolArgs(
    {
      city: "Buenos Aires",
      country: "Argentina",
      geoIntent: "NEAR_AREA",
      placeTargets: [
        {
          rawText: "airport",
          normalizedName: "Airport",
          type: "AIRPORT",
          lat: 0,
          lng: 0,
          radiusMeters: 3000,
          confidence: 0.54,
        },
      ],
    },
    "es",
  );

  assert.equal(plan?.placeTargets?.length, 1);
  assert.equal(plan.placeTargets[0].lat, null);
  assert.equal(plan.placeTargets[0].lng, null);
  assert.equal(plan.placeTargets[0].radiusMeters, 3000);
});
