import axios from "axios";
import { Op, literal } from "sequelize";
import models from "../models/index.js";
import { getCaseInsensitiveLikeOp } from "../utils/sequelizeHelpers.js";

const iLikeOp = getCaseInsensitiveLikeOp();
const CITY_HOTEL_COUNT_LITERAL = literal(
  `(SELECT COUNT(*)::int FROM webbeds_hotel h WHERE h.city_code::text = "WebbedsCity"."code"::text AND h.deleted_at IS NULL)`,
);
const PLACES_GEOCODE_TIMEOUT_MS = Math.max(
  1500,
  Number(process.env.PLACES_GEOCODE_TIMEOUT_MS || 3500),
);
const PLACES_GEOCODE_ENABLED = process.env.WEBBEDS_CITY_PLACE_GEOCODE_ENABLED !== "false";
const PLACE_CITY_MAP_DEBUG = process.env.WEBBEDS_CITY_PLACE_MAP_DEBUG === "true";

export const parseCoordinateValue = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < -180 || numeric > 180) return null;
  return numeric;
};

const roundCoordinate = (value, precision = 8) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number.parseFloat(numeric.toFixed(precision));
};

const haversineDistanceKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
};

const getPlacesApiKey = () =>
  process.env.GOOGLE_PLACES_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  null;

const pickAddressComponent = (components, type) => {
  if (!Array.isArray(components)) return null;
  const match = components.find((comp) => Array.isArray(comp?.types) && comp.types.includes(type));
  return match?.long_name || null;
};

const stripDiacritics = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

const normalizeCityLookupText = (value) =>
  stripDiacritics(value)
    .replace(/\s+/g, " ")
    .trim();

const buildQueryVariants = (query) =>
  Array.from(
    new Set(
      [String(query || "").trim(), normalizeCityLookupText(query)].filter(Boolean),
    ),
  );

const fetchPlaceGeoFromGoogle = async (placeId) => {
  if (!PLACES_GEOCODE_ENABLED) return null;
  const normalizedPlaceId = String(placeId || "").trim();
  if (!normalizedPlaceId) return null;
  const apiKey = getPlacesApiKey();
  if (!apiKey) return null;

  try {
    const { data } = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
      params: {
        place_id: normalizedPlaceId,
        key: apiKey,
      },
      timeout: PLACES_GEOCODE_TIMEOUT_MS,
    });
    if (data?.status !== "OK" || !Array.isArray(data?.results) || !data.results.length) {
      return null;
    }
    const first = data.results[0] || {};
    const location = first?.geometry?.location || {};
    const lat = parseCoordinateValue(location?.lat);
    const lng = parseCoordinateValue(location?.lng);
    if (lat == null || lng == null) return null;
    const components = first?.address_components || [];
    return {
      lat,
      lng,
      label: first?.formatted_address || null,
      city: pickAddressComponent(components, "locality"),
      state: pickAddressComponent(components, "administrative_area_level_1"),
      country: pickAddressComponent(components, "country"),
      source: "google-geocode",
    };
  } catch (error) {
    if (PLACE_CITY_MAP_DEBUG) {
      console.warn("[webbeds.city] place geocode failed", {
        placeId: normalizedPlaceId,
        message: error?.message || error,
      });
    }
    return null;
  }
};

const normalizeCityQueryInput = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return { raw: "", cityToken: "", stateHint: null };
  const [firstToken] = raw.split(",");
  const cityToken = String(firstToken || raw).trim();
  const upperRaw = raw.toUpperCase();
  const stateMatch = upperRaw.match(/(?:,|\s)\s*([A-Z]{2})(?:\b|$)/);
  const stateHint = stateMatch?.[1] || null;
  return { raw, cityToken, stateHint };
};

const looksLikeSpecificPlaceQuery = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return /\b(hotel|hostel|airport|aeropuerto|tower|torre|mall|museum|museo|station|estacion|estação|plaza|square|obelisco)\b/i.test(
    normalized,
  );
};

const extractCityHotelCount = (city) => {
  const direct = Number(city?.hotel_count ?? city?.hotelCount);
  return Number.isFinite(direct) ? direct : 0;
};

const extractCityCoordinates = (city) => ({
  lat: parseCoordinateValue(city?.lat),
  lng: parseCoordinateValue(city?.lng),
});

