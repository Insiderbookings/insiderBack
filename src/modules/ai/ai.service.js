import { extractSearchPlan, generateTripAddons } from "../../services/aiAssistant.service.js";
import { AI_FLAGS, AI_LIMITS } from "./ai.config.js";
import { applyPlanToState, buildPlanOutcome, INTENTS, NEXT_ACTIONS, updateStageFromAction } from "./ai.planner.js";
import { enforcePolicy } from "./ai.policy.js";
import { renderAssistantPayload } from "./ai.renderer.js";
import { loadAssistantState } from "./ai.stateStore.js";
import { geocodePlace, getNearbyPlaces, getWeatherSummary, searchStays } from "./tools/index.js";
import { logAiEvent } from "./ai.telemetry.js";

const buildEmptyInventory = () => ({
  homes: [],
  hotels: [],
  matchTypes: { homes: "NONE", hotels: "NONE" },
});

const normalizeMessages = (messages = []) =>
  Array.isArray(messages)
    ? messages
      .map((message) => {
        if (!message) return null;
        const role = typeof message.role === "string" ? message.role : "user";
        const content = typeof message.content === "string" ? message.content.trim() : "";
        if (!content) return null;
        return { role, content };
      })
      .filter(Boolean)
    : [];

const applyPlanDefaults = (plan, state) => {
  const nextPlan = { ...(plan || {}) };
  const listingTypes =
    Array.isArray(nextPlan.listingTypes) && nextPlan.listingTypes.length
      ? nextPlan.listingTypes
      : Array.isArray(state?.preferences?.listingTypes) && state.preferences.listingTypes.length
        ? state.preferences.listingTypes
        : ["HOMES"];
  nextPlan.listingTypes = listingTypes;
  if (!nextPlan.sortBy && state?.preferences?.sortBy) {
    nextPlan.sortBy = state.preferences.sortBy;
  }
  return nextPlan;
};

const applyUiEventToPlan = (plan, uiEvent) => {
  const nextPlan = { ...(plan || {}) };
  if (!uiEvent) return nextPlan;
  const raw = typeof uiEvent === "string" ? uiEvent : uiEvent?.id || uiEvent?.event || "";
  const normalized = String(raw || "").trim().toUpperCase();
  if (!normalized) return nextPlan;

  if (normalized.includes("CHEAP") || normalized.includes("LOW_PRICE")) {
    nextPlan.sortBy = "PRICE_ASC";
  } else if (normalized.includes("EXPENSIVE") || normalized.includes("HIGH_PRICE")) {
    nextPlan.sortBy = "PRICE_DESC";
  } else if (normalized.includes("POPULAR")) {
    nextPlan.sortBy = "POPULARITY";
  }

  if (normalized.includes("HOTELS")) {
    nextPlan.listingTypes = ["HOTELS"];
  } else if (normalized.includes("HOMES")) {
    nextPlan.listingTypes = ["HOMES"];
  }

  return nextPlan;
};

const PLACE_CATEGORIES = [
  {
    id: "food",
    type: "restaurant",
    label: "Food",
    keywords: ["restaurant", "restaurante", "comida", "food", "cafe", "cafeteria", "brunch", "bar"],
  },
  {
    id: "attractions",
    type: "tourist_attraction",
    label: "Attractions",
    keywords: ["atraccion", "atracciones", "attraction", "tourist", "interesante", "museo", "museum", "parque", "park"],
  },
  {
    id: "shopping",
    type: "shopping_mall",
    label: "Shopping",
    keywords: ["shopping", "compras", "mall", "centro comercial", "outlet", "tiendas"],
  },
  {
    id: "clothing",
    type: "clothing_store",
    label: "Clothing",
    keywords: ["ropa", "clothing", "fashion", "boutique", "zapatos", "shoe", "moda"],
  },
];

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const extractLatestUserMessage = (messages = []) =>
  [...messages].reverse().find((msg) => msg?.role === "user" && msg?.content)?.content || "";

