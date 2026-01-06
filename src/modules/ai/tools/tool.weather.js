import axios from "axios";

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeCoords = (location) => {
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

const resolveLocationName = (location) => {
  if (!location) return "";
  if (typeof location === "string") return location.trim();
  if (typeof location.name === "string" && location.name.trim()) return location.name.trim();
  const city = typeof location.city === "string" ? location.city.trim() : "";
  const country = typeof location.country === "string" ? location.country.trim() : "";
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  return "";
};

const geocodeOpenMeteo = async (name) => {
  const query = String(name || "").trim();
  if (!query) return null;
  try {
    const { data } = await axios.get("https://geocoding-api.open-meteo.com/v1/search", {
      params: { name: query, count: 1, language: "en", format: "json" },
      timeout: 5000,
    });
    const result = Array.isArray(data?.results) ? data.results[0] : null;
    if (!result) return null;
    return { lat: toNumber(result.latitude), lng: toNumber(result.longitude) };
  } catch (err) {
    console.warn("[ai] weather geocode failed", err?.message || err);
    return null;
  }
};

export const getWeatherSummary = async ({ location, timeZone } = {}) => {
  let coords = normalizeCoords(location);
  if (!coords) {
    const name = resolveLocationName(location);
    if (name) {
      coords = await geocodeOpenMeteo(name);
    }
  }
  if (!coords) return null;
  const params = {
    latitude: coords.lat,
    longitude: coords.lng,
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    timezone: timeZone || "auto",
  };

  const fetchWeather = async (timeoutMs) =>
    axios.get("https://api.open-meteo.com/v1/forecast", {
      params,
      timeout: timeoutMs,
    });

  try {
    const { data } = await fetchWeather(8000);
    const current = data?.current || null;
    if (!current) return null;
    return {
      source: "open-meteo",
      lat: coords.lat,
      lng: coords.lng,
      timeZone: data?.timezone || timeZone || null,
      updatedAt: current.time || null,
      current: {
        temperatureC: toNumber(current.temperature_2m),
        apparentC: toNumber(current.apparent_temperature),
        windKph: toNumber(current.wind_speed_10m),
        weatherCode: toNumber(current.weather_code),
      },
    };
  } catch (err) {
    console.warn("[ai] weather lookup failed", err?.message || err);
    try {
      const { data } = await fetchWeather(12000);
      const current = data?.current || null;
      if (!current) return null;
      return {
        source: "open-meteo",
        lat: coords.lat,
        lng: coords.lng,
        timeZone: data?.timezone || timeZone || null,
        updatedAt: current.time || null,
        current: {
          temperatureC: toNumber(current.temperature_2m),
          apparentC: toNumber(current.apparent_temperature),
          windKph: toNumber(current.wind_speed_10m),
          weatherCode: toNumber(current.weather_code),
        },
      };
    } catch (retryErr) {
      console.warn("[ai] weather lookup retry failed", retryErr?.message || retryErr);
      return null;
    }
  }
};
