/**
 * ai.tools.js — OpenAI tool definitions for function calling turn.
 * Defines the 5 tools the model can call, plus helpers to map tool args
 * to the plan/action shapes used by the rest of the AI pipeline.
 */

export const AI_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_stays",
      strict: true,
      description:
        "Search for hotels and accommodations. Call when: user asks for hotels in a destination (new or changed), changes city mid-conversation, adds dates/guests, asks for more options, refines with filters.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
          country: { type: ["string", "null"] },
          checkIn: {
            type: ["string", "null"],
            description: "YYYY-MM-DD or null",
          },
          checkOut: {
            type: ["string", "null"],
            description: "YYYY-MM-DD or null",
          },
          adults: { type: ["number", "null"] },
          children: { type: ["number", "null"] },
          sortBy: {
            type: ["string", "null"],
            enum: ["PRICE_ASC", "PRICE_DESC", "POPULARITY", null],
          },
          amenityCodes: {
            type: "array",
            items: { type: "string" },
            description:
              "Codes from: POOL SPA GYM WIFI PARKING PETS BEACH AIRPORT_SHUTTLE RESTAURANT BAR",
          },
          minStars: { type: ["number", "null"] },
          starRatings: {
            type: "array",
            items: { type: "number" },
            description:
              "Exact hotel star values when the user explicitly asks for specific stars, e.g. [4] or [4,5]. Use this instead of minStars for exact requests like '4-star' or '4 o 5 estrellas'.",
          },
          viewIntent: {
            type: ["string", "null"],
            enum: [
              "RIVER_VIEW",
              "WATER_VIEW",
              "SEA_VIEW",
              "CITY_VIEW",
              "LANDMARK_VIEW",
              null,
            ],
          },
          geoIntent: {
            type: ["string", "null"],
            enum: [
              "IN_AREA",
              "NEAR_AREA",
              "NEAR_LANDMARK",
              "WATERFRONT",
              "VIEW_TO",
              null,
            ],
          },
          placeTargets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                rawText: { type: "string" },
                normalizedName: { type: ["string", "null"] },
                type: {
                  type: ["string", "null"],
                  enum: [
                    "NEIGHBORHOOD",
                    "DISTRICT",
                    "LANDMARK",
                    "AIRPORT",
                    "STATION",
                    "PORT",
                    "VENUE",
                    "GENERIC",
                    "AREA",
                    "WATERFRONT",
                    null,
                  ],
                },
                city: { type: ["string", "null"] },
                country: { type: ["string", "null"] },
                aliases: {
                  type: "array",
                  items: { type: "string" },
                },
                lat: { type: ["number", "null"] },
                lng: { type: ["number", "null"] },
                radiusMeters: { type: ["number", "null"] },
                confidence: { type: ["number", "null"] },
              },
              required: [
                "rawText",
                "normalizedName",
                "type",
                "city",
                "country",
                "aliases",
                "lat",
                "lng",
                "radiusMeters",
                "confidence",
              ],
              additionalProperties: false,
            },
            description:
              "Explicit area, neighborhood, waterfront, or landmark targets mentioned by the user.",
          },
          areaIntent: {
            type: ["string", "null"],
            enum: [
              "GOOD_AREA",
              "CITY_CENTER",
              "QUIET",
              "NIGHTLIFE",
              "BEACH_COAST",
              null,
            ],
          },
          qualityIntent: {
            type: ["string", "null"],
            enum: ["BUDGET", "VALUE", "LUXURY", null],
          },
          areaTraits: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "GOOD_AREA",
                "SAFE",
                "QUIET",
                "NIGHTLIFE",
                "WALKABLE",
                "FAMILY",
                "UPSCALE_AREA",
                "BUSINESS",
                "CENTRAL",
                "CULTURAL",
                "WATERFRONT_AREA",
                "LUXURY",
              ],
            },
            description:
              "Soft area traits the user cares about, such as safe, walkable, upscale, central, business, cultural, waterfront, quiet, nightlife, family, or luxury.",
          },
          preferenceNotes: {
            type: "array",
            items: { type: "string" },
            description:
              "Short free-text notes for soft preferences that matter for ranking/explanation.",
          },
          areaPreference: {
            type: ["string", "null"],
            enum: [
              "CITY_CENTER",
              "BEACH_COAST",
              "FAMILY_FRIENDLY",
              "LUXURY",
              "BUDGET",
              null,
            ],
          },
          nearbyInterest: {
            type: ["string", "null"],
            description: "POI name e.g. 'Burj Khalifa'",
          },
          wantsMoreResults: { type: "boolean" },
        },
        required: [
          "city",
          "country",
          "checkIn",
          "checkOut",
          "adults",
          "children",
          "sortBy",
          "amenityCodes",
          "minStars",
          "starRatings",
          "viewIntent",
          "geoIntent",
          "placeTargets",
          "areaIntent",
          "qualityIntent",
          "areaTraits",
          "preferenceNotes",
          "areaPreference",
          "nearbyInterest",
          "wantsMoreResults",
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_place_reference",
      strict: true,
      description:
        "Resolve a specific place reference such as an airport, station, landmark, district, or port when the place is ambiguous or generic.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          city: { type: ["string", "null"] },
          country: { type: ["string", "null"] },
          place_type_hint: {
            type: ["string", "null"],
            enum: [
              "AIRPORT",
              "LANDMARK",
              "DISTRICT",
              "STATION",
              "PORT",
              "VENUE",
              "GENERIC",
              null,
            ],
          },
          intent_mode: {
            type: ["string", "null"],
            enum: [
              "NEAR_PLACE",
              "IN_PLACE",
              "VISIT_PLACE",
              "STAY_IN_AREA",
              null,
            ],
          },
          language: { type: ["string", "null"] },
          max_candidates: { type: ["number", "null"] },
        },
        required: [
          "query",
          "city",
          "country",
          "place_type_hint",
          "intent_mode",
          "language",
          "max_candidates",
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "answer_from_results",
      strict: true,
      description:
        "Answer questions about hotels already shown in this conversation. Use when user asks about amenities, price, recommendation among shown options. Do NOT call search_stays.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_stay_details",
      strict: true,
      description:
        "Get full details of a specific hotel or home when user wants more info about one property.",
      parameters: {
        type: "object",
        properties: {
          stayId: { type: "string" },
          type: { type: "string", enum: ["HOTEL", "HOME"] },
        },
        required: ["stayId", "type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_trip",
      strict: true,
      description:
        "Help plan a trip: itinerary, activities, restaurants, attractions. Use when user asks what to do, how to plan days, or trip organization.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string" },
          days: { type: ["number", "null"] },
          interests: { type: "array", items: { type: "string" } },
        },
        required: ["destination", "days", "interests"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_destination_info",
      strict: true,
      description:
        "Provide info about a destination: climate, things to do, food, transport, or general travel guidance. Use when user asks about a city/country without requesting a hotel search.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string" },
          aspect: {
            type: ["string", "null"],
            enum: [
              "climate",
              "activities",
              "food",
              "transport",
              "general",
              null,
            ],
          },
        },
        required: ["destination", "aspect"],
        additionalProperties: false,
      },
    },
  },
];

