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

const buildWeatherCacheKey = (location, precision = DEFAULT_COORD_PRECISION, startDate, endDate) => {
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
    const range =
      startDate && endDate ? `:${String(startDate)}:${String(endDate)}` : "";
    return `triphub:weather:${roundedLat}:${roundedLng}${range}`;
  }

  const locationText =
    normalizeText(location.locationText) ||
    normalizeText(location.address) ||
    normalizeText(location.city) ||
    normalizeText(location.country);
  if (locationText) {
    const range =
      startDate && endDate ? `:${String(startDate)}:${String(endDate)}` : "";
    return `triphub:weather:${locationText}${range}`;
  }

  return null;
};

export const getTripWeather = async ({
  location,
  timeZone,
  startDate,
  endDate,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  force = false,
} = {}) => {
  const cacheKey = buildWeatherCacheKey(location, DEFAULT_COORD_PRECISION, startDate, endDate);
  if (cacheKey && !force) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return { weather: cached, cached: true, cacheKey };
    }
  }

  const weather = await getWeatherSummary({ location, timeZone, startDate, endDate });
  if (weather && cacheKey) {
    await cache.set(cacheKey, weather, ttlSeconds);
  }
  return { weather, cached: false, cacheKey };
};
