import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
import axios from "axios";
import { getHomeBadges, getHostBadges } from "../services/badge.service.js";
import { HOME_PROPERTY_TYPES, HOME_SPACE_TYPES } from "../models/Home.js";
import { HOME_DISCOUNT_RULE_TYPES } from "../models/HomeDiscountRule.js";
import { resolveGeoFromRequest } from "../utils/geoLocation.js";
import { mapHomeToCard, getCoverImage } from "../utils/homeMapper.js";

function asBool(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

const asNumber = (value, fallback = null) => {
  if (value == null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeLocationCode = (value) => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.toUpperCase() : null;
};

const resolveTaxRateFromLocation = async (country, state) => {
  const countryCode = normalizeLocationCode(country);
  if (!countryCode) return null;
  const stateCode = normalizeLocationCode(state);
  try {
    let match = null;
    if (stateCode) {
      match = await models.TaxRate.findOne({
        where: { country_code: countryCode, state_code: stateCode },
      });
    }
    if (!match) {
      match = await models.TaxRate.findOne({
        where: { country_code: countryCode, state_code: null },
      });
    }
    const rate = Number(match?.rate);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
};

const normalizeStringList = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeIdList = (value) =>
  normalizeStringList(value)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0);

const getUserId = (user) => user?.id || user?.sub;

const AMENITY_ICON_BY_KEY = {
  WIFI: "wifi-outline",
  INTERNET: "wifi-outline",
  AC: "snow-outline",
  AIR_CONDITIONING: "snow-outline",
  HEATING: "flame-outline",
  KITCHEN: "restaurant-outline",
  COOKING_BASICS: "restaurant-outline",
  WASHER: "refresh-outline",
  DRYER: "sync-outline",
  TV: "tv-outline",
  STREAMING: "play-circle-outline",
  PARKING: "car-outline",
  GARAGE: "car-sport-outline",
  POOL: "water-outline",
  HOT_TUB: "flame-outline",
  GYM: "barbell-outline",
  FITNESS: "barbell-outline",
  PETS: "paw-outline",
  PET_FRIENDLY: "paw-outline",
  WORKSPACE: "desktop-outline",
  DESK: "desktop-outline",
  BREAKFAST: "cafe-outline",
  COFFEE: "cafe-outline",
  SECURITY: "shield-checkmark-outline",
  CAMERA: "videocam-outline",
  LOCKBOX: "key-outline",
  SELF_CHECKIN: "key-outline",
};

const AMENITY_ICON_KEYWORDS = [
  { keyword: "wifi", icon: "wifi-outline" },
  { keyword: "internet", icon: "wifi-outline" },
  { keyword: "air conditioning", icon: "snow-outline" },
  { keyword: "a/c", icon: "snow-outline" },
  { keyword: "ac", icon: "snow-outline" },
  { keyword: "heat", icon: "flame-outline" },
  { keyword: "kitchen", icon: "restaurant-outline" },
  { keyword: "cook", icon: "restaurant-outline" },
  { keyword: "washer", icon: "refresh-outline" },
  { keyword: "dryer", icon: "sync-outline" },
  { keyword: "laundry", icon: "refresh-outline" },
  { keyword: "tv", icon: "tv-outline" },
  { keyword: "stream", icon: "play-circle-outline" },
  { keyword: "parking", icon: "car-outline" },
  { keyword: "garage", icon: "car-sport-outline" },
  { keyword: "pool", icon: "water-outline" },
  { keyword: "alberca", icon: "water-outline" },
  { keyword: "swim", icon: "water-outline" },
  { keyword: "gym", icon: "barbell-outline" },
  { keyword: "fitness", icon: "barbell-outline" },
  { keyword: "pet", icon: "paw-outline" },
  { keyword: "workspace", icon: "desktop-outline" },
  { keyword: "desk", icon: "desktop-outline" },
  { keyword: "breakfast", icon: "cafe-outline" },
  { keyword: "coffee", icon: "cafe-outline" },
  { keyword: "lockbox", icon: "key-outline" },
  { keyword: "self check", icon: "key-outline" },
  { keyword: "security", icon: "shield-checkmark-outline" },
  { keyword: "camera", icon: "videocam-outline" },
];

const resolveAmenityIcon = (amenity) => {
  if (!amenity) return "sparkles-outline";
  if (amenity.icon) return amenity.icon;
  const key = (amenity.amenity_key || amenity.key || amenity.name || "").toUpperCase();
  if (AMENITY_ICON_BY_KEY[key]) return AMENITY_ICON_BY_KEY[key];
  const label = String(amenity.label || amenity.name || "").toLowerCase();
  const match = AMENITY_ICON_KEYWORDS.find((item) => label.includes(item.keyword));
  return match?.icon || "sparkles-outline";
};

const DEFAULT_BED_TYPE_KEY = "SINGLE_BED";
const DEFAULT_BED_TYPE_LABEL = "Single bed";
const DEFAULT_BED_TYPE_ICON = "bed-outline";
let cachedDefaultBedType = null;

const getDefaultBedType = async () => {
  if (cachedDefaultBedType) return cachedDefaultBedType;
  try {
    const bedType = await models.HomeBedType.findOne({
      where: { bed_type_key: DEFAULT_BED_TYPE_KEY },
    });
    if (bedType) {
      cachedDefaultBedType = bedType.toJSON();
      return cachedDefaultBedType;
    }
  } catch (err) {
    console.warn("[getDefaultBedType] fallback", err?.message || err);
  }
  cachedDefaultBedType = {
    id: null,
    bed_type_key: DEFAULT_BED_TYPE_KEY,
    label: DEFAULT_BED_TYPE_LABEL,
    icon: DEFAULT_BED_TYPE_ICON,
  };
  return cachedDefaultBedType;
};

const ensureDefaultBedTypes = async (home) => {
  if (!home) return [];
  const existing = Array.isArray(home.bedTypes) ? home.bedTypes : [];
  if (existing.length) return existing;
  const defaultType = await getDefaultBedType();
  if (!defaultType) return [];
  const rawCount = Number(home.beds);
  const count = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 1;
  return [
    {
      id: null,
      home_id: home.id,
      bed_type_id: defaultType.id ?? null,
      count,
      bedType: defaultType,
      isFallback: true,
    },
  ];
};

const defaultArrivalGuide = () => ({
  checkInInstructions: "",
  accessCode: "",
  wifi: "",
  parking: "",
  addressNotes: "",
  contactPhone: "",
  contactEmail: "",
  notes: "",
});

const parseArrivalGuide = (houseManual) => {
  if (!houseManual) return defaultArrivalGuide();
  if (typeof houseManual === "object") {
    return { ...defaultArrivalGuide(), ...houseManual };
  }
  try {
    const parsed = JSON.parse(houseManual);
    if (parsed && typeof parsed === "object") {
      return { ...defaultArrivalGuide(), ...parsed };
    }
  } catch (_) {
    // treat as plain text
  }
  return { ...defaultArrivalGuide(), checkInInstructions: String(houseManual || "") };
};

const normalizeMediaMetadata = (value) => {
  if (!value || typeof value !== "object") return null;

  const metadata = {};

  for (const [key, raw] of Object.entries(value)) {
    if (["room", "bedroom", "bedLabel", "bedType"].includes(key)) continue;
    if (raw == null || ["string", "number", "boolean"].includes(typeof raw)) {
      metadata[key] = raw;
    }
  }

  const roomRaw = typeof value.room === "string" ? value.room.trim() : "";
  const allowedRooms = [
    "BEDROOM",
    "LIVING_ROOM",
    "KITCHEN",
    "BATHROOM",
    "OUTDOOR",
    "DINING",
    "OTHER",
  ];
  const room = roomRaw && allowedRooms.includes(roomRaw.toUpperCase()) ? roomRaw.toUpperCase() : null;
  if (room) metadata.room = room;

  const bedroomNumber = Number(value.bedroom);
  if (Number.isFinite(bedroomNumber) && bedroomNumber > 0 && bedroomNumber <= 50) {
    metadata.bedroom = bedroomNumber;
  }

  const bedLabel =
    typeof value.bedLabel === "string" ? value.bedLabel.trim().slice(0, 80) : "";
  if (bedLabel) metadata.bedLabel = bedLabel;

  const bedType =
    typeof value.bedType === "string" ? value.bedType.trim().slice(0, 40) : "";
  if (bedType) metadata.bedType = bedType;

  return Object.keys(metadata).length ? metadata : null;
};

const LISTING_TYPES = ["STANDARD", "EXPERIENCE", "SERVICE"];

const mapHomeToExploreCard = (home) => {
  const base = mapHomeToCard(home);
  if (!base) return null;
  const ratingValueRaw =
    home?.rating ??
    home?.avg_rating ??
    home?.meta?.stats?.overallRating ??
    null;
  const ratingValue = Number(ratingValueRaw);
  const reviewCount = Number(
    home?.review_count ?? home?.meta?.stats?.reviews ?? 0
  );
  let ratingLabel = null;
  if (Number.isFinite(ratingValue)) {
    ratingLabel = ratingValue.toFixed(2);
    if (Number.isFinite(reviewCount) && reviewCount > 0) {
      ratingLabel = `${ratingLabel} (${reviewCount})`;
    }
  } else if (Number.isFinite(reviewCount) && reviewCount > 0) {
    ratingLabel = `${reviewCount} reviews`;
  }
  return {
    ...base,
    ratingLabel,
  };
};

const mapHomeToSimilarCard = (home, distanceKm = null) => {
  if (!home) return null;
  const address = home.address ?? {};
  const pricing = home.pricing ?? {};
  return {
    id: home.id,
    title: home.title ?? "Untitled stay",
    city: address.city ?? null,
    state: address.state ?? null,
    country: address.country ?? null,
    locationText: [address.city, address.state, address.country].filter(Boolean).join(", "),
    price: pricing?.base_price != null ? Number(pricing.base_price) : null,
    currency: pricing?.currency ?? "USD",
    coverImage: getCoverImage(home),
    distanceKm: distanceKm != null ? Number(distanceKm) : null,
  };
};

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
};

const buildPriceStats = (prices = []) => {
  const values = prices
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  const mid = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
  return {
    min: values[0],
    max: values[values.length - 1],
    avg: total / values.length,
    median,
    count: values.length,
  };
};

const buildExploreSections = (items) => {
  const safeItems = Array.isArray(items)
    ? items.filter(Boolean)
    : [];
  if (!safeItems.length) return [];

  const chunk = (start, size) => safeItems.slice(start, start + size);
  const chunkSize = 8;
  const sections = [];

  const titles = [
    "Featured stays",
    "Recommended for you",
    "More homes nearby",
  ];

  titles.forEach((title, index) => {
    const start = index * chunkSize;
    const slice = chunk(start, chunkSize);
    if (slice.length) {
      sections.push({
        id: `homes-section-${index + 1}`,
        title,
        items: slice,
      });
    }
  });

  const remaining = chunk(titles.length * chunkSize, safeItems.length);
  if (remaining.length) {
    sections.push({
      id: "homes-section-more",
      title: "Discover more stays",
      items: remaining,
    });
  }

  return sections;
};

export const listExploreHomes = async (req, res) => {
  try {
    const limitParam = Number(req.query?.limit);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, 60)
        : 40;

    const homes = await models.Home.findAll({
      where: {
        status: "PUBLISHED",
        is_visible: true,
      },
      attributes: [
        "id",
        "title",
        "space_type",
        "max_guests",
        "bedrooms",
        "beds",
        "bathrooms",
        "marketing_tags",
        "updated_at",
        "host_id",
      ],
      include: [
        {
          model: models.HomeAddress,
          as: "address",
          attributes: [
            "address_line1",
            "city",
            "state",
            "country",
          ],
        },
        {
          model: models.HomePricing,
          as: "pricing",
          attributes: ["currency", "base_price"],
        },
        {
          model: models.HomeMedia,
          as: "media",
          attributes: ["id", "url", "is_cover", "order"],
          separate: true,
          limit: 6,
          order: [
            ["is_cover", "DESC"],
            ["order", "ASC"],
            ["id", "ASC"],
          ],
        },
        {
          model: models.User,
          as: "host",
          attributes: ["id", "name", "email", "avatar_url", "role", "created_at"],
        },
      ],
      order: [
        ["updated_at", "DESC"],
        ["id", "DESC"],
      ],
      limit,
    });

    const cards = homes
      .map(mapHomeToExploreCard)
      .filter((item) => item && item.coverImage);

    const sections = buildExploreSections(cards);

    return res.json({
      sections,
      total: cards.length,
    });
  } catch (err) {
    console.error("[listExploreHomes]", err);
    return res.status(500).json({ error: "Failed to load homes" });
  }
};

