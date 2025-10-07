import models from "../models/index.js";

function asBool(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

export const createHomeDraft = async (req, res) => {
  try {
    const hostId = req.user?.id;
    if (!hostId) return res.status(401).json({ error: "Unauthorized" });

    const {
      propertyType = "HOUSE",
      spaceType = "ENTIRE_PLACE",
      listingType = "STANDARD",
      maxGuests = 1,
      bedrooms = 1,
      beds = 1,
      bathrooms = 1,
    } = req.body || {};

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
    const home = await models.Home.findOne({ where: { id, host_id: hostId } });
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
          metadata: item?.metadata || null,
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

export const getHomeById = async (req, res) => {
  try {
    const hostId = req.user?.id;
    const { id } = req.params;
    const home = await models.Home.findOne({
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
      ],
    });
    if (!home) return res.status(404).json({ error: "Home not found" });
    return res.json(home);
  } catch (err) {
    console.error("[getHomeById]", err);
    return res.status(500).json({ error: "Failed to fetch home" });
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