const extractRadiusKm = (text) => {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*(km|kilometros|kilometers)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const normalizeTripContext = (value) => {
  if (!value || typeof value !== "object") return null;
  const raw = value.trip || value;
  if (!raw || typeof raw !== "object") return null;
  const location = raw.location || raw.destination || {};
  const lat = Number(location.lat ?? location.latitude ?? raw.lat ?? raw.latitude);
  const lng = Number(location.lng ?? location.lon ?? location.longitude ?? raw.lng ?? raw.longitude);
  const locationText =
    raw.locationText ||
    raw.address ||
    location.address ||
    [location.city, location.state, location.country].filter(Boolean).join(", ") ||
    raw.city ||
    raw.country ||
    null;
  return {
    bookingId: raw.bookingId ?? raw.booking_id ?? null,
    stayName: raw.stayName ?? raw.stay_name ?? raw.name ?? null,
    locationText: locationText || null,
    location: {
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      city: location.city ?? raw.city ?? null,
      state: location.state ?? raw.state ?? null,
      country: location.country ?? raw.country ?? null,
      address: location.address ?? raw.address ?? null,
    },
    dates: {
      checkIn: raw.dates?.checkIn ?? raw.checkIn ?? null,
      checkOut: raw.dates?.checkOut ?? raw.checkOut ?? null,
    },
    guests: raw.guests ?? null,
    radiusKm: raw.radiusKm ?? raw.radius_km ?? null,
    summary: raw.summary ?? null,
  };
};

const mergeTripContext = (base, incoming) => {
  if (!incoming) return base || null;
  if (!base) return incoming;
  return {
    ...base,
    ...incoming,
    location: { ...(base.location || {}), ...(incoming.location || {}) },
    dates: { ...(base.dates || {}), ...(incoming.dates || {}) },
  };
};

const extractTripRequest = ({ text, uiEvent, tripContext }) => {
  const normalized = normalizeText(text);
  const uiRaw = typeof uiEvent === "string" ? uiEvent : uiEvent?.id || uiEvent?.event || "";
  const normalizedUi = normalizeText(uiRaw);
  const wantsItinerary = /(itinerario|itinerary|planificar|plan|organizar|armar|schedule|dia\s+\d|day\s+\d)/i.test(
    normalized
  );
  const wantsNearby =
    /(cerca|near|nearby|lugares|places|restaurant|restaurante|comida|shopping|compras|ropa|attraction|atraccion)/i.test(
      normalized
    );

  // Extract specific keyword if present (very naive, just checks existence)
  let specificKeyword = null;
  if (/(museo|museum)/i.test(normalized)) specificKeyword = "museum";
  else if (/(parque|park)/i.test(normalized)) specificKeyword = "park";
  else if (/(cafe|coffee)/i.test(normalized)) specificKeyword = "cafe";
  else if (/(bar|pub)/i.test(normalized)) specificKeyword = "bar";
  else if (/(sushi|pizza|burger|pasta)/i.test(normalized)) specificKeyword = normalized.match(/(sushi|pizza|burger|pasta)/i)[0];

  const keyword = /(vegano|vegan|vegetarian|veg)/i.test(normalized) ? "vegan" : specificKeyword;

  const categories = PLACE_CATEGORIES.filter((category) =>
    category.keywords.some((kw) => normalized.includes(kw))
  );

  const shouldBootstrap =
    normalizedUi.includes("trip") ||
    normalizedUi.includes("itinerary") ||
    normalizedUi.includes("plan");

  if (!wantsItinerary && !wantsNearby && !shouldBootstrap) return null;
  if (!tripContext) return null;

  const resolvedCategories = categories.length
    ? categories
    : [PLACE_CATEGORIES[1], PLACE_CATEGORIES[0], PLACE_CATEGORIES[2]].filter(Boolean);

  return {
    categories: resolvedCategories,
    keyword,
    wantsItinerary: wantsItinerary || shouldBootstrap,
    radiusKm: extractRadiusKm(text) ?? tripContext.radiusKm ?? null,
    raw: text,
  };
};

const resolveTripLocation = async (tripContext, state, plan, userContext) => {
  if (tripContext?.location?.lat != null && tripContext?.location?.lng != null) {
    return tripContext.location;
  }
  if (state?.destination?.lat != null && state?.destination?.lon != null) {
    return { lat: state.destination.lat, lng: state.destination.lon };
  }

  // Strategy 1: Specific Address
  const specificText = tripContext?.locationText || plan?.location?.address;
  if (specificText) {
    const geocoded = await geocodePlace(specificText);
    if (geocoded?.lat && geocoded?.lon) {
      return { lat: geocoded.lat, lng: geocoded.lon };
    }
  }

  // Strategy 2: Broad Location (City/Country)
  const broadText =
    tripContext?.location?.city ||
    plan?.location?.city ||
    tripContext?.location?.country ||
    plan?.location?.country ||
    userContext?.location?.city ||
    state?.destination?.name ||
    null;

  if (broadText) {
    const geocoded = await geocodePlace(broadText);
    if (geocoded?.lat && geocoded?.lon) {
      return { lat: geocoded.lat, lng: geocoded.lon };
    }
  }

  return null;
};

const buildTripSuggestions = async ({ request, location }) => {
  if (!request || !location) return [];
  const suggestions = [];
  for (const category of request.categories) {
    const useKeyword = request.keyword || null;
    const places = await getNearbyPlaces({
      location,
      radiusKm: request.radiusKm,
      type: category.type,
      keyword: useKeyword,
      limit: 5,
    });
    suggestions.push({
      id: category.id,
      label: category.label,
      type: category.type,
      places,
    });
  }
  return suggestions;
};

const extractWeatherLocationText = (text) => {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  const match =
    normalized.match(/(?:clima|tiempo|weather|temperatura|pronostico|pronóstico)\s*(?:en|in)\s+(.+)/i) ||
    normalized.match(/\b(?:en|in)\s+(.+)/i);
  if (!match) return "";
  const raw = match[1] || "";
  return raw.replace(/[?.!,]+$/g, "").trim();
};

const resolveWeatherLocation = async ({ text, tripContext, state, plan, userContext }) => {
  const explicit = extractWeatherLocationText(text);
  if (explicit) {
    const geocoded = await geocodePlace(explicit);
    if (geocoded?.lat && geocoded?.lon) {
      return { lat: geocoded.lat, lng: geocoded.lon, name: explicit };
    }
    return { name: explicit };
  }
  return resolveTripLocation(tripContext, state, plan, userContext);
};

const buildItinerary = ({ request, tripContext, suggestions }) => {
  if (!request?.wantsItinerary) return [];
  const start = tripContext?.dates?.checkIn ? new Date(tripContext.dates.checkIn) : null;
  const end = tripContext?.dates?.checkOut ? new Date(tripContext.dates.checkOut) : null;
  const dates = [];
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    const cursor = new Date(start);
    while (cursor <= end && dates.length < 3) {
      dates.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    dates.push(new Date());
    dates.push(new Date(Date.now() + 86400000));
  }

  const byCategory = suggestions.reduce((acc, item) => {
    acc[item.id] = Array.isArray(item.places) ? [...item.places] : [];
    return acc;
  }, {});

  const takePlace = (ids = []) => {
    for (const id of ids) {
      const list = byCategory[id] || [];
      if (list.length) return list.shift();
    }
    return null;
  };

  return dates.slice(0, 3).map((dateObj, index) => {
    const label = `Day ${index + 1}`;
    const morning = takePlace(["attractions", "shopping"]);
    const afternoon = takePlace(["shopping", "clothing", "attractions"]);
    const evening = takePlace(["food"]);
    const segments = [];
    if (morning) segments.push({ timeOfDay: "morning", place: morning });
    if (afternoon) segments.push({ timeOfDay: "afternoon", place: afternoon });
    if (evening) segments.push({ timeOfDay: "evening", place: evening });
    return {
      date: dateObj.toISOString().split("T")[0],
      label,
      segments,
    };
  });
};

export const runAiTurn = async ({
  sessionId,
  userId,
  message,
  messages,
  limits,
  stateOverride,
  uiEvent,
  context,
} = {}) => {
  if (!AI_FLAGS.chatEnabled) {
    return {
      inventory: buildEmptyInventory(),
      reply: "AI chat is disabled.",
      followUps: [],
      plan: null,
      state: stateOverride || null,
      ui: { chips: [], cards: [], inputs: [], sections: [] },
      intent: "SMALL_TALK",
      nextAction: "SMALL_TALK",
      safeMode: false,
    };
  }

  let normalizedMessages = normalizeMessages(messages);
  if (!normalizedMessages.length && message) {
    normalizedMessages = [{ role: "user", content: String(message).trim() }];
  }
  if (normalizedMessages.length > AI_LIMITS.maxMessages) {
    normalizedMessages = normalizedMessages.slice(-AI_LIMITS.maxMessages);
  }

  const existingState =
    stateOverride ||
    (sessionId && userId ? await loadAssistantState({ sessionId, userId }) : null);

  const incomingTripContext = normalizeTripContext(context?.trip ?? context?.tripContext ?? context);
  const userContext = context && typeof context === "object" ? context : null;

  const planCandidate = await extractSearchPlan(normalizedMessages);
  const { state: nextState, plan: mergedPlanRaw } = applyPlanToState(existingState, planCandidate);
  const planWithUi = applyUiEventToPlan(mergedPlanRaw, uiEvent);
  const mergedPlan = applyPlanDefaults(planWithUi, nextState);
  if (incomingTripContext) {
    nextState.tripContext = mergeTripContext(nextState.tripContext, incomingTripContext);
  }
  const outcome = buildPlanOutcome({ state: nextState, plan: mergedPlan });
  const policy = enforcePolicy({
    state: nextState,
    intent: outcome.intent,
    nextAction: outcome.nextAction,
  });
  let resolvedIntent = policy.intent || outcome.intent;
  let resolvedNextAction = policy.nextAction || outcome.nextAction;
  const latestUserMessage = extractLatestUserMessage(normalizedMessages);
  const tripRequest = extractTripRequest({
    text: latestUserMessage,
    uiEvent,
    tripContext: nextState.tripContext,
  });
  const wantsWeather = /(clima|tiempo|weather|temperatura|pronostico|pronóstico)/i.test(latestUserMessage);
  const resolvedLocation = wantsWeather
    ? await resolveWeatherLocation({
      text: latestUserMessage,
      tripContext: nextState.tripContext,
      state: nextState,
      plan: mergedPlan,
      userContext,
    })
    : null;
  const weather = resolvedLocation
    ? await getWeatherSummary({ location: resolvedLocation, timeZone: userContext?.timeZone })
    : null;
  const weatherFromContext =
    userContext && typeof userContext === "object" && userContext.weather ? userContext.weather : null;
  const resolvedWeather = wantsWeather ? weather || weatherFromContext : weather;
  if (mergedPlan && resolvedIntent) {
    mergedPlan.intent = resolvedIntent;
  }

  let inventory = buildEmptyInventory();
  if (resolvedNextAction === "RUN_SEARCH") {
    inventory = await searchStays(mergedPlan, {
      limit: limits,
      maxResults: AI_LIMITS.maxResults,
    });
  }

  let trip = null;
  if (tripRequest) {
    const location = await resolveTripLocation(nextState.tripContext, nextState, mergedPlan, userContext);
    if (location) {
      const suggestions = await buildTripSuggestions({ request: tripRequest, location });
      const itinerary = buildItinerary({
        request: tripRequest,
        tripContext: nextState.tripContext,
        suggestions,
      });
      let insights = [];
      let preparation = [];
      const isHubInit = (uiEvent?.id || uiEvent?.event || uiEvent) === "TRIP_HUB_INIT";

      if (isHubInit) {
        const addons = await generateTripAddons({
          tripContext: nextState.tripContext,
          location,
          lang: mergedPlan?.language || "en"
        });
        insights = addons.insights;
        preparation = addons.preparation;
      }

      trip = {
        request: tripRequest,
        location,
        suggestions,
        itinerary,
        insights,
        preparation,
      };
      resolvedIntent = INTENTS.TRIP;
      resolvedNextAction = NEXT_ACTIONS.RUN_TRIP;
      if (mergedPlan) {
        mergedPlan.intent = INTENTS.TRIP;
      }
    }
  }

  const updatedState = updateStageFromAction(nextState, resolvedNextAction);
  if (resolvedNextAction === "RUN_SEARCH") {
    const shownIds = [
      ...(inventory.homes || []).map((item) => String(item.id)),
      ...(inventory.hotels || []).map((item) => String(item.id)),
    ].filter(Boolean);
    updatedState.lastResultsContext = {
      lastSearchId: `search-${Date.now()}`,
      shownIds,
    };
  }

  const rendered = await renderAssistantPayload({
    plan: mergedPlan,
    messages: normalizedMessages,
    inventory,
    nextAction: resolvedNextAction,
    trip,
    tripContext: nextState.tripContext,
    userContext,
    weather: resolvedWeather,
    missing: outcome.missing,
  });

  logAiEvent("turn", {
    sessionId,
    userId,
    intent: resolvedIntent,
    nextAction: resolvedNextAction,
    missing: outcome.missing,
    homes: inventory.homes?.length || 0,
    hotels: inventory.hotels?.length || 0,
    trip: trip ? trip.suggestions?.length || 0 : 0,
  });

  return {
    reply: rendered.assistant?.text || "",
    assistant: rendered.assistant || { text: "", tone: "neutral", disclaimers: [] },
    followUps: rendered.followUps || [],
    ui: rendered.ui || { chips: [], cards: [], inputs: [], sections: [] },
    plan: mergedPlan,
    inventory,
    trip,
    weather: resolvedWeather,
    state: updatedState,
    intent: resolvedIntent,
    nextAction: resolvedNextAction,
    safeMode: outcome.safeMode,
  };
};