export const listHomeDestinations = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    const limitParam = Number(req.query?.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 20) : 12;
    const query = typeof req.query?.query === "string" ? req.query.query.trim() : "";
    const lat = parseCoordinate(req.query?.lat);
    const lng = parseCoordinate(req.query?.lng);
    const iLikeOp = (typeof sequelize.getDialect === "function" ? sequelize.getDialect() : "mysql") === "mysql" ? Op.like : Op.iLike;

    const addressWhere = {};
    if (query.length >= 2) {
      addressWhere[Op.or] = [
        { city: { [iLikeOp]: `%${query}%` } },
        { state: { [iLikeOp]: `%${query}%` } },
        { country: { [iLikeOp]: `%${query}%` } },
      ];
    }

    const rows = await models.HomeAddress.findAll({
      attributes: [
        "city",
        "state",
        "country",
        [sequelize.fn("COUNT", sequelize.col("Home.id")), "stays"],
        [sequelize.fn("AVG", sequelize.col("latitude")), "lat"],
        [sequelize.fn("AVG", sequelize.col("longitude")), "lng"],
      ],
      include: [
        {
          model: models.Home,
          required: true,
          attributes: [],
          where: { status: "PUBLISHED", is_visible: true },
        },
      ],
      where: addressWhere,
      group: ["city", "state", "country"],
      order: [[sequelize.literal("stays"), "DESC"]],
      limit,
      raw: true,
    });

    const normalized = rows
      .map((row, idx) => {
        const labelParts = [row.city, row.state, row.country].filter(Boolean);
        if (!labelParts.length) return null;
        const latCenter = Number(row.lat);
        const lngCenter = Number(row.lng);
        const distance =
          lat != null && lng != null && Number.isFinite(latCenter) && Number.isFinite(lngCenter)
            ? Math.abs(latCenter - lat) + Math.abs(lngCenter - lng)
            : null;
        return {
          id: `${row.city || row.state || row.country || "dest"}-${idx}`,
          city: row.city,
          state: row.state,
          country: row.country,
          label: labelParts.join(", "),
          lat: Number.isFinite(latCenter) ? latCenter : null,
          lng: Number.isFinite(lngCenter) ? lngCenter : null,
          stays: Number(row.stays) || 0,
          bookings: Number(row.bookings) || 0,
          distance,
          source: "internal",
        };
      })
      .filter(Boolean);

    const sorted =
      lat != null && lng != null
        ? normalized.sort((a, b) => {
          if (a.distance == null && b.distance == null) return b.stays - a.stays;
          if (a.distance == null) return 1;
          if (b.distance == null) return -1;
          return a.distance - b.distance;
        })
        : normalized;

    const destinations = [...sorted];

    // Fallback to Google Geocoding when there are few/no internal matches and a query is provided
    if (query.length >= 2 && destinations.length < Math.max(3, limit / 2)) {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
      if (apiKey) {
        try {
          const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`;
          const { data } = await axios.get(url, { timeout: 4000 });
          if (data?.status === "OK" && Array.isArray(data.results)) {
            const geocoderResults = data.results
              .map((result, idx) => {
                const types = Array.isArray(result.types) ? result.types : [];
                const isLocality =
                  types.includes("locality") ||
                  types.includes("administrative_area_level_1") ||
                  types.includes("administrative_area_level_2") ||
                  types.includes("political");
                if (!isLocality) return null;
                const city =
                  result.address_components?.find((c) => c.types?.includes("locality"))?.long_name ||
                  null;
                const state =
                  result.address_components?.find((c) => c.types?.includes("administrative_area_level_1"))?.long_name ||
                  null;
                const country =
                  result.address_components?.find((c) => c.types?.includes("country"))?.long_name || null;
                const label = result.formatted_address || [city, state, country].filter(Boolean).join(", ");
                const latLng = result.geometry?.location || {};
                const destId = `geo-${idx}-${label}`;
                // Avoid duplicates against internal list
                if (destinations.some((d) => d.label?.toLowerCase() === label.toLowerCase())) return null;
                return {
                  id: destId,
                  city,
                  state,
                  country,
                  label: label || query,
                  lat: latLng.lat ?? null,
                  lng: latLng.lng ?? null,
                  stays: 0,
                  bookings: 0,
                  distance: null,
                  source: "geocoder",
                };
              })
              .filter(Boolean);
            destinations.push(...geocoderResults);
          }
        } catch (geoErr) {
          console.warn("[listHomeDestinations] geocoder fallback failed:", geoErr?.message || geoErr);
        }
      }
    }

    res.json({ destinations: destinations.slice(0, limit) });
  } catch (err) {
    console.error("[listHomeDestinations]", err);
    res.status(500).json({ error: "Unable to load destinations" });
  }
};

const parseCoordinate = (value) => {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < -180 || num > 180) return null;
  return num;
};

const TRAVELER_COORDINATE_DELTA = 0.75;
const TRAVELER_STATUS_SCOPE = ["CONFIRMED", "COMPLETED"];

export const searchHomes = async (req, res) => {
  try {
    console.log("[searchHomes] query", req.query);
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const rawCity = typeof req.query?.city === "string" ? req.query.city.trim() : "";
    const rawCountry = typeof req.query?.country === "string" ? req.query.country.trim() : "";
    const lat = parseCoordinate(req.query?.lat);
    const lng = parseCoordinate(req.query?.lng);
    const limitParam = Number(req.query?.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 60) : 30;
    const bedTypeKeys = normalizeStringList(
      req.query?.bedTypeKeys ?? req.query?.bedTypes ?? req.query?.bed_type_keys
    ).map((key) => key.toUpperCase());
    const bedTypeIds = normalizeIdList(req.query?.bedTypeIds ?? req.query?.bed_type_ids);
    const needsBedTypeJoin = Boolean(bedTypeKeys.length || bedTypeIds.length);

    const addressAttributes = ["address_line1", "city", "state", "country", "latitude", "longitude"];
    const baseWhere = { status: "PUBLISHED", is_visible: true };
    const dialect = typeof sequelize.getDialect === "function" ? sequelize.getDialect() : "mysql";
    const iLikeOp = dialect === "mysql" ? Op.like : Op.iLike;

    const addressWhere = {};
    if (lat != null && lng != null) {
      addressWhere.latitude = { [Op.not]: null, [Op.between]: [lat - 1, lat + 1] };
      addressWhere.longitude = { [Op.not]: null, [Op.between]: [lng - 1, lng + 1] };
    }
    if (rawCity) {
      addressWhere.city = { [iLikeOp]: rawCity };
    }
    if (rawCountry) {
      addressWhere.country = { [iLikeOp]: rawCountry };
    }
    const hasAddressWhere = Object.keys(addressWhere).length > 0;

    const include = [
      {
        model: models.HomeAddress,
        as: "address",
        attributes: addressAttributes,
        required: hasAddressWhere,
        where: hasAddressWhere ? addressWhere : undefined,
      },
      {
        model: models.HomePricing,
        as: "pricing",
        attributes: ["currency", "base_price"],
        required: false,
      },
      {
        model: models.HomeMedia,
        as: "media",
        attributes: ["id", "url", "is_cover", "order"],
        separate: true,
        limit: 6,
        order: [
          ["is_cover", "DESC"],
          ["order", "ASC"],
          ["id", "ASC"],
        ],
      },
      {
        model: models.User,
        as: "host",
        attributes: ["id", "name", "email", "avatar_url", "role"],
      },
    ];
    if (needsBedTypeJoin) {
      include.push({
        model: models.HomeBedTypeLink,
        as: "bedTypes",
        required: false,
        include: [
          {
            model: models.HomeBedType,
            as: "bedType",
            attributes: ["id", "bed_type_key", "label", "icon"],
          },
        ],
      });
    }

    const homes = await models.Home.findAll({
      where: baseWhere,
      include,
      order: [
        ["updated_at", "DESC"],
        ["id", "DESC"],
      ],
      limit,
    });

    if (needsBedTypeJoin && (bedTypeKeys.includes(DEFAULT_BED_TYPE_KEY) || bedTypeIds.length)) {
      await getDefaultBedType();
    }

    const filteredHomes = needsBedTypeJoin
      ? (() => {
        const defaultId = (() => {
          const numeric = Number(cachedDefaultBedType?.id);
          return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
        })();
        return homes.filter((home) => {
          const links = Array.isArray(home?.bedTypes) ? home.bedTypes : [];
          if (!links.length) {
            const matchesKey = bedTypeKeys.length
              ? bedTypeKeys.includes(DEFAULT_BED_TYPE_KEY)
              : true;
            const matchesId = bedTypeIds.length
              ? defaultId != null && bedTypeIds.includes(defaultId)
              : true;
            return matchesKey && matchesId;
          }
          const keys = new Set(
            links
              .map((link) => link?.bedType?.bed_type_key || link?.bedType?.key || link?.bed_type_key)
              .filter(Boolean)
              .map((key) => String(key).toUpperCase())
          );
          const ids = new Set(
            links
              .map((link) => Number(link?.bed_type_id ?? link?.bedType?.id))
              .filter((value) => Number.isFinite(value) && value > 0)
          );
          const matchesKey = bedTypeKeys.length ? bedTypeKeys.some((key) => keys.has(key)) : true;
          const matchesId = bedTypeIds.length ? bedTypeIds.some((id) => ids.has(id)) : true;
          return matchesKey && matchesId;
        });
      })()
      : homes;

    const cards = filteredHomes.map((home) => mapHomeToCard(home)).filter(Boolean);

    return res.json({
      items: cards,
      count: cards.length,
      query: {
        city: rawCity || null,
        country: rawCountry || null,
        lat: lat ?? null,
        lng: lng ?? null,
      },
    });
  } catch (err) {
    console.error("[searchHomes]", err);
    return res.status(500).json({ error: "Failed to search homes" });
  }
};

export const listSimilarHomes = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const listingId = Number(req.query?.listingId);
    const limitParam = Number(req.query?.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 30) : 12;
    const radiusParam = Number(req.query?.radiusKm ?? req.query?.radius);
    const radiusKm = Number.isFinite(radiusParam) && radiusParam > 0 ? Math.min(radiusParam, 80) : 25;
    let lat = parseCoordinate(req.query?.lat);
    let lng = parseCoordinate(req.query?.lng);
    let propertyType = req.query?.propertyType || req.query?.property_type || null;
    let spaceType = req.query?.spaceType || req.query?.space_type || null;
    let bedrooms = Number(req.query?.bedrooms);
    let beds = Number(req.query?.beds);
    let maxGuests = Number(req.query?.maxGuests ?? req.query?.max_guests);
    let currency = typeof req.query?.currency === "string" ? req.query.currency.trim().toUpperCase() : null;

    if (Number.isFinite(listingId) && listingId > 0) {
      const home = await models.Home.findOne({
        where: { id: listingId, host_id: hostId },
        include: [{ model: models.HomeAddress, as: "address" }, { model: models.HomePricing, as: "pricing" }],
      });
      if (!home) return res.status(404).json({ error: "Listing not found" });

      const address = home.address ?? {};
      const addressLat = parseCoordinate(address.latitude ?? address.lat);
      const addressLng = parseCoordinate(address.longitude ?? address.lng);
      if (addressLat != null) lat = addressLat;
      if (addressLng != null) lng = addressLng;
      propertyType = home.property_type || propertyType;
      spaceType = home.space_type || spaceType;
      bedrooms = Number.isFinite(bedrooms) ? bedrooms : Number(home.bedrooms);
      beds = Number.isFinite(beds) ? beds : Number(home.beds);
      maxGuests = Number.isFinite(maxGuests) ? maxGuests : Number(home.max_guests);
      currency = currency || home.pricing?.currency || null;
    }

    if (lat == null || lng == null) {
      return res.status(400).json({ error: "Latitude and longitude are required" });
    }

    const normalizedPropertyType = typeof propertyType === "string" ? propertyType.toUpperCase() : null;
    const normalizedSpaceType = typeof spaceType === "string" ? spaceType.toUpperCase() : null;
    const bedroomValue = Number.isFinite(bedrooms) && bedrooms > 0 ? bedrooms : null;
    const bedValue = Number.isFinite(beds) && beds > 0 ? beds : null;
    const guestValue = Number.isFinite(maxGuests) && maxGuests > 0 ? maxGuests : null;

    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / 111;
    const addressWhere = {
      latitude: { [Op.not]: null, [Op.between]: [lat - latDelta, lat + latDelta] },
      longitude: { [Op.not]: null, [Op.between]: [lng - lngDelta, lng + lngDelta] },
    };

    const baseWhere = { status: "PUBLISHED", is_visible: true };
    if (normalizedPropertyType) baseWhere.property_type = normalizedPropertyType;
    if (normalizedSpaceType) baseWhere.space_type = normalizedSpaceType;
    if (bedroomValue) {
      baseWhere.bedrooms = {
        [Op.between]: [Math.max(1, bedroomValue - 1), bedroomValue + 1],
      };
    }
    if (bedValue) {
      baseWhere.beds = {
        [Op.between]: [Math.max(1, bedValue - 1), bedValue + 1],
      };
    }
    if (guestValue) {
      baseWhere.max_guests = {
        [Op.between]: [Math.max(1, guestValue - 2), guestValue + 2],
      };
    }
    if (Number.isFinite(listingId) && listingId > 0) {
      baseWhere.id = { [Op.ne]: listingId };
    }

    const fetchLimit = Math.min(Math.max(limit * 3, 20), 60);

    const similarHomes = await models.Home.findAll({
      where: baseWhere,
      include: [
        {
          model: models.HomeAddress,
          as: "address",
          attributes: ["address_line1", "city", "state", "country", "latitude", "longitude"],
          required: true,
          where: addressWhere,
        },
        {
          model: models.HomePricing,
          as: "pricing",
          attributes: ["currency", "base_price"],
          required: Boolean(currency),
          where: currency ? { currency } : undefined,
        },
        {
          model: models.HomeMedia,
          as: "media",
          attributes: ["id", "url", "is_cover", "order"],
          separate: true,
          limit: 4,
          order: [
            ["is_cover", "DESC"],
            ["order", "ASC"],
            ["id", "ASC"],
          ],
        },
      ],
      order: [
        ["updated_at", "DESC"],
        ["id", "DESC"],
      ],
      limit: fetchLimit,
    });

    const filtered = similarHomes
      .map((home) => {
        const address = home.address ?? {};
        const latValue = Number(address.latitude);
        const lngValue = Number(address.longitude);
        if (!Number.isFinite(latValue) || !Number.isFinite(lngValue)) return null;
        const distance = haversineKm(lat, lng, latValue, lngValue);
        if (!Number.isFinite(distance) || distance > radiusKm) return null;
        return { home, distance };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);

    const items = filtered.slice(0, limit).map(({ home, distance }) =>
      mapHomeToSimilarCard(home, distance)
    );

    const priceStats = buildPriceStats(items.map((item) => item?.price));
    const stats = priceStats ? { ...priceStats, currency: currency || items[0]?.currency || "USD" } : null;

    return res.json({
      items,
      stats,
      count: items.length,
      radiusKm,
    });
  } catch (err) {
    console.error("[listSimilarHomes]", err);
    return res.status(500).json({ error: "Failed to load similar listings" });
  }
};

export const getHomeRecommendations = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    console.log("[getHomeRecommendations] query", req.query);
    const rawCity = typeof req.query?.city === "string" ? req.query.city.trim() : "";
    const rawCountry =
      typeof req.query?.country === "string" ? req.query.country.trim() : "";
    let city = rawCity || null;
    let country = rawCountry || null;
    let lat = parseCoordinate(req.query?.lat);
    let lng = parseCoordinate(req.query?.lng);
    const gpsCustom = ["1", "true", "yes"].includes(String(req.query?.gpscustom || req.query?.gpsCustom || "false").toLowerCase());
    const latCustom = parseCoordinate(req.query?.lat_custom || req.query?.latCustom);
    const lngCustom = parseCoordinate(req.query?.lng_custom || req.query?.lngCustom);
    if (gpsCustom && latCustom != null && lngCustom != null) {
      lat = latCustom;
      lng = lngCustom;
    }
    let region = null;

    if (!city && !country && lat == null && lng == null) {
      const geo = resolveGeoFromRequest(req);
      if (geo) {
        city = geo.city || city;
        country = geo.country || country;
        region = geo.region || null;
        if (lat == null && Number.isFinite(geo.latitude)) {
          lat = geo.latitude;
        }
        if (lng == null && Number.isFinite(geo.longitude)) {
          lng = geo.longitude;
        }
      }
    }

    const limitParam = Number(req.query?.limit);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 60) : 12;

    console.log("[getHomeRecommendations] inferred location", { city, country, lat, lng, region, limit });

    // Define dialect/ops BEFORE using them in include/where clauses
    const dialect = typeof sequelize.getDialect === "function" ? sequelize.getDialect() : "mysql";
    const iLikeOp = dialect === "mysql" ? Op.like : Op.iLike;
    const quote = (name) => (dialect === "mysql" ? `\`${name}\`` : `"${name}"`);
    const columnRef = (alias, column) => `${quote(alias)}.${quote(column)}`;

    const baseWhere = {
      status: "PUBLISHED",
      is_visible: true,
    };

    const addressAttributes = ["address_line1", "city", "state", "country", "latitude", "longitude"];

    const includeBase = [
      {
        model: models.HomeAddress,
        as: "address",
        attributes: addressAttributes,
        // If we have lat/lng, bound by a small box and sort by distance; otherwise use city/country text
        required: Boolean((lat != null && lng != null) || city || country),
        where:
          lat != null && lng != null
            ? {
              latitude: { [Op.not]: null },
              longitude: { [Op.not]: null },
              // simple bounding box to avoid returning far-away homes
              latitude: { [Op.between]: [lat - 1, lat + 1] },
              longitude: { [Op.between]: [lng - 1, lng + 1] },
            }
            : city || country
              ? {
                ...(city ? { city: { [iLikeOp]: city } } : {}),
                ...(country ? { country: { [iLikeOp]: country } } : {}),
              }
              : undefined,
      },
      {
        model: models.HomePricing,
        as: "pricing",
        attributes: ["currency", "base_price"],
        required: false,
      },
      {
        model: models.HomeMedia,
        as: "media",
        attributes: ["id", "url", "is_cover", "order"],
        separate: true,
        limit: 6,
        order: [
          ["is_cover", "DESC"],
          ["order", "ASC"],
          ["id", "ASC"],
        ],
      },
      {
        model: models.User,
        as: "host",
        attributes: ["id", "name", "email", "avatar_url", "role"],
        include: [
          {
            model: models.HostProfile,
            as: "hostProfile",
            attributes: ["metadata"],
            required: false,
          },
        ],
      },
    ];

    const distanceLiteral =
      lat != null && lng != null
        ? sequelize.literal(
          `ABS(COALESCE(${columnRef("address", "latitude")}, 0) - ${lat}) + ABS(COALESCE(${columnRef(
            "address",
            "longitude"
          )}, 0) - ${lng})`
        )
        : null;

    const nearbyPromise = models.Home.findAll({
      where: {
        ...baseWhere,
      },
      include: includeBase,
      order: [
        ...(distanceLiteral ? [[distanceLiteral, "ASC"]] : []),
        ["updated_at", "DESC"],
        ["id", "DESC"],
      ],
      limit,
    });

    const trendingPromise = models.Home.findAll({
      where: baseWhere,
      include: includeBase,
      order: [
        ["created_at", "DESC"],
        ["updated_at", "DESC"],
      ],
      limit,
    });

    const bestValuePromise = models.Home.findAll({
      where: baseWhere,
      include: includeBase,
      order: [
        [{ model: models.HomePricing, as: "pricing" }, "base_price", "ASC"],
        ["updated_at", "DESC"],
      ],
      limit,
    });

    const [nearbyRaw, trendingRaw, bestValueRaw] = await Promise.all([
      nearbyPromise,
      trendingPromise,
      bestValuePromise,
    ]);

    console.log("[getHomeRecommendations] raw counts", {
      nearbyRaw: nearbyRaw.length,
      trendingRaw: trendingRaw.length,
      bestValueRaw: bestValueRaw.length,
    });

    const dedupeById = (arr = []) => {
      const seen = new Set();
      const result = [];
      for (const card of arr) {
        const id = card?.id;
        if (id == null) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(card);
      }
      return result;
    };

    const mapCards = (items) =>
      dedupeById(
        (items ?? [])
          .map(mapHomeToExploreCard)
          .filter((card) => card)
      );

    const nearbyCards = mapCards(nearbyRaw);
    const trendingCards = mapCards(trendingRaw);
    const bestValueCards = mapCards(bestValueRaw);

    console.log("[getHomeRecommendations] card counts after map", {
      nearbyCards: nearbyCards.length,
      trendingCards: trendingCards.length,
      bestValueCards: bestValueCards.length,
    });

    const cityKeyForCard = (card) => {
      const label =
        card?.city ||
        card?.location ||
        card?.state ||
        card?.country ||
        null;
      return label ? label.toLowerCase() : "__cityless";
    };

    const buildCityGroups = (cards = []) => {
      const groups = [];
      const map = new Map();
      for (const card of cards || []) {
        if (!card) continue;
        const key = cityKeyForCard(card);
        if (!map.has(key)) {
          map.set(key, {
            key,
            label: card?.city || card?.location || card?.state || card?.country || null,
            cards: [],
          });
          groups.push(map.get(key));
        }
        map.get(key).cards.push(card);
      }
      return groups;
    };

    const sliderLimit = Math.min(7, Math.max(1, limit || 7));

    const normalizeDestinationRow = (row) => {
      if (!row) return null;
      const parts = [row?.city, row?.state, row?.country]
        .map((value) => (value == null ? null : String(value).trim()))
        .filter(Boolean);
      const label = parts[0] || null;
      if (!label) return null;
      return {
        ...row,
        __label: label,
        __key: label.toLowerCase(),
      };
    };

    const buildSectionForDestination = async (destinationRow, { sectionId, prefix }) => {
      if (!destinationRow) return null;

      const destinationWhere =
        destinationRow.city != null
          ? { city: { [iLikeOp]: destinationRow.city } }
          : destinationRow.state != null
            ? { state: { [iLikeOp]: destinationRow.state } }
            : destinationRow.country != null
              ? { country: { [iLikeOp]: destinationRow.country } }
              : null;

      if (!destinationWhere) return null;

      const [addressInclude, ...restIncludes] = includeBase;
      if (!addressInclude) return null;
      const destinationIncludes = [
        {
          ...addressInclude,
          required: true,
          where: destinationWhere,
        },
        ...restIncludes,
      ];

      const rawHomes = await models.Home.findAll({
        where: baseWhere,
        include: destinationIncludes,
        order: [
          ["updated_at", "DESC"],
          ["id", "DESC"],
        ],
        limit,
      });

      const cards = mapCards(rawHomes).slice(0, sliderLimit);
      if (!cards.length) return null;

      return {
        key: destinationRow.__key,
        section: {
          id: sectionId,
          title: destinationRow.__label ? `${prefix} ${destinationRow.__label}` : prefix,
          items: cards,
        },
      };
    };

    const buildTravelerSection = async ({
      excludeKeys = new Set(),
      locationLabel: locationLabelArg = null,
      sectionId = "homes-slider-travelers",
    } = {}) => {
      if (lat == null || lng == null) return null;

      const bookingWhere = {
        "$homeStay.home.address.latitude$": { [Op.between]: [lat - TRAVELER_COORDINATE_DELTA, lat + TRAVELER_COORDINATE_DELTA] },
        "$homeStay.home.address.longitude$": { [Op.between]: [lng - TRAVELER_COORDINATE_DELTA, lng + TRAVELER_COORDINATE_DELTA] },
        inventory_type: "HOME",
        status: { [Op.in]: TRAVELER_STATUS_SCOPE },
      };

      const destinationRows = await models.Booking.findAll({
        attributes: [
          [sequelize.col("homeStay->home->address.city"), "city"],
          [sequelize.col("homeStay->home->address.state"), "state"],
          [sequelize.col("homeStay->home->address.country"), "country"],
          [sequelize.fn("COUNT", sequelize.col("Stay.id")), "count"],
        ],
        where: {
          ...bookingWhere,
        },
        include: [
          {
            model: models.StayHome,
            as: "homeStay",
            attributes: [],
            required: true,
            include: [
              {
                model: models.Home,
                as: "home",
                attributes: [],
                required: true,
                include: [
                  {
                    model: models.HomeAddress,
                    as: "address",
                    attributes: [],
                    required: true,
                  },
                ],
              },
            ],
          },
        ],
        group: [
          sequelize.col("homeStay->home->address.city"),
          sequelize.col("homeStay->home->address.state"),
          sequelize.col("homeStay->home->address.country"),
        ],
        order: [[sequelize.literal("count"), "DESC"]],
        limit: 5,
        raw: true,
        subQuery: false,
      });

      if (!destinationRows.length) return null;

      const normalizedRows = destinationRows
        .map((row) => normalizeDestinationRow(row))
        .filter(Boolean);

      let destinationRow = null;
      for (const row of normalizedRows) {
        if (excludeKeys.has(row.__key)) continue;
        destinationRow = row;
        break;
      }

      if (!destinationRow) return null;

      const prefix = locationLabelArg
        ? `${locationLabelArg} travelers also visit`
        : "Locals also visit";

      return buildSectionForDestination(destinationRow, {
        sectionId,
        prefix,
      });
    };

    const buildTopBookingSection = async ({
      excludeKeys = new Set(),
      sectionId = "homes-slider-top-booked",
      prefix = "Most booked in",
    } = {}) => {
      const destinationRows = await models.Booking.findAll({
        attributes: [
          [sequelize.col("homeStay->home->address.city"), "city"],
          [sequelize.col("homeStay->home->address.state"), "state"],
          [sequelize.col("homeStay->home->address.country"), "country"],
          [sequelize.fn("COUNT", sequelize.col("Stay.id")), "count"],
        ],
        where: {
          inventory_type: "HOME",
          status: { [Op.in]: TRAVELER_STATUS_SCOPE },
        },
        include: [
          {
            model: models.StayHome,
            as: "homeStay",
            attributes: [],
            required: true,
            include: [
              {
                model: models.Home,
                as: "home",
                attributes: [],
                required: true,
                include: [
                  {
                    model: models.HomeAddress,
                    as: "address",
                    attributes: [],
                    required: true,
                  },
                ],
              },
            ],
          },
        ],
        group: [
          sequelize.col("homeStay->home->address.city"),
          sequelize.col("homeStay->home->address.state"),
          sequelize.col("homeStay->home->address.country"),
        ],
        order: [[sequelize.literal("count"), "DESC"]],
        limit: 8,
        raw: true,
        subQuery: false,
      });

      if (!destinationRows.length) return null;

      const normalizedRows = destinationRows
        .map((row) => normalizeDestinationRow(row))
        .filter(Boolean);

      let destinationRow = null;
      for (const row of normalizedRows) {
        if (excludeKeys.has(row.__key)) continue;
        destinationRow = row;
        break;
      }

      if (!destinationRow) return null;

      return buildSectionForDestination(destinationRow, {
        sectionId,
        prefix,
      });
    };

    const sliderSections = [];
    const usedCityKeys = new Set();

    const cityKeyFromCards = (cards) => {
      if (!Array.isArray(cards) || !cards.length) return null;
      const label =
        cards[0]?.city ||
        cards[0]?.location ||
        cards[0]?.state ||
        cards[0]?.country ||
        null;
      return label ? String(label).toLowerCase() : null;
    };

    const cityTitle = (cards, fallback) => {
      const label =
        cards?.[0]?.city ||
        cards?.[0]?.location ||
        cards?.[0]?.state ||
        cards?.[0]?.country ||
        null;
      return label ? `${fallback} in ${label}` : fallback;
    };

    const buildSlices = (cards) => [
      cards.slice(0, sliderLimit),
      cards.slice(sliderLimit, sliderLimit * 2),
    ];

    const nearbyGroups = buildCityGroups(nearbyCards);
    const nearbyGroup1 = nearbyGroups[0]?.cards?.slice(0, sliderLimit) || [];
    const nearbyGroup2 = nearbyGroups[1]?.cards?.slice(0, sliderLimit) || [];
    const [trending1, trending2] = buildSlices(trendingCards);
    const [best1, best2] = buildSlices(bestValueCards);

    if (nearbyGroup1.length) {
      sliderSections.push({
        id: "homes-slider-nearby-1",
        title: cityTitle(nearbyGroup1, "Nearby stays"),
        items: nearbyGroup1,
      });
      if (nearbyGroups[0]?.key) usedCityKeys.add(nearbyGroups[0].key);
    }
    if (trending1.length) {
      const key = cityKeyFromCards(trending1);
      if (!key || !usedCityKeys.has(key)) {
        sliderSections.push({ id: "homes-slider-trending-1", title: cityTitle(trending1, "Trending stays"), items: trending1 });
        if (key) usedCityKeys.add(key);
      }
    }
    if (nearbyGroup2.length) {
      sliderSections.push({
        id: "homes-slider-nearby-2",
        title: cityTitle(nearbyGroup2, "Nearby stays"),
        items: nearbyGroup2,
      });
      if (nearbyGroups[1]?.key) usedCityKeys.add(nearbyGroups[1].key);
    }
    if (best1.length) {
      const key = cityKeyFromCards(best1);
      if (!key || !usedCityKeys.has(key)) {
        sliderSections.push({ id: "homes-slider-best-1", title: cityTitle(best1, "Best value"), items: best1 });
        if (key) usedCityKeys.add(key);
      }
    }
    if (trending2.length) {
      const key = cityKeyFromCards(trending2);
      if (!key || !usedCityKeys.has(key)) {
        sliderSections.push({ id: "homes-slider-trending-2", title: cityTitle(trending2, "Trending stays"), items: trending2 });
        if (key) usedCityKeys.add(key);
      }
    }
    if (best2.length) {
      const key = cityKeyFromCards(best2);
      if (!key || !usedCityKeys.has(key)) {
        sliderSections.push({ id: "homes-slider-best-2", title: cityTitle(best2, "Best value"), items: best2 });
        if (key) usedCityKeys.add(key);
      }
    }

    const locationLabel =
      city ||
      nearbyCards[0]?.city ||
      null;

    const travelerSectionResult = await buildTravelerSection({
      excludeKeys: usedCityKeys,
      locationLabel,
    });

    if (travelerSectionResult?.section) {
      sliderSections.push(travelerSectionResult.section);
      if (travelerSectionResult.key) {
        usedCityKeys.add(travelerSectionResult.key);
      }
    }

    const travelerSectionResultSecondary = await buildTravelerSection({
      excludeKeys: usedCityKeys,
      locationLabel,
      sectionId: "homes-slider-travelers-secondary",
    });

    if (travelerSectionResultSecondary?.section) {
      sliderSections.push(travelerSectionResultSecondary.section);
      if (travelerSectionResultSecondary.key) {
        usedCityKeys.add(travelerSectionResultSecondary.key);
      }
    }

    const topBookingSectionPrimary = await buildTopBookingSection({
      excludeKeys: usedCityKeys,
      sectionId: "homes-slider-top-booked-primary",
      prefix: "Most booked in",
    });

    if (topBookingSectionPrimary?.section) {
      sliderSections.push(topBookingSectionPrimary.section);
      if (topBookingSectionPrimary.key) {
        usedCityKeys.add(topBookingSectionPrimary.key);
      }
    }

    const topBookingSectionSecondary = await buildTopBookingSection({
      excludeKeys: usedCityKeys,
      sectionId: "homes-slider-top-booked-secondary",
      prefix: "Also popular in",
    });

    if (topBookingSectionSecondary?.section) {
      sliderSections.push(topBookingSectionSecondary.section);
      if (topBookingSectionSecondary.key) {
        usedCityKeys.add(topBookingSectionSecondary.key);
      }
    }

    return res.json({
      location: {
        city: locationLabel,
        region: region || nearbyCards[0]?.state || null,
        country: country || nearbyCards[0]?.country || null,
        latitude: lat ?? null,
        longitude: lng ?? null,
      },
      sections: sliderSections.filter(Boolean),
    });
  } catch (err) {
    console.error("[getHomeRecommendations]", err);
    return res.status(500).json({ error: "Failed to load recommendations" });
  }
};

