import axios from "axios";

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const resolveCoords = (location) => {
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

const formatLocalTime = (time, timezone) => {
  if (!time || !timezone) return null;
  const parsed = new Date(time);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(parsed);
  } catch {
    return null;
  }
};

export const getLocalTime = async ({ location } = {}) => {
  const coords = resolveCoords(location);
  if (!coords) return null;

  const params = {
    latitude: coords.lat,
    longitude: coords.lng,
    current_weather: true,
    timezone: "auto",
  };

  try {
    const { data } = await axios.get("https://api.open-meteo.com/v1/forecast", {
      params,
      timeout: 5000,
    });
    if (!data) return null;
    const time = data.current_weather?.time || null;
    const timezone = data.timezone || null;
    return {
      timezone,
      time,
      formatted: formatLocalTime(time, timezone),
    };
  } catch (err) {
    console.warn("[ai] time lookup failed", err?.message || err);
    return null;
  }
};
