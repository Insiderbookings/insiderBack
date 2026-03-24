import axios from "axios";

const AI_PLACES_DISABLED =
  String(process.env.AI_PLACES_DISABLED || "").trim().toLowerCase() === "true";
const DEBUG_AI_PLACES =
  String(process.env.DEBUG_AI_PLACES || "").trim().toLowerCase() === "true";

const DEFAULT_RADIUS_KM = 10;
const MAX_RADIUS_KM = 15;
const MIN_RADIUS_KM = 0.5;

const PLACE_TYPE_HINT_SET = new Set([
  "AIRPORT",
  "LANDMARK",
  "DISTRICT",
  "STATION",
  "PORT",
  "VENUE",
  "GENERIC",
]);

const normalizeResolverText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizePlaceTypeHint = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return PLACE_TYPE_HINT_SET.has(normalized) ? normalized : "GENERIC";
};

const isPlaceholderCoordPair = (lat, lng) => lat === 0 && lng === 0;

const hasValidCoordPair = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  !isPlaceholderCoordPair(lat, lng);

const inferPlaceTypeHintFromQuery = (query = "", fallback = "GENERIC") => {
  const normalized = normalizeResolverText(query);
  if (!normalized) return normalizePlaceTypeHint(fallback);
  if (/\b(airport|aeropuerto|aeroparque|ezeiza)\b/.test(normalized)) {
    return "AIRPORT";
  }
  if (/\b(station|estacion|terminal|retiro)\b/.test(normalized)) {
    return "STATION";
  }
  if (/\b(port|puerto|harbor|marina)\b/.test(normalized)) {
    return "PORT";
  }
  if (
    /\b(obelisco|obelisk|cemetery|cementerio|museum|museo|park|parque|tower|torre|stadium|estadio|arena|plaza)\b/.test(
      normalized,
    )
  ) {
    return "LANDMARK";
  }
  if (/\b(neighborhood|barrio|district|zona|area)\b/.test(normalized)) {
    return "DISTRICT";
  }
  return normalizePlaceTypeHint(fallback);
};

const isGenericPlaceQuery = (query = "", placeTypeHint = "GENERIC") => {
  const normalized = normalizeResolverText(query);
  if (!normalized) return false;
  if (
    placeTypeHint === "AIRPORT" &&
    /^(airport|aeropuerto)$/.test(normalized)
  ) {
    return true;
  }
  if (
    placeTypeHint === "STATION" &&
    /^(station|estacion|terminal)$/.test(normalized)
  ) {
    return true;
  }
  if (
    placeTypeHint === "PORT" &&
    /^(port|puerto|harbor)$/.test(normalized)
  ) {
    return true;
  }
  return /^(center|centro|downtown)$/.test(normalized);
};

const buildResolverCandidate = (entry, source = "catalog") => ({
  id: String(entry.id || ""),
  label: entry.label || entry.normalizedName || entry.name || "Place",
  normalizedName: entry.normalizedName || entry.name || entry.label || "Place",
  subtitle:
    [entry.city, entry.country].filter(Boolean).join(", ") || null,
  placeType: entry.placeType || "GENERIC",
  city: entry.city || null,
  country: entry.country || null,
  lat: hasValidCoordPair(Number(entry.lat), Number(entry.lng))
    ? Number(entry.lat)
    : null,
  lng: hasValidCoordPair(Number(entry.lat), Number(entry.lng))
    ? Number(entry.lng)
    : null,
  radiusMeters: Number.isFinite(Number(entry.radiusMeters))
    ? Math.max(300, Number(entry.radiusMeters))
    : null,
  source,
  aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
  confidence: entry.confidence || null,
});

