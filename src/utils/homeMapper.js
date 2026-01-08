export const getCoverImage = (home) => {
  const media = Array.isArray(home?.media) ? home.media : [];
  const cover =
    media.find((item) => item?.is_cover) ??
    media.find((item) => Number(item?.order) === 0) ??
    media[0];
  return cover?.url ?? null;
};

const buildSummaryLine = (home) => {
  const parts = [];
  const guests = Number(home?.max_guests);
  const bedrooms = Number(home?.bedrooms);
  const beds = Number(home?.beds);
  const bathrooms = Number(home?.bathrooms);
  if (Number.isFinite(guests) && guests > 0) {
    parts.push(`${guests} guest${guests === 1 ? "" : "s"}`);
  }
  if (Number.isFinite(bedrooms) && bedrooms > 0) {
    parts.push(`${bedrooms} bedroom${bedrooms === 1 ? "" : "s"}`);
  }
  if (Number.isFinite(beds) && beds > 0) {
    parts.push(`${beds} bed${beds === 1 ? "" : "s"}`);
  }
  if (Number.isFinite(bathrooms) && bathrooms > 0) {
    parts.push(`${bathrooms} bath${bathrooms === 1 ? "" : "s"}`);
  }
  return parts.join(" | ");
};

export const mapHomeToCard = (home) => {
  if (!home) return null;
  const address = home.address ?? {};
  const pricing = home.pricing ?? {};
  const photos = Array.isArray(home.media)
    ? home.media.map((item) => item?.url).filter(Boolean)
    : [];
  const latitude = Number(address.latitude ?? address.lat);
  const longitude = Number(address.longitude ?? address.lng);

  const locationParts = [
    address.address_line1,
    address.city,
    address.state,
    address.country,
  ]
    .map((part) => (part ? String(part).trim() : null))
    .filter(Boolean);

  const marketingTags = Array.isArray(home.marketing_tags)
    ? home.marketing_tags
    : [];

  const hostProfileMeta = home.host?.hostProfile?.metadata ?? {};
  const hostUser = home.host
    ? {
      id: home.host.id,
      name: home.host.name,
      email: home.host.email,
      avatarUrl: home.host.avatar_url,
      responseRate: home.host.response_rate ?? null,
      responseTime: home.host.response_time ?? null,
      isSuperhost: Boolean(
        hostProfileMeta.is_superhost ?? hostProfileMeta.superhost ?? false
      ),
    }
    : null;

  return {
    id: home.id,
    hostId: hostUser?.id ?? home.host_id ?? null,
    title: home.title ?? "Untitled stay",
    locationText: locationParts.join(", "),
    city: address.city ?? null,
    state: address.state ?? null,
    country: address.country ?? null,
    spaceType: home.space_type ?? home.spaceType ?? null,
    pricePerNight:
      pricing?.base_price != null ? Number(pricing.base_price) * 1.1 : null,
    currency: pricing?.currency ?? "USD",
    summaryLine: buildSummaryLine(home),
    maxGuests: home.max_guests ?? null,
    bedrooms: home.bedrooms ?? null,
    beds: home.beds ?? null,
    bathrooms:
      home.bathrooms != null ? Number(home.bathrooms) : null,
    coverImage: getCoverImage(home),
    photos,
    badge:
      marketingTags.find((tag) =>
        typeof tag === "string" ? tag.length : false
      ) ?? null,
    marketingTags,
    ratingValue: null,
    reviewCount: null,
    hostId: hostUser?.id ?? home.host_id ?? null,
    host: hostUser,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    locationLat: Number.isFinite(latitude) ? latitude : null,
    locationLng: Number.isFinite(longitude) ? longitude : null,
  };
};
