import { getDefaultState } from "./ai.stateStore.js";

export const INTENTS = {
  SEARCH: "SEARCH",
  HELP: "HELP",
  SMALL_TALK: "SMALL_TALK",
  TRIP: "TRIP",
};

export const NEXT_ACTIONS = {
  ASK_FOR_DESTINATION: "ASK_FOR_DESTINATION",
  ASK_FOR_DATES: "ASK_FOR_DATES",
  ASK_FOR_GUESTS: "ASK_FOR_GUESTS",
  RUN_SEARCH: "RUN_SEARCH",
  RUN_TRIP: "RUN_TRIP",
  HELP: "HELP",
  SMALL_TALK: "SMALL_TALK",
};

export const STAGES = {
  NEED_DESTINATION: "NEED_DESTINATION",
  NEED_DATES: "NEED_DATES",
  NEED_GUESTS: "NEED_GUESTS",
  SHOW_RESULTS: "SHOW_RESULTS",
  DETAILS: "DETAILS",
  QUOTE: "QUOTE",
  READY_TO_BOOK: "READY_TO_BOOK",
  BOOKED: "BOOKED",
  TRIP_ASSIST: "TRIP_ASSIST",
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const mergeSearchPlans = (base, incoming) => {
  const output = clone(base || {});
  if (!incoming || typeof incoming !== "object") return output;
  Object.entries(incoming).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (typeof value === "string" && !value.trim()) return;
    if (Array.isArray(value)) {
      if (value.length) output[key] = value.slice();
      return;
    }
    if (isObject(value)) {
      output[key] = mergeSearchPlans(output[key] || {}, value);
      return;
    }
    output[key] = value;
  });
  return output;
};

const normalizeNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const buildDestinationName = (location = {}) => {
  const parts = [location.city, location.state, location.country]
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

const hasDestination = (state) => {
  if (!state) return false;
  if (state.destination?.name) return true;
  if (state.destination?.lat != null && state.destination?.lon != null) return true;
  return false;
};

const hasDates = (state) =>
  Boolean(state?.dates?.checkIn && state?.dates?.checkOut);

const hasGuests = (state) => {
  const adults = normalizeNumber(state?.guests?.adults);
  const children = normalizeNumber(state?.guests?.children);
  return Boolean((adults && adults > 0) || (children && children > 0));
};

export const applyPlanToState = (state, plan) => {
  const baseState = clone(state || getDefaultState());
  const mergedPlan = mergeSearchPlans(baseState.searchPlan || {}, plan || {});
  baseState.searchPlan = mergedPlan;

  const location = mergedPlan.location || {};
  const destinationName = buildDestinationName(location);
  if (destinationName) {
    baseState.destination.name = destinationName;
  }
  const lat = normalizeNumber(location.lat);
  const lon = normalizeNumber(location.lng ?? location.lon);
  if (lat != null) baseState.destination.lat = lat;
  if (lon != null) baseState.destination.lon = lon;

  const dates = mergedPlan.dates || {};
  if (dates.checkIn) baseState.dates.checkIn = dates.checkIn;
  if (dates.checkOut) baseState.dates.checkOut = dates.checkOut;
  if (typeof dates.flexible === "boolean") {
    baseState.dates.flexible = dates.flexible;
  }

  const guests = mergedPlan.guests || {};
  const adults = normalizeNumber(guests.adults ?? guests.total);
  const children = normalizeNumber(guests.children);
  if (adults != null) baseState.guests.adults = adults;
  if (children != null) baseState.guests.children = children;

  const budget = mergedPlan.budget || {};
  const min = normalizeNumber(budget.min);
  const max = normalizeNumber(budget.max);
  if (min != null) baseState.budget.min = min;
  if (max != null) baseState.budget.max = max;
  if (budget.currency) baseState.budget.currency = budget.currency;

  const listingTypes = Array.isArray(mergedPlan.listingTypes) ? mergedPlan.listingTypes : [];
  if (listingTypes.length) baseState.preferences.listingTypes = listingTypes;
  if (mergedPlan.sortBy) baseState.preferences.sortBy = mergedPlan.sortBy;

  const homeFilters = mergedPlan.homeFilters || {};
  const hotelFilters = mergedPlan.hotelFilters || {};
  const amenityKeys = Array.isArray(homeFilters.amenityKeys) ? homeFilters.amenityKeys : [];
  const hotelAmenityCodes = Array.isArray(hotelFilters.amenityCodes) ? hotelFilters.amenityCodes : [];
  const hotelAmenityItems = Array.isArray(hotelFilters.amenityItemIds) ? hotelFilters.amenityItemIds : [];
  const propertyTypes = Array.isArray(homeFilters.propertyTypes) ? homeFilters.propertyTypes : [];
  const mergedAmenities = [...amenityKeys, ...hotelAmenityCodes, ...hotelAmenityItems].filter(Boolean);
  if (mergedAmenities.length) baseState.preferences.amenities = mergedAmenities;
  if (propertyTypes.length) baseState.preferences.propertyType = propertyTypes;

  return { state: baseState, plan: mergedPlan };
};

export const buildPlanOutcome = ({ state, plan }) => {
  const baseIntent = plan?.intent || INTENTS.SMALL_TALK;
  const intent = baseIntent;

  const missing = [];
  if (intent === INTENTS.SEARCH) {
    if (!hasDestination(state)) missing.push("DESTINATION");
    if (!hasDates(state)) missing.push("DATES");
    if (!hasGuests(state)) missing.push("GUESTS");
  }

  let nextAction = NEXT_ACTIONS.SMALL_TALK;
  if (intent === INTENTS.HELP) {
    nextAction = NEXT_ACTIONS.HELP;
  } else if (intent === INTENTS.SEARCH) {
    if (missing.includes("DESTINATION")) {
      nextAction = NEXT_ACTIONS.ASK_FOR_DESTINATION;
    } else {
      // Contextual Search: Run search even if dates/guests are missing (Static Mode)
      // The Renderer will see 'missing' fields and add UI Chips (Select Dates, etc.)
      nextAction = NEXT_ACTIONS.RUN_SEARCH;
    }
  }

  const safeMode = Boolean(
    state?.locks?.bookingFlowLocked ||
    [STAGES.QUOTE, STAGES.READY_TO_BOOK].includes(state?.stage)
  );

  return {
    intent,
    missing,
    nextAction,
    safeMode,
  };
};

export const updateStageFromAction = (state, nextAction) => {
  const next = clone(state || getDefaultState());
  if (nextAction === NEXT_ACTIONS.ASK_FOR_DESTINATION) {
    next.stage = STAGES.NEED_DESTINATION;
  } else if (nextAction === NEXT_ACTIONS.ASK_FOR_DATES) {
    next.stage = STAGES.NEED_DATES;
  } else if (nextAction === NEXT_ACTIONS.ASK_FOR_GUESTS) {
    next.stage = STAGES.NEED_GUESTS;
  } else if (nextAction === NEXT_ACTIONS.RUN_SEARCH) {
    next.stage = STAGES.SHOW_RESULTS;
  } else if (nextAction === NEXT_ACTIONS.RUN_TRIP) {
    next.stage = STAGES.TRIP_ASSIST;
  }
  return next;
};
