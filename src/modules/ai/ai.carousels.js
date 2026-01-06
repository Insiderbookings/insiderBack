import { geocodePlace, getNearbyPlaces } from "./tools/index.js";

const DEFAULT_MAX_CAROUSELS = 5;
const DEFAULT_ITEMS_PER_CAROUSEL = 5;

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const parsePriceValue = (value) => {
  if (value == null) return null;
  if (typeof value === "number") return toNumber(value);
  const cleaned = String(value).replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") && !cleaned.includes(".")
    ? cleaned.replace(",", ".")
    : cleaned.replace(/,/g, "");
  return toNumber(normalized);
};

const extractPrice = (item) =>
  parsePriceValue(
    item?.pricePerNight ??
      item?.price ??
      item?.nightlyRate ??
      item?.priceLabel ??
      item?.homePayload?.pricePerNight ??
      item?.hotelPayload?.pricePerNight ??
      null
  );

const extractRating = (item) =>
  toNumber(
    item?.ratingValue ??
      item?.rating ??
      item?.reviewScore ??
      item?.review_score ??
      item?.stars ??
      item?.starRating ??
      item?.score ??
      null
  );

const extractReviewCount = (item) =>
  toNumber(
    item?.reviewCount ??
      item?.reviewsCount ??
      item?.ratingsCount ??
      item?.ratings_count ??
      item?.review_count ??
      null
  );

const extractCoords = (item) => {
  const lat =
    toNumber(item?.locationLat) ??
    toNumber(item?.latitude) ??
    toNumber(item?.lat) ??
    toNumber(item?.geoPoint?.lat) ??
    toNumber(item?.location?.lat) ??
    toNumber(item?.coords?.lat) ??
    null;
  const lng =
    toNumber(item?.locationLng) ??
    toNumber(item?.longitude) ??
    toNumber(item?.lng) ??
    toNumber(item?.geoPoint?.lng) ??
    toNumber(item?.location?.lng) ??
    toNumber(item?.coords?.lng) ??
    null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const normalizeTextList = (value) => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => {
      if (!item) return null;
      if (typeof item === "string") return item.trim();
      if (typeof item === "object") {
        return item.label || item.name || item.title || item.text || null;
      }
      return String(item);
    })
    .filter(Boolean);
};