const buildCityWhereFilter = ({ countryCode, countryName, query, requireCoordinates = false }) => {
  const where = {};
  const trimmedQuery = String(query || "").trim();
  if (trimmedQuery) {
    where.name = { [iLikeOp]: `%${trimmedQuery}%` };
  }
  if (countryCode) {
    where.country_code = String(countryCode).trim();
  } else if (countryName) {
    where.country_name = { [iLikeOp]: `%${String(countryName).trim()}%` };
  }
  if (requireCoordinates) {
    where.lat = { [Op.ne]: null };
    where.lng = { [Op.ne]: null };
  }
  return where;
};

const fetchCityByCode = async (code) =>
  models.WebbedsCity.findOne({
    where: { code: String(code).trim() },
    attributes: [
      "code",
      "name",
      "country_code",
      "country_name",
      "state_name",
      "state_code",
      "lat",
      "lng",
      [CITY_HOTEL_COUNT_LITERAL, "hotel_count"],
    ],
    raw: true,
  });

const shouldRelaxCountryNameFilter = ({ countryCode, countryName }) =>
  !countryCode && Boolean(String(countryName || "").trim());

const queryCityCandidates = ({
  query,
  countryCode,
  countryName,
  limit,
  requireCoordinates = false,
}) =>
  models.WebbedsCity.findAll({
    where: buildCityWhereFilter({
      countryCode,
      countryName,
      query,
      requireCoordinates,
    }),
    attributes: [
      "code",
      "name",
      "country_code",
      "country_name",
      "state_name",
      "state_code",
      "lat",
      "lng",
      [CITY_HOTEL_COUNT_LITERAL, "hotel_count"],
    ],
    order: [
      [literal(`"hotel_count"`), "DESC"],
      ["name", "ASC"],
    ],
    limit,
    raw: true,
  });

const findCityCandidates = async ({ query, countryCode, countryName, limit = 25 }) => {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];

  const queryVariants = buildQueryVariants(trimmed);
  for (const queryVariant of queryVariants) {
    const primaryCandidates = await queryCityCandidates({
      query: queryVariant,
      countryCode,
      countryName,
      limit,
    });
    if (primaryCandidates.length) {
      return primaryCandidates;
    }
  }

  if (!shouldRelaxCountryNameFilter({ countryCode, countryName })) {
    return [];
  }

  for (const queryVariant of queryVariants) {
    const relaxedCandidates = await queryCityCandidates({
      query: queryVariant,
      countryCode,
      countryName: null,
      limit,
    });
    if (relaxedCandidates.length) {
      if (PLACE_CITY_MAP_DEBUG) {
        console.warn("[webbeds.city] city candidates relaxed countryName filter", {
          query: trimmed,
          queryVariant,
          countryName,
          count: relaxedCandidates.length,
        });
      }
      return relaxedCandidates;
    }
  }

  return [];
};

const findCoordinateCandidates = async ({
  countryCode,
  countryName,
  query,
  limit = 120,
}) => {
  const normalizedLimit = Math.max(20, Math.min(300, Number(limit) || 120));
  const queryVariants = buildQueryVariants(query);
  const effectiveQueryVariants = queryVariants.length ? queryVariants : [null];

  for (const queryVariant of effectiveQueryVariants) {
    const primaryCandidates = await queryCityCandidates({
      query: queryVariant,
      countryCode,
      countryName,
      limit: normalizedLimit,
      requireCoordinates: true,
    });
    if (primaryCandidates.length) {
      return primaryCandidates;
    }
  }

  if (!shouldRelaxCountryNameFilter({ countryCode, countryName })) {
    return [];
  }

  for (const queryVariant of effectiveQueryVariants) {
    const relaxedCandidates = await queryCityCandidates({
      query: queryVariant,
      countryCode,
      countryName: null,
      limit: normalizedLimit,
      requireCoordinates: true,
    });
    if (relaxedCandidates.length) {
      if (PLACE_CITY_MAP_DEBUG) {
        console.warn("[webbeds.city] coordinate candidates relaxed countryName filter", {
          query: String(query || "").trim() || null,
          queryVariant,
          countryName,
          count: relaxedCandidates.length,
        });
      }
      return relaxedCandidates;
    }
  }

  return [];
};

