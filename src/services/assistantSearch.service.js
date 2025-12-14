import dayjs from "dayjs";
import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
import { WebbedsProvider } from "../providers/webbeds/provider.js";
import { buildSearchHotelsPayload } from "../providers/webbeds/searchHotels.js";
import { mapHomeToCard } from "../utils/homeMapper.js";
import { formatStaticHotel } from "../utils/webbedsMapper.js";

const clampLimit = (value, fallback = 6) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(20, Math.max(1, Math.floor(numeric)));
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const DEFAULT_COORDINATE_RADIUS_KM = 25;
const BLOCKED_CALENDAR_STATUSES = new Set(["RESERVED", "BLOCKED"]);

const normalizeKeyList = (value) => {
  if (!Array.isArray(value) || !value.length) return [];
  const normalized = value
    .map((item) => {
      if (typeof item === "number") return String(item);
      if (typeof item !== "string") return null;
      const trimmed = item.trim();
      return trimmed ? trimmed.toUpperCase() : null;
    })
    .filter(Boolean);
  return Array.from(new Set(normalized));
};

const normalizeBooleanFlag = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "si", "sí"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeIdList = (value) => {
  if (!Array.isArray(value) || !value.length) return [];
  const normalized = value
    .map((item) => {
      if (typeof item === "number") return String(item);
      if (typeof item !== "string") return null;
      const trimmed = item.trim();
      return trimmed || null;
    })
    .filter(Boolean);
  return Array.from(new Set(normalized));
};

const combineCapacities = (...values) => {
  const numeric = values
    .map((value) => toNumberOrNull(value))
    .filter((value) => value != null);
  if (!numeric.length) return null;
  return Math.max(...numeric);
};

const buildCalendarRange = (plan = {}) => {
  const checkInRaw = plan?.dates?.checkIn;
  const checkOutRaw = plan?.dates?.checkOut;
  if (!checkInRaw || !checkOutRaw) return null;
  const checkIn = dayjs(checkInRaw);
  const checkOut = dayjs(checkOutRaw);
  if (!checkIn.isValid() || !checkOut.isValid() || !checkOut.isAfter(checkIn)) return null;
  return {
    startDate: checkIn.format("YYYY-MM-DD"),
    endDate: checkOut.subtract(1, "day").format("YYYY-MM-DD"),
  };
};

const hasCalendarConflicts = (home) => {
  if (!home || !Array.isArray(home.calendar) || !home.calendar.length) return false;
  return home.calendar.some((entry) => entry && BLOCKED_CALENDAR_STATUSES.has(entry.status));
};

const hasRequiredTagKeys = (home, requiredKeys = []) => {
  if (!requiredKeys.length) return true;
  if (!home?.tags) return false;
  const available = new Set(
    home.tags
      .map((link) => link?.tag?.tag_key)
      .filter(Boolean)
      .map((tag) => tag.trim().toUpperCase())
  );
  return requiredKeys.every((key) => available.has(key));
};

const hasRequiredAmenityKeys = (home, requiredKeys = []) => {
  if (!requiredKeys.length) return true;
  if (!home?.amenities) return false;
  const available = new Set(
    home.amenities
      .map((link) => link?.amenity?.amenity_key)
      .filter(Boolean)
      .map((key) => key.trim().toUpperCase())
  );
  return requiredKeys.every((key) => available.has(key));
};

const buildCoordinateFilterUsingRadius = (location = {}) => {
  const lat = toNumberOrNull(location.lat);
  const lng = toNumberOrNull(location.lng);
  if (lat == null || lng == null) return null;
  const radiusKm = location.radiusKm != null ? Math.max(0.5, Number(location.radiusKm)) : DEFAULT_COORDINATE_RADIUS_KM;
  const latDelta = radiusKm / 111;
  const lonScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.01) * 111;
  const lngDelta = radiusKm / lonScale;
  return {
    latitude: { [Op.between]: [lat - latDelta, lat + latDelta] },
    longitude: { [Op.between]: [lng - lngDelta, lng + lngDelta] },
  };
};

