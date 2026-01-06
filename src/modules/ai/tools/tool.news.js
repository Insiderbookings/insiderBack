import axios from "axios";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

const normalizeText = (value) => String(value || "").trim();

const buildRssUrl = (query, locale = "es-419", region = "US") => {
  const encoded = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${encoded}&hl=${locale}&gl=${region}&ceid=${region}:${locale}`;
};

const extractItems = (payload) => {
  const channel = payload?.rss?.channel;
  if (!channel?.item) return [];
  return Array.isArray(channel.item) ? channel.item : [channel.item];
};

export const getLocalNews = async ({ query, limit = 3, locale = "es-419", region = "US" } = {}) => {
  const trimmed = normalizeText(query);
  if (!trimmed) return [];

  const url = buildRssUrl(trimmed, locale, region);
  try {
    const { data } = await axios.get(url, { timeout: 5000 });
    const parsed = parser.parse(data);
    const items = extractItems(parsed);
    return items
      .map((item) => ({
        title: normalizeText(item.title),
        link: normalizeText(item.link),
        source: normalizeText(item.source?.["#text"] || item.source),
        publishedAt: normalizeText(item.pubDate),
      }))
      .filter((item) => item.title)
      .slice(0, Math.max(1, Math.min(6, Number(limit) || 3)));
  } catch (err) {
    console.warn("[ai] news lookup failed", err?.message || err);
    return [];
  }
};
