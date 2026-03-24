import test from "node:test";
import assert from "node:assert/strict";

import {
  extractTripRequest,
  hasAuthoritativeSearchTurn,
} from "../../src/modules/ai/ai.service.js";
import { renderAssistantPayload } from "../../src/modules/ai/ai.renderer.js";
import { NEXT_ACTIONS } from "../../src/modules/ai/ai.planner.js";

const tripContext = {
  location: {
    lat: -34.588,
    lng: -58.392,
    city: "Buenos Aires",
    country: "Argentina",
  },
  radiusKm: 3,
};

const buildSearchInventory = () => ({
  hotels: [
    {
      id: "hotel-1",
      title: "Alvear Icon Hotel",
      city: "Buenos Aires",
      country: "Argentina",
      locationText: "Puerto Madero, Buenos Aires",
      pricePerNight: 250,
      currency: "USD",
      stars: 5,
      shortDescription: "Modern hotel near Puerto Madero.",
      hotelPayload: { rating: 5 },
    },
    {
      id: "hotel-2",
      title: "Hotel Madero",
      city: "Buenos Aires",
      country: "Argentina",
      locationText: "Buenos Aires",
      pricePerNight: 190,
      currency: "USD",
      stars: 4,
      shortDescription: "Stylish stay with good access to the city.",
      hotelPayload: { rating: 4 },
    },
  ],
  homes: [],
  matchTypes: {},
  foundExact: true,
});

test("extractTripRequest ignores hotel proximity queries", () => {
  const request = extractTripRequest({
    text: "quiero un hotel en buenos aires cerca de recoleta",
    uiEvent: null,
    tripContext,
  });

  assert.equal(request, null);
});

test("extractTripRequest ignores hotel budget queries with 'barato'", () => {
  const request = extractTripRequest({
    text: "quiero un hotel barato en buenos aires",
    uiEvent: null,
    tripContext,
  });

  assert.equal(request, null);
});

test("extractTripRequest still supports nearby restaurants flows", () => {
  const request = extractTripRequest({
    text: "que restaurantes hay cerca de recoleta",
    uiEvent: null,
    tripContext,
  });

  assert.ok(request);
  assert.equal(request.wantsItinerary, false);
  assert.ok(Array.isArray(request.categories));
  assert.ok(request.categories.length > 0);
});

test("hasAuthoritativeSearchTurn prioritizes hotel search turns", () => {
  const result = hasAuthoritativeSearchTurn({
    toolName: "search_stays",
    nextAction: NEXT_ACTIONS.RUN_SEARCH,
    plan: {
      intent: "SEARCH",
      geoIntent: "NEAR_AREA",
      placeTargets: [{ rawText: "Recoleta" }],
      areaTraits: [],
      hotelFilters: { amenityCodes: [] },
      preferences: {},
    },
    inventory: buildSearchInventory(),
    latestUserMessage: "quiero un hotel en buenos aires cerca de recoleta",
  });

  assert.equal(result, true);
});

test("renderAssistantPayload keeps hotel cards for RUN_SEARCH", async () => {
  const inventory = buildSearchInventory();
  const rendered = await renderAssistantPayload({
    plan: {
      intent: "SEARCH",
      language: "es",
      location: { city: "Buenos Aires", country: "Argentina" },
      dates: { checkIn: null, checkOut: null },
      guests: { adults: null, children: null },
      hotelFilters: { amenityCodes: [], minRating: null },
      starRatings: [],
      placeTargets: [{ rawText: "Recoleta", normalizedName: "Recoleta" }],
      areaTraits: [],
      preferences: {},
    },
    messages: [
      { role: "user", content: "quiero un hotel en buenos aires cerca de recoleta" },
    ],
    inventory,
    nextAction: NEXT_ACTIONS.RUN_SEARCH,
    trip: null,
    tripContext: null,
    userContext: { name: "Test" },
    weather: null,
    missing: [],
    visualContext: null,
    tripSearchContext: null,
    lastShownResultsContext: null,
    inventoryForReply: null,
    stayDetailsFromDb: null,
    preparedReply: null,
    onTextChunk: null,
  });

  const hotelCards = (rendered.ui?.sections || []).filter(
    (section) => section?.type === "hotelCard",
  );

  assert.ok(hotelCards.length > 0);
  assert.equal(rendered.ui?.sections?.at(-1)?.type, "contextualFooter");
});
