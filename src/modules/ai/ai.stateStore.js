import models from "../../models/index.js";

const DEBUG_AI_STATE_STORE =
  String(process.env.AI_DEBUG_LOGS || "").trim().toLowerCase() === "true";

const debugStateStore = (...args) => {
  if (!DEBUG_AI_STATE_STORE) return;
  console.log(...args);
};

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
  lastSearchParams: null,
  lastShownInventorySummary: null,
  locks: {
    bookingFlowLocked: false,
  },
  searchPlan: null,
  tripContext: null,
};

const MAX_LAST_SHOWN_ITEMS = 20;

const normalizeLastSearchParams = (value) => {
  if (!value || typeof value !== "object") return null;
  const loc = value.location && typeof value.location === "object" ? value.location : {};
  const dates = value.dates && typeof value.dates === "object" ? value.dates : {};
  const guests = value.guests && typeof value.guests === "object" ? value.guests : {};
  return {
    location: {
      city: normalizeString(loc.city),
      state: normalizeString(loc.state),
      country: normalizeString(loc.country),
      lat: normalizeNumber(loc.lat),
      lng: normalizeNumber(loc.lng ?? loc.lon),
    },
    dates: {
      checkIn: normalizeString(dates.checkIn),
      checkOut: normalizeString(dates.checkOut),
      flexible: typeof dates.flexible === "boolean" ? dates.flexible : true,
    },
    guests: {
      adults: normalizeNumber(guests.adults ?? guests.total),
      children: normalizeNumber(guests.children),
    },
    filters: {
      amenities: normalizeArray(value.filters?.amenities),
      sortBy: normalizeString(value.filters?.sortBy ?? value.sortBy),
    },
  };
};

const normalizeInventorySummaryItem = (item, type) => {
  if (!item || typeof item !== "object") return null;
  const id = item.id != null ? String(item.id) : null;
  if (!id) return null;
  const name = normalizeString(item.name ?? item.title ?? "");
  const city = normalizeString(item.city ?? "");
  const amenities = Array.isArray(item.amenities)
    ? item.amenities.slice(0, 50).map((a) => (typeof a === "string" ? a : a?.name ?? String(a)))
    : [];
  const descriptions = Array.isArray(item.descriptions)
    ? item.descriptions.slice(0, 8).map((entry) => (typeof entry === "string" ? entry : String(entry)))
    : [];
  const out = {
    id,
    name: name || id,
    city,
    displayOrder: normalizeNumber(item.displayOrder ?? item.rank ?? item.order),
    pricePerNight: normalizeNumber(item.pricePerNight ?? item.price_per_night),
    currency: normalizeString(item.currency) || "USD",
    amenities,
    descriptions,
  };
  if (type === "hotel") {
    out.stars = normalizeString(item.stars ?? item.classification?.name ?? null) || null;
  }
  if (typeof item.shortReason === "string" && item.shortReason.trim()) {
    out.shortReason = item.shortReason.trim();
  }
  return out;
};

const normalizeLastShownInventorySummary = (value) => {
  if (!value || typeof value !== "object") return null;
  const at = normalizeString(value.at) || null;
  const searchId = normalizeString(value.searchId ?? value.lastSearchId) || null;
  const hotels = (Array.isArray(value.hotels) ? value.hotels : [])
    .slice(0, MAX_LAST_SHOWN_ITEMS)
    .map((h) => normalizeInventorySummaryItem(h, "hotel"))
    .filter(Boolean);
  const homes = (Array.isArray(value.homes) ? value.homes : [])
    .slice(0, MAX_LAST_SHOWN_ITEMS)
    .map((h) => normalizeInventorySummaryItem(h, "home"))
    .filter(Boolean);
  if (!hotels.length && !homes.length) return null;
  return { at, searchId, hotels, homes };
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

  next.lastSearchParams = normalizeLastSearchParams(state.lastSearchParams) || null;
  next.lastShownInventorySummary = normalizeLastShownInventorySummary(state.lastShownInventorySummary) || null;

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

  if (state?.lastResultsContext?.shownIds?.length) {
    debugStateStore(
      `[DEBUG_STORE] LOADED state for ${sessionId}. ShownIds: ${state.lastResultsContext.shownIds.length}`
    );
  } else {
    debugStateStore(`[DEBUG_STORE] LOADED state for ${sessionId}. ShownIds: 0 (or null)`);
  }

  return normalizeState(state);
};

export const saveAssistantState = async ({ sessionId, userId, state }) => {
  if (!sessionId || !userId) return null;
  const session = await models.AiChatSession.findOne({
    where: { id: sessionId, user_id: userId },
    attributes: ["id", "metadata"],
  });
  if (!session) return null;

  // Clone to ensure we are not mutating the Sequelize instance in-place effectively invisible to update
  const currentMetadata = parseMetadata(session.metadata);
  const nextMetadata = { ...currentMetadata };

  nextMetadata.aiState = normalizeState(state);

  const count = nextMetadata.aiState?.lastResultsContext?.shownIds?.length || 0;
  debugStateStore(`[DEBUG_STORE] SAVING state for ${sessionId}. ShownIds: ${count}`);

  // Force update by passing a new object reference
  await session.update({ metadata: nextMetadata });
  return nextMetadata.aiState;
};
