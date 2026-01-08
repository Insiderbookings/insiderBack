import axios from "axios";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

const normalizeText = (value) => String(value || "").trim();
const stripDiacritics = (value) =>
  normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
const normalizeForMatch = (value) =>
  stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const RAW_QUERY_KEYWORDS = {
  en: [
    "airport",
    "flight",
    "airline",
    "metro",
    "train",
    "bus",
    "ferry",
    "strike",
    "festival",
    "concert",
    "museum",
    "weather",
    "alert",
    "advisory",
    "closure",
  ],
  es: [
    "aeropuerto",
    "vuelo",
    "aerolinea",
    "metro",
    "tren",
    "autobus",
    "ferry",
    "huelga",
    "festival",
    "concierto",
    "museo",
    "clima",
    "alerta",
    "aviso",
    "cierre",
  ],
};

const RAW_FILTER_KEYWORDS = {
  en: [
    "airport",
    "flight",
    "airline",
    "terminal",
    "check in",
    "metro",
    "subway",
    "train",
    "rail",
    "tram",
    "bus",
    "ferry",
    "transit",
    "traffic",
    "road",
    "highway",
    "delay",
    "closure",
    "closed",
    "strike",
    "protest",
    "demonstration",
    "curfew",
    "festival",
    "concert",
    "expo",
    "exhibition",
    "fair",
    "carnival",
    "parade",
    "marathon",
    "show",
    "tour",
    "museum",
    "gallery",
    "park",
    "beach",
    "market",
    "opening",
    "reopening",
    "weather",
    "storm",
    "warning",
    "alert",
    "advisory",
    "heat",
    "heatwave",
    "flood",
    "snow",
    "rain",
  ],
  es: [
    "aeropuerto",
    "vuelo",
    "aerolinea",
    "terminal",
    "check in",
    "metro",
    "subte",
    "tren",
    "ferrocarril",
    "tranvia",
    "autobus",
    "ferry",
    "transporte",
    "trafico",
    "carretera",
    "autopista",
    "retraso",
    "cierre",
    "cerrado",
    "huelga",
    "protesta",
    "manifestacion",
    "toque de queda",
    "festival",
    "concierto",
    "expo",
    "exposicion",
    "feria",
    "carnaval",
    "desfile",
    "maraton",
    "show",
    "tour",
    "museo",
    "galeria",
    "parque",
    "playa",
    "mercado",
    "apertura",
    "reapertura",
    "clima",
    "tormenta",
    "alerta",
    "aviso",
    "ola de calor",
    "inundacion",
    "nieve",
    "lluvia",
  ],
};

const isSpanishLocale = (locale) => String(locale || "").toLowerCase().startsWith("es");
const uniqueList = (items) => Array.from(new Set(items));
const getKeywords = (locale, raw) => {
  const key = isSpanishLocale(locale) ? "es" : "en";
  return uniqueList(raw[key].map((keyword) => normalizeForMatch(keyword)).filter(Boolean));
};
const sanitizeQuery = (value) => normalizeText(value).replace(/["]+/g, "");

const buildTravelQuery = ({ city, locale }) => {
  const cityTerm = sanitizeQuery(city);
  if (!cityTerm) return "";
  const keywords = getKeywords(locale, RAW_QUERY_KEYWORDS);
  return `"${cityTerm}" (${keywords.join(" OR ")})`;
};

const buildRssUrl = (query, locale = "es-419", region = "US") => {
  const encoded = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${encoded}&hl=${locale}&gl=${region}&ceid=${region}:${locale}`;
};

const extractItems = (payload) => {
  const channel = payload?.rss?.channel;
  if (!channel?.item) return [];
  return Array.isArray(channel.item) ? channel.item : [channel.item];
};

const parseDate = (value) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const countKeywordHits = (haystack, keywords) => {
  if (!haystack || !keywords.length) return 0;
  const padded = ` ${haystack} `;
  return keywords.reduce((count, keyword) => {
    const needle = ` ${keyword} `;
    return padded.includes(needle) ? count + 1 : count;
  }, 0);
};

const filterTravelNews = (items, { city, locale, maxAgeDays, minKeywordHits }) => {
  const normalizedCity = normalizeForMatch(city);
  const keywords = getKeywords(locale, RAW_FILTER_KEYWORDS);
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  const scored = items
    .map((item) => {
      const normalizedTitle = normalizeForMatch(item.title);
      const keywordHits = countKeywordHits(normalizedTitle, keywords);
      const publishedAtMs = parseDate(item.publishedAt);
      const ageDays =
        publishedAtMs === null ? null : Math.floor((now - publishedAtMs) / msPerDay);
      const recentEnough = ageDays === null ? true : ageDays <= maxAgeDays;

      if (!recentEnough || keywordHits < minKeywordHits) return null;

      const cityHit = normalizedCity ? normalizedTitle.includes(normalizedCity) : false;
      const recencyBoost = ageDays !== null && ageDays <= 3 ? 1 : 0;
      const score = keywordHits + (cityHit ? 1 : 0) + recencyBoost;

      return {
        ...item,
        _score: score,
        _publishedAtMs: publishedAtMs || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b._score - a._score || b._publishedAtMs - a._publishedAtMs);

  const seen = new Set();
  const unique = [];
  for (const item of scored) {
    const key = normalizeForMatch(item.title) || item.link || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique.map(({ _score, _publishedAtMs, ...item }) => item);
};

export const getLocalNews = async ({
  query,
  limit = 3,
  locale = "es-419",
  region = "US",
  maxAgeDays = 14,
  minKeywordHits = 1,
} = {}) => {
  const trimmed = normalizeText(query);
  if (!trimmed) return [];

  const searchQuery = buildTravelQuery({ city: trimmed, locale });
  if (!searchQuery) return [];

  const clampedLimit = Math.max(1, Math.min(6, Number(limit) || 3));
  const clampedMaxAge = Math.max(1, Number(maxAgeDays) || 14);
  const clampedMinHits = Math.max(1, Number(minKeywordHits) || 1);
  const url = buildRssUrl(searchQuery, locale, region);
  try {
    const { data } = await axios.get(url, { timeout: 5000 });
    const parsed = parser.parse(data);
    const items = extractItems(parsed);
    const mapped = items
      .map((item) => ({
        title: normalizeText(item.title),
        link: normalizeText(item.link),
        source: normalizeText(item.source?.["#text"] || item.source),
        publishedAt: normalizeText(item.pubDate),
      }))
      .filter((item) => item.title);

    return filterTravelNews(mapped, {
      city: trimmed,
      locale,
      maxAgeDays: clampedMaxAge,
      minKeywordHits: clampedMinHits,
    }).slice(0, clampedLimit);
  } catch (err) {
    console.warn("[ai] news lookup failed", err?.message || err);
    return [];
  }
};