const buildKeywordBlob = (item) => {
  const parts = [
    item?.title,
    item?.name,
    item?.summaryLine,
    item?.badge,
    ...(normalizeTextList(item?.marketingTags) || []),
    ...(normalizeTextList(item?.amenities) || []),
    ...(normalizeTextList(item?.business) || []),
    ...(normalizeTextList(item?.leisure) || []),
    ...(normalizeTextList(item?.matchReasons) || []),
  ];
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

const degreesToRadians = (deg) => (deg * Math.PI) / 180;

const computeDistanceKm = (from, to) => {
  if (!from || !to) return null;
  const earthRadiusKm = 6371;
  const dLat = degreesToRadians(to.lat - from.lat);
  const dLng = degreesToRadians(to.lng - from.lng);
  const originLat = degreesToRadians(from.lat);
  const destLat = degreesToRadians(to.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(originLat) * Math.cos(destLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((earthRadiusKm * c).toFixed(2));
};

const buildSignals = (text) => {
  const normalized = String(text || "").toLowerCase();
  const has = (terms) => terms.some((term) => normalized.includes(term));
  return {
    nightlife: has(["nightlife", "party", "fiesta", "bar", "club", "discoteca", "nocturno"]),
    shopping: has(["shopping", "compras", "mall", "outlet", "tiendas", "tienda"]),
    business: has(["business", "negocios", "work", "trabajo", "office", "meeting", "conference"]),
    family: has(["family", "familia", "kids", "children", "ninos"]),
    center: has(["center", "centro", "downtown", "centro historico"]),
    premium: has(["premium", "luxury", "lujo", "exclusive", "exclusivo"]),
    budget: has(["budget", "cheap", "barato", "economico"]),
  };
};

const resolveSearchLocation = async ({ plan, state }) => {
  const planLocation = plan?.location || {};
  const lat = toNumber(planLocation.lat ?? planLocation.latitude);
  const lng = toNumber(planLocation.lng ?? planLocation.lon ?? planLocation.longitude);
  if (lat != null && lng != null) return { lat, lng };
  if (state?.destination?.lat != null && state?.destination?.lon != null) {
    return { lat: Number(state.destination.lat), lng: Number(state.destination.lon) };
  }
  const locationText =
    planLocation.city ||
    planLocation.state ||
    planLocation.country ||
    state?.destination?.name ||
    null;
  if (!locationText) return null;
  const geocoded = await geocodePlace(locationText);
  if (!geocoded?.lat || !geocoded?.lon) return null;
  return { lat: geocoded.lat, lng: geocoded.lon };
};

const buildAnchorFromPlaces = (places = []) => {
  if (!Array.isArray(places) || !places.length) return null;
  const candidate = places.find((place) => place?.location) || places[0];
  if (!candidate?.location) return null;
  return {
    location: candidate.location,
    name: candidate.name || null,
  };
};

const scoreByKeywords = (blob, keywords = []) =>
  keywords.reduce((score, keyword) => (blob.includes(keyword) ? score + 1 : score), 0);

const buildCarousel = ({
  id,
  title,
  reason,
  items,
  scoreFn,
  sort = "desc",
  minItems = 2,
  maxItems = DEFAULT_ITEMS_PER_CAROUSEL,
  usedIds,
}) => {
  if (!Array.isArray(items) || !items.length) return null;
  const scored = items
    .map((entry) => {
      const score = scoreFn(entry);
      if (score == null) return null;
      return { ...entry, score };
    })
    .filter(Boolean);

  if (scored.length < minItems) return null;

  scored.sort((a, b) => {
    if (a.score === b.score) return 0;
    return sort === "asc" ? a.score - b.score : b.score - a.score;
  });

  const uniques = [];
  const duplicates = [];
  scored.forEach((entry) => {
    if (usedIds && usedIds.has(entry.id)) {
      duplicates.push(entry);
    } else {
      uniques.push(entry);
    }
  });

  const selected = uniques.slice(0, maxItems);
  if (selected.length < maxItems) {
    selected.push(...duplicates.slice(0, maxItems - selected.length));
  }

  if (selected.length < minItems) return null;
  selected.forEach((entry) => usedIds?.add(entry.id));
  return {
    id,
    title,
    reason,
    items: selected.map((entry) => entry.item),
  };
};

export const buildInventoryCarousels = async ({
  inventory,
  plan,
  state,
  message,
  maxCarousels = DEFAULT_MAX_CAROUSELS,
  maxItems = DEFAULT_ITEMS_PER_CAROUSEL,
} = {}) => {
  const homes = Array.isArray(inventory?.homes) ? inventory.homes : [];
  const hotels = Array.isArray(inventory?.hotels) ? inventory.hotels : [];
  const rawItems = [...homes, ...hotels];
  if (!rawItems.length) return [];

  const normalizedItems = rawItems
    .map((item) => {
      if (!item?.id) return null;
      const id = String(item.id);
      return {
        id,
        item,
        price: extractPrice(item),
        rating: extractRating(item),
        reviewCount: extractReviewCount(item),
        coords: extractCoords(item),
        maxGuests: toNumber(item?.maxGuests ?? item?.max_guests ?? null),
        bedrooms: toNumber(item?.bedrooms ?? null),
        keywordBlob: buildKeywordBlob(item),
        isPreferred: Boolean(item?.preferred || item?.exclusive),
      };
    })
    .filter(Boolean);

  if (!normalizedItems.length) return [];

  const userText = [
    message,
    ...(Array.isArray(plan?.notes) ? plan.notes : []),
    state?.destination?.name,
  ]
    .filter(Boolean)
    .join(" ");
  const signals = buildSignals(userText);

  const requested = new Set();
  if (signals.nightlife) requested.add("nightlife");
  if (signals.shopping) requested.add("shopping");
  if (signals.business) requested.add("business");
  if (signals.family) requested.add("family");
  if (signals.center) requested.add("central");

  const optionalIds = ["central", "family", "business", "nightlife", "shopping"];
  const prioritizedOptional = [
    ...optionalIds.filter((id) => requested.has(id)),
    ...optionalIds.filter((id) => !requested.has(id)),
  ];

  const hasCoords = normalizedItems.some((entry) => entry.coords);
  const needsLocation = hasCoords && prioritizedOptional.some((id) => ["central", "nightlife", "shopping"].includes(id));
  const location = needsLocation ? await resolveSearchLocation({ plan, state }) : null;

  const anchors = {};
  if (location && requested.has("nightlife")) {
    const nightlifePlaces = await getNearbyPlaces({
      location,
      radiusKm: plan?.location?.radiusKm ?? 4,
      type: "night_club",
      limit: 4,
    });
    anchors.nightlife = buildAnchorFromPlaces(nightlifePlaces);
  }
  if (location && requested.has("shopping")) {
    const shoppingPlaces = await getNearbyPlaces({
      location,
      radiusKm: plan?.location?.radiusKm ?? 4,
      type: "shopping_mall",
      limit: 4,
    });
    anchors.shopping = buildAnchorFromPlaces(shoppingPlaces);
  }

  const usedIds = new Set();
  const carousels = [];

  const baseBuilders = {
    budget: () =>
      buildCarousel({
        id: "budget",
        title: "Best Prices",
        reason: "Lowest nightly rates for your dates.",
        items: normalizedItems,
        scoreFn: (entry) => entry.price,
        sort: "asc",
        minItems: 1,
        maxItems,
        usedIds,
      }),
    premium: () =>
      buildCarousel({
        id: "premium",
        title: "Premium Picks",
        reason: "Higher-end stays with strong ratings.",
        items: normalizedItems,
        scoreFn: (entry) =>
          (entry.price ?? 0) * 100 + (entry.rating ?? 0) * 10 + (entry.isPreferred ? 50 : 0),
        sort: "desc",
        minItems: 1,
        maxItems,
        usedIds,
      }),
    topRated: () =>
      buildCarousel({
        id: "topRated",
        title: "Top Rated",
        reason: "Stays guests rate the highest.",
        items: normalizedItems,
        scoreFn: (entry) =>
          entry.rating != null ? entry.rating * 100 + (entry.reviewCount ?? 0) : null,
        sort: "desc",
        minItems: 1,
        maxItems,
        usedIds,
      }),
  };

  const baseOrder = signals.premium && !signals.budget
    ? ["premium", "topRated", "budget"]
    : signals.budget && !signals.premium
      ? ["budget", "topRated", "premium"]
      : ["budget", "premium", "topRated"];

  baseOrder.forEach((id) => {
    const builder = baseBuilders[id];
    if (!builder) return;
    const carousel = builder();
    if (carousel) carousels.push(carousel);
  });

  const optionalBuilders = {
    central: () => {
      if (!location) return null;
      return buildCarousel({
        id: "central",
        title: "Near the Center",
        reason: "Closest to the city center.",
        items: normalizedItems,
        scoreFn: (entry) => (entry.coords ? computeDistanceKm(entry.coords, location) : null),
        sort: "asc",
        minItems: 2,
        maxItems,
        usedIds,
      });
    },
    nightlife: () => {
      const anchor = anchors.nightlife;
      if (!anchor?.location) return null;
      const label = anchor.name ? `Close to nightlife near ${anchor.name}.` : "Close to nightlife hotspots.";
      return buildCarousel({
        id: "nightlife",
        title: "Nightlife Ready",
        reason: label,
        items: normalizedItems,
        scoreFn: (entry) => (entry.coords ? computeDistanceKm(entry.coords, anchor.location) : null),
        sort: "asc",
        minItems: 2,
        maxItems,
        usedIds,
      });
    },
    shopping: () => {
      const anchor = anchors.shopping;
      if (!anchor?.location) return null;
      const label = anchor.name ? `Steps from shopping near ${anchor.name}.` : "Easy access to shopping.";
      return buildCarousel({
        id: "shopping",
        title: "Shopping Friendly",
        reason: label,
        items: normalizedItems,
        scoreFn: (entry) => (entry.coords ? computeDistanceKm(entry.coords, anchor.location) : null),
        sort: "asc",
        minItems: 2,
        maxItems,
        usedIds,
      });
    },
    family: () =>
      buildCarousel({
        id: "family",
        title: "Great for Families",
        reason: "Space and comfort for groups.",
        items: normalizedItems,
        scoreFn: (entry) => {
          if ((entry.maxGuests ?? 0) >= 4) return entry.maxGuests ?? 4;
          if ((entry.bedrooms ?? 0) >= 2) return entry.bedrooms ?? 2;
          return null;
        },
        sort: "desc",
        minItems: 2,
        maxItems,
        usedIds,
      }),
    business: () =>
      buildCarousel({
        id: "business",
        title: "Business Ready",
        reason: "Work-friendly amenities.",
        items: normalizedItems,
        scoreFn: (entry) => {
          const score = scoreByKeywords(entry.keywordBlob, [
            "business",
            "workspace",
            "desk",
            "wifi",
            "meeting",
            "conference",
          ]);
          return score > 0 ? score : null;
        },
        sort: "desc",
        minItems: 2,
        maxItems,
        usedIds,
      }),
  };

  for (const id of prioritizedOptional) {
    if (carousels.length >= maxCarousels) break;
    const builder = optionalBuilders[id];
    if (!builder) continue;
    const carousel = builder();
    if (carousel) carousels.push(carousel);
  }

  return carousels.slice(0, maxCarousels);
};