export const getPublicHome = async (req, res) => {
  try {
    const { id } = req.params;
    const homeInstance = await models.Home.findOne({
      where: { id, status: "PUBLISHED", is_visible: true },
      include: [
        { model: models.HomeAddress, as: "address" },
        { model: models.HomePricing, as: "pricing" },
        { model: models.HomePolicies, as: "policies" },
        { model: models.HomeSecurity, as: "security" },
        {
          model: models.HomeMedia,
          as: "media",
          separate: true,
          order: [
            ["is_cover", "DESC"],
            ["order", "ASC"],
            ["id", "ASC"],
          ],
        },
        {
          model: models.HomeAmenityLink,
          as: "amenities",
          include: [{ model: models.HomeAmenity, as: "amenity" }],
        },
        {
          model: models.HomeBedTypeLink,
          as: "bedTypes",
          include: [{ model: models.HomeBedType, as: "bedType" }],
        },
        {
          model: models.HomeTagLink,
          as: "tags",
          include: [{ model: models.HomeTag, as: "tag" }],
        },
        { model: models.HomeDiscountRule, as: "discounts" },
        {
          model: models.User,
          as: "host",
          attributes: ["id", "name", "email", "avatar_url", "role", "created_at"],
          include: [
            {
              model: models.HostProfile,
              as: "hostProfile",
              attributes: ["id", "metadata", "created_at"],
            },
          ],
        },
      ],
    });

    if (!homeInstance) {
      return res.status(404).json({ error: "Home not found" });
    }

    const home = homeInstance.toJSON();
    const [homeBadges, hostBadges] = await Promise.all([
      getHomeBadges(home),
      home.host ? getHostBadges(home.host) : [],
    ]);

    home.badges = {
      home: homeBadges,
      host: hostBadges,
    };
    if (home.pricing) {
      if (home.pricing.base_price != null) {
        home.pricing.base_price = Number(home.pricing.base_price) * 1.1;
      }
      if (home.pricing.weekend_price != null) {
        home.pricing.weekend_price = Number(home.pricing.weekend_price) * 1.1;
      }
    }
    home.bedTypes = await ensureDefaultBedTypes(home);

    return res.json(home);
  } catch (err) {
    console.error("[getPublicHome]", err);
    return res.status(500).json({ error: "Failed to fetch home" });
  }
};
export const createHomeDraft = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    if (!hostId) return res.status(401).json({ error: "Unauthorized" });

    let {
      propertyType = "HOUSE",
      spaceType = "ENTIRE_PLACE",
      listingType = "STANDARD",
      maxGuests = 1,
      bedrooms = 1,
      beds = 1,
      bathrooms = 1,
    } = req.body || {};

    if (!HOME_PROPERTY_TYPES.includes(propertyType)) propertyType = "HOUSE";
    if (!HOME_SPACE_TYPES.includes(spaceType)) spaceType = "ENTIRE_PLACE";
    if (!LISTING_TYPES.includes(listingType)) listingType = "STANDARD";

    const home = await models.Home.create({
      host_id: hostId,
      property_type: propertyType,
      space_type: spaceType,
      listing_type: listingType,
      max_guests: Number(maxGuests) || 1,
      bedrooms: Number(bedrooms) || 1,
      beds: Number(beds) || 1,
      bathrooms: Number(bathrooms) || 1,
      status: "DRAFT",
      draft_step: 1,
    });

    await models.HomePricing.create({
      home_id: home.id,
      currency: req.body?.currency || "USD",
      base_price: Number(req.body?.basePrice) || 0,
    });

    return res.status(201).json(home);
  } catch (err) {
    console.error("[createHomeDraft]", err);
    return res.status(500).json({ error: "Failed to create home draft" });
  }
};