const buildClarificationQuestion = (language = "es", placeTypeHint = "GENERIC") => {
  const lang = String(language || "es").toLowerCase();
  if (placeTypeHint === "AIRPORT") {
    if (lang.startsWith("en")) return "Which airport do you mean?";
    if (lang.startsWith("pt")) return "A qual aeroporto você se refere?";
    return "¿A cuál aeropuerto te referís?";
  }
  if (placeTypeHint === "STATION") {
    if (lang.startsWith("en")) return "Which station do you mean?";
    if (lang.startsWith("pt")) return "A qual estação você se refere?";
    return "¿A qué estación te referís?";
  }
  if (placeTypeHint === "PORT") {
    if (lang.startsWith("en")) return "Which port do you mean?";
    if (lang.startsWith("pt")) return "A qual porto você se refere?";
    return "¿A qué puerto te referís?";
  }
  if (lang.startsWith("en")) return "Which place do you mean exactly?";
  if (lang.startsWith("pt")) return "A qual lugar você se refere exatamente?";
  return "¿A qué lugar te referís exactamente?";
};

const buildNotFoundQuestion = (language = "es") => {
  const lang = String(language || "es").toLowerCase();
  if (lang.startsWith("en")) {
    return "I couldn't identify that place clearly. Can you be more specific?";
  }
  if (lang.startsWith("pt")) {
    return "Nao consegui identificar esse lugar com clareza. Pode ser mais especifico?";
  }
  return "No pude ubicar ese lugar con claridad. ¿Podés ser más específico?";
};

const mapGoogleResultToResolverCandidate = (item = {}, placeTypeHint = "GENERIC") => {
  const lat = toNumber(item.geometry?.location?.lat);
  const lng = toNumber(item.geometry?.location?.lng);
  if (!hasValidCoordPair(lat, lng)) return null;
  const types = Array.isArray(item.types) ? item.types : [];
  const hint = normalizePlaceTypeHint(placeTypeHint);
  if (
    hint === "AIRPORT" &&
    !types.includes("airport") &&
    !/\b(airport|aeropuerto|aeroparque|ezeiza)\b/i.test(item.name || "")
  ) {
    return null;
  }
  if (
    hint === "STATION" &&
    !types.some((type) =>
      ["train_station", "transit_station", "subway_station", "bus_station"].includes(type),
    ) &&
    !/\b(station|estacion|terminal)\b/i.test(item.name || "")
  ) {
    return null;
  }
  if (
    hint === "PORT" &&
    !types.some((type) => ["port", "marina"].includes(type)) &&
    !/\b(port|puerto|harbor|marina)\b/i.test(item.name || "")
  ) {
    return null;
  }

  return buildResolverCandidate(
    {
      id: item.place_id,
      label: item.name || item.formatted_address || "Place",
      normalizedName: item.name || item.formatted_address || "Place",
      placeType:
        hint !== "GENERIC"
          ? hint
          : types.includes("airport")
            ? "AIRPORT"
            : "LANDMARK",
      city: null,
      country: null,
      lat,
      lng,
      radiusMeters:
        hint === "AIRPORT"
          ? 6000
          : hint === "LANDMARK"
            ? 2000
            : 3000,
      aliases: [],
      confidence: 0.7,
    },
    "google_places",
  );
};

const resolveGooglePlaceCandidates = async ({
  query,
  city,
  country,
  placeTypeHint = "GENERIC",
  maxCandidates = 5,
} = {}) => {
  if (AI_PLACES_DISABLED) return [];
  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY;
  if (!apiKey) return [];

  try {
    const mergedQuery = [query, city, country].filter(Boolean).join(", ");
    const { data } = await axios.get(
      "https://maps.googleapis.com/maps/api/place/textsearch/json",
      {
        params: { query: mergedQuery, key: apiKey },
        timeout: 5000,
      },
    );
    if (!Array.isArray(data?.results) || !data.results.length) return [];
    return data.results
      .map((item) => mapGoogleResultToResolverCandidate(item, placeTypeHint))
      .filter(Boolean)
      .slice(0, Math.max(1, Math.min(Number(maxCandidates) || 5, 6)));
  } catch (err) {
    console.warn("[ai] resolve place reference failed", err?.message || err);
    return [];
  }
};

