import test from "node:test";
import assert from "node:assert/strict";

import { scopeChatRelevantHotelCards } from "../../src/services/assistantSearch.service.js";

const buildCard = ({
  id,
  semanticScore = 0,
  semanticEvidence = [],
  distanceMeters = null,
  semanticMatch = null,
  decisionExplanation = null,
  pricePerNight = null,
  stars = 4,
} = {}) => ({
  id: String(id),
  name: `Hotel ${id}`,
  city: "Buenos Aires",
  semanticScore,
  semanticEvidence,
  distanceMeters,
  semanticMatch,
  decisionExplanation,
  pricePerNight,
  stars,
  matchReasons: [],
});

test("scopeChatRelevantHotelCards keeps broad destination-only searches unchanged", () => {
  const cards = Array.from({ length: 40 }, (_, index) =>
    buildCard({ id: index + 1 }),
  );
  const scoped = scopeChatRelevantHotelCards({
    cards,
    plan: {
      location: { city: "Dubai", country: "United Arab Emirates" },
    },
    limit: 40,
  });

  assert.equal(scoped.cards.length, 40);
  assert.equal(scoped.searchScope.scopeMode, "NONE");
  assert.equal(scoped.searchScope.scopeReason, null);
  assert.equal(scoped.searchScope.visibleHotelCount, 40);
  assert.equal(scoped.searchScope.warningMode, null);
  assert.equal(scoped.searchScope.scopeConfidence, null);
});

test("scopeChatRelevantHotelCards filters semantic geo searches to relevant cards only", () => {
  const cards = [
    buildCard({
      id: 1,
      semanticScore: 72,
      semanticEvidence: [{ type: "verified_geo" }],
      distanceMeters: 320,
    }),
    buildCard({
      id: 2,
      semanticScore: 58,
      semanticEvidence: [{ type: "verified_text" }],
      distanceMeters: 870,
    }),
    buildCard({
      id: 3,
      semanticScore: 14,
      semanticEvidence: [{ type: "weak_hint" }],
      distanceMeters: 5100,
    }),
    buildCard({ id: 4, semanticScore: 11 }),
    buildCard({ id: 5, semanticScore: 7 }),
    buildCard({ id: 6, semanticScore: 0 }),
  ];

  const scoped = scopeChatRelevantHotelCards({
    cards,
    plan: {
      location: { city: "Buenos Aires", country: "Argentina" },
      geoIntent: "NEAR_AREA",
      placeTargets: [
        {
          rawText: "Recoleta",
          normalizedName: "Recoleta",
          type: "NEIGHBORHOOD",
          radiusMeters: 2800,
        },
      ],
    },
    limit: 120,
  });

  assert.deepEqual(
    scoped.cards.map((card) => card.id),
    ["1", "2", "3", "4", "5"],
  );
  assert.equal(scoped.searchScope.scopeReason, "SEMANTIC_GEO");
  assert.equal(scoped.searchScope.scopeMode, "RELAXED");
  assert.equal(scoped.searchScope.candidateHotelCount, 6);
  assert.equal(scoped.searchScope.visibleHotelCount, 5);
  assert.equal(scoped.searchScope.warningMode, "EXPANDED_WITH_NOTICE");
  assert.equal(scoped.searchScope.scopeConfidence, "MEDIUM");
  assert.equal(
    scoped.searchScope.scopeExpansionReason,
    "INSUFFICIENT_STRONG_MATCHES",
  );
});

test("scopeChatRelevantHotelCards caps semantic visible results at 30", () => {
  const cards = Array.from({ length: 45 }, (_, index) =>
    buildCard({
      id: index + 1,
      semanticScore: 30,
      semanticEvidence: [{ type: "verified_structured" }],
    }),
  );

  const scoped = scopeChatRelevantHotelCards({
    cards,
    plan: {
      location: { city: "Buenos Aires", country: "Argentina" },
      qualityIntent: "BUDGET",
    },
    limit: 120,
  });

  assert.equal(scoped.cards.length, 30);
  assert.equal(scoped.searchScope.scopeReason, "QUALITY");
  assert.equal(scoped.searchScope.scopeMode, "STRICT");
  assert.equal(scoped.searchScope.relevantHotelCount, 45);
  assert.equal(scoped.searchScope.visibleHotelCount, 30);
  assert.equal(scoped.searchScope.warningMode, null);
  assert.equal(scoped.searchScope.scopeConfidence, "MEDIUM");
});