export const updateHomeBasics = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { id } = req.params;
    const home = await models.Home.findOne({ where: { id, host_id: hostId } });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const updates = {};
    const allowed = {
      title: "title",
      description: "description",
      propertyType: "property_type",
      spaceType: "space_type",
      listingType: "listing_type",
      maxGuests: "max_guests",
      bedrooms: "bedrooms",
      beds: "beds",
      bathrooms: "bathrooms",
      allowSharedSpaces: "allow_shared_spaces",
      marketingTags: "marketing_tags",
    };

    for (const [key, column] of Object.entries(allowed)) {
      if (req.body[key] == null) continue;
      const value = req.body[key];
      if (column === "allow_shared_spaces") {
        updates[column] = asBool(value);
      } else if (column === "property_type") {
        const normalized = typeof value === "string" ? value.toUpperCase() : value;
        if (HOME_PROPERTY_TYPES.includes(normalized)) {
          updates[column] = normalized;
        }
      } else if (column === "space_type") {
        const normalized = typeof value === "string" ? value.toUpperCase() : value;
        if (HOME_SPACE_TYPES.includes(normalized)) {
          updates[column] = normalized;
        }
      } else if (column === "listing_type") {
        const normalized = typeof value === "string" ? value.toUpperCase() : value;
        if (LISTING_TYPES.includes(normalized)) {
          updates[column] = normalized;
        }
      } else if (["max_guests", "bedrooms", "beds"].includes(column)) {
        updates[column] = Number(value) || 0;
      } else if (column === "bathrooms") {
        updates[column] = Number(value) || 0;
      } else {
        updates[column] = value;
      }
    }

    if (Object.keys(updates).length) {
      await home.update(updates);
    }

    if (typeof req.body?.draftStep === "number") {
      await home.update({ draft_step: Math.max(home.draft_step, req.body.draftStep) });
    }

    return res.json(await home.reload());
  } catch (err) {
    console.error("[updateHomeBasics]", err);
    return res.status(500).json({ error: "Failed to update home" });
  }
};

