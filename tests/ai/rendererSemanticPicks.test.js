import test from "node:test";
import assert from "node:assert/strict";

import {
  getTopInventoryPicksByCategory,
  renderAssistantPayload,
  buildDeterministicSemanticExplanationPlan,
} from "../../src/modules/ai/ai.renderer.js";

const buildHotel = ({ id, name, primaryReasonText }) => ({
  id: String(id),
  name,
  city: "Buenos Aires",
  pricePerNight: 180,
  decisionExplanation: {
    primaryReasonType: "zone_fit",
    primaryReasonText,
    secondaryReasonType: "walkability",
    secondaryReasonText: "te deja moverte a pie con mas comodidad",
    comparisonAngle: "zone_fit",
    allowedAngles: ["zone_fit", "walkability"],
    angleTexts: {
      zone_fit: primaryReasonText,
      walkability: "te deja moverte a pie con mas comodidad",
    },
    signals: {
      zone_fit: true,
      walkability: true,
      quiet_profile: false,
      value: false,
      premium_profile: false,
      stars_match: false,
      view_match: false,
      landmark_proximity: false,
    },
    allowedClaims: [
      primaryReasonText,
      "te deja moverte a pie con mas comodidad",
      "Belgrano",
    ],
    canMentionZone: true,
    mentionedZoneLabel: "Belgrano",
    confidence: "MEDIUM",
  },
});

test("getTopInventoryPicksByCategory respects semantic thread top picks and explanation text", () => {
  const inventory = {
    hotels: [
      buildHotel({
        id: 1,
        name: "Hotel Uno",
        primaryReasonText:
          "la zona de Recoleta suele funcionar bien si buscas algo tranquilo y caminable",
      }),
      buildHotel({
        id: 2,
        name: "Hotel Dos",
        primaryReasonText:
          "encaja mejor con un plan mas tranquilo para descansar",
      }),
      buildHotel({
        id: 3,
        name: "Hotel Tres",
        primaryReasonText:
          "la zona de Belgrano suele funcionar bien si buscas algo tranquilo y caminable",
      }),
    ],
    searchScope: {
      hotels: {
        threadTopPickIds: ["3", "1"],
      },
    },
  };

  const plan = {
    location: { city: "Buenos Aires", country: "Argentina" },
    areaTraits: ["QUIET", "WALKABLE"],
    semanticSearch: {
      intentProfile: {
        inferenceMode: "TRAIT_PROFILE",
        userRequestedAreaTraits: ["QUIET", "WALKABLE"],
      },
    },
  };

  const picks = getTopInventoryPicksByCategory(inventory, plan, "es", 0);

  assert.deepEqual(
    picks.slice(0, 2).map((pick) => pick.item.id),
    ["3", "1"],
  );
  assert.equal(
    picks[0].pickReason,
    "la zona de Belgrano suele funcionar bien si buscas algo tranquilo y caminable",
  );
});

test("buildDeterministicSemanticExplanationPlan returns one intro plus differentiated items", () => {
  const inventory = {
    hotels: [
      buildHotel({
        id: 1,
        name: "Hotel Uno",
        primaryReasonText:
          "la zona de Belgrano suele funcionar bien si buscas algo tranquilo y caminable",
      }),
      buildHotel({
        id: 2,
        name: "Hotel Dos",
        primaryReasonText:
          "encaja mejor con un plan mas tranquilo para descansar",
      }),
    ],
    searchScope: {
      hotels: {
        threadTopPickIds: ["1", "2"],
      },
    },
  };
  inventory.hotels[1].decisionExplanation.comparisonAngle = "quiet_profile";
  inventory.hotels[1].decisionExplanation.allowedAngles = [
    "quiet_profile",
    "walkability",
  ];
  inventory.hotels[1].decisionExplanation.angleTexts = {
    quiet_profile: "encaja mejor con un plan mas tranquilo para descansar",
    walkability: "te deja moverte a pie con mas comodidad",
  };
  inventory.hotels[1].decisionExplanation.mentionedZoneLabel = "Palermo";

  const plan = {
    location: { city: "Buenos Aires", country: "Argentina" },
    areaTraits: ["QUIET", "WALKABLE"],
    semanticSearch: {
      intentProfile: {
        inferenceMode: "TRAIT_PROFILE",
        userRequestedAreaTraits: ["QUIET", "WALKABLE"],
      },
    },
  };

  const explanationPlan = buildDeterministicSemanticExplanationPlan({
    inventory,
    plan,
    language: "es",
    seed: 0,
  });

  assert.equal(explanationPlan.source, "deterministic");
  assert.equal(explanationPlan.items.length, 2);
  assert.notEqual(explanationPlan.items[0].angle, explanationPlan.items[1].angle);
  assert.match(explanationPlan.intro, /perfil tranquilo y caminable/i);
});

test("renderAssistantPayload returns a short results intro after a separate semantic orientation message", async () => {
  const inventory = {
    hotels: [
      buildHotel({
        id: 1,
        name: "Hotel Uno",
        primaryReasonText:
          "la zona de Belgrano suele funcionar bien si buscas algo tranquilo y caminable",
      }),
      buildHotel({
        id: 2,
        name: "Hotel Dos",
        primaryReasonText:
          "encaja mejor con un plan mas tranquilo para descansar",
      }),
    ],
    homes: [],
    searchScope: {
      hotels: {
        threadTopPickIds: ["1", "2"],
      },
    },
  };

  const orientationText =
    "Claro. Para un perfil tranquilo y caminable en Buenos Aires, normalmente miro primero zonas como Belgrano o Palermo. Dejame buscar opciones ahi.";

  const plan = {
    location: { city: "Buenos Aires", country: "Argentina" },
    areaTraits: ["QUIET", "WALKABLE"],
    assumptions: {
      separateSemanticOrientationMessage: true,
    },
    semanticSearch: {
      orientation: {
        text: orientationText,
      },
      intentProfile: {
        inferenceMode: "TRAIT_PROFILE",
        userRequestedAreaTraits: ["QUIET", "WALKABLE"],
      },
    },
  };

  const rendered = await renderAssistantPayload({
    plan,
    messages: [
      {
        role: "user",
        content: "Quiero un hotel tranquilo y caminable en Buenos Aires",
      },
    ],
    inventory,
    nextAction: "RUN_SEARCH",
    userContext: {},
    missing: [],
    preparedReply: {
      text: orientationText,
      sections: [],
      mode: "separate_message",
      stage: "orientation",
    },
  });

  assert.match(rendered.assistant.text, /opciones recomendadas/i);
  assert.equal(rendered.ui.sections[0].type, "hotelCard");
  assert.equal(rendered.ui.sections[1].type, "hotelCard");
  assert.equal(
    rendered.ui.sections.filter((section) => section?.type === "textBlock").length,
    0,
  );
});
