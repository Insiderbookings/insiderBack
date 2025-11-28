import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
import { mapHomeToCard } from "../utils/homeMapper.js";
import { formatStaticHotel } from "../utils/webbedsMapper.js";

const clampLimit = (value, fallback = 6) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(20, Math.max(1, Math.floor(numeric)));
};

const toNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

const runHomeQuery = async ({ plan, limit, guests, coordinateFilter, addressWhere, budgetMax, respectGuest, respectBudget }) => {
  const where = {
    status: "PUBLISHED",
    is_visible: true,
  };
  if (respectGuest && guests) {
    where.max_guests = { [Op.gte]: guests };
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
    {
      model: models.HomeAmenityLink,
      as: "amenities",
      required: Boolean(plan?.amenities?.parking),
      include: [
        {
          model: models.HomeAmenity,
          as: "amenity",
          attributes: ["id", "amenity_key", "label"],
        },
      ],
    },
  ];

  const homes = await models.Home.findAll({
    where,
    include,
    order: [
      ["updated_at", "DESC"],
      ["id", "DESC"],
    ],
    limit,
  });

  return homes;
};

export const searchHomesForPlan = async (plan = {}, options = {}) => {
  console.log("[assistant] plan", JSON.stringify(plan));
  const limit = clampLimit(options.limit);
  const guests = resolveGuestTotal(plan);
  const addressWhere = {};
  if (plan?.location?.city) {
    const filter = buildStringFilter(plan.location.city);
    if (filter) addressWhere.city = filter;
  }
  if (plan?.location?.country) {
    const filter = buildStringFilter(plan.location.country);
    if (filter) addressWhere.country = filter;
  }
  if (plan?.location?.state) {
    const filter = buildStringFilter(plan.location.state);
    if (filter) addressWhere.state = filter;
  }

  const latValue = toNumberOrNull(plan?.location?.lat);
  const lngValue = toNumberOrNull(plan?.location?.lng);
  const coordinateFilter =
    latValue != null && lngValue != null
      ? {
          latitude: { [Op.between]: [latValue - 0.35, latValue + 0.35] },
          longitude: { [Op.between]: [lngValue - 0.35, lngValue + 0.35] },
        }
      : null;

  const budgetMax = resolveBudgetMax(plan);

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
    });

    const enriched = homes
      .map((home) => {
        if (plan?.amenities?.parking && !matchParking(home)) {
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

    console.log("[assistant] attempt result count", enriched.length);
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

export const searchHotelsForPlan = async (plan = {}, options = {}) => {
  const limit = clampLimit(options.limit);
  const where = {};
  if (plan?.location?.city) {
    const filter = buildStringFilter(plan.location.city);
    if (filter) where.city_name = filter;
  }
  if (plan?.location?.country) {
    const filter = buildStringFilter(plan.location.country);
    if (filter) where.country_name = filter;
  }

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
    limit,
  });

  return hotels
    .map((hotel) => {
      const card = formatStaticHotel(hotel);
      if (!card) return null;
      return {
        ...card,
        inventoryType: "HOTEL",
        matchReasons: buildHotelMatchReasons({ plan, hotel: card }),
      };
    })
    .filter(Boolean);
};