export const upsertHomeAddress = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { id } = req.params;
    const home = await models.Home.findOne({ where: { id, host_id: hostId } });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const payload = {
      country: req.body?.country || null,
      state: req.body?.state || null,
      city: req.body?.city || null,
      zip_code: req.body?.zipCode || null,
      address_line1: req.body?.addressLine1 || null,
      address_line2: req.body?.addressLine2 || null,
      latitude: req.body?.latitude ?? null,
      longitude: req.body?.longitude ?? null,
      share_exact_location: asBool(req.body?.shareExactLocation, false),
      map_zoom: Number(req.body?.mapZoom) || 15,
    };

    const [address, created] = await models.HomeAddress.findOrCreate({
      where: { home_id: home.id },
      defaults: { ...payload, home_id: home.id },
    });

    if (!created) await address.update(payload);

    await home.update({ draft_step: Math.max(home.draft_step, Number(req.body?.draftStep || 5)) });

    return res.json(await address.reload());
  } catch (err) {
    console.error("[upsertHomeAddress]", err);
    return res.status(500).json({ error: "Failed to store address" });
  }
};

export const updateHomeAmenities = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { id } = req.params;
    const home = await models.Home.findOne({ where: { id, host_id: hostId } });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const rawPayload = req.body;
    const amenityIds = Array.isArray(rawPayload)
      ? rawPayload
      : Array.isArray(rawPayload?.amenityIds)
        ? rawPayload.amenityIds
        : Array.isArray(rawPayload?.amenities)
          ? rawPayload.amenities
          : [];
    const transaction = await models.Home.sequelize.transaction();
    try {
      await models.HomeAmenityLink.destroy({ where: { home_id: home.id }, transaction });
      if (amenityIds.length) {
        const rows = amenityIds.map((amenityId) => ({ home_id: home.id, amenity_id: amenityId }));
        await models.HomeAmenityLink.bulkCreate(rows, { transaction });
      }
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    await home.update({ draft_step: Math.max(home.draft_step, Number(req.body?.draftStep || 7)) });

    const amenities = await models.HomeAmenityLink.findAll({
      where: { home_id: home.id },
      include: [{ model: models.HomeAmenity, as: "amenity" }],
    });

    return res.json(amenities);
  } catch (err) {
    console.error("[updateHomeAmenities]", err);
    return res.status(500).json({ error: "Failed to update amenities" });
  }
};