const matchesCoordinateFilter = (geoPoint, filter) => {
  if (!filter || !geoPoint) return true;
  const latBounds = filter.latitude?.[Op.between];
  const lngBounds = filter.longitude?.[Op.between];
  const lat = toNumberOrNull(geoPoint.lat ?? geoPoint.latitude);
  const lng = toNumberOrNull(geoPoint.lng ?? geoPoint.longitude);
  if (latBounds && (lat == null || lat < latBounds[0] || lat > latBounds[1])) {
    return false;
  }
  if (lngBounds && (lng == null || lng < lngBounds[0] || lng > lngBounds[1])) {
    return false;
  }
  return true;
};

let liveHotelProvider = null;
let liveHotelProviderFailed = false;

const getLiveHotelProvider = () => {
  if (liveHotelProviderFailed) return null;
  if (liveHotelProvider) return liveHotelProvider;
  try {
    liveHotelProvider = new WebbedsProvider();
    return liveHotelProvider;
  } catch (error) {
    liveHotelProviderFailed = true;
    console.warn("[assistant] live hotel provider unavailable:", error?.message || error);
    return null;
  }
};

const resolveDialect = () =>
  typeof sequelize.getDialect === "function" ? sequelize.getDialect() : "mysql";

const buildStringFilter = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  const dialect = resolveDialect();
  const operator = dialect === "mysql" ? Op.like : Op.iLike;
  return { [operator]: `%${trimmed}%` };
};

const resolveGuestTotal = (plan) => {
  const adults = Number(plan?.guests?.adults);
  const children = Number(plan?.guests?.children);
  const other = Number(plan?.guests?.others);
  const fallback = Number(plan?.guests?.total);
  const sum = [adults, children, other].reduce(
    (acc, value) => (Number.isFinite(value) && value > 0 ? acc + value : acc),
    0
  );
  if (sum > 0) return sum;
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return null;
};

const resolveBudgetMax = (plan) => toNumberOrNull(plan?.budget?.max);

const hasAmenityMatch = (home, matcher) => {
  if (!home?.amenities) return false;
  return home.amenities.some((link) => {
    const label = String(link?.amenity?.label || "").toLowerCase();
    const key = String(link?.amenity?.amenity_key || "").toUpperCase();
    return matcher({ label, key });
  });
};

const matchParking = (home) =>
  hasAmenityMatch(home, ({ label, key }) => {
    if (!label && !key) return false;
    if (key.includes("PARK") || key.includes("GARAGE")) return true;
    return label.includes("parking") || label.includes("cochera");
  });

const collectAmenityKeywords = (plan = {}) => {
  const keywords = new Set();
  const noteText = Array.isArray(plan.notes) ? plan.notes.join(" ").toLowerCase() : "";

  const pushAll = (arr) => arr.forEach((k) => keywords.add(k.toLowerCase()));

  if (plan?.amenities?.workspace) pushAll(["workspace", "desk", "escritorio"]);
  if (plan?.amenities?.pool) pushAll(["pool", "piscina", "pileta"]);
  if (plan?.amenities?.petFriendly) pushAll(["pet", "mascota", "pet friendly"]);
  if (plan?.amenities?.parking) pushAll(["parking", "garage", "cochera", "estacionamiento"]);

  // free-form detection from notes (common synonyms)
  const keywordMap = [
    { cues: ["washer", "laundry", "washing machine", "lavadora", "lavarropas"], add: ["washer", "laundry"] },
    { cues: ["dryer", "secadora"], add: ["dryer"] },
    { cues: ["parking", "cochera", "garage", "estacionamiento"], add: ["parking", "cochera"] },
    { cues: ["workspace", "desk", "escritorio"], add: ["workspace", "desk"] },
    { cues: ["pool", "piscina", "pileta"], add: ["pool", "piscina"] },
    { cues: ["pet", "mascota"], add: ["pet friendly"] },
  ];
  keywordMap.forEach(({ cues, add }) => {
    if (cues.some((cue) => noteText.includes(cue.toLowerCase()))) {
      pushAll(add);
    }
  });

  return Array.from(keywords).filter(Boolean);
};

