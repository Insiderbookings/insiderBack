import axios from "axios";

const DEFAULT_RADIUS_KM = 10;
const MAX_RADIUS_KM = 15;
const MIN_RADIUS_KM = 0.5;

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const toCoordPair = (location) => {
  if (!location) return null;
  const lat =
    toNumber(location.lat) ??
    toNumber(location.latitude) ??
    toNumber(location.locationLat) ??
    toNumber(location.coords?.lat) ??
    null;
  const lng =
    toNumber(location.lng) ??
    toNumber(location.lon) ??
    toNumber(location.longitude) ??
    toNumber(location.locationLng) ??
    toNumber(location.coords?.lng) ??
    null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const clampRadiusKm = (value) => {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) return DEFAULT_RADIUS_KM;
  return Math.max(MIN_RADIUS_KM, Math.min(MAX_RADIUS_KM, numeric));
};

const toMeters = (km) => Math.round(Number(km || 0) * 1000);

const degreesToRadians = (deg) => (deg * Math.PI) / 180;

const computeDistanceKm = (from, to) => {
  if (!from || !to) return null;
  const earthRadiusKm = 6371;
  const dLat = degreesToRadians(to.lat - from.lat);
  const dLng = degreesToRadians(to.lng - from.lng);
  const originLat = degreesToRadians(from.lat);
  const destLat = degreesToRadians(to.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(originLat) * Math.cos(destLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((earthRadiusKm * c).toFixed(2));
};

const normalizePlace = (item, origin) => {
  if (!item) return null;
  const location = item.geometry?.location;
  const lat = toNumber(location?.lat);
  const lng = toNumber(location?.lng);
  const coords = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  // Extract photo
  let photoUrl = null;
  if (Array.isArray(item.photos) && item.photos.length > 0) {
    const ref = item.photos[0].photo_reference;
    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;

    console.log(`[ai] place ${item.name} | hasRef: ${!!ref} | hasKey: ${!!apiKey}`);

    if (ref && apiKey) {
      photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${ref}&key=${apiKey}`;
    }
  }

  return {
    id: item.place_id,
    name: item.name,
    address: item.vicinity || item.formatted_address || null,
    rating: Number.isFinite(Number(item.rating)) ? Number(item.rating) : null,
    ratingsCount: Number.isFinite(Number(item.user_ratings_total)) ? Number(item.user_ratings_total) : null,
    priceLevel: Number.isFinite(Number(item.price_level)) ? Number(item.price_level) : null,
    types: Array.isArray(item.types) ? item.types : [],
    location: coords,
    distanceKm: coords ? computeDistanceKm(origin, coords) : null,
    openNow: Boolean(item.opening_hours?.open_now),
    photoUrl,
    mapsUrl: item.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${item.place_id}`
      : null,
  };
};

const fetchPlaceDetailsPhoto = async (placeId) => {
  if (!placeId) return null;
  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  try {
    const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/details/json", {
      params: {
        place_id: placeId,
        key: apiKey,
        fields: "photos",
      },
      timeout: 5000,
    });
    const photos = Array.isArray(data?.result?.photos) ? data.result.photos : [];
    const ref = photos[0]?.photo_reference;
    if (!ref) return null;
    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${ref}&key=${apiKey}`;
  } catch (err) {
    console.warn("[ai] places details failed", err?.message || err);
    return null;
  }
};

export const getNearbyPlaces = async ({
  location,
  radiusKm,
  type,
  keyword,
  limit = 6,
  hydratePhotos = false,
} = {}) => {
  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY;
  if (!apiKey) return [];

  const coords = toCoordPair(location);
  if (!coords) return [];

  const radiusMeters = toMeters(clampRadiusKm(radiusKm));
  const params = {
    location: `${coords.lat},${coords.lng}`,
    radius: radiusMeters,
    key: apiKey,
  };
  if (type) params.type = type;
  if (keyword) params.keyword = keyword;

  try {
    const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/nearbysearch/json", {
      params,
      timeout: 5000,
    });
    if (!data || !Array.isArray(data.results)) return [];
    const items = data.results
      .map((item) => normalizePlace(item, coords))
      .filter(Boolean);

    if (hydratePhotos) {
      const withPhoto = [];
      for (const item of items) {
        if (!item.photoUrl && item.id) {
          const detailPhoto = await fetchPlaceDetailsPhoto(item.id);
          if (detailPhoto) item.photoUrl = detailPhoto;
        }
        withPhoto.push(item);
      }
      return withPhoto.slice(0, Math.max(1, Math.min(10, Number(limit) || 6)));
    }

    const sorted = items.sort((a, b) => {
      if (a.distanceKm != null && b.distanceKm != null) {
        return a.distanceKm - b.distanceKm;
      }
      return (b.rating || 0) - (a.rating || 0);
    });
    return sorted.slice(0, Math.max(1, Math.min(10, Number(limit) || 6)));
  } catch (err) {
    console.warn("[ai] places lookup failed", err?.message || err);
    return [];
  }
};