const rankCityCandidate = ({ candidate, cityToken, stateHint, targetLat = null, targetLng = null }) => {
  const normalizedName = normalizeCityLookupText(candidate?.name).toUpperCase();
  const normalizedCityToken = normalizeCityLookupText(cityToken).toUpperCase();
  const hotelCount = extractCityHotelCount(candidate);
  let score = Math.min(hotelCount, 400) * 300;

  if (normalizedCityToken && normalizedName === normalizedCityToken) score += 250000;
  if (normalizedCityToken && normalizedName.startsWith(`${normalizedCityToken} -`)) score += 120000;
  if (normalizedCityToken && normalizedName.includes(normalizedCityToken)) score += 20000;
  if (stateHint && normalizedName.includes(`- ${stateHint}`)) score += 60000;
  if (normalizedCityToken) {
    score -= Math.max(0, normalizedName.length - normalizedCityToken.length);
  }

  if (targetLat != null && targetLng != null) {
    const { lat, lng } = extractCityCoordinates(candidate);
    if (lat != null && lng != null) {
      const distanceKm = haversineDistanceKm(targetLat, targetLng, lat, lng);
      if (distanceKm <= 25) score += 220000;
      else if (distanceKm <= 100) score += 140000;
      else if (distanceKm <= 300) score += 70000;
      else score += Math.max(0, 40000 - distanceKm * 120);
      score -= Math.round(distanceKm * 20);
    } else {
      score -= 15000;
    }
  }

  return score;
};

const pickBestCityCandidate = ({ candidates, cityToken, stateHint, targetLat = null, targetLng = null }) => {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!list.length) return null;
  const ranked = list
    .map((candidate) => ({
      candidate,
      score: rankCityCandidate({ candidate, cityToken, stateHint, targetLat, targetLng }),
      hotelCount: extractCityHotelCount(candidate),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.hotelCount !== a.hotelCount) return b.hotelCount - a.hotelCount;
      return String(a.candidate?.name || "").localeCompare(String(b.candidate?.name || ""));
    });
  return ranked[0]?.candidate || null;
};

const getMappedCityByPlaceId = async (placeId) => {
  const placeModel = models.WebbedsCityPlaceMap;
  if (!placeModel) return null;
  const normalizedPlaceId = String(placeId || "").trim();
  if (!normalizedPlaceId) return null;

  try {
    const mapped = await placeModel.findOne({
      where: { place_id: normalizedPlaceId },
      raw: true,
    });
    if (!mapped?.city_code) return null;
    const city = await fetchCityByCode(mapped.city_code);
    if (!city) return null;
    return {
      city,
      map: mapped,
    };
  } catch (error) {
    if (PLACE_CITY_MAP_DEBUG) {
      console.warn("[webbeds.city] place map read failed", {
        placeId: normalizedPlaceId,
        message: error?.message || error,
      });
    }
    return null;
  }
};

const persistPlaceCityMap = async ({ placeId, resolvedCity, placeGeo, searchQuery }) => {
  const placeModel = models.WebbedsCityPlaceMap;
  if (!placeModel || !resolvedCity?.code || !placeId) return;

  try {
    await placeModel.upsert({
      place_id: String(placeId).trim(),
      city_code: String(resolvedCity.code).trim(),
      label: placeGeo?.label ?? null,
      place_city: placeGeo?.city ?? null,
      place_state: placeGeo?.state ?? null,
      place_country: placeGeo?.country ?? null,
      lat: roundCoordinate(placeGeo?.lat),
      lng: roundCoordinate(placeGeo?.lng),
      metadata: {
        source: placeGeo?.source || "unknown",
        searchQuery: String(searchQuery || "").trim() || null,
      },
    });
  } catch (error) {
    if (PLACE_CITY_MAP_DEBUG) {
      console.warn("[webbeds.city] place map upsert failed", {
        placeId,
        cityCode: resolvedCity?.code ?? null,
        message: error?.message || error,
      });
    }
  }
};