const hasAmenityKeywords = (home, keywords = []) => {
  if (!keywords.length) return true;
  return keywords.some((kw) =>
    hasAmenityMatch(home, ({ label, key }) => {
      const lowerKey = key.toLowerCase();
      return label.includes(kw) || lowerKey.includes(kw);
    })
  );
};

const buildHomeMatchReasons = ({ plan, home, card }) => {
  const reasons = [];
  if (plan?.location?.city && card?.city) {
    if (card.city.toLowerCase() === plan.location.city.toLowerCase()) {
      reasons.push(`En ${card.city}`);
    }
  }
  const guests = resolveGuestTotal(plan);
  if (guests && Number(card?.maxGuests) >= guests) {
    reasons.push(`Apto para ${card.maxGuests} huéspedes`);
  }
  if (plan?.amenities?.parking && matchParking(home)) {
    reasons.push("Incluye cochera/estacionamiento");
  }
  const budgetMax = resolveBudgetMax(plan);
  if (budgetMax != null && card?.pricePerNight != null) {
    if (Number(card.pricePerNight) <= budgetMax) {
      reasons.push(`Desde ${card.pricePerNight} ${card.currency || "USD"} por noche`);
    }
  }
  return reasons;
};

const buildPricingOrderLiteral = () => {
  const alias = resolveDialect() === "postgres" ? '"Home"' : "Home";
  return sequelize.literal(
    `(SELECT hp.base_price FROM home_pricing AS hp WHERE hp.home_id = ${alias}.id AND hp.deleted_at IS NULL LIMIT 1)`
  );
};

