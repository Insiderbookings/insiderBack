const ensureArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const extractTextList = (node, entryKey) => {
  const languages = ensureArray(node?.language ?? node);
  const collected = [];
  languages.forEach((languageNode) => {
    const entries = ensureArray(languageNode?.[entryKey]);
    entries.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === "string") {
        collected.push(entry);
        return;
      }
      collected.push(entry?.["#text"] ?? entry?.text ?? entry?.name ?? null);
    });
  });
  return collected.filter(Boolean);
};

const pickCoverImage = (imagesPayload) => {
  if (!imagesPayload) return null;
  const hotelImages = imagesPayload?.hotelImages ?? imagesPayload;
  if (hotelImages?.thumb) {
    return hotelImages.thumb;
  }
  const imageList = ensureArray(hotelImages?.image);
  const found = imageList.find((image) => image?.url);
  return found?.url ?? null;
};

const extractImages = (imagesPayload, limit = null) => {
  if (!imagesPayload) return [];
  const hotelImages = imagesPayload?.hotelImages ?? imagesPayload;
  const imageList = ensureArray(hotelImages?.image);
  const normalized = imageList
    .map((img) => {
      if (!img) return null;
      if (typeof img === "string") return { url: img, categoryName: "General" };
      return {
        url: img?.url ?? null,
        categoryName: img?.category?.["#text"] ?? img?.category?.text ?? img?.category?.name ?? "General",
        isThumbnail: img?.isThumbnail || false
      };
    })
    .filter((img) => img?.url);
  if (limit == null) return normalized;
  const safeLimit = Number(limit);
  if (!Number.isFinite(safeLimit)) return normalized;
  if (safeLimit <= 0) return [];
  return normalized.slice(0, safeLimit);
};

const extractAmenities = (node, categoryName) => {
  const list = extractTextList(node, categoryName === "amenitieItem" ? "amenitieItem" : (categoryName === "leisureItem" ? "leisureItem" : "businessItem"));
  return list.map(name => ({ name, category: categoryName === "amenitieItem" ? "General" : (categoryName === "leisureItem" ? "Leisure" : "Business") }));
};

const extractShortDescription = (descriptions) => {
  const descNode = descriptions?.description1 ?? descriptions?.description2 ?? null;
  if (!descNode) return null;
  const languageNode = Array.isArray(descNode)
    ? descNode.find((entry) => entry?.language)?.language
    : descNode.language ?? descNode;
  if (!languageNode) return null;
  return languageNode?.["#text"] ?? languageNode?.text ?? null;
};

const extractGeoLocations = (geoPayload) => {
  if (!geoPayload) return [];
  const raw = geoPayload?.geoLocation ?? geoPayload?.geoLocations ?? geoPayload;
  const locations = ensureArray(raw);
  return locations
    .map((geo) => {
      if (!geo) return null;
      const distanceNode = geo?.distance ?? null;
      const distanceValue =
        typeof distanceNode === "object"
          ? distanceNode?.["#text"] ?? distanceNode?.text ?? distanceNode?.value
          : distanceNode;
      const parsedDistance =
        distanceValue == null ? null : Number(String(distanceValue).replace(/[^0-9.\-]/g, ""));
      return {
        id: geo?.["@_id"] ?? geo?.id ?? null,
        name: geo?.name ?? geo?.["@_name"] ?? geo?.text ?? null,
        type: geo?.type ?? geo?.["@_type"] ?? null,
        distance: Number.isFinite(parsedDistance) ? parsedDistance : null,
        distanceUnit:
          typeof distanceNode === "object"
            ? distanceNode?.["@_attr"] ?? distanceNode?.attr ?? null
            : geo?.distanceAttr ?? null,
      };
    })
    .filter((geo) => geo?.name);
};

