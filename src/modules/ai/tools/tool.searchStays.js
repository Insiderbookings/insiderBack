import { searchHomesForPlan, searchHotelsForPlan } from "../../../services/assistantSearch.service.js";

export const searchStays = async (plan, { limit, maxResults = 5, excludeIds = [] } = {}) => {
  const SEARCH_HOMES_ENABLED = false; // Feature flag: Temporarily disabled

  const listingTypes =
    Array.isArray(plan?.listingTypes) && plan.listingTypes.length
      ? plan.listingTypes
      : ["HOMES", "HOTELS"];

  let wantsHomes = listingTypes.includes("HOMES");
  let wantsHotels = listingTypes.includes("HOTELS");

  if (wantsHomes && !SEARCH_HOMES_ENABLED) {
    wantsHomes = false;
    // If user asked ONLY for homes (wantsHotels was false), force hotels so they get at least some results
    if (!wantsHotels) {
      wantsHotels = true;
    }
  }

  // Split excludes if needed (or pass all to both, usually they have different ID formats)
  // Homes are usually integers or UUIDs, Hotels are strings/integers. Passing full list is safe.

  const [homesResult, hotelsResult] = await Promise.all([
    wantsHomes ? searchHomesForPlan(plan, { limit: limit?.homes, excludeIds }) : { items: [], matchType: "NONE" },
    wantsHotels ? searchHotelsForPlan(plan, { limit: limit?.hotels, excludeIds }) : { items: [], matchType: "NONE" },
  ]);

  const homes = Array.isArray(homesResult?.items) ? homesResult.items : [];
  const hotels = Array.isArray(hotelsResult?.items) ? hotelsResult.items : [];

  return {
    homes: homes.slice(0, maxResults),
    hotels: hotels.slice(0, maxResults),
    matchTypes: {
      homes: homesResult?.matchType || "NONE",
      hotels: hotelsResult?.matchType || "NONE",
    },
    foundExact:
      homesResult?.matchType === "EXACT" || hotelsResult?.matchType === "EXACT",
  };
};
