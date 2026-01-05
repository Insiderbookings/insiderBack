import models from "../../models/index.js";

const DEFAULT_STATE = {
  stage: "NEED_DESTINATION",
  destination: {
    name: null,
    placeId: null,
    lat: null,
    lon: null,
    timezone: null,
    bbox: null,
    confidence: null,
  },
  dates: {
    checkIn: null,
    checkOut: null,
    flexible: true,
    originalText: null,
  },
  rooms: null,
  guests: {
    adults: null,
    children: null,
    childrenAges: [],
  },
  budget: {
    min: null,
    max: null,
    currency: "USD",
  },
  preferences: {
    amenities: [],
    areas: [],
    cancellationPolicy: null,
    propertyType: [],
    listingTypes: [],
    sortBy: null,
  },
  lastResultsContext: {
    lastSearchId: null,
    shownIds: [],
  },
  locks: {
    bookingFlowLocked: false,
  },
  searchPlan: null,
  tripContext: null,
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const parseMetadata = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeString = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeState = (state) => {
  const base = clone(DEFAULT_STATE);
  if (!state || typeof state !== "object") return base;
  const next = { ...base, ...state };

  next.destination = {
    ...base.destination,
    ...(state.destination || {}),
  };
  next.destination.name = normalizeString(next.destination.name);
  next.destination.placeId = normalizeString(next.destination.placeId);
  next.destination.lat = normalizeNumber(next.destination.lat);
  next.destination.lon = normalizeNumber(next.destination.lon);
  next.destination.timezone = normalizeString(next.destination.timezone);
  next.destination.confidence = normalizeNumber(next.destination.confidence);
  next.destination.bbox = Array.isArray(next.destination.bbox) ? next.destination.bbox : null;

  next.dates = { ...base.dates, ...(state.dates || {}) };
  next.dates.checkIn = normalizeString(next.dates.checkIn);
  next.dates.checkOut = normalizeString(next.dates.checkOut);
  next.dates.flexible = typeof next.dates.flexible === "boolean" ? next.dates.flexible : base.dates.flexible;
  next.dates.originalText = normalizeString(next.dates.originalText);

  next.rooms = normalizeNumber(next.rooms);

  next.guests = { ...base.guests, ...(state.guests || {}) };
  next.guests.adults = normalizeNumber(next.guests.adults);
  next.guests.children = normalizeNumber(next.guests.children);
  next.guests.childrenAges = normalizeArray(next.guests.childrenAges);

  next.budget = { ...base.budget, ...(state.budget || {}) };
  next.budget.min = normalizeNumber(next.budget.min);
  next.budget.max = normalizeNumber(next.budget.max);
  next.budget.currency = normalizeString(next.budget.currency) || base.budget.currency;

  next.preferences = { ...base.preferences, ...(state.preferences || {}) };
  next.preferences.amenities = normalizeArray(next.preferences.amenities);
  next.preferences.areas = normalizeArray(next.preferences.areas);
  next.preferences.propertyType = normalizeArray(next.preferences.propertyType);
  next.preferences.listingTypes = normalizeArray(next.preferences.listingTypes);
  next.preferences.cancellationPolicy = normalizeString(next.preferences.cancellationPolicy);
  next.preferences.sortBy = normalizeString(next.preferences.sortBy);

  next.lastResultsContext = { ...base.lastResultsContext, ...(state.lastResultsContext || {}) };
  next.lastResultsContext.lastSearchId = normalizeString(next.lastResultsContext.lastSearchId);
  next.lastResultsContext.shownIds = normalizeArray(next.lastResultsContext.shownIds);

  next.locks = { ...base.locks, ...(state.locks || {}) };
  next.locks.bookingFlowLocked = Boolean(next.locks.bookingFlowLocked);

  if (state.searchPlan && typeof state.searchPlan === "object") {
    next.searchPlan = state.searchPlan;
  } else {
    next.searchPlan = null;
  }

  if (state.tripContext && typeof state.tripContext === "object") {
    next.tripContext = state.tripContext;
  } else {
    next.tripContext = null;
  }

  if (typeof next.stage !== "string" || !next.stage.trim()) {
    next.stage = base.stage;
  }

  return next;
};

export const getDefaultState = () => clone(DEFAULT_STATE);

export const loadAssistantState = async ({ sessionId, userId }) => {
  if (!sessionId || !userId) return normalizeState(null);
  const session = await models.AiChatSession.findOne({
    where: { id: sessionId, user_id: userId },
    attributes: ["id", "metadata"],
  });
  if (!session) return normalizeState(null);
  const metadata = parseMetadata(session.metadata);
  const state = metadata.aiState || metadata.ai_state || null;
  return normalizeState(state);
};

export const saveAssistantState = async ({ sessionId, userId, state }) => {
  if (!sessionId || !userId) return null;
  const session = await models.AiChatSession.findOne({
    where: { id: sessionId, user_id: userId },
    attributes: ["id", "metadata"],
  });
  if (!session) return null;
  const metadata = parseMetadata(session.metadata);
  metadata.aiState = normalizeState(state);
  await session.update({ metadata });
  return metadata.aiState;
};
