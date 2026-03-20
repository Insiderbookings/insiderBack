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
          checkIn: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
          checkOut: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
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
          areaPreference: {
            type: ["string", "null"],
            enum: ["CITY_CENTER", "BEACH_COAST", "FAMILY_FRIENDLY", "LUXURY", "BUDGET", null],
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
        "Provide info about a destination: climate, things to do, best time to visit. Use when user asks about a city/country without requesting hotel search.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string" },
          aspect: {
            type: ["string", "null"],
            enum: ["climate", "activities", "food", "general", null],
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
  hotelFilters: {
    amenityCodes: args.amenityCodes?.length ? args.amenityCodes : null,
    minRating: args.minStars || null,
  },
  preferences: {
    areaPreference: args.areaPreference ? [args.areaPreference] : [],
    nearbyInterest: args.nearbyInterest || null,
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
