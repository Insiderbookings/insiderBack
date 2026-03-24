import models from "../../models/index.js";

const FEATURE_CATALOG = [
  {
    id: "pool",
    labels: { es: "pileta", en: "pool" },
    detect: /\b(pileta|piscina|pool|swimming pool|swimming)\b/i,
    match: [
      /\b(pileta|piscina|pool|swimming pool|swimming)\b/i,
      /\b(outdoor pool|indoor pool|rooftop pool|heated pool)\b/i,
    ],
  },
  {
    id: "spa",
    labels: { es: "spa", en: "spa" },
    detect: /\b(spa|wellness|masaje|massage)\b/i,
    match: [/\b(spa|wellness|masaje|massage)\b/i],
  },
  {
    id: "gym",
    labels: { es: "gimnasio", en: "gym" },
    detect: /\b(gimnasio|gym|gymnasium|fitness|fitness center)\b/i,
    match: [/\b(gimnasio|gym|gymnasium|fitness|fitness center)\b/i],
  },
  {
    id: "wifi",
    labels: { es: "wifi", en: "wifi" },
    detect: /\b(wifi|wi-fi|internet)\b/i,
    match: [/\b(wifi|wi-fi|wireless|internet)\b/i],
  },
  {
    id: "parking",
    labels: { es: "estacionamiento", en: "parking" },
    detect: /\b(estacionamiento|parking|garage|cochera|car park)\b/i,
    match: [/\b(estacionamiento|parking|garage|cochera|car park)\b/i],
  },
  {
    id: "breakfast",
    labels: { es: "desayuno", en: "breakfast" },
    detect: /\b(desayuno|breakfast)\b/i,
    match: [/\b(desayuno|breakfast)\b/i],
  },
  {
    id: "beach",
    labels: { es: "acceso a playa", en: "beach access" },
    detect: /\b(playa|beach)\b/i,
    match: [/\b(playa|beach|private beach)\b/i],
  },
  {
    id: "airportShuttle",
    labels: { es: "traslado al aeropuerto", en: "airport shuttle" },
    detect: /\b(traslado|transfer|airport shuttle|airport transfer|shuttle)\b/i,
    match: [/\b(traslado|transfer|airport shuttle|airport transfer|shuttle)\b/i],
  },
  {
    id: "pets",
    labels: { es: "admite mascotas", en: "pet friendly" },
    detect: /\b(mascota|mascotas|pet|pets|pet friendly)\b/i,
    match: [/\b(mascota|mascotas|pet|pets|pet friendly)\b/i],
  },
  {
    id: "babysitting",
    labels: { es: "servicio de ninera", en: "babysitting" },
    detect: /\b(ninera|niñera|nanny|babysitter|babysitting)\b/i,
    match: [/\b(ninera|niñera|nanny|babysitter|babysitting|baby sitting)\b/i],
  },
  {
    id: "childcare",
    labels: { es: "childcare", en: "childcare" },
    detect: /\b(childcare|child care)\b/i,
    match: [/\b(childcare|child care)\b/i],
  },
  {
    id: "kidsClub",
    labels: { es: "kids club", en: "kids club" },
    detect: /\b(kids club|children's club|childrens club|nursery)\b/i,
    match: [/\b(kids club|children's club|childrens club|nursery)\b/i],
  },
];

const POSITION_CATALOG = [
  {
    id: "first",
    order: 1,
    detect: /\b(el primero|la primera|primero|primera|the first one|first one|the first|first)\b/i,
    labels: { es: "el primero", en: "the first one" },
  },
  {
    id: "second",
    order: 2,
    detect: /\b(el segundo|la segunda|segundo|segunda|the second one|second one|the second|second)\b/i,
    labels: { es: "el segundo", en: "the second one" },
  },
  {
    id: "third",
    order: 3,
    detect: /\b(el tercero|la tercera|tercero|tercera|the third one|third one|the third|third)\b/i,
    labels: { es: "el tercero", en: "the third one" },
  },
  {
    id: "last",
    order: -1,
    detect: /\b(el ultimo|el último|la ultima|la última|ultimo|último|the last one|last one|the last|last)\b/i,
    labels: { es: "el ultimo", en: "the last one" },
  },
];

const FAMILY_SIGNAL_CATALOG = [
  {
    id: "childcare",
    pattern: /\b(ninera|niñera|nanny|babysitter|babysitting|childcare|child care)\b/i,
    labels: { es: "servicio de cuidado infantil", en: "childcare services" },
  },
  {
    id: "kidsClub",
    pattern: /\b(kids club|children's club|childrens club|nursery)\b/i,
    labels: { es: "kids club", en: "kids club" },
  },
  {
    id: "familyRoom",
    pattern: /\b(family room|family suite|connecting rooms|interconnecting rooms|habitacion familiar|habitación familiar)\b/i,
    labels: { es: "habitaciones familiares", en: "family rooms" },
  },
  {
    id: "crib",
    pattern: /\b(crib|cot|baby cot|cuna|cunita)\b/i,
    labels: { es: "cuna o crib", en: "crib or baby cot" },
  },
  {
    id: "playArea",
    pattern: /\b(playground|play area|game room|arcade|playroom|kids pool|children's pool|childrens pool)\b/i,
    labels: { es: "espacios para chicos", en: "kids facilities" },
  },
];

const CHEAPEST_QUERY_PATTERN =
  /\b(mas barato|más barato|mas economico|más económico|mas economica|más económica|cheapest|lowest price|least expensive|best price)\b/i;
const MOST_EXPENSIVE_QUERY_PATTERN =
  /\b(mas caro|más caro|most expensive|highest price|priciest)\b/i;
const PRICE_INFO_QUERY_PATTERN =
  /\b(cuanto sale|cuánto sale|precio|tarifa|rate|price|how much)\b/i;
const MULTIPLE_SELECTION_PATTERN =
  /\b(cuales|cuáles|which ones|which of|what are|show me|list|lista|mostrame|muestrame)\b/i;
const RECOMMENDATION_QUERY_PATTERN =
  /\b(recomendame|recomiendame|recomendaciones?|recommend(?: me|ations?)?|what do you recommend|which one would you pick|what would you pick|cu[aá]l me recomiendas|qu[eé] me recomiendas|cu[aá]l elegir[ií]as|best option|me conviene)\b/i;

const FAMILY_QUERY_PATTERNS = [
  /\b(mejor(?:es)?\s+para\s+(?:chicos|ninos|niños|bebes|bebés|familia|family|kids|children))\b/i,
  /\b(para\s+ir\s+con\s+(?:chicos|ninos|niños|bebes|bebés)|for\s+(?:kids|children|families))\b/i,
  /\b(family-friendly|kid-friendly|child-friendly|family stay|family hotel)\b/i,
];

const isSpanish = (text = "") =>
  /\b(quiero|cuales|cuáles|tienen|tiene|de los|de las|hoteles|mencionaste|pileta|piscina|ninera|niñera|mas barato|más barato|familia|chicos)\b/i.test(
    String(text || "")
  );

const normalizeString = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeDisplayCurrencyCode = (value) => {
  const raw = String(value || "USD").trim().toUpperCase();
  if (!raw) return "USD";
  if (/^\d+$/.test(raw)) {
    if (raw === "520" || raw === "840") return "USD";
    if (raw === "978") return "EUR";
    if (raw === "826") return "GBP";
    if (raw === "124") return "CAD";
    if (raw === "036" || raw === "36") return "AUD";
    return "USD";
  }
  return raw.slice(0, 3) || "USD";
};

const toNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const tryParseJson = (value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!["[", "{", "\""].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return value;
  }
};

const normalizeTextList = (value) => {
  if (value == null) return [];
  const parsed = tryParseJson(value);
  if (Array.isArray(parsed)) {
    return parsed
      .flatMap((item) => normalizeTextList(item))
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }
  if (typeof parsed === "object") {
    return Object.values(parsed)
      .flatMap((item) => normalizeTextList(item))
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }
  const text = normalizeString(parsed);
  return text ? [text] : [];
};

const unique = (values = []) => Array.from(new Set(values.filter(Boolean)));

const joinHumanList = (values = [], language = "es", conjunction = "and") => {
  const cleaned = values.filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) {
    const joiner = conjunction === "or"
      ? language === "es" ? " o " : " or "
      : language === "es" ? " y " : " and ";
    return `${cleaned[0]}${joiner}${cleaned[1]}`;
  }
  const lastJoiner = conjunction === "or"
    ? language === "es" ? " o " : " or "
    : language === "es" ? " y " : " and ";
  return `${cleaned.slice(0, -1).join(", ")}${lastJoiner}${cleaned[cleaned.length - 1]}`;
};

const collectItemFacts = (item = {}) =>
  unique([
    ...normalizeTextList(item.amenities),
    ...normalizeTextList(item.leisure),
    ...normalizeTextList(item.business),
    ...normalizeTextList(item.descriptions),
    ...normalizeTextList(item.shortReason),
    ...normalizeTextList(item.matchReasons),
    ...normalizeTextList(
      Array.isArray(item.semanticEvidence)
        ? item.semanticEvidence.map((entry) => entry?.value || entry?.label || null)
        : [],
    ),
    ...normalizeTextList(item.matchedPlaceTarget?.normalizedName),
    ...normalizeTextList(item.matchedPlaceTarget?.rawText),
    ...normalizeTextList(
      Number.isFinite(Number(item.distanceMeters))
        ? [`${Math.round(Number(item.distanceMeters))} meters`]
        : [],
    ),
  ]);

const buildItemFactBlob = (item = {}) =>
  collectItemFacts(item)
    .join(" | ")
    .toLowerCase();

const detectFeatures = (message = "") =>
  FEATURE_CATALOG.filter((feature) => feature.detect.test(String(message || "")));

const detectFeatureMode = (message = "", features = []) => {
  if (features.length < 2) return "all";
  return /\b(o|or)\b/i.test(String(message || "")) ? "any" : "all";
};

const detectPriceQuery = (message = "") => {
  const text = String(message || "");
  if (CHEAPEST_QUERY_PATTERN.test(text)) return "cheapest";
  if (MOST_EXPENSIVE_QUERY_PATTERN.test(text)) return "mostExpensive";
  return null;
};

const detectFamilyQuery = (message = "") =>
  FAMILY_QUERY_PATTERNS.some((pattern) => pattern.test(String(message || "")));

const detectPositionReference = (message = "") =>
  POSITION_CATALOG.find((entry) => entry.detect.test(String(message || ""))) || null;

const detectMultipleSelection = (message = "") =>
  MULTIPLE_SELECTION_PATTERN.test(String(message || ""));

const detectPriceInfoQuery = (message = "") =>
  PRICE_INFO_QUERY_PATTERN.test(String(message || ""));

const detectRecommendationQuery = (message = "") =>
  RECOMMENDATION_QUERY_PATTERN.test(String(message || ""));

const buildFeatureLabelText = (features = [], language = "es", mode = "all") =>
  joinHumanList(
    features.map((feature) => feature.labels?.[language] || feature.labels?.en || feature.id),
    language,
    mode === "any" ? "or" : "and"
  );

const formatPriceLabel = (item = {}, language = "es") => {
  const amount = toNumberOrNull(item.pricePerNight);
  if (amount == null) return null;
  const currency = normalizeDisplayCurrencyCode(normalizeString(item.currency) || "USD");
  try {
    return new Intl.NumberFormat(language === "es" ? "es-AR" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch (_) {
    return `${currency} ${Math.round(amount)}`;
  }
};

const formatStayLabel = (item = {}, language = "es", options = {}) => {
  const showOrder = options.showOrder !== false;
  const name = item.name || item.title || "Stay";
  const prefix =
    showOrder && Number.isFinite(Number(item.displayOrder)) ? `#${Number(item.displayOrder)} ` : "";
  const city = item.city ? `, ${item.city}` : "";
  const starsText = normalizeString(item.stars);
  const stars = starsText ? `, ${starsText}` : "";
  return `${prefix}${name}${city}${stars}`;
};

const buildBulletLabel = (item = {}, language = "es", options = {}) => {
  const base = formatStayLabel(item, language, options);
  const price = formatPriceLabel(item, language);
  return price ? `${base} - ${price}` : base;
};

const normalizeFactItem = (item = {}, inventoryType = "HOTEL", fallbackOrder = null) => ({
  ...item,
  inventoryType,
  displayOrder: toNumberOrNull(item.displayOrder) ?? fallbackOrder,
  pricePerNight: toNumberOrNull(item.pricePerNight ?? item.price_per_night),
  currency: normalizeDisplayCurrencyCode(normalizeString(item.currency) || "USD"),
  amenities: unique(normalizeTextList(item.amenities)),
  leisure: unique(normalizeTextList(item.leisure)),
  business: unique(normalizeTextList(item.business)),
  descriptions: unique(normalizeTextList(item.descriptions)),
  shortReason: normalizeString(item.shortReason),
  matchReasons: unique(normalizeTextList(item.matchReasons)),
  semanticEvidence: Array.isArray(item.semanticEvidence)
    ? item.semanticEvidence
        .map((entry) =>
          entry && typeof entry === "object"
            ? {
                type: normalizeString(entry.type),
                label: normalizeString(entry.label),
                value: normalizeString(entry.value),
              }
            : null,
        )
        .filter(Boolean)
    : [],
});

const sortByDisplayOrder = (items = []) =>
  [...items].sort((left, right) => {
    const leftOrder = toNumberOrNull(left.displayOrder) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = toNumberOrNull(right.displayOrder) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left.name || left.title || "").localeCompare(String(right.name || right.title || ""));
  });

const enrichHotelsFromCatalog = async (hotels = []) => {
  const hotelIds = hotels.map((hotel) => String(hotel.id || "")).filter(Boolean);
  if (!hotelIds.length) return hotels;
  try {
    const rows = await models.WebbedsHotel.findAll({
      where: { hotel_id: hotelIds },
      attributes: ["hotel_id", "amenities", "leisure", "business", "descriptions"],
      raw: true,
    });
    const byId = new Map(rows.map((row) => [String(row.hotel_id), row]));
    return hotels.map((hotel) => {
      const row = byId.get(String(hotel.id || ""));
      if (!row) return hotel;
      return {
        ...hotel,
        amenities: unique([
          ...normalizeTextList(hotel.amenities),
          ...normalizeTextList(row.amenities),
          ...normalizeTextList(row.leisure),
          ...normalizeTextList(row.business),
        ]),
        leisure: unique([...normalizeTextList(hotel.leisure), ...normalizeTextList(row.leisure)]),
        business: unique([...normalizeTextList(hotel.business), ...normalizeTextList(row.business)]),
        descriptions: unique([...normalizeTextList(hotel.descriptions), ...normalizeTextList(row.descriptions)]),
      };
    });
  } catch (error) {
    console.warn("[ai.lastResultsFacts] enrichHotelsFromCatalog failed", error?.message || error);
    return hotels;
  }
};

const buildOrderedItems = async (summary = {}) => {
  const summaryHotels = Array.isArray(summary.hotels) ? summary.hotels : [];
  const summaryHomes = Array.isArray(summary.homes) ? summary.homes : [];
  const hotels = await enrichHotelsFromCatalog(summaryHotels);
  const normalizedHotels = hotels.map((hotel, index) =>
    normalizeFactItem(hotel, "HOTEL", index + 1)
  );
  const homeFallbackStart = normalizedHotels.length;
  const normalizedHomes = summaryHomes.map((home, index) =>
    normalizeFactItem(home, "HOME", homeFallbackStart + index + 1)
  );
  return sortByDisplayOrder([...normalizedHotels, ...normalizedHomes]);
};

const matchesFeatureSet = (item = {}, features = [], mode = "all") => {
  const blob = buildItemFactBlob(item);
  if (!features.length) return false;
  if (mode === "any") {
    return features.some((feature) => feature.match.some((pattern) => pattern.test(blob)));
  }
  return features.every((feature) => feature.match.some((pattern) => pattern.test(blob)));
};

const getComparablePricedItems = (items = []) => {
  const priced = items.filter((item) => toNumberOrNull(item.pricePerNight) != null);
  if (!priced.length) return [];
  const currencyCounts = new Map();
  priced.forEach((item) => {
    const currency = normalizeString(item.currency) || "USD";
    currencyCounts.set(currency, (currencyCounts.get(currency) || 0) + 1);
  });
  const dominantCurrency = [...currencyCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  return priced.filter((item) => (normalizeString(item.currency) || "USD") === dominantCurrency);
};

const collectFamilyReasons = (item = {}, language = "es") => {
  const blob = buildItemFactBlob(item);
  return FAMILY_SIGNAL_CATALOG.filter((signal) => signal.pattern.test(blob))
    .map((signal) => signal.labels?.[language] || signal.labels?.en || signal.id);
};

const selectPositionItem = (items = [], positionRef = null) => {
  if (!positionRef || !items.length) return null;
  const ordered = sortByDisplayOrder(items);
  if (positionRef.order === -1) return ordered[ordered.length - 1] || null;
  return ordered[positionRef.order - 1] || null;
};

const buildNoFeatureReply = ({ features, language = "es", mode = "all" }) => {
  const featureText = buildFeatureLabelText(features, language, mode);
  const combinedText =
    mode === "all" && features.length > 1
      ? language === "es"
        ? `${featureText} al mismo tiempo`
        : `${featureText} at the same time`
      : featureText;
  return language === "es"
    ? `De los resultados que te mostré, no lo veo confirmado para ${combinedText}. Si querés, puedo buscar nuevas opciones con eso.`
    : `From the results I showed you, I do not see ${combinedText} confirmed. If you want, I can run a fresh filtered search.`;
};

const buildFeatureReply = ({ items, features, language = "es", mode = "all" }) => {
  const matches = items.filter((item) => matchesFeatureSet(item, features, mode));
  if (!matches.length) {
    return buildNoFeatureReply({ features, language, mode });
  }
  const featureText = buildFeatureLabelText(features, language, mode);
  const intro =
    language === "es"
      ? matches.length === 1
        ? `Si. De los resultados que te mostre, este tiene ${featureText} confirmado:`
        : `Si. De los resultados que te mostre, estos ${matches.length} tienen ${featureText} confirmado:`
      : matches.length === 1
        ? `Yes. From the results I showed you, this one has confirmed ${featureText}:`
        : `Yes. From the results I showed you, these ${matches.length} have confirmed ${featureText}:`;
  const bullets = matches.map((item) => `- ${buildBulletLabel(item, language)}`);
  const outro =
    matches.length < items.length
      ? language === "es"
        ? "En el resto no lo tengo confirmado con la información guardada."
        : "For the rest, I do not have that confirmed in the saved information."
      : null;
  return [intro, ...bullets, outro].filter(Boolean).join("\n");
};

const buildPriceReply = ({
  items,
  language = "es",
  priceQuery = "cheapest",
  wantsMultiple = false,
}) => {
  const comparable = getComparablePricedItems(items);
  if (!comparable.length) {
    return language === "es"
      ? "No tengo precios comparables guardados para esos resultados. Si queres, puedo refrescar la busqueda para revisar tarifas."
      : "I do not have comparable saved prices for those results. If you want, I can refresh the search and check rates again.";
  }

  const sorted = [...comparable].sort((left, right) =>
    priceQuery === "mostExpensive"
      ? Number(right.pricePerNight) - Number(left.pricePerNight)
      : Number(left.pricePerNight) - Number(right.pricePerNight)
  );

  const selectionCount = wantsMultiple ? Math.min(3, sorted.length) : 1;
  const selected = sorted.slice(0, selectionCount);
  const intro =
    priceQuery === "mostExpensive"
      ? language === "es"
        ? wantsMultiple
          ? "De los que te mostre, estos son los mas caros con precio comparable:"
          : "De los que te mostre, el mas caro con precio comparable es:"
        : wantsMultiple
          ? "From the options I showed you, these are the most expensive with comparable pricing:"
          : "From the options I showed you, the most expensive one with comparable pricing is:"
      : language === "es"
        ? wantsMultiple
          ? "De los que te mostre, estos son los mas baratos con precio comparable:"
          : "De los que te mostre, el mas barato con precio comparable es:"
        : wantsMultiple
          ? "From the options I showed you, these are the cheapest with comparable pricing:"
          : "From the options I showed you, the cheapest one with comparable pricing is:";

  const bullets = selected.map((item) => `- ${buildBulletLabel(item, language)}`);
  const omittedCount = items.length - comparable.length;
  const outro =
    omittedCount > 0
      ? language === "es"
        ? "Algunos resultados no tenian un precio comparable guardado en esta busqueda."
        : "Some results did not have a comparable saved price in this search."
      : null;
  return [intro, ...bullets, outro].filter(Boolean).join("\n");
};

const buildFamilyReply = ({ items, language = "es", wantsMultiple = false }) => {
  const ranked = items
    .map((item) => ({
      item,
      reasons: unique(collectFamilyReasons(item, language)).slice(0, 3),
    }))
    .filter((entry) => entry.reasons.length > 0)
    .sort((left, right) => {
      if (right.reasons.length !== left.reasons.length) {
        return right.reasons.length - left.reasons.length;
      }
      return (toNumberOrNull(left.item.displayOrder) || 9999) - (toNumberOrNull(right.item.displayOrder) || 9999);
    });

  if (!ranked.length) {
    return language === "es"
      ? "De los resultados que te mostré, no veo señales familiares lo bastante claras. Si querés, puedo filtrarte opciones más orientadas a chicos."
      : "From the results I showed you, I do not see strong enough family-friendly signals. If you want, I can filter options that are more kid-oriented.";
  }

  const selected = ranked.slice(0, wantsMultiple ? Math.min(3, ranked.length) : 1);
  const intro =
    language === "es"
      ? wantsMultiple
        ? "De los que te mostré, estos son los que mejor perfil familiar tienen:"
        : "De los que te mostré, este es el que mejor pinta para ir con chicos:"
      : wantsMultiple
        ? "From the options I showed you, these look the most family-friendly:"
        : "From the options I showed you, this one looks the most family-friendly:";

  const bullets = selected.map(({ item, reasons }) =>
    `- ${buildBulletLabel(item, language)}${reasons.length ? ` (${joinHumanList(reasons, language)})` : ""}`
  );
  return [intro, ...bullets].filter(Boolean).join("\n");
};

const buildRecommendationReply = ({ items, language = "es", wantsMultiple = false }) => {
  const ordered = sortByDisplayOrder(items);
  if (!ordered.length) return null;

  const selected = ordered.slice(0, wantsMultiple ? Math.min(3, ordered.length) : 1);
  const intro =
    language === "es"
      ? wantsMultiple
        ? "Tomando como base los últimos resultados, estas serían mis primeras recomendaciones."
        : "Tomando como base los últimos resultados, esta sería mi primera recomendación."
      : wantsMultiple
        ? "Based on the latest results, these would be my top recommendations."
        : "Based on the latest results, this would be my top recommendation.";

  const bullets = selected.map((item) => {
    const reasons = unique([
      normalizeString(item.shortReason),
      ...pickTopReasonsForRecommendation(item, language),
    ]).slice(0, 2);
    const suffix = reasons.length ? ` (${joinHumanList(reasons, language)})` : "";
    return `- ${buildBulletLabel(item, language)}${suffix}`;
  });

  return [intro, ...bullets].filter(Boolean).join("\n");
};

const pickTopReasonsForRecommendation = (item = {}, language = "es") => {
  const reasons = [];
  if (normalizeString(item.stars)) {
    reasons.push(language === "es" ? `${item.stars} de categoría` : `${item.stars} category`);
  }
  if (normalizeString(item.city)) {
    reasons.push(language === "es" ? `bien ubicado en ${item.city}` : `well located in ${item.city}`);
  }
  if (toNumberOrNull(item.pricePerNight) != null) {
    reasons.push(language === "es" ? "precio visible" : "visible pricing");
  }
  return reasons;
};

const buildPositionFeatureReply = ({
  item,
  positionRef,
  features,
  language = "es",
  mode = "all",
}) => {
  if (!item) {
    return language === "es"
      ? "No pude identificar ese resultado dentro de los ultimos que te mostre."
      : "I could not identify that result among the latest options I showed you.";
  }

  const featureText = buildFeatureLabelText(features, language, mode);
  const hasFeature = matchesFeatureSet(item, features, mode);
  const label = positionRef.labels?.[language] || positionRef.labels?.en || "that one";
  const stayLabel = formatStayLabel(item, language, { showOrder: true });

  return hasFeature
    ? language === "es"
      ? `Sí. ${label} que te mostré fue ${stayLabel}, y ahí sí veo ${featureText} confirmado.`
      : `Yes. ${label} I showed you was ${stayLabel}, and I do see ${featureText} confirmed.`
    : language === "es"
      ? `No. ${label} que te mostré fue ${stayLabel}, y no veo ${featureText} confirmado.`
      : `No. ${label} I showed you was ${stayLabel}, and I do not see ${featureText} confirmed.`;
};

const buildPositionPriceReply = ({ item, positionRef, language = "es" }) => {
  if (!item) {
    return language === "es"
      ? "No pude identificar ese resultado dentro de los ultimos que te mostre."
      : "I could not identify that result among the latest options I showed you.";
  }
  const label = positionRef.labels?.[language] || positionRef.labels?.en || "that one";
  const stayLabel = formatStayLabel(item, language, { showOrder: true });
  const price = formatPriceLabel(item, language);
  if (!price) {
    return language === "es"
      ? `${label} que te mostre fue ${stayLabel}, pero no tengo un precio guardado para esa opcion en esta busqueda.`
      : `${label} I showed you was ${stayLabel}, but I do not have a saved price for that option in this search.`;
  }
  return language === "es"
    ? `${label} que te mostre fue ${stayLabel}, y lo tengo guardado en ${price}.`
    : `${label} I showed you was ${stayLabel}, and I have it saved at ${price}.`;
};

const buildPositionFamilyReply = ({ item, positionRef, language = "es" }) => {
  if (!item) {
    return language === "es"
      ? "No pude identificar ese resultado dentro de los ultimos que te mostre."
      : "I could not identify that result among the latest options I showed you.";
  }
  const label = positionRef.labels?.[language] || positionRef.labels?.en || "that one";
  const stayLabel = formatStayLabel(item, language, { showOrder: true });
  const reasons = collectFamilyReasons(item, language);
  if (!reasons.length) {
    return language === "es"
      ? `${label} que te mostré fue ${stayLabel}, pero no veo señales familiares claras confirmadas.`
      : `${label} I showed you was ${stayLabel}, but I do not see clear family-friendly signals confirmed.`;
  }
  return language === "es"
    ? `${label} que te mostre fue ${stayLabel}, y si tiene buenas senales para ir con chicos: ${joinHumanList(reasons, language)}.`
    : `${label} I showed you was ${stayLabel}, and it does show good family-friendly signals: ${joinHumanList(reasons, language)}.`;
};

const buildFactRow = (item = {}, language = "es", options = {}) => {
  const subtitleParts = [];
  if (item.city) subtitleParts.push(item.city);
  if (item.stars) subtitleParts.push(item.stars);
  if (options.subtitle) subtitleParts.push(options.subtitle);
  return {
    id: String(item.id || item.displayOrder || item.name || item.title || Math.random()),
    entityId: item.id != null ? String(item.id) : null,
    inventoryType: String(item.inventoryType || options.inventoryType || "HOTEL").toUpperCase(),
    title: formatStayLabel(item, language, { showOrder: false }),
    subtitle: subtitleParts.join(" · ") || null,
    value: options.value || formatPriceLabel(item, language),
    priceFrom: toNumberOrNull(item.pricePerNight ?? item.price_per_night),
    currency: item.currency || null,
    city: item.city || null,
    locationText: item.city || null,
    tags: Array.isArray(options.tags) ? options.tags.filter(Boolean).slice(0, 3) : [],
  };
};

const buildAdvisorTakeSection = ({
  eyebrow = null,
  title,
  body = null,
  tone = "neutral",
  tags = [],
} = {}) => ({
  type: "advisorTake",
  eyebrow,
  title,
  body,
  tone,
  tags: Array.isArray(tags) ? tags.filter(Boolean).slice(0, 4) : [],
});

const buildFactAnswerSection = ({
  eyebrow = null,
  title,
  body = null,
  tone = "neutral",
  layoutVariant = "facts",
  items = [],
  footer = null,
} = {}) => ({
  type: "factAnswer",
  eyebrow,
  title,
  body,
  tone,
  layoutVariant,
  items: Array.isArray(items) ? items.filter(Boolean).slice(0, 5) : [],
  footer,
});

const buildComparisonSection = ({
  eyebrow = null,
  title,
  body = null,
  tone = "neutral",
  layoutVariant = "comparison",
  items = [],
  footer = null,
} = {}) => ({
  type: "comparison",
  eyebrow,
  title,
  body,
  tone,
  layoutVariant,
  items: Array.isArray(items) ? items.filter(Boolean).slice(0, 5) : [],
  footer,
});

export const buildPreparedReplyFromLastResults = async ({
  summary,
  latestUserMessage,
  language = null,
} = {}) => {
  if (!summary || !latestUserMessage) return null;

  const targetLanguage = language || (isSpanish(latestUserMessage) ? "es" : "en");
  const items = await buildOrderedItems(summary);
  if (!items.length) return null;

  const features = detectFeatures(latestUserMessage);
  const featureMode = detectFeatureMode(latestUserMessage, features);
  const priceQuery = detectPriceQuery(latestUserMessage);
  const familyQuery = detectFamilyQuery(latestUserMessage);
  const positionRef = detectPositionReference(latestUserMessage);
  const wantsMultiple = detectMultipleSelection(latestUserMessage);
  const wantsPriceInfo = detectPriceInfoQuery(latestUserMessage);
  const recommendationQuery = detectRecommendationQuery(latestUserMessage);

  if (positionRef && features.length) {
    const selectedItem = selectPositionItem(items, positionRef);
    const featureText = buildFeatureLabelText(features, targetLanguage, featureMode);
    return {
      text: buildPositionFeatureReply({
        item: selectedItem,
        positionRef,
        features,
        language: targetLanguage,
        mode: featureMode,
      }),
      sections: selectedItem
        ? [
            buildAdvisorTakeSection({
              eyebrow: targetLanguage === "es" ? "Resultado puntual" : "Specific result",
              title: formatStayLabel(selectedItem, targetLanguage),
              body:
                targetLanguage === "es"
                  ? `Chequeo directo sobre ${positionRef.labels?.[targetLanguage] || "ese resultado"} para ${featureText}.`
                  : `Direct check on ${positionRef.labels?.[targetLanguage] || "that result"} for ${featureText}.`,
              tone: matchesFeatureSet(selectedItem, features, featureMode) ? "positive" : "neutral",
              tags: [featureText, formatPriceLabel(selectedItem, targetLanguage)],
            }),
          ]
        : [],
    };
  }

  if (positionRef && wantsPriceInfo) {
    const selectedItem = selectPositionItem(items, positionRef);
    return {
      text: buildPositionPriceReply({
        item: selectedItem,
        positionRef,
        language: targetLanguage,
      }),
      sections: selectedItem
        ? [
            buildComparisonSection({
              eyebrow: targetLanguage === "es" ? "Precio guardado" : "Saved price",
              title: formatStayLabel(selectedItem, targetLanguage),
              body:
                targetLanguage === "es"
                  ? `Dato guardado para ${positionRef.labels?.[targetLanguage] || "ese resultado"} dentro de los ultimos resultados que te mostre.`
                  : `Saved data for ${positionRef.labels?.[targetLanguage] || "that result"} from the latest options I showed you.`,
              tone: "neutral",
              layoutVariant: "spotlight",
              items: [buildFactRow(selectedItem, targetLanguage)],
            }),
          ]
        : [],
    };
  }

  if (positionRef && familyQuery) {
    const selectedItem = selectPositionItem(items, positionRef);
    const familyReasons = selectedItem ? collectFamilyReasons(selectedItem, targetLanguage) : [];
    return {
      text: buildPositionFamilyReply({
        item: selectedItem,
        positionRef,
        language: targetLanguage,
      }),
      sections: selectedItem
        ? [
            buildAdvisorTakeSection({
              eyebrow: targetLanguage === "es" ? "Lectura familiar" : "Family read",
              title: formatStayLabel(selectedItem, targetLanguage),
              body:
                familyReasons.length > 0
                  ? joinHumanList(familyReasons, targetLanguage)
                  : targetLanguage === "es"
                    ? "No veo señales familiares claras confirmadas."
                    : "I do not see clear family-friendly signals confirmed.",
              tone: familyReasons.length > 0 ? "positive" : "neutral",
              tags: familyReasons,
            }),
          ]
        : [],
    };
  }

  if (priceQuery) {
    const comparable = getComparablePricedItems(items);
    if (!comparable.length) {
      return {
        text: buildPriceReply({
          items,
          language: targetLanguage,
          priceQuery,
          wantsMultiple,
        }),
        sections: [
          buildAdvisorTakeSection({
            eyebrow: targetLanguage === "es" ? "Precio" : "Price",
            title:
              targetLanguage === "es"
                ? "No tengo comparables guardados"
                : "I do not have saved comparables",
            body:
              targetLanguage === "es"
                ? "No tengo suficientes precios comparables guardados para ordenar bien esos resultados."
                : "I do not have enough saved comparable prices to rank those results cleanly.",
            tone: "neutral",
          }),
        ],
      };
    }
    const sorted = [...comparable].sort((left, right) =>
      priceQuery === "mostExpensive"
        ? Number(right.pricePerNight) - Number(left.pricePerNight)
        : Number(left.pricePerNight) - Number(right.pricePerNight)
    );
    const selected = sorted.slice(0, wantsMultiple ? Math.min(3, sorted.length) : 1);
    return {
        text:
          targetLanguage === "es"
            ? priceQuery === "mostExpensive"
              ? wantsMultiple
                ? "Te marco los precios mas altos que tengo comparables entre los ultimos resultados."
                : "Te marco el precio mas alto que tengo comparable entre los ultimos resultados."
              : wantsMultiple
                ? "Te marco los precios mas bajos que tengo comparables entre los ultimos resultados."
                : "Te marco el precio mas bajo que tengo comparable entre los ultimos resultados."
            : priceQuery === "mostExpensive"
              ? wantsMultiple
                ? "Here are the highest comparable prices from the latest options I showed you."
                : "Here is the highest comparable price from the latest options I showed you."
              : wantsMultiple
                ? "Here are the lowest comparable prices from the latest options I showed you."
                : "Here is the lowest comparable price from the latest options I showed you.",
      sections: [
        buildComparisonSection({
          eyebrow:
            targetLanguage === "es"
              ? priceQuery === "mostExpensive" ? "Comparativa de precio" : "Comparativa de precio"
              : "Price comparison",
          title:
            targetLanguage === "es"
              ? priceQuery === "mostExpensive"
                ? wantsMultiple ? "Los mas caros guardados" : "El mas caro guardado"
                : wantsMultiple ? "Los mas baratos guardados" : "El mas barato guardado"
              : priceQuery === "mostExpensive"
                ? wantsMultiple ? "Most expensive saved options" : "Most expensive saved option"
                : wantsMultiple ? "Cheapest saved options" : "Cheapest saved option",
          body:
            targetLanguage === "es"
              ? "Comparacion hecha sobre los precios guardados de los ultimos resultados que te mostre."
              : "Comparison based on saved prices from the latest options I showed you.",
          tone: priceQuery === "mostExpensive" ? "neutral" : "positive",
          layoutVariant: "leaderboard",
          items: selected.map((item, index) =>
            buildFactRow(item, targetLanguage, {
              tags: [
                targetLanguage === "es"
                  ? index === 0
                    ? priceQuery === "mostExpensive" ? "tope de precio" : "mejor precio"
                    : "comparable"
                  : index === 0
                    ? priceQuery === "mostExpensive" ? "top price" : "best price"
                    : "comparable",
              ],
            })
          ),
          footer:
            comparable.length < items.length
              ? targetLanguage === "es"
                ? "Algunos resultados no tenian precio comparable guardado."
                : "Some results did not have saved comparable pricing."
              : null,
        }),
      ],
    };
  }

  if (features.length) {
    const matches = items.filter((item) => matchesFeatureSet(item, features, featureMode));
    const featureText = buildFeatureLabelText(features, targetLanguage, featureMode);
    if (!matches.length) {
      return {
        text: buildNoFeatureReply({
          features,
          language: targetLanguage,
          mode: featureMode,
        }),
        sections: [
          buildAdvisorTakeSection({
            eyebrow: targetLanguage === "es" ? "Dato confirmado" : "Confirmed detail",
            title:
              targetLanguage === "es"
                ? `Sin match confirmado para ${featureText}`
                : `No confirmed match for ${featureText}`,
            body:
              targetLanguage === "es"
                ? "No lo veo confirmado en los ultimos resultados que te mostre."
                : "I do not see it confirmed in the latest options I showed you.",
            tone: "neutral",
            tags: [featureText],
          }),
        ],
      };
    }
    return {
      text:
        targetLanguage === "es"
          ? matches.length === 1
            ? `Si. Te marco el match confirmado para ${featureText}.`
            : `Si. Te marco ${matches.length} matches confirmados para ${featureText}.`
          : matches.length === 1
            ? `Yes. I found one confirmed match for ${featureText}.`
            : `Yes. I found ${matches.length} confirmed matches for ${featureText}.`,
      sections: [
        buildFactAnswerSection({
          eyebrow: targetLanguage === "es" ? "Coincidencias" : "Matches",
          title:
            targetLanguage === "es"
              ? `${matches.length} con ${featureText}`
              : `${matches.length} with ${featureText}`,
          body:
            targetLanguage === "es"
              ? "Esto sale de la información guardada para los hoteles que te mostré."
              : "This comes from the saved information for the hotels I showed you.",
          tone: "positive",
          layoutVariant: "checklist",
          items: matches.map((item) =>
            buildFactRow(item, targetLanguage, {
              tags: [featureText],
            })
          ),
          footer:
            matches.length < items.length
              ? targetLanguage === "es"
                ? "En el resto no lo tengo confirmado en esta búsqueda guardada."
                : "For the rest, I do not have it confirmed in this saved search."
              : null,
        }),
      ],
    };
  }

  if (familyQuery) {
    const ranked = items
      .map((item) => ({
        item,
        reasons: unique(collectFamilyReasons(item, targetLanguage)).slice(0, 3),
      }))
      .filter((entry) => entry.reasons.length > 0)
      .sort((left, right) => {
        if (right.reasons.length !== left.reasons.length) {
          return right.reasons.length - left.reasons.length;
        }
        return (toNumberOrNull(left.item.displayOrder) || 9999) - (toNumberOrNull(right.item.displayOrder) || 9999);
      });

    if (!ranked.length) {
      return {
        text: buildFamilyReply({
          items,
          language: targetLanguage,
          wantsMultiple,
        }),
        sections: [
          buildAdvisorTakeSection({
            eyebrow: targetLanguage === "es" ? "Perfil familiar" : "Family profile",
            title:
              targetLanguage === "es"
                ? "No veo senales familiares fuertes"
                : "I do not see strong family signals",
            body:
              targetLanguage === "es"
                ? "No tengo señales suficientemente claras para ordenarlos bien pensando en chicos."
                : "I do not have clear enough signals to rank them well for kids.",
            tone: "neutral",
          }),
        ],
      };
    }
    const selected = ranked.slice(0, wantsMultiple ? Math.min(3, ranked.length) : 1);
    return {
      text:
        targetLanguage === "es"
          ? wantsMultiple
            ? "Te marco los que mejor perfil familiar muestran entre los ultimos resultados."
            : "Te marco el que mejor perfil familiar muestra entre los ultimos resultados."
          : wantsMultiple
            ? "Here are the options with the strongest family profile from the latest options I showed you."
            : "Here is the option with the strongest family profile from the latest options I showed you.",
      sections: [
        buildComparisonSection({
          eyebrow: targetLanguage === "es" ? "Lectura familiar" : "Family read",
          title:
            targetLanguage === "es"
              ? wantsMultiple ? "Los mas family-friendly" : "El mas family-friendly"
              : wantsMultiple ? "Most family-friendly" : "Most family-friendly option",
          body:
            targetLanguage === "es"
              ? "Ordenado según las señales familiares que tengo confirmadas."
              : "Ranked by the family-friendly signals I have confirmed.",
          tone: "positive",
          layoutVariant: "leaderboard",
          items: selected.map(({ item, reasons }) =>
            buildFactRow(item, targetLanguage, {
              tags: reasons,
            })
          ),
        }),
      ],
    };
  }

  if (recommendationQuery) {
    const selected = sortByDisplayOrder(items).slice(0, wantsMultiple ? Math.min(3, items.length) : 1);
    return {
      text: buildRecommendationReply({
        items,
        language: targetLanguage,
        wantsMultiple,
      }),
      sections: [
        buildComparisonSection({
          eyebrow: targetLanguage === "es" ? "Recomendación" : "Recommendation",
          title:
            targetLanguage === "es"
              ? wantsMultiple ? "Mis primeras opciones" : "Mi primera opción"
              : wantsMultiple ? "My top options" : "My top option",
          body:
            targetLanguage === "es"
              ? "Tomo como base el orden y las señales guardadas de la última búsqueda."
              : "This is based on the saved order and signals from the latest search.",
          tone: "positive",
          layoutVariant: wantsMultiple ? "leaderboard" : "spotlight",
          items: selected.map((item, index) =>
            buildFactRow(item, targetLanguage, {
              tags: [
                index === 0
                  ? targetLanguage === "es" ? "top pick" : "top pick"
                  : targetLanguage === "es" ? "recomendado" : "recommended",
              ],
            })
          ),
        }),
      ],
    };
  }

  return null;
};
