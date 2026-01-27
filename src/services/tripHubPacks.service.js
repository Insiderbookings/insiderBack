import cache from "./cache.js";
import { getWeatherSummary } from "../modules/ai/tools/tool.weather.js";
import { getNearbyPlaces } from "../modules/ai/tools/tool.places.js";
import h3 from "h3-js";

const DEFAULT_H3_RESOLUTION = Number(process.env.TRIP_HUB_H3_RESOLUTION || 6);
const BASE_TTL_SECONDS = Number(process.env.TRIP_HUB_BASE_TTL_SECONDS || 86400);
const DELTA_TTL_SECONDS = Number(process.env.TRIP_HUB_DELTA_TTL_SECONDS || 1800);
const DEFAULT_RADIUS_KM = Number(process.env.TRIP_HUB_PLACES_RADIUS_KM || 5);
const DEFAULT_GROUP_LIMIT = Number(process.env.TRIP_HUB_GROUP_LIMIT || 6);
const DEFAULT_ITEMS_PER_GROUP = Number(process.env.TRIP_HUB_ITEMS_PER_GROUP || 6);
const DEFAULT_RECO_TOTAL = Number(process.env.TRIP_HUB_RECO_TOTAL || 8);
const DEFAULT_PER_GROUP_RECO = Number(process.env.TRIP_HUB_RECO_PER_GROUP || 3);

const PLACE_GROUPS = [
  { id: "food", title: "Where to Eat", type: "restaurant", timeTags: ["morning", "afternoon", "evening"] },
  { id: "drinks", title: "Drinks & Nightlife", type: "bar", timeTags: ["evening", "night"] },
  { id: "things", title: "Things to Do", type: "tourist_attraction", timeTags: ["morning", "afternoon"] },
  { id: "cafes", title: "Cafes", type: "cafe", timeTags: ["morning", "afternoon"] },
  { id: "pharmacy", title: "Pharmacies", type: "pharmacy", timeTags: ["morning", "afternoon", "evening"] },
  { id: "grocery", title: "Groceries", type: "grocery_or_supermarket", timeTags: ["morning", "afternoon", "evening"] },
];

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

const formatDateKey = (date, timeZone) => {
  if (!date) return null;
  if (!timeZone) return date.toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

const resolveLocalHour = (date, timeZone) => {
  if (!date) return null;
  if (!timeZone) return date.getHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const hourPart = parts.find((part) => part.type === "hour");
    const hour = Number(hourPart?.value);
    return Number.isFinite(hour) ? hour : date.getHours();
  } catch {
    return date.getHours();
  }
};

const resolveBucketFromHour = (hour) => {
  if (!Number.isFinite(hour)) return "now";
  if (hour >= 5 && hour <= 11) return "morning";
  if (hour >= 12 && hour <= 17) return "afternoon";
  if (hour >= 18 && hour <= 22) return "evening";
  return "night";
};

const resolveH3Cell = (coords, resolution) => {
  if (!coords) return null;
  if (typeof h3?.latLngToCell === "function") {
    return h3.latLngToCell(coords.lat, coords.lng, resolution);
  }
  if (typeof h3?.geoToH3 === "function") {
    return h3.geoToH3(coords.lat, coords.lng, resolution);
  }
  return null;
};

const buildBaseKey = ({ h3, dateKey }) => `triphub:base:${h3}:${dateKey}`;
const buildDeltaKey = ({ h3, dateKey, bucket }) =>
  `triphub:delta:${h3}:${dateKey}:${bucket}`;

export const resolveTripHubZone = ({ location, resolution = DEFAULT_H3_RESOLUTION } = {}) => {
  const coords = resolveCoords(location);
  if (!coords) return { h3: null, coords: null, resolution };
  const h3 = resolveH3Cell(coords, resolution);
  return { h3, coords, resolution };
};

export const resolveTripHubTimeBucket = ({ date = new Date(), timeZone } = {}) => {
  const dateKey = formatDateKey(date, timeZone);
  const hour = resolveLocalHour(date, timeZone);
  const bucket = resolveBucketFromHour(hour);
  return { dateKey, hour, bucket };
};

export const getTripHubPackKeys = ({ h3, dateKey, bucket }) => ({
  baseKey: buildBaseKey({ h3, dateKey }),
  deltaKey: buildDeltaKey({ h3, dateKey, bucket }),
});

const normalizePlaceItem = (item, group, generatedAt) => {
  if (!item) return null;
  return {
    id: item.id || item.place_id || item.name,
    name: item.name,
    category: group.title,
    categoryId: group.id,
    location: item.location || null,
    distanceKm: item.distanceKm ?? null,
    rating: item.rating ?? null,
    ratingsCount: item.ratingsCount ?? null,
    priceLevel: item.priceLevel ?? null,
    openNow: item.openNow ?? null,
    photoUrl: item.photoUrl ?? null,
    mapsUrl: item.mapsUrl ?? null,
    tags: {
      time: group.timeTags || [],
    },
    updatedAt: item.updatedAt || generatedAt,
  };
};

const isRainyWeather = (weather) => {
  const code = Number(weather?.current?.weatherCode);
  const precip = Number(weather?.current?.precipitationMm);
  if (Number.isFinite(precip) && precip > 0.2) return true;
  return Number.isFinite(code) && [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code);
};

const scorePlace = ({ item, bucket, weather, openNow }) => {
  let score = 0;
  if (Number.isFinite(item.rating)) score += item.rating * 1.4;
  if (Number.isFinite(item.ratingsCount)) score += Math.log10(item.ratingsCount + 1);
  if (Number.isFinite(item.distanceKm)) score -= Math.min(item.distanceKm, 10) * 0.6;
  if (openNow === true) score += 1.4;
  if (openNow === false) score -= 0.6;
  if (item.tags?.time?.includes(bucket)) score += 1.2;
  if (isRainyWeather(weather) && item.categoryId === "things") score -= 0.4;
  return score;
};

