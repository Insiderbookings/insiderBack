const toPlain = (value) => {
  if (!value) return null;
  if (typeof value.toJSON === "function") {
    try {
      return value.toJSON();
    } catch {
      return value;
    }
  }
  return value;
};

const hasValue = (value) => {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
};

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeText = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const joinLocationParts = (parts) => {
  const cleaned = parts
    .map((part) => (part ? String(part).trim() : null))
    .filter(Boolean);
  return cleaned.length ? cleaned.join(", ") : null;
};

const pickCandidate = (candidates) => {
  const selected = candidates.find((item) => hasValue(item.value));
  return selected ? { value: selected.value, source: selected.source } : { value: null, source: null };
};

const pickCoords = (candidates) => {
  for (const item of candidates) {
    const lat = toNumber(item.lat);
    const lng = toNumber(item.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { value: { lat, lng }, source: item.source };
    }
  }
  return { value: null, source: null };
};

const pickCoverImage = (media) => {
  if (!Array.isArray(media) || !media.length) return null;
  const normalized = media.map(toPlain);
  const cover =
    normalized.find((item) => item?.is_cover) ??
    normalized.find((item) => Number(item?.order) === 0) ??
    normalized[0];
  return cover?.url ?? null;
};

const resolveWebbedsImage = (images) => {
  if (!Array.isArray(images) || !images.length) return null;
  const first = images[0];
  if (typeof first === "string") return first;
  if (first?.url) return first.url;
  if (first?.image) return first.image;
  if (first?.path) return first.path;
  return null;
};

const uniqAmenities = (items) => {
  const seen = new Set();
  const output = [];
  items.forEach((item) => {
    const normalized = String(item || "").trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  });
  return output;
};

const normalizeAmenities = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    const parsed = value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item?.name) return String(item.name).trim();
        if (item?.label) return String(item.label).trim();
        if (item?.description) return String(item.description).trim();
        if (item?.facility_name) return String(item.facility_name).trim();
        if (item?.facility) return String(item.facility).trim();
        if (item?.value) return String(item.value).trim();
        if (item?.text) return String(item.text).trim();
        return null;
      })
      .filter(Boolean);
    return uniqAmenities(parsed);
  }
  if (typeof value === "object") {
    const nestedKeys = [
      "amenities",
      "amenitiesList",
      "facility",
      "facilities",
      "hotelAmenities",
      "HotelAmenities",
    ];
    const nestedItems = nestedKeys.flatMap((key) =>
      Array.isArray(value[key]) ? value[key] : []
    );
    if (nestedItems.length) {
      return normalizeAmenities(nestedItems);
    }

    const booleanMap = Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => String(key).trim())
      .filter(Boolean);
    if (booleanMap.length) return uniqAmenities(booleanMap);

    const stringValues = Object.values(value)
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (stringValues.length) return uniqAmenities(stringValues);
  }
  return [];
};

const normalizeHouseRules = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const summarizeCandidateList = (candidates, normalize) =>
  candidates.map((candidate) => {
    const normalized = normalize ? normalize(candidate.value) : candidate.value;
    const list = Array.isArray(normalized) ? normalized : [];
    return {
      source: candidate.source,
      count: list.length,
      sample: list.slice(0, 5),
    };
  });

const summarizeTextCandidates = (candidates, maxLen = 160) =>
  candidates.map((candidate) => {
    const text = normalizeText(candidate.value);
    if (!text) return { source: candidate.source, preview: null };
    const preview = text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
    return { source: candidate.source, preview };
  });

const dateFromYmd = (value) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseDateKey = (value) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const diffDays = (from, to) => {
  if (!from || !to) return null;
  const fromMid = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toMid = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const diffMs = toMid - fromMid;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
};

const formatDateKey = (date, timeZone) => {
  if (!date) return null;
  if (!timeZone) return date.toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

const formatLocalDateTime = (date, timeZone) => {
  if (!date || !timeZone) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return null;
  }
};

