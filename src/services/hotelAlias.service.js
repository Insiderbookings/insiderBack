// src/services/hotelAlias.service.js
import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";

const AUTO_THRESHOLD = Number(process.env.HOTEL_ALIAS_AUTO_THRESHOLD || 0.85);
const REVIEW_THRESHOLD = Number(process.env.HOTEL_ALIAS_REVIEW_THRESHOLD || 0.7);
const MAX_GEO_DISTANCE_KM = Number(process.env.HOTEL_ALIAS_MAX_DISTANCE_KM || 15);

const DIALECT = sequelize?.getDialect?.() || "postgres";
const LIKE_OPERATOR = DIALECT === "postgres" ? Op.iLike : Op.like;

const EARTH_RADIUS_KM = 6371;

const normalizeString = (value) => {
  if (!value) return "";
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
};

const levenshtein = (a, b) => {
  if (a === b) return 0;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  const matrix = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));
  for (let i = 0; i <= lenA; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= lenB; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= lenA; i += 1) {
    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[lenA][lenB];
};

const stringSimilarity = (a, b) => {
  const normA = normalizeString(a);
  const normB = normalizeString(b);
  if (!normA && !normB) return 1;
  if (!normA || !normB) return 0;
  const distance = levenshtein(normA, normB);
  const maxLen = Math.max(normA.length, normB.length, 1);
  return Math.max(0, 1 - distance / maxLen);
};

const toNumberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const pLat1 = toNumberOrNull(lat1);
  const pLat2 = toNumberOrNull(lat2);
  const pLng1 = toNumberOrNull(lng1);
  const pLng2 = toNumberOrNull(lng2);
  if (pLat1 == null || pLat2 == null || pLng1 == null || pLng2 == null) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(pLat2 - pLat1);
  const dLng = toRad(pLng2 - pLng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(pLat1)) * Math.cos(toRad(pLat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

const geoScore = (candidate, base) => {
  const distance = haversineDistance(base.lat, base.lng, candidate.lat, candidate.lng);
  if (distance == null) return null;
  if (distance >= MAX_GEO_DISTANCE_KM) return 0;
  return Math.max(0, 1 - distance / MAX_GEO_DISTANCE_KM);
};

const cityScore = (candidateCity, baseCity) => {
  if (!candidateCity || !baseCity) return null;
  const normCandidate = normalizeString(candidateCity);
  const normBase = normalizeString(baseCity);
  if (!normCandidate || !normBase) return null;
  if (normCandidate === normBase) return 1;
  return stringSimilarity(normCandidate, normBase);
};

const computeCompositeScore = (components) => {
  const valid = components.filter((comp) => comp.score != null);
  if (!valid.length) return 0;
  const totalWeight = valid.reduce((sum, comp) => sum + comp.weight, 0);
  if (!totalWeight) return 0;
  const totalScore = valid.reduce((sum, comp) => sum + comp.score * comp.weight, 0);
  return totalScore / totalWeight;
};

const fetchAlias = async (provider, providerHotelId) =>
  models.HotelAlias.findOne({
    where: { provider, provider_hotel_id: String(providerHotelId) },
    include: [{ model: models.Hotel, as: "hotel", attributes: ["id", "name", "city", "country", "lat", "lng"] }],
  });

const upsertAlias = async (payload) => {
  const { provider, provider_hotel_id: providerHotelId } = payload;
  let alias = await fetchAlias(provider, providerHotelId);
  if (alias) {
    await alias.update(payload);
  } else {
    alias = await models.HotelAlias.create(payload);
  }
  return alias;
};

const formatAliasResult = (aliasInstance, status, extras = {}) => {
  if (!aliasInstance) {
    return { status: "unmatched", confidence: null, hotelId: null, aliasId: null, needsReview: false, ...extras };
  }
  const alias = aliasInstance.get({ plain: true });
  return {
    status,
    aliasId: alias.id,
    hotelId: alias.hotel_id,
    confidence: alias.confidence != null ? Number(alias.confidence) : null,
    needsReview: alias.needs_review,
    matchedAt: alias.matched_at,
    metadata: alias.metadata || {},
    matchedHotel: alias.hotel || null,
    ...extras,
  };
};

const buildHotelWhere = (hotel) => {
  const where = {};
  const lat = toNumberOrNull(hotel.lat);
  const lng = toNumberOrNull(hotel.lng);
  if (lat != null && lng != null) {
    const delta = MAX_GEO_DISTANCE_KM / 110; // rough degrees approximation
    where.lat = { [Op.between]: [lat - delta, lat + delta] };
    where.lng = { [Op.between]: [lng - delta, lng + delta] };
    return where;
  }
  if (hotel.country) {
    where.country = { [LIKE_OPERATOR]: hotel.country };
  }
  if (hotel.city) {
    where.city = { [LIKE_OPERATOR]: hotel.city };
  }
  return where;
};

const findCandidateHotels = async (hotel) => {
  const where = buildHotelWhere(hotel);
  const candidates = await models.Hotel.findAll({
    where,
    limit: 50,
    attributes: ["id", "name", "city", "country", "address", "lat", "lng"],
  });

  if (candidates.length || !hotel.country) return candidates;

  // fallback: only by country to widen search
  return models.Hotel.findAll({
    where: { country: { [LIKE_OPERATOR]: hotel.country } },
    limit: 50,
    attributes: ["id", "name", "city", "country", "address", "lat", "lng"],
  });
};

const evaluateCandidate = (candidate, hotel) => {
  const scores = [
    { weight: 0.6, score: stringSimilarity(hotel.name, candidate.name) },
    { weight: 0.25, score: geoScore(candidate, hotel) },
    { weight: 0.15, score: cityScore(candidate.city, hotel.city) },
  ];
  const composite = computeCompositeScore(scores);
  return { composite, candidate };
};

const matchProviderHotel = async (provider, hotel) => {
  const providerHotelId = String(hotel.providerHotelId);
  const existing = await fetchAlias(provider, providerHotelId);
  if (existing) {
    const status = existing.needs_review ? "pending_review" : "linked";
    return formatAliasResult(existing, status, { providerHotelId });
  }

  const candidates = await findCandidateHotels(hotel);
  if (!candidates.length) {
    return {
      status: "unmatched",
      confidence: 0,
      hotelId: null,
      aliasId: null,
      needsReview: false,
      providerHotelId,
    };
  }

  let best = { composite: 0, candidate: null };
  for (const candidate of candidates) {
    const evaluated = evaluateCandidate(candidate, hotel);
    if (evaluated.composite > best.composite) {
      best = evaluated;
    }
  }

  const confidence = Number(best.composite.toFixed(4));
  if (!best.candidate) {
    return { status: "unmatched", confidence, hotelId: null, aliasId: null, needsReview: false, providerHotelId };
  }

  if (confidence < REVIEW_THRESHOLD) {
    return {
      status: "unmatched",
      confidence,
      hotelId: null,
      aliasId: null,
      needsReview: false,
      providerHotelId,
      suggestedHotel: {
        id: best.candidate.id,
        name: best.candidate.name,
        city: best.candidate.city,
        country: best.candidate.country,
        confidence,
      },
    };
  }

  const alias = await upsertAlias({
    provider,
    provider_hotel_id: providerHotelId,
    hotel_id: best.candidate.id,
    confidence,
    needs_review: confidence < AUTO_THRESHOLD,
    matched_at: new Date(),
    metadata: {
      sourceName: hotel.name,
      sourceCity: hotel.city,
      sourceCountry: hotel.country,
      sourceAddress: hotel.address,
      sourceLat: hotel.lat,
      sourceLng: hotel.lng,
      normalizedName: normalizeString(hotel.name),
    },
  });

  const status = confidence >= AUTO_THRESHOLD ? "linked" : "pending_review";
  return formatAliasResult(alias, status, {
    providerHotelId,
    suggestedHotel:
      status === "pending_review"
        ? {
            id: best.candidate.id,
            name: best.candidate.name,
            city: best.candidate.city,
            country: best.candidate.country,
            confidence,
          }
        : null,
  });
};

export const ensureHotelAliases = async (provider, hotels = []) => {
  if (!Array.isArray(hotels) || !hotels.length) return new Map();
  const providerIds = hotels
    .map((hotel) => hotel?.providerHotelId)
    .filter((id) => id != null)
    .map((id) => String(id));

  if (!providerIds.length) return new Map();

  const existingAliases = await models.HotelAlias.findAll({
    where: { provider, provider_hotel_id: { [Op.in]: providerIds } },
    include: [{ model: models.Hotel, as: "hotel", attributes: ["id", "name", "city", "country", "lat", "lng"] }],
  });

  const resultMap = new Map();

  for (const alias of existingAliases) {
    const formatted = formatAliasResult(
      alias,
      alias.needs_review ? "pending_review" : "linked",
      { providerHotelId: alias.provider_hotel_id },
    );
    resultMap.set(alias.provider_hotel_id, formatted);
  }

  const missing = hotels.filter(
    (hotel) => !resultMap.has(String(hotel.providerHotelId)),
  );

  for (const hotel of missing) {
    try {
      const match = await matchProviderHotel(provider, hotel);
      resultMap.set(String(hotel.providerHotelId), match);
    } catch (err) {
      console.error("[hotelAlias] match error:", {
        provider,
        providerHotelId: hotel.providerHotelId,
        error: err?.message || err,
      });
      resultMap.set(String(hotel.providerHotelId), {
        status: "error",
        hotelId: null,
        aliasId: null,
        needsReview: false,
        confidence: null,
        providerHotelId: String(hotel.providerHotelId),
        error: err?.message || "Matching failed",
      });
    }
  }

  return resultMap;
};