const resolveCityFromPlace = async ({
  placeId,
  query,
  countryCode,
  countryName,
  stateHint,
  cityToken,
  lat,
  lng,
}) => {
  const normalizedPlaceId = String(placeId || "").trim();
  if (!normalizedPlaceId) return null;

  const mapped = await getMappedCityByPlaceId(normalizedPlaceId);
  const mappedHotelCount = extractCityHotelCount(mapped?.city);
  if (mapped?.city && (mappedHotelCount > 0 || !cityToken)) {
    return mapped.city;
  }
  if (mapped?.city && PLACE_CITY_MAP_DEBUG) {
    console.warn("[webbeds.city] ignoring stale place mapping (no inventory)", {
      placeId: normalizedPlaceId,
      mappedCityCode: mapped.city?.code ?? null,
      mappedCityName: mapped.city?.name ?? null,
      mappedHotelCount,
    });
  }

  const providedLat = parseCoordinateValue(lat);
  const providedLng = parseCoordinateValue(lng);
  let placeGeo = null;
  let googlePlaceGeo = null;
  if (normalizedPlaceId) {
    googlePlaceGeo = await fetchPlaceGeoFromGoogle(normalizedPlaceId);
  }
  if (providedLat != null && providedLng != null) {
    placeGeo = {
      lat: providedLat,
      lng: providedLng,
      source: "request",
      city: googlePlaceGeo?.city ?? cityToken ?? null,
      state: googlePlaceGeo?.state ?? stateHint ?? null,
      country: googlePlaceGeo?.country ?? countryName ?? null,
      label: googlePlaceGeo?.label ?? null,
    };
  } else {
    placeGeo = googlePlaceGeo;
  }

  const effectiveCityToken =
    placeGeo?.city ||
    (looksLikeSpecificPlaceQuery(query) ? null : cityToken) ||
    null;
  const textQuery = effectiveCityToken || String(query || "").trim();
  const textCandidates = textQuery
    ? await findCityCandidates({
        query: textQuery,
      countryCode,
      countryName: countryName ?? placeGeo?.country ?? null,
      limit: 40,
    })
    : [];

  const coordinateCandidates =
    placeGeo?.lat != null && placeGeo?.lng != null
      ? await findCoordinateCandidates({
          query: effectiveCityToken || null,
          countryCode,
          countryName: countryName ?? placeGeo?.country ?? null,
          limit: 150,
      })
      : [];

  const dedupedCandidates = Array.from(
    new Map(
      [...textCandidates, ...coordinateCandidates].map((item) => [String(item.code), item]),
    ).values(),
  );
  if (!dedupedCandidates.length) return null;

  const best = pickBestCityCandidate({
    candidates: dedupedCandidates,
    cityToken: effectiveCityToken || cityToken,
    stateHint,
    targetLat: placeGeo?.lat ?? null,
    targetLng: placeGeo?.lng ?? null,
  });

  if (best) {
    await persistPlaceCityMap({
      placeId: normalizedPlaceId,
      resolvedCity: best,
      placeGeo,
      searchQuery: query,
    });
  }

  return best;
};

export const resolveWebbedsCityMatch = async ({
  query,
  cityCode,
  countryCode,
  countryName,
  placeId,
  lat,
  lng,
} = {}) => {
  const { cityToken, stateHint } = normalizeCityQueryInput(query);
  const placeResolvedCity = await resolveCityFromPlace({
    placeId,
    query,
    countryCode,
    countryName,
    stateHint,
    cityToken,
    lat,
    lng,
  });
  if (placeResolvedCity) return placeResolvedCity;

  if (cityCode) {
    const selectedCity = await fetchCityByCode(cityCode);
    if (!selectedCity) return null;

    if (extractCityHotelCount(selectedCity) > 0 || !cityToken) {
      return selectedCity;
    }

    const fallbackCandidates = await findCityCandidates({
      query: cityToken,
      countryCode: countryCode ?? selectedCity.country_code,
      countryName: countryName ?? selectedCity.country_name,
      limit: 30,
    });
    const bestFallback = pickBestCityCandidate({
      candidates: fallbackCandidates.filter((item) => String(item.code) !== String(selectedCity.code)),
      cityToken,
      stateHint,
      targetLat: parseCoordinateValue(lat),
      targetLng: parseCoordinateValue(lng),
    });

    if (bestFallback) {
      return bestFallback;
    }
    return selectedCity;
  }

  if (!cityToken) return null;

  const candidates = await findCityCandidates({
    query: cityToken,
    countryCode,
    countryName,
    limit: 30,
  });
  return pickBestCityCandidate({
    candidates,
    cityToken,
    stateHint,
    targetLat: parseCoordinateValue(lat),
    targetLng: parseCoordinateValue(lng),
  });
};

export default resolveWebbedsCityMatch;
