import axios from "axios";

export const geocodePlace = async (placeText) => {
  const query = String(placeText || "").trim();
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

  if (!query) return null;
  if (!apiKey) {
    console.warn("[ai] geocode - Missing Google API Key in env");
    return null;
  }

  console.log(`[ai] geocoding: "${query}" with key length: ${apiKey.length}`);

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    query
  )}&key=${apiKey}`;
  try {
    const { data } = await axios.get(url, { timeout: 4000 });
    if (data?.status !== "OK" || !Array.isArray(data.results) || !data.results.length) {
      return null;
    }
    const result = data.results[0];
    const location = result.geometry?.location || {};
    const viewport = result.geometry?.viewport || {};
    return {
      name: result.formatted_address || query,
      placeId: result.place_id || null,
      lat: Number(location.lat) || null,
      lon: Number(location.lng) || null,
      bbox: viewport.northeast && viewport.southwest ? { ...viewport } : null,
      confidence: 0.7,
      source: "google",
    };
  } catch (err) {
    console.warn("[ai] geocode failed", err?.message || err);
    return null;
  }
};
