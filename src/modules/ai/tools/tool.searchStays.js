import { searchHomesForPlan, searchHotelsForPlan } from "../../../services/assistantSearch.service.js";

export const searchStays = async (plan, { limit, maxResults = 5 } = {}) => {
  const listingTypes = Array.isArray(plan?.listingTypes) ? plan.listingTypes : ["HOMES"];
  const wantsHomes = listingTypes.includes("HOMES") || listingTypes.length === 0;
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
  };
};