const finalizePlaceResolution = ({
  candidates = [],
  query,
  language = "es",
  placeTypeHint = "GENERIC",
} = {}) => {
  const normalizedCandidates = Array.isArray(candidates)
    ? candidates.filter(Boolean)
    : [];
  if (!normalizedCandidates.length) {
    return {
      status: "NOT_FOUND",
      confidence: "LOW",
      resolved_place: null,
      candidates: [],
      clarification_question: buildNotFoundQuestion(language),
    };
  }

  const top = normalizedCandidates[0];
  const second = normalizedCandidates[1] || null;
  const topScore = Number(top._score || 0);
  const secondScore = Number(second?._score || 0);
  const genericQuery = isGenericPlaceQuery(query, placeTypeHint);
  const topCandidate = {
    ...top,
    confidence:
      top.source === "catalog" && topScore >= 120
        ? "HIGH"
        : top.source === "catalog"
          ? "MEDIUM"
          : "MEDIUM",
  };

  if (
    normalizedCandidates.length === 1 ||
    (!genericQuery && topScore >= 120 && topScore - secondScore >= 25)
  ) {
    return {
      status: "RESOLVED",
      confidence: topCandidate.confidence,
      resolved_place: topCandidate,
      candidates: [],
      clarification_question: null,
    };
  }

  return {
    status: "AMBIGUOUS",
    confidence: "MEDIUM",
    resolved_place: null,
    candidates: normalizedCandidates.map(({ _score: _drop, ...candidate }) => candidate),
    clarification_question: buildClarificationQuestion(language, placeTypeHint),
  };
};

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

export const computeDistanceKm = (from, to) => {
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

    if (DEBUG_AI_PLACES) {
      console.log(`[ai] place ${item.name} | hasRef: ${!!ref} | hasKey: ${!!apiKey}`);
    }

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
  if (AI_PLACES_DISABLED) return [];
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

export const resolvePoiToCoordinates = async (query) => {
  if (AI_PLACES_DISABLED) return null;
  if (!query || typeof query !== "string") return null;
  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  try {
    const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/textsearch/json", {
      params: { query: query.trim(), key: apiKey },
      timeout: 5000,
    });
    if (!data || !Array.isArray(data.results) || !data.results.length) return null;
    const place = data.results[0];
    const lat = toNumber(place.geometry?.location?.lat);
    const lng = toNumber(place.geometry?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat,
      lng,
      name: place.name || query.trim(),
      address: place.formatted_address || null,
    };
  } catch (err) {
    console.warn("[ai] resolvePoiToCoordinates failed", err?.message || err);
    return null;
  }
};

export const searchDestinationImages = async (query, limit = 2) => {
  if (AI_PLACES_DISABLED) return [];
  if (!query || typeof query !== "string") return [];
  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY;
  if (!apiKey) return [];

  // Use Text Search to find the city/place itself
  try {
    const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/textsearch/json", {
      params: {
        query: query,
        key: apiKey,
      },
      timeout: 5000,
    });

    if (!data || !Array.isArray(data.results) || !data.results.length) return [];

    const results = data.results.slice(0, limit);
    const images = [];

    for (const place of results) {
      if (place.photos && place.photos.length > 0) {
        // Take the best photo (usually the first one)
        const ref = place.photos[0].photo_reference;
        if (ref) {
          images.push({
            url: `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${apiKey}`,
            caption: place.name
          });
        }
      }
    }

    return images;
  } catch (err) {
    console.warn("[ai] destination image search failed", err?.message || err);
    return [];
  }
};

export const resolvePlaceReference = async ({
  query,
  city = null,
  country = null,
  place_type_hint = "GENERIC",
  intent_mode = "NEAR_PLACE",
  language = "es",
  max_candidates = 5,
} = {}) => {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    return {
      status: "NOT_FOUND",
      confidence: "LOW",
      resolved_place: null,
      candidates: [],
      clarification_question: buildNotFoundQuestion(language),
    };
  }

  const placeTypeHint = inferPlaceTypeHintFromQuery(
    trimmedQuery,
    place_type_hint,
  );
  const maxCandidates = Math.max(
    1,
    Math.min(Number(max_candidates) || 5, 6),
  );

  const googleCandidates = await resolveGooglePlaceCandidates({
    query: trimmedQuery,
    city,
    country,
    placeTypeHint,
    maxCandidates,
  });
  return finalizePlaceResolution({
    candidates: googleCandidates,
    query: trimmedQuery,
    language,
    placeTypeHint,
    intentMode: intent_mode,
  });
};