export const updateHomeBedTypes = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { id } = req.params;
    const home = await models.Home.findOne({ where: { id, host_id: hostId } });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const rawPayload = req.body;
    const bedTypeItems = Array.isArray(rawPayload)
      ? rawPayload
      : Array.isArray(rawPayload?.bedTypes)
        ? rawPayload.bedTypes
        : [];

    const normalized = new Map();
    bedTypeItems.forEach((item) => {
      if (!item) return;
      const bedTypeId = Number(
        item?.bedTypeId ?? item?.bed_type_id ?? item?.id ?? item?.bedType?.id
      );
      if (!Number.isFinite(bedTypeId) || bedTypeId <= 0) return;
      const rawCount = Number(item?.count ?? item?.qty ?? item?.quantity ?? 1);
      if (!Number.isFinite(rawCount) || rawCount <= 0) return;
      const count = Math.min(Math.max(Math.floor(rawCount), 1), 50);
      const existing = normalized.get(bedTypeId) || 0;
      normalized.set(bedTypeId, existing + count);
    });

    const rows = Array.from(normalized.entries()).map(([bedTypeId, count]) => ({
      home_id: home.id,
      bed_type_id: bedTypeId,
      count,
    }));

    const transaction = await models.Home.sequelize.transaction();
    try {
      await models.HomeBedTypeLink.destroy({ where: { home_id: home.id }, transaction });
      if (rows.length) {
        await models.HomeBedTypeLink.bulkCreate(rows, { transaction });
      }
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    await home.update({ draft_step: Math.max(home.draft_step, Number(req.body?.draftStep || 8)) });

    const bedTypes = await models.HomeBedTypeLink.findAll({
      where: { home_id: home.id },
      include: [{ model: models.HomeBedType, as: "bedType" }],
    });

    const resolved = await ensureDefaultBedTypes({ ...home.toJSON(), bedTypes });
    return res.json(resolved);
  } catch (err) {
    console.error("[updateHomeBedTypes]", err);
    return res.status(500).json({ error: "Failed to update bed types" });
  }
};

export const updateHomePricing = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { id } = req.params;
    const home = await models.Home.findOne({
      where: { id, host_id: hostId },
      include: [
        { model: models.HomePricing, as: "pricing" },
        { model: models.HomeAddress, as: "address" },
      ],
    });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const payload = {
      currency: req.body?.currency || home.pricing?.currency || "USD",
      base_price: Number(req.body?.basePrice ?? home.pricing?.base_price ?? 0),
      weekend_price: req.body?.weekendPrice != null ? Number(req.body.weekendPrice) : home.pricing?.weekend_price,
      minimum_stay: req.body?.minimumStay != null ? Number(req.body.minimumStay) : home.pricing?.minimum_stay,
      maximum_stay: req.body?.maximumStay != null ? Number(req.body.maximumStay) : home.pricing?.maximum_stay,
      cleaning_fee: req.body?.cleaningFee != null ? Number(req.body.cleaningFee) : home.pricing?.cleaning_fee,
      extra_guest_fee: req.body?.extraGuestFee != null ? Number(req.body.extraGuestFee) : home.pricing?.extra_guest_fee,
      extra_guest_threshold: req.body?.extraGuestThreshold != null ? Number(req.body.extraGuestThreshold) : home.pricing?.extra_guest_threshold,
      tax_rate: req.body?.taxRate != null ? Number(req.body.taxRate) : home.pricing?.tax_rate,
      pricing_strategy: req.body?.pricingStrategy || home.pricing?.pricing_strategy || null,
    };

    if (payload.tax_rate == null) {
      const resolvedTaxRate = await resolveTaxRateFromLocation(
        home.address?.country,
        home.address?.state
      );
      if (resolvedTaxRate != null) payload.tax_rate = resolvedTaxRate;
    }

    if (home.pricing) {
      await home.pricing.update(payload);
    } else {
      await models.HomePricing.create({ ...payload, home_id: home.id });
    }

    await home.update({ draft_step: Math.max(home.draft_step, Number(req.body?.draftStep || 10)) });

    return res.json(await home.reload({ include: [{ model: models.HomePricing, as: "pricing" }] }));
  } catch (err) {
    console.error("[updateHomePricing]", err);
    return res.status(500).json({ error: "Failed to update pricing" });
  }
};

export const attachHomeMedia = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { id } = req.params;
    const home = req.home ?? (await models.Home.findOne({ where: { id, host_id: hostId } }));
    if (!home) return res.status(404).json({ error: "Home not found" });

    const mediaList = Array.isArray(req.body?.media) ? req.body.media : [];

    const transaction = await models.Home.sequelize.transaction();
    try {
      await models.HomeMedia.destroy({ where: { home_id: home.id }, transaction });
      if (mediaList.length) {
        const rows = mediaList.map((item, index) => ({
          home_id: home.id,
          type: item?.type === "VIDEO" ? "VIDEO" : "IMAGE",
          url: item?.url,
          order: item?.order ?? index,
          caption: item?.caption || null,
          is_cover: asBool(item?.isCover, index === 0),
          metadata: normalizeMediaMetadata(item?.metadata),
        })).filter((row) => row.url);
        if (rows.length) await models.HomeMedia.bulkCreate(rows, { transaction });
      }
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    await home.update({ draft_step: Math.max(home.draft_step, Number(req.body?.draftStep || 12)) });

    const media = await models.HomeMedia.findAll({ where: { home_id: home.id }, order: [["order", "ASC"]] });
    return res.json(media);
  } catch (err) {
    console.error("[attachHomeMedia]", err);
    return res.status(500).json({ error: "Failed to store media" });
  }
};

export const updateHomePolicies = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { id } = req.params;
    const home = await models.Home.findOne({
      where: { id, host_id: hostId },
      include: [{ model: models.HomePolicies, as: "policies" }],
    });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const payload = {
      checkin_from: req.body?.checkInFrom || null,
      checkin_to: req.body?.checkInTo || null,
      checkout_time: req.body?.checkOutTime || null,
      quiet_hours_start: req.body?.quietHoursStart || null,
      quiet_hours_end: req.body?.quietHoursEnd || null,
      cancellation_policy: req.body?.cancellationPolicy || req.body?.cancellation_policy || null,
      smoking_allowed: asBool(req.body?.smokingAllowed, false),
      pets_allowed: asBool(req.body?.petsAllowed, false),
      events_allowed: asBool(req.body?.eventsAllowed, false),
      additional_rules: req.body?.additionalRules || null,
      house_manual: req.body?.houseManual || null,
    };

    if (home.policies) {
      await home.policies.update(payload);
    } else {
      await models.HomePolicies.create({ ...payload, home_id: home.id });
    }

    await home.update({ draft_step: Math.max(home.draft_step, Number(req.body?.draftStep || 13)) });

    return res.json(await home.reload({ include: [{ model: models.HomePolicies, as: "policies" }] }));
  } catch (err) {
    console.error("[updateHomePolicies]", err);
    return res.status(500).json({ error: "Failed to update policies" });
  }
};

export const updateHomeSecurity = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { id } = req.params;
    const home = await models.Home.findOne({
      where: { id, host_id: hostId },
      include: [{ model: models.HomeSecurity, as: "security" }],
    });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const payload = {
      has_security_camera: asBool(req.body?.hasSecurityCamera, false),
      security_camera_details: req.body?.securityCameraDetails || null,
      has_monitoring_device: asBool(req.body?.hasMonitoringDevice, false),
      monitoring_details: req.body?.monitoringDetails || null,
      has_weapons: asBool(req.body?.hasWeapons, false),
      weapon_details: req.body?.weaponDetails || null,
      additional_disclosures: req.body?.additionalDisclosures || null,
    };

    if (home.security) {
      await home.security.update(payload);
    } else {
      await models.HomeSecurity.create({ ...payload, home_id: home.id });
    }

    await home.update({ draft_step: Math.max(home.draft_step, Number(req.body?.draftStep || 18)) });

    return res.json(await home.reload({ include: [{ model: models.HomeSecurity, as: "security" }] }));
  } catch (err) {
    console.error("[updateHomeSecurity]", err);
    return res.status(500).json({ error: "Failed to update security" });
  }
};

export const updateHomeDiscounts = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { id } = req.params;
    const home = await models.Home.findOne({ where: { id, host_id: hostId } });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const incoming = Array.isArray(req.body?.discounts) ? req.body.discounts : [];
    const rules = incoming
      .map((item) => {
        const ruleType = String(item?.ruleType || "").toUpperCase();
        const percentage = asNumber(item?.percentage);
        if (!HOME_DISCOUNT_RULE_TYPES.includes(ruleType) || percentage == null) return null;
        return {
          rule_type: ruleType,
          percentage,
          min_nights: asNumber(item?.minNights),
          max_nights: asNumber(item?.maxNights),
          lead_days: asNumber(item?.leadDays),
          active: item?.active !== false,
          metadata: item?.metadata ?? null,
        };
      })
      .filter(Boolean);

    const transaction = await models.Home.sequelize.transaction();
    try {
      await models.HomeDiscountRule.destroy({ where: { home_id: home.id }, transaction });
      if (rules.length) {
        const rows = rules.map((rule) => ({ ...rule, home_id: home.id }));
        await models.HomeDiscountRule.bulkCreate(rows, { transaction });
      }
      await transaction.commit();
    } catch (upsertErr) {
      await transaction.rollback();
      throw upsertErr;
    }

    await home.update({ draft_step: Math.max(home.draft_step, Number(req.body?.draftStep || 16)) });

    const discounts = await models.HomeDiscountRule.findAll({ where: { home_id: home.id } });
    return res.json(discounts);
  } catch (err) {
    console.error("[updateHomeDiscounts]", err);
    return res.status(500).json({ error: "Failed to update discounts" });
  }
};