export const getBasePackCache = async (key) => {
  if (!key) return null;
  return cache.get(key);
};

export const getDeltaPackCache = async (key) => {
  if (!key) return null;
  return cache.get(key);
};

export const setBasePackCache = async (key, payload, ttlSeconds = BASE_TTL_SECONDS) => {
  if (!key || !payload) return;
  await cache.set(key, payload, ttlSeconds);
};

export const setDeltaPackCache = async (key, payload, ttlSeconds = DELTA_TTL_SECONDS) => {
  if (!key || !payload) return;
  await cache.set(key, payload, ttlSeconds);
};

export const generateBasePack = async ({
  location,
  h3,
  dateKey,
  radiusKm = DEFAULT_RADIUS_KM,
  groupLimit = DEFAULT_GROUP_LIMIT,
  itemsPerGroup = DEFAULT_ITEMS_PER_GROUP,
} = {}) => {
  const generatedAt = new Date().toISOString();
  const coords = resolveCoords(location);
  if (!coords) return null;

  const groups = await Promise.all(
    PLACE_GROUPS.slice(0, groupLimit).map(async (group) => {
      const items = await getNearbyPlaces({
        location: coords,
        radiusKm,
        type: group.type,
        limit: itemsPerGroup,
        hydratePhotos: true,
      });
      const normalized = items
        .map((item) => normalizePlaceItem(item, group, generatedAt))
        .filter(Boolean);
      return {
        id: group.id,
        title: group.title,
        items: normalized,
        updatedAt: generatedAt,
      };
    })
  );

  const filteredGroups = groups.filter((group) => group.items.length);
  return {
    meta: {
      h3,
      date: dateKey,
      generatedAt,
      source: "places",
      radiusKm,
    },
    groups: filteredGroups,
  };
};

export const generateDeltaPack = async ({
  location,
  h3,
  dateKey,
  bucket,
  timeZone,
  radiusKm = DEFAULT_RADIUS_KM,
  groupLimit = DEFAULT_GROUP_LIMIT,
} = {}) => {
  const generatedAt = new Date().toISOString();
  const coords = resolveCoords(location);
  if (!coords) return null;

  const weather = await getWeatherSummary({ location: coords, timeZone });
  const openNow = {};
  const groups = await Promise.all(
    PLACE_GROUPS.slice(0, groupLimit).map(async (group) => {
      const items = await getNearbyPlaces({
        location: coords,
        radiusKm,
        type: group.type,
        limit: 10,
        hydratePhotos: false,
      });
      items.forEach((item) => {
        if (item?.id) {
          openNow[item.id] = Boolean(item.openNow);
        }
      });
      return { id: group.id, count: items.length };
    })
  );

  return {
    meta: {
      h3,
      date: dateKey,
      bucket,
      generatedAt,
      source: "weather+places",
      radiusKm,
      groups,
    },
    weather,
    openNow,
  };
};

export const assembleTripHubRecommendations = ({
  basePack,
  deltaPack,
  bucket,
  maxTotal = DEFAULT_RECO_TOTAL,
  perGroupLimit = DEFAULT_PER_GROUP_RECO,
} = {}) => {
  if (!basePack?.groups?.length) return [];
  const weather = deltaPack?.weather || null;
  const openNowMap = deltaPack?.openNow || {};
  const groups = basePack.groups.map((group) => {
    const scored = group.items
      .map((item) => {
        const openNow = Object.prototype.hasOwnProperty.call(openNowMap, item.id)
          ? openNowMap[item.id]
          : item.openNow;
        return {
          ...item,
          openNow,
          _score: scorePlace({ item, bucket, weather, openNow }),
        };
      })
      .sort((a, b) => b._score - a._score)
      .slice(0, perGroupLimit)
      .map(({ _score, ...rest }) => rest);
    return {
      title: group.title,
      items: scored,
      updatedAt: deltaPack?.meta?.generatedAt || basePack?.meta?.generatedAt,
    };
  });

  const flattenedCount = groups.reduce((acc, group) => acc + group.items.length, 0);
  if (flattenedCount <= maxTotal) return groups;

  const capped = [];
  let remaining = maxTotal;
  for (const group of groups) {
    if (!remaining) break;
    const items = group.items.slice(0, Math.min(group.items.length, Math.max(1, Math.floor(maxTotal / groups.length))));
    remaining -= items.length;
    capped.push({ ...group, items });
  }
  return capped.filter((group) => group.items.length);
};

export const getTripHubRecommendationsFromCache = async ({
  tripContext,
  timeZone,
  date = new Date(),
  bucket: bucketOverride,
} = {}) => {
  if (!tripContext) return null;
  const location = tripContext?.location || null;
  const { h3 } = resolveTripHubZone({ location });
  if (!h3) return null;
  const { dateKey, bucket } = resolveTripHubTimeBucket({ date, timeZone });
  const resolvedBucket = bucketOverride || bucket;
  const { baseKey, deltaKey } = getTripHubPackKeys({
    h3,
    dateKey,
    bucket: resolvedBucket,
  });
  const basePack = await getBasePackCache(baseKey);
  const deltaPack = await getDeltaPackCache(deltaKey);
  if (!basePack && !deltaPack) return null;
  const suggestions = assembleTripHubRecommendations({
    basePack,
    deltaPack,
    bucket: resolvedBucket,
  });
  return {
    suggestions,
    weather: deltaPack?.weather || null,
    packKeys: { baseKey, deltaKey },
    h3,
    dateKey,
    bucket: resolvedBucket,
  };
};
