import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
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

const parseCoordinate = (value) => {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < -180 || num > 180) return null;
  return num;
};

export const getHomeRecommendations = async (req, res) => {
  try {
    console.log("[getHomeRecommendations] query", req.query);
    const rawCity = typeof req.query?.city === "string" ? req.query.city.trim() : "";
    const rawCountry =
      typeof req.query?.country === "string" ? req.query.country.trim() : "";
    let city = rawCity || null;
    let country = rawCountry || null;
    let lat = parseCoordinate(req.query?.lat);
    let lng = parseCoordinate(req.query?.lng);
    let region = null;

    if (!city && !country && lat == null && lng == null) {
      console.log("[getHomeRecommendations] no geo in query, resolved from req", resolveGeoFromRequest(req));
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
      Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 20) : 12;

    const baseWhere = {
      status: "PUBLISHED",
      is_visible: true,
    };

    const includeBase = [
      {
        model: models.HomeAddress,
        as: "address",
        attributes: ["address_line1", "city", "state", "country", "latitude", "longitude"],
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
                ...(city ? { city: { [Op.iLike]: city } } : {}),
                ...(country ? { country: { [Op.iLike]: country } } : {}),
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
            `ABS(COALESCE("address"."latitude", 0) - ${lat}) + ABS(COALESCE("address"."longitude", 0) - ${lng})`
          )
        : null;
    console.log("[getHomeRecommendations] resolved filters", { city, country, lat, lng, region, limit });

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
    console.log("[getHomeRecommendations] result sizes", {
      nearby: nearbyRaw?.length,
      trending: trendingRaw?.length,
      bestValue: bestValueRaw?.length,
      distance: Boolean(distanceLiteral),
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

    const sections = [];
    const nearbyCards = mapCards(nearbyRaw);
    const trendingCards = mapCards(trendingRaw);
    const bestValueCards = mapCards(bestValueRaw);

    const locationLabel = city || (nearbyCards[0]?.city ?? null);

    if (nearbyCards.length) {
      sections.push({
        id: "nearby",
        title: locationLabel ? `Popular in ${locationLabel}` : "Homes near you",
        items: nearbyCards,
      });
    }

    if (trendingCards.length) {
      sections.push({
        id: "trending",
        title: "Trending stays this week",
        items: trendingCards,
      });
    }

    if (bestValueCards.length) {
      sections.push({
        id: "best-value",
        title: "Best value picks",
        items: bestValueCards,
      });
    }

    // Remove duplicates across sections: keep first occurrence
    const seenIds = new Set();
    const dedupedSections = [];
    for (const section of sections) {
      const uniqItems = [];
      for (const card of section.items || []) {
        if (!card?.id) continue;
        if (seenIds.has(card.id)) continue;
        seenIds.add(card.id);
        uniqItems.push(card);
      }
      if (uniqItems.length) {
        dedupedSections.push({ ...section, items: uniqItems });
      }
    }

    // Fallback: if we still have no sections, reuse explore builder to avoid empty feed
    if (!dedupedSections.length) {
      const fallbackCards = mapCards(trendingRaw);
      buildExploreSections(fallbackCards).forEach((section) => {
        dedupedSections.push(section);
      });
    }

    return res.json({
      location: {
        city: locationLabel,
        region: region || nearbyCards[0]?.state || null,
        country: country || nearbyCards[0]?.country || null,
        latitude: lat ?? null,
        longitude: lng ?? null,
      },
      sections: dedupedSections,
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

    return res.json(home);
  } catch (err) {
    console.error("[getPublicHome]", err);
    return res.status(500).json({ error: "Failed to fetch home" });
  }
};
export const createHomeDraft = async (req, res) => {
  try {
    const hostId = req.user?.id;
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
    const hostId = req.user?.id;
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
    const hostId = req.user?.id;
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
    const hostId = req.user?.id;
    const { id } = req.params;
    const home = await models.Home.findOne({ where: { id, host_id: hostId } });
    if (!home) return res.status(404).json({ error: "Home not found" });

    const amenityIds = Array.isArray(req.body?.amenityIds) ? req.body.amenityIds : [];
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

export const updateHomePricing = async (req, res) => {
  try {
    const hostId = req.user?.id;
    const { id } = req.params;
    const home = await models.Home.findOne({ where: { id, host_id: hostId }, include: [{ model: models.HomePricing, as: "pricing" }] });
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
    const hostId = req.user?.id;
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
    const hostId = req.user?.id;
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
    const hostId = req.user?.id;
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
    const hostId = req.user?.id;
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
        icon: amenity.icon,
      });
    }

    const marketingTags = tags.map((tag) => ({
      id: tag.id,
      key: tag.tag_key,
      label: tag.label,
      category: tag.category,
      description: tag.description,
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
    const hostId = req.user?.id;
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
    return res.json({ uploaded });
  } catch (err) {
    console.error("[respondUploadedMedia]", err);
    return res.status(500).json({ error: "Failed to process upload" });
  }
};

export const getHomeById = async (req, res) => {
  try {
    const hostId = req.user?.id;
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
    const hostId = req.user?.id;
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
  const hostId = Number(req.user?.id);
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
    const hostId = req.user?.id;
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
    const hostId = req.user?.id;
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
  const hostId = Number(req.user?.id);
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