export const getHomeCatalogs = async (_req, res) => {
  try {
    const amenities = await models.HomeAmenity.findAll({
      order: [
        ["group_key", "ASC"],
        ["label", "ASC"],
      ],
    });

    const tags = await models.HomeTag.findAll({
      order: [
        ["category", "ASC"],
        ["label", "ASC"],
      ],
    });

    const bedTypes = await models.HomeBedType.findAll({
      order: [
        ["sort_order", "ASC"],
        ["label", "ASC"],
      ],
    });

    const amenityGroups = [];
    const groupMap = new Map();
    for (const amenity of amenities) {
      const key = amenity.group_key || "general";
      if (!groupMap.has(key)) {
        const entry = { groupKey: key, amenities: [] };
        groupMap.set(key, entry);
        amenityGroups.push(entry);
      }
      groupMap.get(key).amenities.push({
        id: amenity.id,
        key: amenity.amenity_key,
        label: amenity.label,
        description: amenity.description,
        icon: resolveAmenityIcon(amenity),
      });
    }

    const marketingTags = tags.map((tag) => ({
      id: tag.id,
      key: tag.tag_key,
      label: tag.label,
      category: tag.category,
      description: tag.description,
    }));

    const bedTypeOptions = bedTypes.map((bedType) => ({
      id: bedType.id,
      key: bedType.bed_type_key,
      label: bedType.label,
      description: bedType.description,
      icon: bedType.icon,
    }));

    const discountTemplates = [
      {
        id: "NEW_LISTING_PROMO",
        ruleType: "EARLY_BIRD",
        label: "New listing promotion",
        percentage: 20,
        description: "Offer 20% off your first three reservations to build momentum.",
        metadata: { reservationLimit: 3 },
      },
      {
        id: "LAST_MINUTE",
        ruleType: "LAST_MINUTE",
        label: "Last-minute discount",
        percentage: 6,
        description: "Add a discount for stays booked 14 days or less before check-in.",
        metadata: { leadDays: 14 },
      },
      {
        id: "WEEKLY",
        ruleType: "LONG_STAY",
        label: "Weekly stay discount",
        percentage: 9,
        description: "Reward guests who stay 7 nights or longer with a reduced rate.",
        metadata: { minNights: 7 },
      },
    ];

    const safetyOptions = [
      {
        key: "hasSecurityCamera",
        label: "Outdoor security camera present",
        description: "Includes visible cameras aimed at common areas such as entrances or driveways.",
      },
      {
        key: "hasMonitoringDevice",
        label: "Decibel monitor present",
        description: "Detects excessive noise levels so you can keep things comfortable for neighbors.",
      },
      {
        key: "hasWeapons",
        label: "Weapons stored on the property",
        description: "You must explain the type of weapon and where it is stored safely.",
      },
    ];

    return res.json({
      propertyTypes: HOME_PROPERTY_TYPES,
      spaceTypes: HOME_SPACE_TYPES,
      amenityGroups,
      bedTypes: bedTypeOptions,
      marketingTags,
      discountTemplates,
      safetyOptions,
    });
  } catch (err) {
    console.error("[getHomeCatalogs]", err);
    return res.status(500).json({ error: "Failed to load catalogs" });
  }
};

export const publishHome = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { id } = req.params;
    const home = await models.Home.findOne({
      where: { id, host_id: hostId },
      include: [
        { model: models.HomeAddress, as: "address" },
        { model: models.HomePricing, as: "pricing" },
        { model: models.HomeMedia, as: "media" },
      ],
    });
    if (!home) return res.status(404).json({ error: "Home not found" });

    if (!home.title || !home.description) {
      return res.status(400).json({ error: "Title and description are required before publishing." });
    }
    if (!home.address || !home.address?.address_line1 || !home.address?.city || !home.address?.country) {
      return res.status(400).json({ error: "Complete the address details before publishing." });
    }
    if (!home.pricing || Number(home.pricing.base_price || 0) <= 0) {
      return res.status(400).json({ error: "Set a base price before publishing." });
    }
    if (!Array.isArray(home.media) || !home.media.length) {
      return res.status(400).json({ error: "Add at least one photo before publishing." });
    }

    await home.update({
      status: "PUBLISHED",
      is_visible: true,
      draft_step: Math.max(home.draft_step, 20),
    });

    return res.json({
      id: home.id,
      status: home.status,
      isVisible: home.is_visible,
    });
  } catch (err) {
    console.error("[publishHome]", err);
    return res.status(500).json({ error: "Failed to publish home" });
  }
};

export const respondUploadedMedia = (req, res) => {
  try {
    const uploaded = Array.isArray(req.uploadedImages) ? req.uploadedImages : [];
    console.log("[respondUploadedMedia] urls:", uploaded.map((item) => item.url));
    return res.json({ uploaded });
  } catch (err) {
    console.error("[respondUploadedMedia]", err);
    return res.status(500).json({ error: "Failed to process upload" });
  }
};

export const getHomeById = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { id } = req.params;
    const homeInstance = await models.Home.findOne({
      where: { id, host_id: hostId },
      include: [
        { model: models.HomeAddress, as: "address" },
        { model: models.HomePricing, as: "pricing" },
        { model: models.HomePolicies, as: "policies" },
        { model: models.HomeSecurity, as: "security" },
        { model: models.HomeMedia, as: "media" },
        { model: models.HomeAmenityLink, as: "amenities", include: [{ model: models.HomeAmenity, as: "amenity" }] },
        { model: models.HomeBedTypeLink, as: "bedTypes", include: [{ model: models.HomeBedType, as: "bedType" }] },
        { model: models.HomeTagLink, as: "tags", include: [{ model: models.HomeTag, as: "tag" }] },
        { model: models.HomeDiscountRule, as: "discounts" },
        {
          model: models.User,
          as: "host",
          attributes: ["id", "name", "email", "avatar_url", "role", "created_at"],
          include: [
            {
              model: models.HostProfile,
              as: "hostProfile",
              attributes: ["id", "metadata", "created_at"],
            },
          ],
        },
      ],
    });
    if (!homeInstance) return res.status(404).json({ error: "Home not found" });
    const home = homeInstance.toJSON();
    const [homeBadges, hostBadges] = await Promise.all([
      getHomeBadges(home),
      home.host ? getHostBadges(home.host) : [],
    ]);
    home.badges = {
      home: homeBadges,
      host: hostBadges,
    };
    home.bedTypes = await ensureDefaultBedTypes(home);
    return res.json(home);
  } catch (err) {
    console.error("[getHomeById]", err);
    return res.status(500).json({ error: "Failed to fetch home" });
  }
};

export const getPublicHomeAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const homeId = Number(id);
    if (!homeId) return res.status(400).json({ error: "Invalid home ID" });

    const { startDate, endDate } = clampDateRange({
      start: req.query?.start,
      end: req.query?.end,
    });

    const home = await models.Home.findOne({
      where: { id: homeId, status: "PUBLISHED", is_visible: true },
      attributes: ["id"],
    });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const [calendarEntries, stays] = await Promise.all([
      models.HomeCalendar.findAll({
        where: {
          home_id: homeId,
          date: { [Op.between]: [formatDate(startDate), formatDate(endDate)] },
          status: { [Op.ne]: "AVAILABLE" },
        },
      }),
      models.Stay.findAll({
        where: {
          inventory_type: "HOME",
          status: { [Op.in]: ["PENDING", "CONFIRMED"] },
          check_in: { [Op.lt]: formatDate(new Date(endDate.getTime() + 86400000)) },
          check_out: { [Op.gt]: formatDate(startDate) },
        },
        include: [
          {
            model: models.StayHome,
            as: "homeStay",
            required: true,
            where: { home_id: homeId },
          },
        ],
      }),
    ]);

    const unavailable = new Set();
    for (const entry of calendarEntries) {
      if (entry?.date) unavailable.add(entry.date);
    }
    for (const stay of stays) {
      const checkIn = parseDateOnly(stay.check_in);
      const checkOut = parseDateOnly(stay.check_out);
      if (!checkIn || !checkOut) continue;
      const loopEnd = new Date(checkOut.getTime());
      loopEnd.setUTCDate(loopEnd.getUTCDate() - 1);
      for (const day of iterateDates(checkIn, loopEnd)) {
        if (day < startDate || day > endDate) continue;
        const iso = formatDate(day);
        if (iso) unavailable.add(iso);
      }
    }

    const days = iterateDates(startDate, endDate).map((date) => {
      const iso = formatDate(date);
      return {
        date: iso,
        status: unavailable.has(iso) ? "UNAVAILABLE" : "AVAILABLE",
      };
    });

    return res.json({
      range: {
        start: formatDate(startDate),
        end: formatDate(endDate),
      },
      unavailable: Array.from(unavailable).sort(),
      days,
    });
  } catch (err) {
    console.error("getPublicHomeAvailability error:", err);
    return res.status(500).json({ error: "Unable to load availability" });
  }
};

export const listHostHomes = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    if (!hostId) return res.status(401).json({ error: "Unauthorized" });

    const homes = await models.Home.findAll({
      where: { host_id: hostId },
      order: [["updated_at", "DESC"]],
      include: [{ model: models.HomeAddress, as: "address" }, { model: models.HomePricing, as: "pricing" }],
    });

    return res.json(homes);
  } catch (err) {
    console.error("[listHostHomes]", err);
    return res.status(500).json({ error: "Failed to list homes" });
  }
};




