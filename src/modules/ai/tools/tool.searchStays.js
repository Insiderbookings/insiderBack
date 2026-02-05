import { searchHomesForPlan, searchHotelsForPlan } from "../../../services/assistantSearch.service.js";

export const searchStays = async (plan, { limit, maxResults = 5 } = {}) => {
  const listingTypes =
    Array.isArray(plan?.listingTypes) && plan.listingTypes.length
      ? plan.listingTypes
      : ["HOMES", "HOTELS"];
  const wantsHomes = listingTypes.includes("HOMES");
  const wantsHotels = listingTypes.includes("HOTELS");

  const [homesResult, hotelsResult] = await Promise.all([
    wantsHomes ? searchHomesForPlan(plan, { limit: limit?.homes }) : { items: [], matchType: "NONE" },
    wantsHotels ? searchHotelsForPlan(plan, { limit: limit?.hotels }) : { items: [], matchType: "NONE" },
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
