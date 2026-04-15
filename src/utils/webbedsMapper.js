const ensureArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const stripHtml = (value) => {
  if (typeof value !== "string") return value;
  return value.replace(/<\/?[^>]+(>|$)/g, "").trim();
};

const extractStaticRoomTypes = (roomStatic) => {
  if (!roomStatic) return [];

  if (Array.isArray(roomStatic?.roomTypes)) {
    return roomStatic.roomTypes
      .map((roomType) => roomType?.raw_payload ?? roomType)
      .filter(Boolean);
  }

  if (Array.isArray(roomStatic)) {
    return roomStatic
      .map((roomType) => roomType?.raw_payload ?? roomType)
      .filter(Boolean);
  }

  const rooms = ensureArray(roomStatic?.room);
  if (rooms.length) {
    return rooms.flatMap((room) => ensureArray(room?.roomType)).filter(Boolean);
  }

  return ensureArray(roomStatic).filter(Boolean);
};

const resolveRoomTypeCode = (roomType) =>
  String(
    roomType?.roomTypeCode ??
      roomType?.roomtypecode ??
      roomType?.["@_roomtypecode"] ??
      roomType?.code ??
      roomType?.id ??
      "",
  ).trim();

const normalizeRoomFamilyName = (value) => {
  const text = stripHtml(String(value ?? "")).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s*-\s*BAR$/i, "")
    .replace(/\s+\bBAR\b$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
};

const extractRoomImageUrls = (roomType) => {
  if (!roomType) return [];
  const sources = [
    roomType?.roomImages,
    roomType?.room_images,
    roomType?.roomImage,
    roomType?.room_image,
    roomType?.images,
    roomType?.image,
    roomType?.photos,
    roomType?.photo,
    roomType?.raw_payload?.roomImages,
    roomType?.raw_payload?.room_images,
    roomType?.raw_payload?.roomImage,
    roomType?.raw_payload?.room_image,
    roomType?.raw_payload?.images,
    roomType?.raw_payload?.image,
    roomType?.raw_payload?.photos,
    roomType?.raw_payload?.photo,
  ];

  const urls = new Set();
  const readUrl = (value) => {
    if (!value) return null;
    if (typeof value === "string" || typeof value === "number") return String(value);
    return (
      value?.url ??
      value?.["@_url"] ??
      value?.["#text"] ??
      value?.text ??
      value?.value ??
      value?.["#cdata-section"] ??
      null
    );
  };

  sources.forEach((source) => {
    if (!source) return;
    const thumb = readUrl(source?.thumb);
    if (thumb) urls.add(thumb);
    const node =
      source?.image ??
      source?.images ??
      source?.roomImage ??
      source?.roomImages ??
      source?.room_image ??
      source?.room_images ??
      source?.photo ??
      source?.photos ??
      source;
    ensureArray(node).forEach((entry) => {
      const url = readUrl(entry?.url ?? entry);
      if (url) urls.add(url);
    });
  });

  return Array.from(urls);
};

const buildRoomImagePayload = (urls = []) => {
  const uniqueUrls = Array.from(
    new Set(
      ensureArray(urls)
        .map((url) => (url == null ? null : String(url).trim()))
        .filter(Boolean),
    ),
  );
  if (!uniqueUrls.length) return null;
  return {
    "@_count": String(uniqueUrls.length),
    thumb: uniqueUrls[0],
    image: uniqueUrls.map((url, index) => ({
      "@_runno": String(index),
      url,
    })),
  };
};

