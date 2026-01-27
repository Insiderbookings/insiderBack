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

const safeArray = (value) => (Array.isArray(value) ? value : []);

const buildSeries = (source, fields) => {
  if (!source || !Array.isArray(source.time)) return [];
  const times = safeArray(source.time);
  return times.map((time, index) => {
    const item = { time };
    fields.forEach((field) => {
      const raw = source[field.key]?.[index];
      const numeric = toNumber(raw);
      item[field.name] = Number.isFinite(numeric) ? numeric : null;
    });
    return item;
  });
};

const filterSeriesByDateRange = (series, startDate, endDate) => {
  if (!startDate || !endDate) return [];
  const startKey = String(startDate);
  const endKey = String(endDate);
  return series.filter((item) => {
    if (!item?.time) return false;
    const day = String(item.time).slice(0, 10);
    return day >= startKey && day <= endKey;
  });
};

export const getWeatherSummary = async ({ location, timeZone, startDate, endDate } = {}) => {
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
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,precipitation",
    hourly: "temperature_2m,precipitation_probability,precipitation,wind_speed_10m,relative_humidity_2m,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    forecast_days: 14,
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
    const { data } = await fetchWeather(10000); // Increased to 10s
    const current = data?.current || null;
    if (!current) return null;
    const hourlySeries = buildSeries(data?.hourly, [
      { key: "temperature_2m", name: "temperatureC" },
      { key: "precipitation_probability", name: "precipitationProbability" },
      { key: "precipitation", name: "precipitationMm" },
      { key: "wind_speed_10m", name: "windKph" },
      { key: "relative_humidity_2m", name: "humidity" },
      { key: "weather_code", name: "weatherCode" },
    ]);
    const dailySeries = buildSeries(data?.daily, [
      { key: "temperature_2m_max", name: "maxC" },
      { key: "temperature_2m_min", name: "minC" },
      { key: "precipitation_probability_max", name: "precipitationProbability" },
      { key: "weather_code", name: "weatherCode" },
    ]);
    const dailyTrip = filterSeriesByDateRange(dailySeries, startDate, endDate);
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
        humidity: toNumber(current.relative_humidity_2m),
        precipitationMm: toNumber(current.precipitation),
      },
      hourly: {
        series: hourlySeries.slice(0, 48),
      },
      daily: {
        series: dailySeries,
        trip: dailyTrip,
      },
    };
  } catch (err) {
    console.warn("[ai] weather lookup failed (10s)", err?.message || "timeout");
    try {
      const { data } = await fetchWeather(15000); // Retry with 15s
      const current = data?.current || null;
      if (!current) return null;
      const hourlySeries = buildSeries(data?.hourly, [
        { key: "temperature_2m", name: "temperatureC" },
        { key: "precipitation_probability", name: "precipitationProbability" },
        { key: "precipitation", name: "precipitationMm" },
        { key: "wind_speed_10m", name: "windKph" },
        { key: "relative_humidity_2m", name: "humidity" },
        { key: "weather_code", name: "weatherCode" },
      ]);
      const dailySeries = buildSeries(data?.daily, [
        { key: "temperature_2m_max", name: "maxC" },
        { key: "temperature_2m_min", name: "minC" },
        { key: "precipitation_probability_max", name: "precipitationProbability" },
        { key: "weather_code", name: "weatherCode" },
      ]);
      const dailyTrip = filterSeriesByDateRange(dailySeries, startDate, endDate);
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
          humidity: toNumber(current.relative_humidity_2m),
          precipitationMm: toNumber(current.precipitation),
        },
        hourly: {
          series: hourlySeries.slice(0, 48),
        },
        daily: {
          series: dailySeries,
          trip: dailyTrip,
        },
      };
    } catch (retryErr) {
      console.warn("[ai] weather lookup retry failed", retryErr?.message || retryErr);
      return null;
    }
  }
};
