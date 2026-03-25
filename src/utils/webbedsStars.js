export const WEBBEDS_CLASSIFICATION_CODE_TO_STARS = Object.freeze({
  559: 1,
  560: 2,
  561: 3,
  562: 4,
  563: 5,
});

const toFiniteNumberOrNull = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const resolveWebbedsStarValue = (rawValue) => {
  if (rawValue == null) return null;

  const numeric = toFiniteNumberOrNull(rawValue);
  if (numeric != null) {
    if (WEBBEDS_CLASSIFICATION_CODE_TO_STARS[numeric] != null) {
      return WEBBEDS_CLASSIFICATION_CODE_TO_STARS[numeric];
    }
    if (numeric >= 1 && numeric <= 5) {
      return numeric;
    }
    return null;
  }

  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  const starsFromAsterisks = (trimmed.match(/\*/g) || []).length;
  if (starsFromAsterisks >= 1 && starsFromAsterisks <= 5) {
    return starsFromAsterisks;
  }

  const explicitStarMatch = trimmed.match(
    /\b([1-5])(?:\s*(?:star|stars|estrella|estrellas))\b/i,
  );
  if (explicitStarMatch) {
    return Number(explicitStarMatch[1]);
  }

  return null;
};

export const resolveWebbedsHotelStars = (hotel) => {
  if (!hotel || typeof hotel !== "object") return null;

  const candidates = [
    hotel?.stars,
    hotel?.classification?.code,
    hotel?.classification_code,
    hotel?.rating,
    hotel?.hotelDetails?.rating,
    hotel?.hotelDetails?.classification?.code,
    hotel?.hotelPayload?.stars,
    hotel?.hotelPayload?.classification?.code,
    hotel?.hotelPayload?.classification_code,
    hotel?.hotelPayload?.rating,
    hotel?.hotelPayload?.hotelDetails?.rating,
    hotel?.hotelPayload?.hotelDetails?.classification?.code,
  ];

  for (const candidate of candidates) {
    const resolved = resolveWebbedsStarValue(candidate);
    if (resolved != null) return resolved;
  }

  return null;
};

export const resolveWebbedsClassificationLabel = (hotel) => {
  if (!hotel || typeof hotel !== "object") return null;

  const labelCandidates = [
    hotel?.classification?.name,
    hotel?.classificationLabel,
    hotel?.classification_label,
    hotel?.classification_name,
    hotel?.hotelPayload?.classification?.name,
    hotel?.hotelPayload?.classificationLabel,
    hotel?.hotelPayload?.classification_label,
    hotel?.hotelPayload?.classification_name,
    hotel?.hotelDetails?.classification?.name,
    hotel?.hotelPayload?.hotelDetails?.classification?.name,
  ];

  for (const candidate of labelCandidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }

  if (typeof hotel?.stars === "string") {
    const trimmed = hotel.stars.trim();
    if (trimmed && toFiniteNumberOrNull(trimmed) == null) {
      return trimmed;
    }
  }

  return null;
};