export const formatStaticHotel = (hotel, options = {}) => {
  if (!hotel) return null;
  const plain = hotel.get ? hotel.get({ plain: true }) : hotel;
  const compact = Boolean(options?.compact);
  const coverImage = pickCoverImage(plain.images);
  const shortDescription = extractShortDescription(plain.descriptions);
  const imageLimitRaw = options?.imageLimit;
  const imageLimitValue = imageLimitRaw == null ? null : Number(imageLimitRaw);
  const imageLimit = Number.isFinite(imageLimitValue) ? imageLimitValue : null;
  const allImages = extractImages(plain.images, imageLimit);

  const amenitiesGeneral = extractAmenities(plain.amenities, "amenitieItem");
  const amenitiesLeisure = extractAmenities(plain.leisure, "leisureItem");
  const amenitiesBusiness = extractAmenities(plain.business, "businessItem");
  const allAmenities = [...amenitiesGeneral, ...amenitiesLeisure, ...amenitiesBusiness];

  const transportationList = extractTextList(plain.transportation, "transportationItem");
  const geoLocations = extractGeoLocations(plain.geo_locations);
  const extraLocations = [plain.location1, plain.location2, plain.location3]
    .map((item) => (item ? String(item).trim() : null))
    .filter(Boolean);
  const roomTypesRaw =
    plain.room_static?.roomTypes ||
    plain.room_static ||
    plain.roomTypes ||
    plain.room_types ||
    [];

  return {
    id: String(plain.hotel_id),
    name: plain.name,
    city: plain.city_name,
    cityCode: plain.city_code != null ? String(plain.city_code) : null,
    country: plain.country_name,
    countryCode: plain.country_code != null ? String(plain.country_code) : null,
    region: plain.region_name ?? null,
    regionCode: plain.region_code ?? null,
    rating: plain.rating,
    address:
      plain.full_address?.hotelStreetAddress ??
      plain.address ??
      [plain.city_name, plain.country_name].filter(Boolean).join(", "),
    zipCode: plain.zip_code ?? null,
    fullAddress: compact ? null : plain.full_address ?? null,
    geoPoint:
      plain.lat != null && plain.lng != null ? { lat: Number(plain.lat), lng: Number(plain.lng) } : null,
    geoLocations: compact ? [] : geoLocations,
    priority: plain.priority,
    preferred: Boolean(plain.preferred),
    exclusive: Boolean(plain.exclusive),
    contact: {
      phone: plain.hotel_phone ?? null,
      checkIn: plain.hotel_check_in ?? null,
      checkOut: plain.hotel_check_out ?? null,
      minAge: plain.min_age ?? null,
    },
    propertyInfo: {
      roomsCount: plain.no_of_rooms ?? null,
      floors: plain.floors ?? null,
      builtYear: plain.built_year ?? null,
      renovationYear: plain.renovation_year ?? null,
    },
    locations: compact ? [] : extraLocations,
    chain: plain.chainCatalog
      ? { code: String(plain.chainCatalog.code), name: plain.chainCatalog.name }
      : plain.chain
        ? { code: plain.chain, name: plain.chain }
        : null,
    classification: plain.classification
      ? { code: String(plain.classification.code), name: plain.classification.name }
      : plain.classification_code
        ? { code: String(plain.classification_code), name: null }
        : null,
    coverImage,
    lat: plain.lat ? Number(plain.lat) : null,
    lng: plain.lng ? Number(plain.lng) : null,
    images: compact ? allImages.slice(0, 1) : allImages,
    amenities: compact ? [] : allAmenities, // Now returns full list of objects {name, category}
    leisure: compact ? [] : amenitiesLeisure.map(a => a.name), // Keep backward compat
    business: compact ? [] : amenitiesBusiness.map(a => a.name), // Keep backward compat
    transportation: compact ? [] : transportationList,
    descriptions: compact ? null : plain.descriptions ?? null,
    shortDescription,
    roomTypes: compact ? [] : roomTypesRaw,
    metadata: {
      hasLeisure: compact ? false : amenitiesLeisure.length > 0,
      hasBusiness: compact ? false : amenitiesBusiness.length > 0,
      rawPriority: plain.priority ?? null,
    },
  };
};

export const formatStaticHotels = (rows = []) =>
  rows
    .map(formatStaticHotel)
    .filter(Boolean);