const runHomeQuery = async ({
  plan,
  limit,
  guests,
  coordinateFilter,
  addressWhere,
  budgetMax,
  respectGuest,
  respectBudget,
  amenityKeywords,
  homeFilters = {},
  combinedGuestCapacity = null,
  explicitGuestCapacity = null,
  calendarRange = null,
}) => {
  const where = {
    status: "PUBLISHED",
    is_visible: true,
  };
  const propertyTypes = Array.isArray(homeFilters.propertyTypes) ? homeFilters.propertyTypes : [];
  if (propertyTypes.length) {
    where.property_type = { [Op.in]: propertyTypes };
  }
  const spaceTypes = Array.isArray(homeFilters.spaceTypes) ? homeFilters.spaceTypes : [];
  if (spaceTypes.length) {
    where.space_type = { [Op.in]: spaceTypes };
  }
  const dynamicCapacity = respectGuest ? (combinedGuestCapacity ?? guests) : explicitGuestCapacity;
  if (dynamicCapacity) {
    where.max_guests = { [Op.gte]: dynamicCapacity };
  } else if (respectGuest && guests) {
    where.max_guests = { [Op.gte]: guests };
  }
  const minBedrooms = toNumberOrNull(homeFilters.minBedrooms);
  if (minBedrooms != null) {
    where.bedrooms = { ...(where.bedrooms || {}), [Op.gte]: minBedrooms };
  }
  const minBeds = toNumberOrNull(homeFilters.minBeds);
  if (minBeds != null) {
    where.beds = { ...(where.beds || {}), [Op.gte]: minBeds };
  }
  const minBathrooms = toNumberOrNull(homeFilters.minBathrooms);
  if (minBathrooms != null) {
    where.bathrooms = { ...(where.bathrooms || {}), [Op.gte]: minBathrooms };
  }

  const include = [
    {
      model: models.HomeAddress,
      as: "address",
      attributes: ["address_line1", "city", "state", "country", "latitude", "longitude"],
      required: Boolean(Object.keys(addressWhere).length || coordinateFilter),
      where:
        Object.keys({
          ...(Object.keys(addressWhere).length ? addressWhere : {}),
          ...(coordinateFilter || {}),
        }).length > 0
          ? {
            ...(Object.keys(addressWhere).length ? addressWhere : {}),
            ...(coordinateFilter || {}),
          }
          : undefined,
    },
    // LOGGING: Check the address where clause
    // console.log("[assistant] runHomeQuery address where:", JSON.stringify(addressWhere));
    // console.log("[assistant] runHomeQuery coordinate filter:", JSON.stringify(coordinateFilter));
    {
      model: models.HomePricing,
      as: "pricing",
      attributes: ["currency", "base_price", "weekend_price"],
      ...(respectBudget && budgetMax != null
        ? { where: { base_price: { [Op.lte]: budgetMax } } }
        : {}),
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

  const order = [];
  const homeAlias = resolveDialect() === "postgres" ? '"Home"' : "Home";

  if (plan?.sortBy === "POPULARITY") {
    order.push([
      sequelize.literal(
        `(SELECT COUNT(*) FROM home_recent_view WHERE home_recent_view.home_id = ${homeAlias}.id)`
      ),
      "DESC",
    ]);
  } else if (plan?.sortBy === "PRICE_ASC") {
    order.push([buildPricingOrderLiteral(), "ASC"]);
  } else if (plan?.sortBy === "PRICE_DESC") {
    order.push([buildPricingOrderLiteral(), "DESC"]);
  } else {
    order.push(["updated_at", "DESC"]);
    order.push(["id", "DESC"]);
  }

  const amenityFilterKeys = Array.isArray(homeFilters.amenityKeys) ? homeFilters.amenityKeys : [];
  const needsAmenityJoin = Boolean(plan?.amenities?.parking || (amenityKeywords && amenityKeywords.length) || amenityFilterKeys.length);

  console.log("[assistant] runHomeQuery executing with where:", JSON.stringify(where));
  console.log("[assistant] runHomeQuery address include where:", JSON.stringify(include[0].where));

  const homes = await models.Home.findAll({
    where,
    include: [
      ...include,
      {
        model: models.HomeAmenityLink,
        as: "amenities",
        required: needsAmenityJoin,
        include: [
          {
            model: models.HomeAmenity,
            as: "amenity",
            attributes: ["id", "amenity_key", "label"],
          },
        ],
      },
      ...(Array.isArray(homeFilters.tagKeys) && homeFilters.tagKeys.length
        ? [
            {
              model: models.HomeTagLink,
              as: "tags",
              required: false,
              include: [
                {
                  model: models.HomeTag,
                  as: "tag",
                  attributes: ["id", "tag_key", "label"],
                },
              ],
            },
          ]
        : []),
      ...(calendarRange
        ? [
            {
              model: models.HomeCalendar,
              as: "calendar",
              attributes: ["date", "status"],
              required: false,
              where: {
                status: { [Op.in]: Array.from(BLOCKED_CALENDAR_STATUSES) },
                date: {
                  [Op.between]: [calendarRange.startDate, calendarRange.endDate],
                },
              },
            },
          ]
        : []),
    ],
    order,
    limit,
    distinct: true,
  });

  console.log(`[assistant] runHomeQuery found ${homes.length} raw homes`);
  return homes;
};

export const searchHomesForPlan = async (plan = {}, options = {}) => {
  console.log("[assistant] plan", JSON.stringify(plan));
  // If the plan has a specific limit, use it, otherwise use the default or requested limit
  const planLimit = typeof plan.limit === "number" && plan.limit > 0 ? plan.limit : null;
  const limit = clampLimit(planLimit || options.limit);
  const guests = resolveGuestTotal(plan);
  const homeFiltersRaw = plan?.homeFilters || {};
  const normalizedHomeFilters = {
    ...homeFiltersRaw,
    propertyTypes: normalizeKeyList(homeFiltersRaw.propertyTypes),
    spaceTypes: normalizeKeyList(homeFiltersRaw.spaceTypes),
    amenityKeys: normalizeKeyList(homeFiltersRaw.amenityKeys),
    tagKeys: normalizeKeyList(homeFiltersRaw.tagKeys),
  };
  const addressWhere = {};
  if (plan?.location?.city) {
    const filter = buildStringFilter(plan.location.city);
    if (filter) addressWhere.city = filter;
  }
  if (plan?.location?.country) {
    const filter = buildStringFilter(plan.location.country);
    if (filter) addressWhere.country = filter;
  }
  if (plan?.location?.state && !plan?.location?.city) {
    const filter = buildStringFilter(plan.location.state);
    if (filter) addressWhere.state = filter;
  }

  const coordinateFilter = buildCoordinateFilterUsingRadius(plan?.location || {});
  const budgetMax = resolveBudgetMax(plan);
  const amenityKeywords = collectAmenityKeywords(plan);
  const calendarRange = buildCalendarRange(plan);
  const explicitGuestCapacity = toNumberOrNull(normalizedHomeFilters.maxGuests);
  const combinedGuestCapacity = combineCapacities(guests, explicitGuestCapacity);
  const requiredAmenityKeys = normalizedHomeFilters.amenityKeys || [];
  const requiredTagKeys = normalizedHomeFilters.tagKeys || [];

  const attempts = [
    { respectGuest: true, respectBudget: true },
    { respectGuest: false, respectBudget: true },
    { respectGuest: false, respectBudget: false },
  ];

  for (const attempt of attempts) {
    console.log("[assistant] attempt", attempt);
    const homes = await runHomeQuery({
      plan,
      limit,
      guests,
      coordinateFilter,
      addressWhere,
      budgetMax,
      respectGuest: attempt.respectGuest,
      respectBudget: attempt.respectBudget,
      amenityKeywords,
      homeFilters: normalizedHomeFilters,
      combinedGuestCapacity,
      explicitGuestCapacity,
      calendarRange,
    });

    console.log(`[assistant] attempt ${JSON.stringify(attempt)} returned ${homes.length} homes`);

    const enriched = homes
      .map((home) => {
        if (calendarRange && hasCalendarConflicts(home)) {
          return null;
        }
        if (requiredTagKeys.length && !hasRequiredTagKeys(home, requiredTagKeys)) {
          return null;
        }
        if (requiredAmenityKeys.length && !hasRequiredAmenityKeys(home, requiredAmenityKeys)) {
          return null;
        }
        if ((plan?.amenities?.parking && !matchParking(home)) || (amenityKeywords.length && !hasAmenityKeywords(home, amenityKeywords))) {
          return null;
        }
        const card = mapHomeToCard(home);
        if (!card) return null;
        const reasons = buildHomeMatchReasons({ plan, home, card });
        if (!attempt.respectGuest && guests) {
          reasons.push("Mostrando opciones sin validar capacidad exacta");
        }
        if (!attempt.respectBudget && budgetMax != null) {
          reasons.push("Incluye precios por encima del presupuesto seleccionado");
        }
        return {
          ...card,
          inventoryType: "HOME",
          matchReasons: reasons,
        };
      })
      .filter(Boolean);

    console.log(`[assistant] attempt enriched count: ${enriched.length}`);
    if (enriched.length) {
      return enriched;
    }
  }

  console.log("[assistant] final result count 0");
  return [];
};

const buildHotelMatchReasons = ({ plan, hotel }) => {
  const reasons = [];
  if (plan?.location?.city && hotel.city) {
    if (hotel.city.toLowerCase().includes(plan.location.city.toLowerCase())) {
      reasons.push(`Ubicado en ${hotel.city}`);
    }
  }
  if (hotel.preferred) {
    reasons.push("Hotel preferido de WebBeds");
  }
  return reasons;
};

const buildHotelOccupancies = (plan = {}) => {
  const adults =
    toNumberOrNull(plan?.guests?.adults) ??
    toNumberOrNull(plan?.guests?.total) ??
    2;
  const children = toNumberOrNull(plan?.guests?.children) ?? 0;
  const safeAdults = Math.max(1, Math.floor(adults));
  const safeChildren = Math.max(0, Math.floor(children));
  return `${safeAdults}|${safeChildren}`;
};

const resolveWebbedsLocationCodes = async (location = {}) => {
  const result = { cityCode: null, countryCode: null };
  if (!location) return result;
  const countryName = typeof location.country === "string" ? location.country.trim().toLowerCase() : null;
  if (countryName) {
    const countryRow = await models.WebbedsCountry.findOne({
      where: sequelize.where(sequelize.fn("LOWER", sequelize.col("name")), countryName),
      attributes: ["code"],
      raw: true,
    });
    if (countryRow?.code != null) {
      result.countryCode = String(countryRow.code);
    }
  }
  const cityName = typeof location.city === "string" ? location.city.trim().toLowerCase() : null;
  if (cityName) {
    const cityWhere = {
      [Op.and]: [
        sequelize.where(sequelize.fn("LOWER", sequelize.col("name")), cityName),
      ],
    };
    if (result.countryCode) {
      cityWhere[Op.and].push({ country_code: result.countryCode });
    }
    const cityRow = await models.WebbedsCity.findOne({
      where: cityWhere,
      attributes: ["code"],
      raw: true,
    });
    if (cityRow?.code != null) {
      result.cityCode = String(cityRow.code);
    }
  }
  return result;
};

const filterHotelsByAmenities = async (hotels, filters = {}) => {
  const amenityCodes = Array.isArray(filters.amenityCodes) ? filters.amenityCodes.filter(Boolean) : [];
  const amenityItemIds = Array.isArray(filters.amenityItemIds) ? filters.amenityItemIds.filter(Boolean) : [];
  if (!amenityCodes.length && !amenityItemIds.length) return hotels;
  const hotelIds = hotels.map((hotel) => String(hotel.id)).filter(Boolean);
  if (!hotelIds.length) return [];
  const amenityWhere = { hotel_id: { [Op.in]: hotelIds } };
  if (amenityCodes.length && amenityItemIds.length) {
    amenityWhere[Op.or] = [
      { catalog_code: { [Op.in]: amenityCodes } },
      { item_id: { [Op.in]: amenityItemIds } },
    ];
  } else if (amenityCodes.length) {
    amenityWhere.catalog_code = { [Op.in]: amenityCodes };
  } else if (amenityItemIds.length) {
    amenityWhere.item_id = { [Op.in]: amenityItemIds };
  }

  const rows = await models.WebbedsHotelAmenity.findAll({
    where: amenityWhere,
    attributes: ["hotel_id", "catalog_code", "item_id"],
    raw: true,
  });
  const amenityMap = new Map();
  rows.forEach((row) => {
    const key = String(row.hotel_id);
    if (!amenityMap.has(key)) {
      amenityMap.set(key, { codes: new Set(), items: new Set() });
    }
    if (row.catalog_code != null) {
      amenityMap.get(key).codes.add(String(row.catalog_code));
    }
    if (row.item_id) {
      amenityMap.get(key).items.add(String(row.item_id));
    }
  });

  return hotels.filter((hotel) => {
    const info = amenityMap.get(String(hotel.id));
    if (!info) return false;
    const hasCodes = !amenityCodes.length || amenityCodes.every((code) => info.codes.has(String(code)));
    const hasItems = !amenityItemIds.length || amenityItemIds.every((itemId) => info.items.has(String(itemId)));
    return hasCodes && hasItems;
  });
};

const applyHotelFilters = async (hotels, filters = {}) => {
  let filtered = hotels;
  if (filters.preferredOnly) {
    filtered = filtered.filter((hotel) => hotel.preferred);
  }
  if (filters.minRating != null) {
    filtered = filtered.filter((hotel) => {
      const rating = toNumberOrNull(hotel.rating);
      return rating != null && rating >= filters.minRating;
    });
  }
  if ((filters.amenityCodes?.length || filters.amenityItemIds?.length) && filtered.length) {
    filtered = await filterHotelsByAmenities(filtered, filters);
  }
  return filtered;
};

const mapLiveHotelOptions = async ({ options = [], plan, limit, hotelFilters, coordinateFilter }) => {
  if (!Array.isArray(options) || !options.length) return [];
  const grouped = new Map();
  options.forEach((option) => {
    const hotelCode = option?.hotelCode ?? option?.hotelDetails?.hotelCode;
    if (!hotelCode) return;
    const key = String(hotelCode);
    const price = toNumberOrNull(option.price);
    if (price == null) return;
    const current = grouped.get(key);
    if (!current || price < current.price) {
      grouped.set(key, {
        hotelCode: key,
        price,
        currency: option.currency,
        option,
      });
    }
  });
  if (!grouped.size) return [];

  const hotelCodes = Array.from(grouped.keys());
  const records = await models.WebbedsHotel.findAll({
    where: { hotel_id: { [Op.in]: hotelCodes } },
    attributes: [
      "hotel_id",
      "name",
      "city_name",
      "city_code",
      "country_name",
      "country_code",
      "address",
      "full_address",
      "lat",
      "lng",
      "rating",
      "priority",
      "preferred",
      "exclusive",
      "chain",
      "chain_code",
      "classification_code",
      "images",
      "amenities",
      "leisure",
      "business",
      "descriptions",
    ],
    include: [
      {
        model: models.WebbedsHotelChain,
        as: "chainCatalog",
        attributes: ["code", "name"],
      },
      {
        model: models.WebbedsHotelClassification,
        as: "classification",
        attributes: ["code", "name"],
      },
    ],
  });

  const cards = records
    .map((record) => {
      const card = formatStaticHotel(record);
      if (!card) return null;
      const info = grouped.get(card.id);
      if (!info) return null;
      return {
        ...card,
        pricePerNight: info.price,
        currency: info.currency || card.currency || "USD",
        providerInfo: {
          rateKey: info.option.rateKey,
          board: info.option.board,
        },
      };
    })
    .filter(Boolean);

  let filteredCards = await applyHotelFilters(cards, hotelFilters);
  if (coordinateFilter) {
    filteredCards = filteredCards.filter((card) => matchesCoordinateFilter(card.geoPoint, coordinateFilter));
  }
  filteredCards.sort((a, b) => {
    const priceA = toNumberOrNull(a.pricePerNight) ?? Number.MAX_SAFE_INTEGER;
    const priceB = toNumberOrNull(b.pricePerNight) ?? Number.MAX_SAFE_INTEGER;
    return priceA - priceB;
  });

  return filteredCards.slice(0, limit).map((hotel) => ({
    ...hotel,
    inventoryType: "HOTEL",
    matchReasons: buildHotelMatchReasons({ plan, hotel }),
  }));
};

const tryRunLiveHotelSearch = async ({ plan, limit, hotelFilters, coordinateFilter }) => {
  if (!plan?.dates?.checkIn || !plan?.dates?.checkOut) return [];
  const provider = getLiveHotelProvider();
  if (!provider) return [];
  const locationCodes = await resolveWebbedsLocationCodes(plan?.location || {});
  if (!locationCodes.cityCode && !locationCodes.countryCode) return [];
  try {
    const { payload, requestAttributes } = buildSearchHotelsPayload({
      checkIn: plan.dates.checkIn,
      checkOut: plan.dates.checkOut,
      occupancies: buildHotelOccupancies(plan),
      cityCode: locationCodes.cityCode,
      countryCode: locationCodes.countryCode,
      resultsPerPage: limit * 2,
      includeFields: ["hotelDetails"],
    });
    const credentials = provider.getCredentials();
    const options = await provider.sendSearchRequest({
      req: { id: `assistant-hotels-${Date.now()}` },
      payload,
      requestAttributes,
      credentials,
    });
    return await mapLiveHotelOptions({
      options,
      plan,
      limit,
      hotelFilters,
      coordinateFilter,
    });
  } catch (error) {
    console.warn("[assistant] live hotel search failed", error?.message || error);
    return [];
  }
};
export const searchHotelsForPlan = async (plan = {}, options = {}) => {
  const planLimit = typeof plan.limit === "number" && plan.limit > 0 ? plan.limit : null;
  const limit = clampLimit(planLimit || options.limit);
  const hotelFiltersRaw = plan?.hotelFilters || {};
  const normalizedHotelFilters = {
    ...hotelFiltersRaw,
    amenityCodes: normalizeKeyList(hotelFiltersRaw.amenityCodes),
    amenityItemIds: normalizeIdList(hotelFiltersRaw.amenityItemIds),
    preferredOnly: normalizeBooleanFlag(hotelFiltersRaw.preferredOnly),
    minRating: toNumberOrNull(hotelFiltersRaw.minRating),
  };
  const coordinateFilter = buildCoordinateFilterUsingRadius(plan?.location || {});

  const liveResults = await tryRunLiveHotelSearch({
    plan,
    limit,
    hotelFilters: normalizedHotelFilters,
    coordinateFilter,
  });
  if (liveResults.length) {
    return liveResults;
  }

  const where = {};
  if (plan?.location?.city) {
    const filter = buildStringFilter(plan.location.city);
    if (filter) where.city_name = filter;
  }
  if (plan?.location?.country) {
    const filter = buildStringFilter(plan.location.country);
    if (filter) where.country_name = filter;
  }
  if (coordinateFilter) {
    where.lat = coordinateFilter.latitude;
    where.lng = coordinateFilter.longitude;
  }
  if (normalizedHotelFilters.preferredOnly) {
    where.preferred = true;
  }

  const fetchMultiplier =
    normalizedHotelFilters.amenityCodes.length ||
      normalizedHotelFilters.amenityItemIds.length ||
      normalizedHotelFilters.minRating != null
      ? 3
      : 1;
  const fetchLimit = clampLimit(limit * fetchMultiplier);

  const hotels = await models.WebbedsHotel.findAll({
    where,
    attributes: [
      "hotel_id",
      "name",
      "city_name",
      "city_code",
      "country_name",
      "country_code",
      "address",
      "full_address",
      "lat",
      "lng",
      "rating",
      "priority",
      "preferred",
      "exclusive",
      "chain",
      "chain_code",
      "classification_code",
      "images",
      "amenities",
      "leisure",
      "business",
      "descriptions",
    ],
    include: [
      {
        model: models.WebbedsHotelChain,
        as: "chainCatalog",
        attributes: ["code", "name"],
      },
      {
        model: models.WebbedsHotelClassification,
        as: "classification",
        attributes: ["code", "name"],
      },
    ],
    order: [
      ["preferred", "DESC"],
      ["priority", "DESC"],
      ["name", "ASC"],
    ],
    limit: fetchLimit,
  });

  let cards = hotels.map(formatStaticHotel).filter(Boolean);
  cards = await applyHotelFilters(cards, normalizedHotelFilters);
  cards = cards
    .map((hotel) => ({
      ...hotel,
      inventoryType: "HOTEL",
      matchReasons: buildHotelMatchReasons({ plan, hotel }),
    }))
    .slice(0, limit);
  return cards;
};
