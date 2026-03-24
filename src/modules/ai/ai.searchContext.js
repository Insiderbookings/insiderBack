import { getDefaultState } from "./ai.stateStore.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizeSearchContextText = (value = "") =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildDestinationSignature = (location = {}) => {
  const city = normalizeSearchContextText(location?.city);
  const country = normalizeSearchContextText(location?.country);
  const state = normalizeSearchContextText(location?.state);
  const landmark = normalizeSearchContextText(location?.landmark);
  const rawQuery = normalizeSearchContextText(location?.rawQuery);
  const lat =
    location?.lat == null || !Number.isFinite(Number(location.lat))
      ? null
      : Number(location.lat).toFixed(4);
  const lng =
    (location?.lng ?? location?.lon) == null ||
    !Number.isFinite(Number(location?.lng ?? location?.lon))
      ? null
      : Number(location.lng ?? location.lon).toFixed(4);

  return [city || rawQuery || null, state || null, country || null, landmark || null, lat, lng]
    .filter((value) => value != null && value !== "")
    .join("|");
};

const buildSemanticScopeSignature = (plan = {}) => {
  const intentProfile =
    plan?.semanticSearch?.intentProfile &&
    typeof plan.semanticSearch.intentProfile === "object"
      ? plan.semanticSearch.intentProfile
      : {};
  const starRatings = Array.isArray(plan?.starRatings)
    ? [...new Set(plan.starRatings.map((value) => Number(value)).filter(Number.isFinite))]
        .sort((left, right) => left - right)
        .join(",")
    : "";
  const requestedTraits = Array.isArray(intentProfile?.userRequestedAreaTraits)
    ? intentProfile.userRequestedAreaTraits
    : Array.isArray(intentProfile?.requestedAreaTraits)
      ? intentProfile.requestedAreaTraits
      : [];
  const explicitZones = Array.isArray(intentProfile?.userRequestedZones)
    ? intentProfile.userRequestedZones
    : Array.isArray(intentProfile?.requestedZones)
      ? intentProfile.requestedZones
      : [];
  const explicitLandmarks = Array.isArray(intentProfile?.userRequestedLandmarks)
    ? intentProfile.userRequestedLandmarks
    : Array.isArray(intentProfile?.requestedLandmarks)
      ? intentProfile.requestedLandmarks
      : [];

  return {
    inferenceMode: intentProfile?.inferenceMode || null,
    viewIntent: plan?.viewIntent || null,
    areaIntent: plan?.areaIntent || null,
    qualityIntent: plan?.qualityIntent || null,
    geoIntent: plan?.geoIntent || null,
    starRatings,
    requestedTraits: requestedTraits.join(","),
    explicitZones: explicitZones.join(","),
    explicitLandmarks: explicitLandmarks.join(","),
  };
};

export const buildSearchContextKey = (plan = {}) => {
  const location =
    plan?.location && typeof plan.location === "object" ? plan.location : {};
  const destinationSignature = buildDestinationSignature(location);
  const semanticSignature = buildSemanticScopeSignature(plan);
  return JSON.stringify({
    destination: destinationSignature || null,
    semantic: semanticSignature,
  });
};

export const shouldResetSearchContextForNewDestination = ({
  state = null,
  nextPlan = null,
} = {}) => {
  const previousState = state && typeof state === "object" ? state : null;
  const plan = nextPlan && typeof nextPlan === "object" ? nextPlan : null;
  if (!previousState || !plan) return false;

  const nextDestinationSignature = buildDestinationSignature(plan.location || {});
  if (!nextDestinationSignature) return false;

  const previousLocation =
    previousState?.searchPlan?.location &&
    typeof previousState.searchPlan.location === "object"
      ? previousState.searchPlan.location
      : {
          city: previousState?.destination?.name || null,
        };
  const previousDestinationSignature = buildDestinationSignature(previousLocation);
  if (!previousDestinationSignature) return false;

  return previousDestinationSignature !== nextDestinationSignature;
};

export const resetDestinationScopedSearchState = (state = null) => {
  const baseState = clone(state || getDefaultState());
  baseState.destination = { name: null, lat: null, lon: null };
  baseState.searchPlan = {};
  baseState.lastShownInventorySummary = null;
  baseState.lastResultsContext = null;
  baseState.lastReferencedHotelIds = [];
  baseState.lastSearchParams = null;
  baseState.currentSearchContextKey = null;
  return baseState;
};
