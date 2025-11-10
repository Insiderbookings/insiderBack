import geoip from "geoip-lite";

const normalizeIp = (ip) => {
  if (!ip) return null;
  const value = ip.trim();
  if (!value) return null;
  // Remove IPv6 prefix if present (e.g., ::ffff:192.0.2.1)
  return value.startsWith("::ffff:") ? value.slice(7) : value;
};

const extractIpFromRequest = (req) => {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) {
    const parts = forwarded.split(",").map((part) => normalizeIp(part));
    const first = parts.find(Boolean);
    if (first) return first;
  }
  if (Array.isArray(forwarded)) {
    const first = forwarded.map(normalizeIp).find(Boolean);
    if (first) return first;
  }
  const connectionIp =
    normalizeIp(req.connection?.remoteAddress) ||
    normalizeIp(req.socket?.remoteAddress) ||
    normalizeIp(req.ip);
  return connectionIp;
};

export const resolveGeoFromRequest = (req) => {
  const ip = extractIpFromRequest(req);
  if (!ip) return null;
  try {
    const lookup = geoip.lookup(ip);
    if (!lookup) return null;
    const [lat, lng] = Array.isArray(lookup.ll) ? lookup.ll : [null, null];
    return {
      ip,
      city: lookup.city || null,
      region: lookup.region || null,
      country: lookup.country || null,
      latitude: lat ?? null,
      longitude: lng ?? null,
    };
  } catch (err) {
    console.warn("resolveGeoFromRequest error:", err?.message || err);
    return null;
  }
};