const buildRoomImageProfile = (roomType) => {
  const normalizedName = normalizeRoomFamilyName(roomType?.name);
  const text = ` ${String(normalizedName ?? "").toLowerCase()} `;
  const normalizedText = ` ${String(normalizedName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  const includesAny = (patterns = []) =>
    patterns.some((pattern) => {
      const normalizedPattern = String(pattern).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return (normalizedPattern && normalizedText.includes(` ${normalizedPattern} `)) || text.includes(pattern);
    });
  const hasKing = includesAny([" king ", "king bed"]);
  const hasTwin = includesAny([" twin ", "twin bed", "twin beds"]);
  const hasDouble = includesAny([" double ", "double bed"]);
  const hasTriple = includesAny([" triple "]);
  const hasSingle = includesAny([" single "]);
  const hasClub = includesAny([" club "]);
  const hasRegency = includesAny([" regency "]);
  const hasRoyal = includesAny([" royal "]);
  const hasExecutive = includesAny([" executive "]);
  const hasStandard = includesAny([" standard ", " classic "]);
  const hasSeaView = includesAny([" sea view", " ocean view", " partial sea view", " with view", " view "]);
  const hasSuite = includesAny([" suite "]);
  const hasConnecting = includesAny([" connecting "]);
  const hasFamily = includesAny([" family "]);
  const hasApartment = includesAny([" apartment "]);

  let bedType = "generic";
  if (includesAny(["double or twin", "king or twin"])) bedType = "flex";
  else if (hasTwin) bedType = "twin";
  else if (hasKing) bedType = "king";
  else if (hasDouble) bedType = "double";
  else if (hasTriple) bedType = "triple";
  else if (hasSingle) bedType = "single";

  let tier = "base";
  if (hasRoyal) tier = "royal";
  else if (hasRegency) tier = "regency";
  else if (hasExecutive) tier = "executive";
  else if (hasClub) tier = "club";
  else if (hasStandard) tier = "standard";
  else if (includesAny([" room "])) tier = "room";

  return {
    normalizedName,
    bedType,
    tier,
    hasSeaView,
    hasSuite,
    hasConnecting,
    hasFamily,
    hasApartment,
  };
};

const scoreRoomImageCandidate = (targetProfile, candidateProfile) => {
  if (!targetProfile || !candidateProfile) return Number.NEGATIVE_INFINITY;

  if (targetProfile.hasApartment !== candidateProfile.hasApartment) return Number.NEGATIVE_INFINITY;
  if (targetProfile.hasFamily !== candidateProfile.hasFamily) return Number.NEGATIVE_INFINITY;
  if (targetProfile.hasConnecting !== candidateProfile.hasConnecting) return Number.NEGATIVE_INFINITY;
  if (targetProfile.hasSuite !== candidateProfile.hasSuite) return Number.NEGATIVE_INFINITY;
  if (targetProfile.hasSeaView !== candidateProfile.hasSeaView) return Number.NEGATIVE_INFINITY;

  let score = 0;

  if (targetProfile.tier === candidateProfile.tier) {
    score += 6;
  } else {
    const relaxedTierMatch =
      (targetProfile.tier === "room" && candidateProfile.tier === "base") ||
      (targetProfile.tier === "base" && candidateProfile.tier === "room") ||
      (targetProfile.tier === "standard" && candidateProfile.tier === "base") ||
      (targetProfile.tier === "base" && candidateProfile.tier === "standard");
    if (!relaxedTierMatch) return Number.NEGATIVE_INFINITY;
    score += 2;
  }

  if (targetProfile.bedType === candidateProfile.bedType) {
    score += 4;
  } else if (
    (targetProfile.bedType === "king" || targetProfile.bedType === "twin" || targetProfile.bedType === "double") &&
    candidateProfile.bedType === "flex"
  ) {
    score += 1;
  } else if (
    targetProfile.bedType === "flex" &&
    ["king", "twin", "double"].includes(candidateProfile.bedType)
  ) {
    score += 1;
  } else if (targetProfile.bedType !== "generic" && candidateProfile.bedType !== "generic") {
    return Number.NEGATIVE_INFINITY;
  }

  if (targetProfile.normalizedName && candidateProfile.normalizedName) {
    const targetTokens = new Set(targetProfile.normalizedName.split(/[\s,]+/).filter(Boolean));
    const candidateTokens = new Set(candidateProfile.normalizedName.split(/[\s,]+/).filter(Boolean));
    let overlap = 0;
    targetTokens.forEach((token) => {
      if (candidateTokens.has(token)) overlap += 1;
    });
    score += overlap * 0.25;
  }

  return score;
};

const enrichStaticRoomTypes = (roomTypes = []) => {
  const normalizedRoomTypes = ensureArray(roomTypes).filter(Boolean);
  if (!normalizedRoomTypes.length) return [];

  const exactImagesByCode = new Map();
  const donorCandidates = [];

  normalizedRoomTypes.forEach((roomType) => {
    const urls = extractRoomImageUrls(roomType);
    if (!urls.length) return;

    const roomTypeCode = resolveRoomTypeCode(roomType);
    if (roomTypeCode && !exactImagesByCode.has(roomTypeCode)) {
      exactImagesByCode.set(roomTypeCode, urls);
    }

    donorCandidates.push({
      urls,
      profile: buildRoomImageProfile(roomType),
    });
  });

  return normalizedRoomTypes.map((roomType) => {
    const currentUrls = extractRoomImageUrls(roomType);
    if (currentUrls.length) return roomType;

    const roomTypeCode = resolveRoomTypeCode(roomType);
    const targetProfile = buildRoomImageProfile(roomType);
    let inheritedSource = roomTypeCode ? "roomTypeCode" : null;
    let inheritedUrls = roomTypeCode ? exactImagesByCode.get(roomTypeCode) : null;

    if (!inheritedUrls?.length) {
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestCandidate = null;
      donorCandidates.forEach((candidate) => {
        const score = scoreRoomImageCandidate(targetProfile, candidate.profile);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      });
      if (bestScore > 0 && bestCandidate?.urls?.length) {
        inheritedUrls = bestCandidate.urls;
        inheritedSource = "roomProfile";
      }
    }

    if (!inheritedUrls?.length) return roomType;

    return {
      ...roomType,
      roomImages: buildRoomImagePayload(inheritedUrls),
      imageInheritance: {
        source: inheritedSource,
        profile: targetProfile,
      },
    };
  });
};

const extractTextList = (node, entryKey) => {
  if (!node) return [];
  if (Array.isArray(node)) {
    return node
      .map((entry) => (typeof entry === "string" ? entry : entry?.["#text"] ?? entry?.text ?? entry?.name ?? null))
      .filter(Boolean);
  }
  const languages = ensureArray(node?.language ?? node);
  const collected = [];
  languages.forEach((languageNode) => {
    if (!languageNode || typeof languageNode !== "object") return;
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

const AMENITY_ENTRY_KEYS = {
  amenitieItem: ["amenitieItem", "amenityItem"],
  leisureItem: ["leisureItem"],
  businessItem: ["businessItem"],
};

const extractAmenities = (node, categoryName) => {
  const keyGroup = categoryName === "amenitieItem" ? "amenitieItem" : (categoryName === "leisureItem" ? "leisureItem" : "businessItem");
  const keys = AMENITY_ENTRY_KEYS[keyGroup] || [keyGroup];
  let list = [];
  for (const key of keys) {
    list = extractTextList(node, key);
    if (list.length) break;
  }
  const categoryLabel = categoryName === "amenitieItem" ? "General" : (categoryName === "leisureItem" ? "Leisure" : "Business");
  return list.map(name => ({ name, category: categoryLabel }));
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
  const shortDescription = extractShortDescription(plain.descriptions);
  const imageLimitRaw = options?.imageLimit;
  const imageLimitValue = imageLimitRaw == null ? null : Number(imageLimitRaw);
  const imageLimit = Number.isFinite(imageLimitValue) ? imageLimitValue : null;
  const allImages = extractImages(plain.images, imageLimit);
  const coverImage = pickCoverImage(plain.images) || (allImages[0]?.url ? allImages[0].url : null);

  const amenitiesGeneral = extractAmenities(plain.amenities, "amenitieItem");
  const amenitiesLeisure = extractAmenities(plain.leisure, "leisureItem");
  const amenitiesBusiness = extractAmenities(plain.business, "businessItem");
  const allAmenities = [...amenitiesGeneral, ...amenitiesLeisure, ...amenitiesBusiness];

  const transportationList = extractTextList(plain.transportation, "transportationItem");
  const geoLocations = extractGeoLocations(plain.geo_locations);
  const extraLocations = [plain.location1, plain.location2, plain.location3]
    .map((item) => (item ? String(item).trim() : null))
    .filter(Boolean);
  const roomTypesRaw = extractStaticRoomTypes(
    plain.roomTypes ?? plain.room_types ?? plain.room_static ?? [],
  );
  const roomTypes = enrichStaticRoomTypes(roomTypesRaw);

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
    roomTypes: compact ? [] : roomTypes,
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
