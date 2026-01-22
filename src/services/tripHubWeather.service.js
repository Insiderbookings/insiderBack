import cache from "./cache.js";
import { getWeatherSummary } from "../modules/ai/tools/tool.weather.js";

const DEFAULT_TTL_SECONDS = Number(process.env.TRIP_HUB_WEATHER_TTL_SECONDS || 1800);
const DEFAULT_COORD_PRECISION = Number(process.env.TRIP_HUB_WEATHER_COORD_PRECISION || 2);

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeText = (value) => {
  if (!value) return "";
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
};

const roundCoord = (value, precision) => {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** precision;
  return Math.round(numeric * factor) / factor;
};

const buildWeatherCacheKey = (location, precision = DEFAULT_COORD_PRECISION) => {
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
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const roundedLat = roundCoord(lat, precision);
    const roundedLng = roundCoord(lng, precision);
    return `triphub:weather:${roundedLat}:${roundedLng}`;
  }

  const locationText =
    normalizeText(location.locationText) ||
    normalizeText(location.address) ||
    normalizeText(location.city) ||
    normalizeText(location.country);
  if (locationText) return `triphub:weather:${locationText}`;

  return null;
};

export const getTripWeather = async ({
  location,
  timeZone,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  force = false,
} = {}) => {
  const cacheKey = buildWeatherCacheKey(location);
  if (cacheKey && !force) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return { weather: cached, cached: true, cacheKey };
    }
  }

  const weather = await getWeatherSummary({ location, timeZone });
  if (weather && cacheKey) {
    await cache.set(cacheKey, weather, ttlSeconds);
  }
  return { weather, cached: false, cacheKey };
};