/**
 * Maps flat args from search_stays tool to the nested plan shape
 * expected by searchStays and the rest of the pipeline.
 */
const normalizePlaceCoordinate = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizePlaceCoordinatePair = (latValue, lngValue) => {
  const lat = normalizePlaceCoordinate(latValue);
  const lng = normalizePlaceCoordinate(lngValue);
  if (lat === 0 && lng === 0) {
    return { lat: null, lng: null };
  }
  return { lat, lng };
};

export const buildPlanFromToolArgs = (args, language = "es") => ({
  language,
  intent: "SEARCH",
  location: {
    city: args.city || null,
    country: args.country || null,
    rawQuery: args.city || null,
  },
  dates: {
    checkIn: args.checkIn || null,
    checkOut: args.checkOut || null,
    flexible: !args.checkIn,
  },
  guests: {
    adults: args.adults || null,
    children: args.children ?? null,
  },
  sortBy: args.sortBy || null,
  starRatings:
    Array.isArray(args.starRatings) && args.starRatings.length
      ? args.starRatings
      : [],
  viewIntent: args.viewIntent || null,
  geoIntent: args.geoIntent || null,
  placeTargets:
    Array.isArray(args.placeTargets) && args.placeTargets.length
      ? args.placeTargets
          .map((target) => ({
            ...normalizePlaceCoordinatePair(target?.lat, target?.lng),
            rawText:
              typeof target?.rawText === "string" ? target.rawText.trim() : "",
            normalizedName:
              typeof target?.normalizedName === "string"
                ? target.normalizedName.trim()
                : null,
            type: typeof target?.type === "string" ? target.type : null,
            city: typeof target?.city === "string" ? target.city.trim() : null,
            country:
              typeof target?.country === "string"
                ? target.country.trim()
                : null,
            aliases: Array.isArray(target?.aliases)
              ? target.aliases
                  .map((entry) => String(entry || "").trim())
                  .filter(Boolean)
              : [],
            radiusMeters: Number.isFinite(Number(target?.radiusMeters))
              ? Number(target.radiusMeters)
              : null,
            polygonRef: null,
            confidence: Number.isFinite(Number(target?.confidence))
              ? Number(target.confidence)
              : null,
          }))
          .filter((target) => target.rawText)
      : [],
  areaIntent: args.areaIntent || null,
  qualityIntent: args.qualityIntent || null,
  areaTraits:
    Array.isArray(args.areaTraits) && args.areaTraits.length
      ? Array.from(
          new Set(
            args.areaTraits
              .map((entry) =>
                String(entry || "")
                  .trim()
                  .toUpperCase(),
              )
              .filter(Boolean),
          ),
        )
      : [],
  preferenceNotes:
    Array.isArray(args.preferenceNotes) && args.preferenceNotes.length
      ? args.preferenceNotes
      : [],
  hotelFilters: {
    amenityCodes: args.amenityCodes?.length ? args.amenityCodes : null,
    minRating:
      Array.isArray(args.starRatings) && args.starRatings.length
        ? null
        : args.minStars || null,
    starRatings:
      Array.isArray(args.starRatings) && args.starRatings.length
        ? args.starRatings
        : null,
  },
  preferences: {
    areaPreference: args.areaPreference ? [args.areaPreference] : [],
    nearbyInterest: args.nearbyInterest || null,
    placeTargets:
      Array.isArray(args.placeTargets) && args.placeTargets.length
        ? args.placeTargets
            .map((target) =>
              typeof target?.rawText === "string" ? target.rawText.trim() : "",
            )
            .filter(Boolean)
        : [],
    preferenceNotes:
      Array.isArray(args.preferenceNotes) && args.preferenceNotes.length
        ? args.preferenceNotes
        : [],
  },
  listingTypes: ["HOTELS"],
  assumptions: {
    functionCalling: true,
    wantsMoreResults: Boolean(args.wantsMoreResults),
  },
});

export const TOOL_TO_NEXT_ACTION = {
  search_stays: "RUN_SEARCH",
  plan_trip: "RUN_PLANNING",
  get_destination_info: "RUN_LOCATION",
  get_stay_details: "RUN_LOCATION",
  answer_from_results: "ANSWER_WITH_LAST_RESULTS",
};

export const TOOL_TO_INTENT = {
  search_stays: "SEARCH",
  plan_trip: "PLANNING",
  get_destination_info: "LOCATION",
  get_stay_details: "LOCATION",
  answer_from_results: "QUESTION_ABOUT_LAST_RESULTS",
};