const formatDate = (date) => {
  if (!(date instanceof Date)) {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const parseDateOnly = (value) => {
  if (!value) return null;
  const parts = String(value).split('-').map(Number);
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
};

const clampDateRange = ({ start, end, fallbackDays = 180 }) => {
  const now = new Date();
  const startDate = parseDateOnly(start) || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fallbackEnd = new Date(startDate.getTime());
  fallbackEnd.setUTCDate(fallbackEnd.getUTCDate() + fallbackDays);
  const endDate = parseDateOnly(end) || fallbackEnd;
  if (endDate <= startDate) {
    endDate.setUTCDate(startDate.getUTCDate() + Math.max(1, fallbackDays));
  }
  const maxEnd = new Date(startDate.getTime());
  maxEnd.setUTCDate(maxEnd.getUTCDate() + 370);
  if (endDate > maxEnd) return { startDate, endDate: maxEnd };
  return { startDate, endDate };
};

const iterateDates = (start, end) => {
  const dates = [];
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    dates.push(new Date(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const isWeekend = (date) => {
  const day = date.getUTCDay();
  return day === 5 || day === 6;
};

const buildCalendarDay = ({ date, basePrice, weekendPrice, defaultCurrency, entry, reservation }) => {
  const dateStr = formatDate(date);
  const priceOverride = entry?.price_override != null ? Number(entry.price_override) : null;
  const weekendCandidate = weekendPrice != null ? Number(weekendPrice) : null;
  let price = basePrice != null ? Number(basePrice) : null;
  if (isWeekend(date) && weekendCandidate != null) {
    price = weekendCandidate;
  }
  if (priceOverride != null && !Number.isNaN(priceOverride)) {
    price = priceOverride;
  }

  let status = 'AVAILABLE';
  if (reservation) {
    status = 'RESERVED';
  } else if (entry?.status) {
    status = entry.status;
  }

  return {
    date: dateStr,
    status,
    price: price != null ? Number(price) : null,
    basePrice: basePrice != null ? Number(basePrice) : null,
    weekendPrice: weekendCandidate,
    priceOverride: priceOverride != null ? Number(priceOverride) : null,
    currency: entry?.currency || defaultCurrency || 'USD',
    note: entry?.note || null,
    reservation,
  };
};

export const getHostCalendarDetail = async (req, res) => {
  const hostId = Number(getUserId(req.user));
  if (!hostId) return res.status(400).json({ error: 'Invalid host ID' });

  const homeId = Number(req.params?.homeId);
  if (!homeId) return res.status(400).json({ error: 'Invalid listing' });

  const now = new Date();
  const monthParam = Number(req.query?.month);
  const yearParam = Number(req.query?.year);
  const targetYear = Number.isFinite(yearParam) ? yearParam : now.getUTCFullYear();
  const targetMonth = Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : now.getUTCMonth() + 1;

  const startDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
  const endDate = new Date(Date.UTC(targetYear, targetMonth, 0));
  const afterEndDate = new Date(Date.UTC(targetYear, targetMonth, 1));

  try {
    const home = await models.Home.findOne({
      where: { id: homeId, host_id: hostId },
      include: [
        { model: models.HomeAddress, as: 'address' },
        { model: models.HomePricing, as: 'pricing' },
        {
          model: models.HomeMedia,
          as: 'media',
          attributes: ['id', 'url', 'is_cover', 'order'],
          separate: true,
          limit: 6,
          order: [
            ['is_cover', 'DESC'],
            ['order', 'ASC'],
            ['id', 'ASC'],
          ],
        },
      ],
    });

    if (!home) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const calendarEntries = await models.HomeCalendar.findAll({
      where: {
        home_id: homeId,
        date: {
          [Op.between]: [formatDate(startDate), formatDate(endDate)],
        },
      },
    });

    const stays = await models.Stay.findAll({
      where: {
        inventory_type: 'HOME',
        status: { [Op.in]: ['PENDING', 'CONFIRMED'] },
        check_in: { [Op.lt]: formatDate(afterEndDate) },
        check_out: { [Op.gt]: formatDate(startDate) },
      },
      include: [
        {
          model: models.StayHome,
          as: 'homeStay',
          required: true,
          where: { home_id: homeId },
        },
        {
          model: models.User,
          attributes: ['id', 'name', 'avatar_url'],
        },
      ],
    });

    const basePrice = home.pricing?.base_price != null ? Number(home.pricing.base_price) : null;
    const weekendPrice = home.pricing?.weekend_price != null ? Number(home.pricing.weekend_price) : null;
    const currency = home.pricing?.currency || null;

    const entryMap = new Map(calendarEntries.map((entry) => [entry.date, entry]));

    const reservationMap = new Map();
    const reservations = [];

    for (const stay of stays) {
      const checkIn = parseDateOnly(stay.check_in);
      const checkOut = parseDateOnly(stay.check_out);
      if (!checkIn || !checkOut) continue;

      const guestName =
        stay.guest_name ||
        stay.User?.name ||
        stay.User?.email ||
        stay.User?.username ||
        'Guest';

      const reservation = {
        id: stay.id,
        guestName,
        guestAvatar: stay.User?.avatar_url || null,
        guestInitials: guestName
          ? guestName
            .split(' ')
            .filter(Boolean)
            .map((part) => part[0]?.toUpperCase())
            .join('')
            .slice(0, 2)
          : 'G',
        checkIn: stay.check_in,
        checkOut: stay.check_out,
        nights: stay.nights ?? Math.max(1, Math.round((parseDateOnly(stay.check_out) - parseDateOnly(stay.check_in)) / 86400000)),
        status: stay.status,
      };
      reservations.push(reservation);

      const loopStart = checkIn > startDate ? checkIn : new Date(startDate.getTime());
      const checkoutDate = parseDateOnly(stay.check_out);
      if (!checkoutDate) continue;
      const loopEnd = new Date(checkoutDate.getTime());
      loopEnd.setUTCDate(loopEnd.getUTCDate() - 1);
      const cappedEnd = loopEnd < endDate ? loopEnd : new Date(endDate.getTime());

      for (const day of iterateDates(loopStart, cappedEnd)) {
        const key = formatDate(day);
        reservationMap.set(key, {
          ...reservation,
          isCheckIn: key === stay.check_in,
          isCheckOut: key === formatDate(loopEnd),
        });
      }
    }

    const days = iterateDates(startDate, endDate).map((day) =>
      buildCalendarDay({
        date: day,
        basePrice,
        weekendPrice,
        defaultCurrency: currency,
        entry: entryMap.get(formatDate(day)) || null,
        reservation: reservationMap.get(formatDate(day)) || null,
      })
    );

    return res.json({
      home: {
        id: home.id,
        title: home.title,
        status: home.status,
        city: home.address?.city || null,
        country: home.address?.country || null,
        coverImage: getCoverImage(home),
        currency: currency || 'USD',
        basePrice,
        weekendPrice,
      },
      month: {
        year: targetYear,
        month: targetMonth,
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
      },
      days,
      reservations,
    });
  } catch (error) {
    console.error('getHostCalendarDetail error:', error);
    return res.status(500).json({ error: 'Unable to load calendar detail' });
  }
};

export const getArrivalGuide = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { homeId } = req.params;
    const home = await models.Home.findOne({
      where: { id: homeId, host_id: hostId },
      include: [{ model: models.HomePolicies, as: "policies" }],
    });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const guide = parseArrivalGuide(home.policies?.house_manual);
    return res.json({ guide });
  } catch (err) {
    console.error("getArrivalGuide error:", err);
    return res.status(500).json({ error: "Unable to load arrival guide" });
  }
};

export const updateArrivalGuide = async (req, res) => {
  try {
    const hostId = getUserId(req.user);
    const { homeId } = req.params;
    const home = await models.Home.findOne({
      where: { id: homeId, host_id: hostId },
      include: [{ model: models.HomePolicies, as: "policies" }],
    });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const payload = {
      checkInInstructions: req.body?.checkInInstructions || "",
      accessCode: req.body?.accessCode || "",
      wifi: req.body?.wifi || "",
      parking: req.body?.parking || "",
      addressNotes: req.body?.addressNotes || "",
      contactPhone: req.body?.contactPhone || "",
      contactEmail: req.body?.contactEmail || "",
      notes: req.body?.notes || "",
    };

    if (home.policies) {
      await home.policies.update({ house_manual: JSON.stringify(payload) });
    } else {
      await models.HomePolicies.create({ home_id: home.id, house_manual: JSON.stringify(payload) });
    }
    await home.update({ draft_step: Math.max(home.draft_step, 13) });

    return res.json({ guide: payload });
  } catch (err) {
    console.error("updateArrivalGuide error:", err);
    return res.status(500).json({ error: "Unable to save arrival guide" });
  }
};

export const upsertHostCalendarDay = async (req, res) => {
  const hostId = Number(getUserId(req.user));
  if (!hostId) return res.status(400).json({ error: 'Invalid host ID' });

  const homeId = Number(req.params?.homeId);
  if (!homeId) return res.status(400).json({ error: 'Invalid listing' });

  const { date, status = 'AVAILABLE', priceOverride = null, note = null } = req.body || {};
  const parsedDate = parseDateOnly(date);
  if (!parsedDate) {
    return res.status(400).json({ error: 'Invalid date' });
  }
  const dateString = formatDate(parsedDate);

  try {
    const home = await models.Home.findOne({
      where: { id: homeId, host_id: hostId },
      include: [{ model: models.HomePricing, as: 'pricing' }],
    });

    if (!home) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const conflictingStay = await models.Stay.findOne({
      where: {
        inventory_type: 'HOME',
        status: { [Op.in]: ['PENDING', 'CONFIRMED'] },
        check_in: { [Op.lte]: dateString },
        check_out: { [Op.gt]: dateString },
      },
      include: [
        {
          model: models.StayHome,
          as: 'homeStay',
          required: true,
          where: { home_id: homeId },
        },
      ],
    });

    if (conflictingStay && status !== 'RESERVED') {
      return res.status(409).json({ error: 'Date is already reserved' });
    }

    const overrideValue = priceOverride === '' ? null : priceOverride;
    const overrideNumber = overrideValue != null ? Number(overrideValue) : null;
    if (overrideNumber != null && !Number.isFinite(overrideNumber)) {
      return res.status(400).json({ error: 'Invalid price override' });
    }

    const existing = await models.HomeCalendar.findOne({
      where: { home_id: homeId, date: dateString },
    });

    const normalizedStatus = status === 'BLOCKED' ? 'BLOCKED' : 'AVAILABLE';

    if (normalizedStatus === 'AVAILABLE' && overrideNumber == null && !note) {
      if (existing) {
        await existing.destroy();
      }
    } else {
      const payload = {
        home_id: homeId,
        date: dateString,
        status: normalizedStatus,
        price_override: overrideNumber,
        currency: home.pricing?.currency || existing?.currency || 'USD',
        note: note || null,
      };
      if (existing) {
        await existing.update(payload);
      } else {
        await models.HomeCalendar.create(payload);
      }
    }

    const entry = await models.HomeCalendar.findOne({
      where: { home_id: homeId, date: dateString },
    });

    let reservation = null;
    if (!entry || entry.status !== 'AVAILABLE') {
      const stay = await models.Stay.findOne({
        where: {
          inventory_type: 'HOME',
          status: { [Op.in]: ['PENDING', 'CONFIRMED'] },
          check_in: { [Op.lte]: dateString },
          check_out: { [Op.gt]: dateString },
        },
        include: [
          {
            model: models.StayHome,
            as: 'homeStay',
            required: true,
            where: { home_id: homeId },
          },
          {
            model: models.User,
            attributes: ['id', 'name', 'avatar_url'],
          },
        ],
      });
      if (stay) {
        const guestName =
          stay.guest_name ||
          stay.User?.name ||
          stay.User?.email ||
          stay.User?.username ||
          'Guest';

        reservation = {
          id: stay.id,
          guestName,
          guestAvatar: stay.User?.avatar_url || null,
          guestInitials: guestName
            ? guestName
              .split(' ')
              .filter(Boolean)
              .map((part) => part[0]?.toUpperCase())
              .join('')
              .slice(0, 2)
            : 'G',
          checkIn: stay.check_in,
          checkOut: stay.check_out,
          status: stay.status,
        };
      }
    }

    const updatedDay = buildCalendarDay({
      date: parsedDate,
      basePrice: home.pricing?.base_price != null ? Number(home.pricing.base_price) : null,
      weekendPrice: home.pricing?.weekend_price != null ? Number(home.pricing.weekend_price) : null,
      defaultCurrency: home.pricing?.currency || null,
      entry,
      reservation,
    });

    return res.json({ day: updatedDay });
  } catch (error) {
    console.error('upsertHostCalendarDay error:', error);
    return res.status(500).json({ error: 'Unable to update calendar' });
  }
};