test("scopeChatRelevantHotelCards returns empty when semantic query has no relevant matches", () => {
  const cards = Array.from({ length: 8 }, (_, index) =>
    buildCard({ id: index + 1 }),
  );

  const scoped = scopeChatRelevantHotelCards({
    cards,
    plan: {
      location: { city: "Buenos Aires", country: "Argentina" },
      geoIntent: "NEAR_LANDMARK",
      placeTargets: [
        {
          rawText: "Obelisco",
          normalizedName: "Obelisco",
          type: "LANDMARK",
          radiusMeters: 1600,
        },
      ],
    },
    limit: 120,
  });

  assert.equal(scoped.cards.length, 0);
  assert.equal(scoped.searchScope.scopeReason, "SEMANTIC_GEO");
  assert.equal(scoped.searchScope.visibleHotelCount, 0);
  assert.equal(scoped.searchScope.scopeConfidence, "LOW");
  assert.equal(scoped.searchScope.scopeExpansionReason, "NO_RELEVANT_MATCHES");
});

test("scopeChatRelevantHotelCards keeps trait-only searches in semantic traits mode", () => {
  const cards = [
    buildCard({
      id: 1,
      semanticScore: 44,
      semanticEvidence: [{ type: "verified_structured", label: "catalog_zone_trait_overlap" }],
    }),
    buildCard({
      id: 2,
      semanticScore: 28,
      semanticEvidence: [{ type: "verified_text", label: "area_trait_walkable" }],
    }),
    buildCard({
      id: 3,
      semanticScore: 12,
      semanticEvidence: [{ type: "weak_hint" }],
    }),
  ];

  const scoped = scopeChatRelevantHotelCards({
    cards,
    plan: {
      location: { city: "Buenos Aires", country: "Argentina" },
      areaTraits: ["QUIET", "WALKABLE"],
      semanticSearch: {
        intentProfile: {
          inferenceMode: "TRAIT_PROFILE",
          userRequestedAreaTraits: ["QUIET", "WALKABLE"],
          candidateZones: ["ba-belgrano", "ba-recoleta"],
        },
      },
    },
    limit: 120,
  });

  assert.equal(scoped.searchScope.scopeReason, "SEMANTIC_TRAITS");
  assert.equal(scoped.searchScope.scopeConfidence, "MEDIUM");
  assert.equal(scoped.cards.length, 3);
});

test("scopeChatRelevantHotelCards does not treat weak trait-profile hints as strong matches", () => {
  const cards = [
    buildCard({
      id: 1,
      semanticScore: 48,
      semanticEvidence: [{ type: "verified_structured", label: "catalog_zone_trait_overlap" }],
    }),
    buildCard({
      id: 2,
      semanticScore: 30,
      semanticEvidence: [{ type: "verified_text", label: "area_trait_walkable" }],
    }),
    ...Array.from({ length: 6 }, (_, index) =>
      buildCard({
        id: index + 3,
        semanticScore: 26,
        semanticEvidence: [{ type: "weak_hint", label: "candidate_zone_distance_hint" }],
      }),
    ),
  ];

  const scoped = scopeChatRelevantHotelCards({
    cards,
    plan: {
      location: { city: "Buenos Aires", country: "Argentina" },
      areaTraits: ["QUIET", "WALKABLE"],
      semanticSearch: {
        intentProfile: {
          inferenceMode: "TRAIT_PROFILE",
          userRequestedAreaTraits: ["QUIET", "WALKABLE"],
          candidateZones: ["ba-belgrano"],
        },
      },
    },
    limit: 120,
  });

  assert.equal(scoped.searchScope.scopeReason, "SEMANTIC_TRAITS");
  assert.equal(scoped.searchScope.strongHotelCount, 2);
  assert.equal(scoped.searchScope.relevantHotelCount, 5);
  assert.equal(scoped.searchScope.scopeMode, "RELAXED");
});

