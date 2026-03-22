import models from "../../models/index.js";

const STATE_KEY = "assistantState";

export const getDefaultState = () => ({
  stage: "NEED_DESTINATION",
  destination: { name: null, lat: null, lon: null },
  dates: { checkIn: null, checkOut: null, flexible: true },
  guests: { adults: null, children: null },
  budget: { min: null, max: null, currency: "USD" },
  preferences: {
    listingTypes: [],
    sortBy: null,
    areaPreference: [],
    nearbyInterest: null,
    amenities: [],
    propertyType: [],
  },
  searchPlan: {},
  locks: { bookingFlowLocked: false },
  tripContext: null,
  lastShownInventorySummary: null,
  lastResultsContext: null,
  lastSearchParams: null,
  pendingToolCall: null,
});

export const loadAssistantState = async ({ sessionId, userId }) => {
  if (!sessionId || !userId) return null;
  try {
    const session = await models.AiChatSession.findOne({
      where: { id: sessionId, user_id: userId },
      attributes: ["metadata"],
    });
    if (!session) return null;
    const meta = session.metadata;
    if (!meta || typeof meta !== "object") return null;
    const stored = meta[STATE_KEY];
    if (!stored || typeof stored !== "object") return null;
    return stored;
  } catch (err) {
    console.warn("[ai.stateStore] loadAssistantState failed", err?.message || err);
    return null;
  }
};

export const saveAssistantState = async ({ sessionId, userId, state }) => {
  if (!sessionId || !userId || !state) return;
  try {
    const session = await models.AiChatSession.findOne({
      where: { id: sessionId, user_id: userId },
      attributes: ["id", "metadata"],
    });
    if (!session) return;
    const meta = session.metadata && typeof session.metadata === "object"
      ? { ...session.metadata }
      : {};
    meta[STATE_KEY] = state;
    await session.update({ metadata: meta });
  } catch (err) {
    console.warn("[ai.stateStore] saveAssistantState failed", err?.message || err);
  }
};