const buildSummary = ({ stayName, locationText, checkIn, checkOut }) => {
  const parts = [];
  if (stayName) parts.push(stayName);
  if (locationText) parts.push(locationText);
  if (checkIn && checkOut) parts.push(`${checkIn} to ${checkOut}`);
  return parts.join(" | ");
};

export const buildTripHubContext = ({ booking, intelligence }) => {
  const data = toPlain(booking) ?? {};
  const inventorySnapshot = toPlain(data.inventory_snapshot ?? data.inventorySnapshot) ?? {};
  const meta = toPlain(data.meta) ?? {};
  const metaSnapshot = toPlain(meta.snapshot) ?? {};
  const intelligenceMeta = intelligence?.metadata || {};

  const homeStay = toPlain(data.homeStay ?? data.stayHome ?? data.StayHome) ?? null;
  const home = toPlain(homeStay?.home ?? homeStay?.Home ?? data.home) ?? null;
  const hotelStay = toPlain(data.hotelStay ?? data.stayHotel ?? data.StayHotel) ?? null;
  const hotel = toPlain(hotelStay?.hotel ?? data.hotel) ?? null;
  const webbedsHotel = toPlain(hotelStay?.webbedsHotel ?? data.webbedsHotel) ?? null;
  const homeAddress = toPlain(home?.address) ?? null;
  const homeMedia = Array.isArray(home?.media) ? home.media.map(toPlain) : [];

  const rawInventoryType = String(data.inventory_type ?? data.inventoryType ?? "").toUpperCase();
  const inventoryType = rawInventoryType === "HOME" ? "HOME" : "HOTEL";

  const stayNameCandidates = [
    { value: data.hotel_name ?? data.hotelName, source: "booking.hotel_name" },
    { value: inventorySnapshot.hotelName, source: "booking.inventory_snapshot.hotelName" },
    { value: metaSnapshot.hotelName, source: "booking.meta.snapshot.hotelName" },
    { value: hotel?.name, source: "hotelStay.hotel.name" },
    { value: webbedsHotel?.name, source: "hotelStay.webbedsHotel.name" },
    { value: home?.title, source: "homeStay.home.title" },
  ];
  const stayNameSelected = pickCandidate(stayNameCandidates);
  const stayName = normalizeText(stayNameSelected.value) ?? null;

  const cityCandidates = [
    { value: homeAddress?.city, source: "homeStay.home.address.city" },
    { value: hotel?.city, source: "hotelStay.hotel.city" },
    { value: webbedsHotel?.city_name, source: "hotelStay.webbedsHotel.city_name" },
    { value: inventorySnapshot.city, source: "booking.inventory_snapshot.city" },
    { value: metaSnapshot.city, source: "booking.meta.snapshot.city" },
  ];
  const countryCandidates = [
    { value: homeAddress?.country, source: "homeStay.home.address.country" },
    { value: hotel?.country, source: "hotelStay.hotel.country" },
    { value: webbedsHotel?.country_name, source: "hotelStay.webbedsHotel.country_name" },
    { value: inventorySnapshot.country, source: "booking.inventory_snapshot.country" },
    { value: metaSnapshot.country, source: "booking.meta.snapshot.country" },
  ];

  const citySelected = pickCandidate(cityCandidates);
  const countrySelected = pickCandidate(countryCandidates);
  const city = normalizeText(citySelected.value) ?? null;
  const country = normalizeText(countrySelected.value) ?? null;

  const homeLocationCandidate = {
    value: joinLocationParts([
      homeAddress?.address_line1,
      homeAddress?.city,
      homeAddress?.state,
      homeAddress?.country,
    ]),
    source: "homeStay.home.address.*",
  };
  const hotelLocationCandidate = {
    value: joinLocationParts([hotel?.address, hotel?.city, hotel?.country]),
    source: "hotelStay.hotel.address/city/country",
  };
  const webbedsLocationCandidate = {
    value: joinLocationParts([
      webbedsHotel?.address,
      webbedsHotel?.city_name,
      webbedsHotel?.country_name,
    ]),
    source: "hotelStay.webbedsHotel.address/city/country",
  };
  const locationTextCandidates = inventoryType === "HOME"
    ? [
      homeLocationCandidate,
      { value: data.location, source: "booking.location" },
      { value: inventorySnapshot.location, source: "booking.inventory_snapshot.location" },
      { value: inventorySnapshot.address, source: "booking.inventory_snapshot.address" },
      { value: metaSnapshot.location, source: "booking.meta.snapshot.location" },
      { value: metaSnapshot.address, source: "booking.meta.snapshot.address" },
      hotelLocationCandidate,
      webbedsLocationCandidate,
    ]
    : [
      webbedsLocationCandidate,
      { value: inventorySnapshot.location, source: "booking.inventory_snapshot.location" },
      { value: data.location, source: "booking.location" },
      { value: inventorySnapshot.address, source: "booking.inventory_snapshot.address" },
      { value: metaSnapshot.location, source: "booking.meta.snapshot.location" },
      { value: metaSnapshot.address, source: "booking.meta.snapshot.address" },
      hotelLocationCandidate,
      homeLocationCandidate,
    ];
  const locationTextSelected = pickCandidate(locationTextCandidates);
  let locationText = normalizeText(locationTextSelected.value);
  let locationTextSource = locationTextSelected.source;
  if (!locationText && (city || country)) {
    locationText = joinLocationParts([city, country]);
    locationTextSource = "derived.city_country";
  }

  const coordsCandidates = [
    {
      lat: homeAddress?.latitude,
      lng: homeAddress?.longitude,
      source: "homeStay.home.address.latitude/longitude",
    },
    { lat: hotel?.lat, lng: hotel?.lng, source: "hotelStay.hotel.lat/lng" },
    { lat: webbedsHotel?.lat, lng: webbedsHotel?.lng, source: "hotelStay.webbedsHotel.lat/lng" },
    {
      lat: inventorySnapshot.lat ?? inventorySnapshot.latitude,
      lng: inventorySnapshot.lng ?? inventorySnapshot.longitude,
      source: "booking.inventory_snapshot.lat/lng",
    },
    {
      lat: metaSnapshot.lat ?? metaSnapshot.latitude,
      lng: metaSnapshot.lng ?? metaSnapshot.longitude,
      source: "booking.meta.snapshot.lat/lng",
    },
  ];
  const coordsSelected = pickCoords(coordsCandidates);
  const coords = coordsSelected.value;

  const imageCandidates = [
    { value: inventorySnapshot.hotelImage, source: "booking.inventory_snapshot.hotelImage" },
    { value: inventorySnapshot.image, source: "booking.inventory_snapshot.image" },
    { value: inventorySnapshot.coverImage, source: "booking.inventory_snapshot.coverImage" },
    { value: metaSnapshot.image, source: "booking.meta.snapshot.image" },
    { value: hotel?.image, source: "hotelStay.hotel.image" },
    { value: resolveWebbedsImage(webbedsHotel?.images), source: "hotelStay.webbedsHotel.images" },
    { value: pickCoverImage(homeMedia), source: "homeStay.home.media" },
  ];
  const imageSelected = pickCandidate(imageCandidates);
  const imageUrl = normalizeText(imageSelected.value) ?? null;

  const amenitiesCandidates = inventoryType === "HOME"
    ? [
      { value: home?.amenities, source: "homeStay.home.amenities" },
      { value: inventorySnapshot.amenities, source: "booking.inventory_snapshot.amenities" },
      { value: metaSnapshot.amenities, source: "booking.meta.snapshot.amenities" },
      { value: hotel?.amenities, source: "hotelStay.hotel.amenities" },
      { value: webbedsHotel?.amenities, source: "hotelStay.webbedsHotel.amenities" },
    ]
    : [
      { value: webbedsHotel?.amenities, source: "hotelStay.webbedsHotel.amenities" },
      { value: hotel?.amenities, source: "hotelStay.hotel.amenities" },
      { value: inventorySnapshot.amenities, source: "booking.inventory_snapshot.amenities" },
      { value: metaSnapshot.amenities, source: "booking.meta.snapshot.amenities" },
      { value: home?.amenities, source: "homeStay.home.amenities" },
    ];
  const amenitiesSelected = pickCandidate(
    amenitiesCandidates.map((candidate) => ({
      ...candidate,
      value: normalizeAmenities(candidate.value),
    }))
  );
  const amenities = Array.isArray(amenitiesSelected.value) ? amenitiesSelected.value : [];

  const houseRulesCandidates = [
    { value: home?.house_rules, source: "homeStay.home.house_rules" },
    { value: homeStay?.house_rules_snapshot, source: "homeStay.house_rules_snapshot" },
    { value: inventorySnapshot.houseRules, source: "booking.inventory_snapshot.houseRules" },
    { value: metaSnapshot.houseRules, source: "booking.meta.snapshot.houseRules" },
  ];
  const houseRulesSelected = pickCandidate(
    houseRulesCandidates.map((candidate) => ({
      ...candidate,
      value: normalizeHouseRules(candidate.value),
    }))
  );
  const houseRules = normalizeHouseRules(houseRulesSelected.value);

  const arrivalTimeCandidates = [
    { value: homeStay?.checkin_window_start, source: "homeStay.checkin_window_start" },
    { value: webbedsHotel?.hotel_check_in, source: "hotelStay.webbedsHotel.hotel_check_in" },
    { value: metaSnapshot.checkInTime, source: "booking.meta.snapshot.checkInTime" },
  ];
  const arrivalSelected = pickCandidate(arrivalTimeCandidates);
  const arrivalTime = normalizeText(arrivalSelected.value);

  const checkoutTimeCandidates = [
    { value: homeStay?.checkout_time, source: "homeStay.checkout_time" },
    { value: webbedsHotel?.hotel_check_out, source: "hotelStay.webbedsHotel.hotel_check_out" },
    { value: metaSnapshot.checkOutTime, source: "booking.meta.snapshot.checkOutTime" },
  ];
  const checkoutSelected = pickCandidate(checkoutTimeCandidates);
  const checkoutTime = normalizeText(checkoutSelected.value);

  const checkIn = data.check_in ?? data.checkIn ?? null;
  const checkOut = data.check_out ?? data.checkOut ?? null;

  const timeZone = normalizeText(intelligenceMeta?.weather?.timeZone) ?? null;
  const now = new Date();
  const checkInDate = dateFromYmd(checkIn);
  const checkOutDate = dateFromYmd(checkOut);
  const todayKey = formatDateKey(now, timeZone);
  const checkInKey = normalizeText(checkIn);
  const checkOutKey = normalizeText(checkOut);

  let phase = "unknown";
  if (todayKey && checkInKey && checkOutKey) {
    if (todayKey < checkInKey) phase = "pre_trip";
    else if (todayKey > checkOutKey) phase = "post_trip";
    else phase = "in_trip";
  } else if (checkInDate && checkOutDate) {
    if (now < checkInDate) phase = "pre_trip";
    else if (now >= checkOutDate) phase = "post_trip";
    else phase = "in_trip";
  }

  const missingRequired = [];
  if (!stayName) missingRequired.push("stayName");
  if (!locationText && !city && !country) missingRequired.push("location");
  if (!checkIn) missingRequired.push("dates.checkIn");
  if (!checkOut) missingRequired.push("dates.checkOut");
  if (!coords) missingRequired.push("coords");

  const missingOptional = [];
  if (!arrivalTime) missingOptional.push("arrivalTime");
  if (!checkoutTime) missingOptional.push("checkoutTime");
  if (!amenities.length) missingOptional.push("amenities");

  const tripContext = {
    bookingId: data.id ?? null,
    inventoryType,
    stayName: stayName ?? "Your stay",
    locationText: locationText ?? null,
    imageUrl,
    location: {
      city,
      country,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    },
    dates: {
      checkIn,
      checkOut,
    },
    amenities,
    houseRules,
    arrivalTime,
    checkoutTime,
    summary: buildSummary({
      stayName: stayName ?? "Your stay",
      locationText,
      checkIn,
      checkOut,
    }),
  };

  const intelligenceSummary = intelligence
    ? {
      hasCached: true,
      updatedAt: intelligence.lastGeneratedAt ?? null,
      insights: Array.isArray(intelligence.insights) ? intelligence.insights.length : 0,
      preparation: Array.isArray(intelligence.preparation) ? intelligence.preparation.length : 0,
      suggestions: Array.isArray(intelligenceMeta.suggestions) ? intelligenceMeta.suggestions.length : 0,
      localPulse: Array.isArray(intelligenceMeta.localPulse) ? intelligenceMeta.localPulse.length : 0,
      itinerary: Array.isArray(intelligenceMeta.itinerary) ? intelligenceMeta.itinerary.length : 0,
      hasWeather: Boolean(intelligenceMeta.weather),
      hasTimeContext: Boolean(intelligenceMeta.timeContext),
      hasLocalLingo: Boolean(intelligenceMeta.localLingo),
    }
    : { hasCached: false };

  const placesKeyAvailable = Boolean(
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY
  );

  return {
    booking: {
      id: data.id ?? null,
      source: data.source ?? null,
      inventoryType,
      status: data.status ?? null,
      paymentStatus: data.payment_status ?? data.paymentStatus ?? null,
      checkIn,
      checkOut,
      nights: data.nights ?? (checkInDate && checkOutDate ? diffDays(checkInDate, checkOutDate) : null),
      guests: {
        adults: data.adults ?? null,
        children: data.children ?? null,
      },
      bookedAt: data.booked_at ?? null,
    },
    stay: {
      type: inventoryType,
      name: stayName ?? null,
      locationText,
      address: normalizeText(locationText),
      city,
      country,
      coords: coords ?? null,
      imageUrl,
      arrivalTime,
      checkoutTime,
      checkinWindow: {
        start: normalizeText(homeStay?.checkin_window_start) ?? null,
        end: normalizeText(homeStay?.checkin_window_end) ?? null,
      },
    },
    tripContext,
    derived: {
      phase,
      now: now.toISOString(),
      timeZone,
      localDate: todayKey,
      localDateTime: formatLocalDateTime(now, timeZone),
      daysToCheckIn: checkInKey
        ? diffDays(parseDateKey(todayKey), parseDateKey(checkInKey))
        : checkInDate
          ? diffDays(now, checkInDate)
          : null,
      daysToCheckOut: checkOutKey
        ? diffDays(parseDateKey(todayKey), parseDateKey(checkOutKey))
        : checkOutDate
          ? diffDays(now, checkOutDate)
          : null,
      daysSinceCheckout: checkOutKey
        ? diffDays(parseDateKey(checkOutKey), parseDateKey(todayKey))
        : checkOutDate
          ? diffDays(checkOutDate, now)
          : null,
    },
    tools: {
      places: {
        ready: Boolean(coords),
        hasKey: placesKeyAvailable,
        locationText: locationText ?? null,
      },
      weather: {
        ready: Boolean(coords || locationText || city || country),
        locationText: locationText ?? joinLocationParts([city, country]),
      },
    },
    intelligence: intelligenceSummary,
    sources: {
      stayName: stayNameSelected.source,
      locationText: locationTextSource,
      city: citySelected.source,
      country: countrySelected.source,
      coords: coordsSelected.source,
      imageUrl: imageSelected.source,
      amenities: amenitiesSelected.source,
      houseRules: houseRulesSelected.source,
      arrivalTime: arrivalSelected.source,
      checkoutTime: checkoutSelected.source,
    },
    candidates: {
      stayName: stayNameCandidates,
      locationText: locationTextCandidates,
      city: cityCandidates,
      country: countryCandidates,
      coords: coordsCandidates,
      image: imageCandidates,
      amenities: summarizeCandidateList(amenitiesCandidates, normalizeAmenities),
      houseRules: summarizeTextCandidates(houseRulesCandidates),
      arrivalTime: summarizeTextCandidates(arrivalTimeCandidates),
      checkoutTime: summarizeTextCandidates(checkoutTimeCandidates),
    },
    missing: {
      required: missingRequired,
      optional: missingOptional,
    },
  };
};