test("scopeChatRelevantHotelCards diversifies thread top picks for trait-only near ties", () => {
  const cards = [
    buildCard({
      id: 1,
      semanticScore: 90,
      semanticEvidence: [{ type: "verified_structured", label: "catalog_zone_trait_overlap" }],
      semanticMatch: { confidence: "MEDIUM", matchedZoneId: "ba-recoleta", scopeEligible: true, evidence: [] },
      decisionExplanation: {
        comparisonAngle: "zone",
        mentionedZoneLabel: "Recoleta",
        primaryReasonText: "la zona de Recoleta suele funcionar bien si buscas algo caminable",
      },
      pricePerNight: 320,
      stars: 5,
    }),
    buildCard({
      id: 2,
      semanticScore: 88,
      semanticEvidence: [{ type: "verified_structured", label: "catalog_zone_trait_overlap" }],
      semanticMatch: { confidence: "MEDIUM", matchedZoneId: "ba-recoleta", scopeEligible: true, evidence: [] },
      decisionExplanation: {
        comparisonAngle: "premium",
        mentionedZoneLabel: "Recoleta",
        primaryReasonText: "la zona de Recoleta suele funcionar bien si buscas algo caminable",
      },
      pricePerNight: 290,
      stars: 5,
    }),
    buildCard({
      id: 3,
      semanticScore: 84,
      semanticEvidence: [{ type: "verified_structured", label: "catalog_zone_trait_overlap" }],
      semanticMatch: { confidence: "MEDIUM", matchedZoneId: "ba-belgrano", scopeEligible: true, evidence: [] },
      decisionExplanation: {
        comparisonAngle: "quiet",
        mentionedZoneLabel: "Belgrano",
        primaryReasonText: "la zona de Belgrano suele funcionar bien si buscas algo tranquilo y caminable",
      },
      pricePerNight: 180,
      stars: 4,
    }),
    buildCard({
      id: 4,
      semanticScore: 82,
      semanticEvidence: [{ type: "verified_structured", label: "catalog_zone_trait_overlap" }],
      semanticMatch: { confidence: "MEDIUM", matchedZoneId: "ba-palermo-soho", scopeEligible: true, evidence: [] },
      decisionExplanation: {
        comparisonAngle: "walkability",
        mentionedZoneLabel: "Palermo Soho",
        primaryReasonText: "la zona de Palermo Soho suele funcionar bien si buscas algo caminable",
      },
      pricePerNight: 200,
      stars: 4,
    }),
    buildCard({
      id: 5,
      semanticScore: 80,
      semanticEvidence: [{ type: "verified_structured", label: "catalog_zone_trait_overlap" }],
      semanticMatch: { confidence: "MEDIUM", matchedZoneId: "ba-san-telmo", scopeEligible: true, evidence: [] },
      decisionExplanation: {
        comparisonAngle: "value",
        mentionedZoneLabel: "San Telmo",
        primaryReasonText: "la zona de San Telmo suele funcionar bien si buscas algo caminable",
      },
      pricePerNight: 140,
      stars: 3,
    }),
  ];

  const scoped = scopeChatRelevantHotelCards({
    cards,
    plan: {
      location: { city: "Buenos Aires", country: "Argentina" },
      areaTraits: ["WALKABLE"],
      semanticSearch: {
        intentProfile: {
          inferenceMode: "TRAIT_PROFILE",
          userRequestedAreaTraits: ["WALKABLE"],
          candidateZones: ["ba-recoleta", "ba-belgrano", "ba-palermo-soho", "ba-san-telmo"],
        },
      },
    },
    limit: 120,
  });

  assert.deepEqual(
    scoped.searchScope.threadTopPickIds,
    ["1", "3", "4", "5", "2"],
  );
});
