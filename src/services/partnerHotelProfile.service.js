import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
import { formatStaticHotel } from "../utils/webbedsMapper.js";
import { resolvePartnerProgramFromClaim } from "./partnerCatalog.service.js";
import {
  buildPublicPartnerInquiryPayload,
  getPartnerInquirySummaryForClaim,
  resolvePartnerInquiryStatus,
} from "./partnerInquiry.service.js";
import {
  buildPartnerHotelProfileAssociation,
  buildPartnerHotelProfileQueryOptions,
  filterPartnerHotelProfileWritePayload,
} from "./partnerHotelProfileSchema.service.js";
import cache from "./cache.js";
import { presignIfS3Url } from "../utils/s3Presign.js";

export const PARTNER_HOTEL_PROFILE_STATUS = Object.freeze({
  draft: "DRAFT",
  active: "ACTIVE",
  archived: "ARCHIVED",
});

export const PARTNER_HOTEL_PROFILE_IMAGE_SOURCE = Object.freeze({
  provider: "provider",
  partnerUpload: "partner_upload",
});

export const PARTNER_HOTEL_PROFILE_AMENITY_SOURCE = Object.freeze({
  provider: "provider",
  custom: "custom",
});

const MAX_PROFILE_GALLERY_ITEMS = 80;
const MAX_PROFILE_AMENITY_ITEMS = 240;
const PARTNER_HOTEL_PROFILE_CACHE_VERSION_KEY = "partners:hotel-profile:cache-version";
const PARTNER_HOTEL_PROFILE_CACHE_VERSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const hasOwn = (object, key) =>
  Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);

const normalizeCacheVersion = (value) => {
  if (value == null) return "0";
  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).trim();
    return normalized || "0";
  }
  if (typeof value === "object") {
    return normalizeCacheVersion(value?.value ?? value?.version ?? null);
  }
  return "0";
};

const bumpPartnerHotelProfileCacheVersion = async () => {
  const version = `${Date.now()}`;
  await cache.set(
    PARTNER_HOTEL_PROFILE_CACHE_VERSION_KEY,
    { value: version },
    PARTNER_HOTEL_PROFILE_CACHE_VERSION_TTL_SECONDS,
  );
  return version;
};

export const getPartnerHotelProfileCacheVersion = async () =>
  normalizeCacheVersion(await cache.get(PARTNER_HOTEL_PROFILE_CACHE_VERSION_KEY));

const toPlain = (value) => (value?.get ? value.get({ plain: true }) : value);

const normalizeTrimmedString = (value, maxLength = null) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (Number.isFinite(Number(maxLength)) && Number(maxLength) > 0) {
    return text.slice(0, Number(maxLength));
  }
  return text;
};

const normalizeMultilineText = (value) => {
  if (value == null) return null;
  const text = String(value).replace(/\r\n/g, "\n").trim();
  return text || null;
};

const normalizeEmail = (value) => {
  const normalized = normalizeTrimmedString(value, 150);
  return normalized ? normalized.toLowerCase() : null;
};

const normalizeUrl = (value) => normalizeTrimmedString(value, 255);

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeSortValue = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
};

const normalizeAmenityCategory = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["general", "amenity", "amenities", "amenitie", "amenitieitem"].includes(normalized)) {
    return "General";
  }
  if (["leisure", "leisureitem"].includes(normalized)) return "Leisure";
  if (["business", "businessitem"].includes(normalized)) return "Business";
  return normalizeTrimmedString(value, 32);
};

const buildClaimInclude = async ({ includeHotel = true, includeProfile = false } = {}) => {
  const include = [
    ...(includeHotel
      ? [
          {
            model: models.WebbedsHotel,
            as: "hotel",
            required: false,
          },
        ]
      : []),
  ];
  if (includeProfile) {
    include.push(
      await buildPartnerHotelProfileAssociation({
        includeCollections: true,
      }),
    );
  }
  return include;
};

const sortProfileImages = (items = []) =>
  [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const sortDiff = normalizeSortValue(left?.sort_order) - normalizeSortValue(right?.sort_order);
    if (sortDiff !== 0) return sortDiff;
    return Number(left?.id || 0) - Number(right?.id || 0);
  });

const sortProfileAmenities = (items = []) =>
  [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const highlightDiff = Number(Boolean(right?.is_highlighted)) - Number(Boolean(left?.is_highlighted));
    if (highlightDiff !== 0) return highlightDiff;
    const sortDiff = normalizeSortValue(left?.sort_order) - normalizeSortValue(right?.sort_order);
    if (sortDiff !== 0) return sortDiff;
    return String(left?.label || "").localeCompare(String(right?.label || ""));
  });

const canEditBasicProfile = (partnerProgram) =>
  Boolean(partnerProgram?.capabilities?.basicProfile);

const canUseFullProfileEditor = (partnerProgram) =>
  Boolean(partnerProgram?.capabilities?.fullProfileEditor);

const canUseResponseTimeBadge = (partnerProgram) =>
  Boolean(partnerProgram?.capabilities?.responseTimeBadge);

const canUseSpecialOffers = (partnerProgram) =>
  Boolean(partnerProgram?.capabilities?.specialOffers);

const canUseBookingInquiry = (partnerProgram) =>
  Boolean(partnerProgram?.capabilities?.bookingInquiry);

const shouldApplyPublicProfileOverrides = ({ partnerProgram, profile }) =>
  canEditBasicProfile(partnerProgram) &&
  profile &&
  String(profile.status || "").toUpperCase() !== PARTNER_HOTEL_PROFILE_STATUS.archived &&
  String(profile.status || "").toUpperCase() === PARTNER_HOTEL_PROFILE_STATUS.active;

const serializePartnerHotelProfile = (profile) => {
  if (!profile) return null;
  const plain = toPlain(profile);
  return {
    id: plain.id,
    hotelId: plain.hotel_id != null ? String(plain.hotel_id) : null,
    claimId: plain.claim_id ?? null,
    status: plain.status || PARTNER_HOTEL_PROFILE_STATUS.draft,
    updatedByUserId: plain.updated_by_user_id ?? null,
    headline: plain.headline || null,
    descriptionOverride: plain.description_override || null,
    contactName: plain.contact_name || null,
    contactEmail: plain.contact_email || null,
    contactPhone: plain.contact_phone || null,
    website: plain.website || null,
    inquiryEnabled: Boolean(plain.inquiry_enabled),
    inquiryEmail: plain.inquiry_email || null,
    inquiryPhone: plain.inquiry_phone || null,
    inquiryNotes: plain.inquiry_notes || null,
    responseTimeBadgeEnabled: Boolean(plain.response_time_badge_enabled),
    responseTimeBadgeLabel: plain.response_time_badge_label || null,
    specialOffersEnabled: Boolean(plain.special_offers_enabled),
    specialOffersTitle: plain.special_offers_title || null,
    specialOffersBody: plain.special_offers_body || null,
    profileCompletion: Number(plain.profile_completion) || 0,
    publishedAt: plain.published_at || null,
    createdAt: plain.created_at || null,
    updatedAt: plain.updated_at || null,
  };
};

const serializeProfileImage = (entry, index = 0) => {
  const plain = toPlain(entry);
  const sourceType =
    String(plain?.source_type || "").trim().toLowerCase() ===
    PARTNER_HOTEL_PROFILE_IMAGE_SOURCE.partnerUpload
      ? PARTNER_HOTEL_PROFILE_IMAGE_SOURCE.partnerUpload
      : PARTNER_HOTEL_PROFILE_IMAGE_SOURCE.provider;
  const imageUrl = normalizeTrimmedString(
    plain?.image_url || plain?.provider_image_url || null,
  );
  if (!imageUrl) return null;
  return {
    id: plain?.id ?? null,
    sourceType,
    providerImageUrl: normalizeTrimmedString(plain?.provider_image_url || null),
    imageUrl,
    caption: plain?.caption || null,
    sortOrder: normalizeSortValue(plain?.sort_order, index),
    isCover: Boolean(plain?.is_cover),
    isActive: Boolean(plain?.is_active),
  };
};

const serializeProfileAmenity = (entry, index = 0) => {
  const plain = toPlain(entry);
  const label = normalizeTrimmedString(plain?.label || null, 255);
  if (!label) return null;
  return {
    id: plain?.id ?? null,
    sourceType:
      String(plain?.source_type || "").trim().toLowerCase() ===
      PARTNER_HOTEL_PROFILE_AMENITY_SOURCE.custom
        ? PARTNER_HOTEL_PROFILE_AMENITY_SOURCE.custom
        : PARTNER_HOTEL_PROFILE_AMENITY_SOURCE.provider,
    providerCategory: normalizeAmenityCategory(plain?.provider_category || null),
    providerCatalogCode:
      plain?.provider_catalog_code != null
        ? String(plain.provider_catalog_code)
        : null,
    providerItemId: normalizeTrimmedString(plain?.provider_item_id || null, 80),
    label,
    sortOrder: normalizeSortValue(plain?.sort_order, index),
    isHighlighted: Boolean(plain?.is_highlighted),
    isActive: Boolean(plain?.is_active),
  };
};

const resolveGalleryImageUrl = (value) => {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") {
    return normalizeTrimmedString(value);
  }
  if (typeof value === "object") {
    return normalizeTrimmedString(
      value?.url ??
        value?.imageUrl ??
        value?.image_url ??
        value?.providerImageUrl ??
        value?.provider_image_url ??
        value?.thumb ??
        value?.["@_url"] ??
        value?.["#text"] ??
        value?.text ??
        value?.value ??
        null,
    );
  }
  return null;
};

const normalizeGalleryEntriesFromSource = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  const hotelImages = value?.hotelImages ?? value;
  const entries = [];
  const thumbUrl = resolveGalleryImageUrl(hotelImages?.thumb ?? value?.thumb ?? null);
  if (thumbUrl) {
    entries.push({
      url: thumbUrl,
      categoryName: "thumbnail",
      isThumbnail: true,
    });
  }

  const rawImages = hotelImages?.image;
  const imageEntries = Array.isArray(rawImages)
    ? rawImages
    : rawImages
      ? [rawImages]
      : [];
  imageEntries.forEach((entry) => {
    const url = resolveGalleryImageUrl(entry);
    if (!url) return;
    if (entry && typeof entry === "object") {
      entries.push({
        ...entry,
        url,
      });
      return;
    }
    entries.push({ url });
  });

  return entries;
};

const resolveFirstGalleryImage = (...sources) => {
  for (const source of sources) {
    const entries = normalizeGalleryEntriesFromSource(source);
    for (const entry of entries) {
      const url = resolveGalleryImageUrl(entry);
      if (url) return url;
    }
  }
  return null;
};

const buildImageObjectsForPublicPayload = (galleryItems = []) =>
  galleryItems
    .map((entry) => {
      const url = normalizeTrimmedString(entry?.imageUrl || entry?.providerImageUrl || null);
      if (!url) return null;
      return {
        url,
        categoryName: entry?.caption || "Partner image",
        isThumbnail: Boolean(entry?.isCover),
      };
    })
    .filter(Boolean);

const buildBaseGalleryFromItem = (item) => {
  const topLevelImages = normalizeGalleryEntriesFromSource(item?.images);
  const detailImages = normalizeGalleryEntriesFromSource(item?.hotelDetails?.images);
  const baseImages = topLevelImages.length ? topLevelImages : detailImages;
  const explicitCover =
    normalizeTrimmedString(
      item?.coverImage ||
        item?.image ||
        item?.hotelDetails?.coverImage ||
        item?.hotelDetails?.image ||
        null,
    ) || resolveFirstGalleryImage(baseImages);
  return baseImages
    .map((entry, index) => {
      const url = resolveGalleryImageUrl(entry);
      if (!url) return null;
      return {
        sourceType: PARTNER_HOTEL_PROFILE_IMAGE_SOURCE.provider,
        providerImageUrl: url,
        imageUrl: url,
        caption: normalizeTrimmedString(entry?.categoryName || null, 255),
        sortOrder: index,
        isCover: url === explicitCover || index === 0,
        isActive: true,
      };
    })
    .filter(Boolean);
};

const buildBaseAmenitiesFromItem = (item) => {
  const baseAmenities = Array.isArray(item?.amenities)
    ? item.amenities
    : Array.isArray(item?.hotelDetails?.amenities)
      ? item.hotelDetails.amenities
      : [];
  return baseAmenities
    .map((entry, index) => {
      const label = normalizeTrimmedString(entry?.name || entry?.label || entry, 255);
      if (!label) return null;
      return {
        sourceType: PARTNER_HOTEL_PROFILE_AMENITY_SOURCE.provider,
        providerCategory: normalizeAmenityCategory(entry?.category || "General"),
        providerCatalogCode: null,
        providerItemId: null,
        label,
        sortOrder: index,
        isHighlighted: Boolean(entry?.isHighlighted),
        isActive: true,
      };
    })
    .filter(Boolean);
};

const buildEffectiveGallery = ({
  item,
  profile,
  applyPublicOverrides,
  allowFullEditorOverrides = false,
}) => {
  const profileImages = sortProfileImages(profile?.profileImages || [])
    .map((entry, index) => serializeProfileImage(entry, index))
    .filter(Boolean);
  const activeProfileImages = profileImages.filter((entry) => entry.isActive);
  if (applyPublicOverrides && allowFullEditorOverrides && activeProfileImages.length) {
    return activeProfileImages;
  }
  return buildBaseGalleryFromItem(item);
};

const buildEffectiveAmenities = ({
  item,
  profile,
  applyPublicOverrides,
  allowFullEditorOverrides = false,
}) => {
  const profileAmenities = sortProfileAmenities(profile?.profileAmenities || [])
    .map((entry, index) => serializeProfileAmenity(entry, index))
    .filter(Boolean);
  const activeProfileAmenities = profileAmenities.filter((entry) => entry.isActive);
  if (applyPublicOverrides && allowFullEditorOverrides && activeProfileAmenities.length) {
    return activeProfileAmenities;
  }
  return buildBaseAmenitiesFromItem(item);
};

const buildContactPayload = ({ item, profile, applyPublicOverrides }) => {
  const baseContact =
    item?.contact && typeof item.contact === "object"
      ? { ...item.contact }
      : item?.hotelDetails?.contact && typeof item.hotelDetails.contact === "object"
        ? { ...item.hotelDetails.contact }
        : {};
  if (!applyPublicOverrides || !profile) {
    return {
      ...baseContact,
      website: null,
    };
  }

  return {
    ...baseContact,
    name: profile.contact_name || baseContact.name || null,
    email: profile.contact_email || baseContact.email || null,
    phone: profile.contact_phone || baseContact.phone || null,
    website: profile.website || null,
  };
};

export const buildEffectivePartnerHotelProfile = ({
  item,
  claim = null,
  profile,
  partnerProgram,
  includeSavedDraft = false,
}) => {
  const plainProfile = profile ? toPlain(profile) : null;
  const applyPublicOverrides =
    includeSavedDraft || shouldApplyPublicProfileOverrides({ partnerProgram, profile: plainProfile });
  const allowFullEditorOverrides = canUseFullProfileEditor(partnerProgram);
  const galleryItems = buildEffectiveGallery({
    item,
    profile: plainProfile,
    applyPublicOverrides,
    allowFullEditorOverrides,
  });
  const amenityItems = buildEffectiveAmenities({
    item,
    profile: plainProfile,
    applyPublicOverrides,
    allowFullEditorOverrides,
  });
  const publicGallery = buildImageObjectsForPublicPayload(galleryItems);
  const explicitCover =
    galleryItems.find((entry) => entry.isCover && entry.isActive)?.imageUrl ||
    galleryItems.find((entry) => entry.isActive)?.imageUrl ||
    null;
  const contact = buildContactPayload({
    item,
    profile: plainProfile,
    applyPublicOverrides,
  });

  const description =
    applyPublicOverrides && plainProfile?.description_override
      ? plainProfile.description_override
      : item?.shortDescription || item?.hotelDetails?.shortDescription || null;

  const headline =
    applyPublicOverrides && plainProfile?.headline
      ? plainProfile.headline
      : item?.name || item?.hotelName || item?.hotelDetails?.hotelName || null;

  const responseTimeBadge =
    applyPublicOverrides &&
    canUseResponseTimeBadge(partnerProgram) &&
    plainProfile?.response_time_badge_enabled &&
    plainProfile?.response_time_badge_label
      ? {
          enabled: true,
          label: plainProfile.response_time_badge_label,
        }
      : null;

  const specialOffers =
    applyPublicOverrides &&
    canUseSpecialOffers(partnerProgram) &&
    plainProfile?.special_offers_enabled &&
    (plainProfile?.special_offers_title || plainProfile?.special_offers_body)
      ? {
          enabled: true,
          title: plainProfile?.special_offers_title || null,
          body: plainProfile?.special_offers_body || null,
        }
      : null;

  const bookingInquiry = buildPublicPartnerInquiryPayload({
    claim,
    profile: plainProfile,
    partnerProgram,
  });

  return {
    hotelId:
      item?.hotelId ??
      item?.hotelCode ??
      item?.id ??
      item?.hotelDetails?.hotelId ??
      item?.hotelDetails?.hotelCode ??
      (plainProfile?.hotel_id != null ? String(plainProfile.hotel_id) : null),
    profileId: plainProfile?.id ?? null,
    status: plainProfile?.status || PARTNER_HOTEL_PROFILE_STATUS.draft,
    headline,
    description,
    coverImage:
      explicitCover ||
      normalizeTrimmedString(
        item?.coverImage ||
          item?.image ||
          item?.hotelDetails?.coverImage ||
          item?.hotelDetails?.image ||
          resolveFirstGalleryImage(item?.images, item?.hotelDetails?.images) ||
          null,
      ),
    gallery: publicGallery,
    amenities: amenityItems
      .filter((entry) => entry.isActive)
      .map((entry) => ({
        name: entry.label,
        label: entry.label,
        providerCategory: entry.providerCategory || "General",
        category: entry.providerCategory || "General",
        sortOrder: entry.sortOrder,
        isHighlighted: Boolean(entry.isHighlighted),
        sourceType: entry.sourceType,
      })),
    contact,
    responseTimeBadge,
    specialOffers,
    bookingInquiry,
    profileCompletion: Number(plainProfile?.profile_completion) || 0,
    publishedAt: plainProfile?.published_at || null,
  };
};

const applyEffectiveProfileToItem = ({ item, effectiveProfile }) => {
  if (!item || typeof item !== "object" || !effectiveProfile) return item;
  const publicGallery = Array.isArray(effectiveProfile.gallery) ? effectiveProfile.gallery : [];
  const existingImages = item.images ?? item?.hotelDetails?.images ?? null;
  const topLevelImages = publicGallery.length ? publicGallery : existingImages;
  const coverImage =
    effectiveProfile.coverImage ||
    item.coverImage ||
    item.image ||
    item?.hotelDetails?.coverImage ||
    item?.hotelDetails?.image ||
    resolveFirstGalleryImage(topLevelImages);
  const hotelDetails =
    item?.hotelDetails && typeof item.hotelDetails === "object"
      ? {
          ...item.hotelDetails,
          coverImage,
          image: coverImage || item.hotelDetails.image || null,
          images: topLevelImages ?? item.hotelDetails.images ?? null,
          amenities:
            effectiveProfile.amenities?.length > 0
              ? effectiveProfile.amenities
              : item.hotelDetails.amenities,
          shortDescription: effectiveProfile.description || item.hotelDetails.shortDescription || null,
          contact:
            effectiveProfile.contact && Object.keys(effectiveProfile.contact).length
              ? effectiveProfile.contact
              : item.hotelDetails.contact,
          responseTimeBadge: effectiveProfile.responseTimeBadge || null,
          specialOffers: effectiveProfile.specialOffers || null,
          bookingInquiry: effectiveProfile.bookingInquiry || null,
        }
      : item?.hotelDetails;

  return {
    ...item,
    headline: effectiveProfile.headline || item.headline || null,
    shortDescription: effectiveProfile.description || item.shortDescription || null,
    description: effectiveProfile.description || item.description || null,
    coverImage,
    image: coverImage,
    images: topLevelImages ?? item.images ?? null,
    amenities:
      effectiveProfile.amenities?.length > 0 ? effectiveProfile.amenities : item.amenities,
    contact:
      effectiveProfile.contact && Object.keys(effectiveProfile.contact).length
        ? effectiveProfile.contact
        : item.contact,
    responseTimeBadge: effectiveProfile.responseTimeBadge || null,
    specialOffers: effectiveProfile.specialOffers || null,
    bookingInquiry: effectiveProfile.bookingInquiry || null,
    effectivePartnerProfile: effectiveProfile,
    hotelDetails,
  };
};

const buildGalleryKey = (item) =>
  [
    String(item?.sourceType || "").trim().toLowerCase(),
    normalizeTrimmedString(item?.providerImageUrl || null),
    normalizeTrimmedString(item?.imageUrl || null),
  ]
    .filter(Boolean)
    .join("::");

const buildAmenityKey = (item) => {
  const sourceType = String(item?.sourceType || "").trim().toLowerCase();
  const category = normalizeAmenityCategory(item?.providerCategory || null);
  const label = normalizeTrimmedString(item?.label || null);
  if (sourceType === PARTNER_HOTEL_PROFILE_AMENITY_SOURCE.custom) {
    return [sourceType, category, label].filter(Boolean).join("::").toLowerCase();
  }
  return [
    sourceType,
    category,
    normalizeTrimmedString(item?.providerCatalogCode || null),
    normalizeTrimmedString(item?.providerItemId || null),
    label,
  ]
    .filter(Boolean)
    .join("::")
    .toLowerCase();
};

const dedupeByKey = (items = [], buildKey) => {
  const seen = new Set();
  const deduped = [];
  items.forEach((item) => {
    const key = buildKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  return deduped;
};

const normalizeGalleryInput = (items = []) => {
  const prepared = (Array.isArray(items) ? items : [])
    .slice(0, MAX_PROFILE_GALLERY_ITEMS)
    .map((entry, index) => {
      const sourceType =
        String(entry?.sourceType || entry?.source_type || "")
          .trim()
          .toLowerCase() === PARTNER_HOTEL_PROFILE_IMAGE_SOURCE.partnerUpload
          ? PARTNER_HOTEL_PROFILE_IMAGE_SOURCE.partnerUpload
          : PARTNER_HOTEL_PROFILE_IMAGE_SOURCE.provider;
      const providerImageUrl = normalizeTrimmedString(
        entry?.providerImageUrl || entry?.provider_image_url || null,
      );
      const imageUrl = normalizeTrimmedString(
        entry?.imageUrl || entry?.image_url || providerImageUrl || null,
      );
      if (!imageUrl) return null;
      return {
        sourceType,
        providerImageUrl: sourceType === PARTNER_HOTEL_PROFILE_IMAGE_SOURCE.provider ? providerImageUrl || imageUrl : providerImageUrl,
        imageUrl,
        caption: normalizeTrimmedString(entry?.caption || null, 255),
        sortOrder: normalizeSortValue(entry?.sortOrder ?? entry?.sort_order, index),
        isCover: normalizeBoolean(entry?.isCover ?? entry?.is_cover, false),
        isActive: normalizeBoolean(entry?.isActive ?? entry?.is_active, true),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  const normalized = dedupeByKey(prepared, buildGalleryKey).map((entry, index) => ({
    ...entry,
    sortOrder: index,
  }));

  const hasActiveCover = normalized.some((entry) => entry.isActive && entry.isCover);
  if (!hasActiveCover) {
    const firstActive = normalized.find((entry) => entry.isActive);
    if (firstActive) firstActive.isCover = true;
  }
  return normalized;
};

const normalizeAmenityInput = (items = []) => {
  const prepared = (Array.isArray(items) ? items : [])
    .slice(0, MAX_PROFILE_AMENITY_ITEMS)
    .map((entry, index) => {
      const sourceType =
        String(entry?.sourceType || entry?.source_type || "")
          .trim()
          .toLowerCase() === PARTNER_HOTEL_PROFILE_AMENITY_SOURCE.custom
          ? PARTNER_HOTEL_PROFILE_AMENITY_SOURCE.custom
          : PARTNER_HOTEL_PROFILE_AMENITY_SOURCE.provider;
      const label = normalizeTrimmedString(entry?.label || entry?.name || null, 255);
      if (!label) return null;
      return {
        sourceType,
        providerCategory: normalizeAmenityCategory(
          entry?.providerCategory || entry?.provider_category || entry?.category || "General",
        ),
        providerCatalogCode: normalizeTrimmedString(
          entry?.providerCatalogCode || entry?.provider_catalog_code || null,
        ),
        providerItemId: normalizeTrimmedString(
          entry?.providerItemId || entry?.provider_item_id || null,
          80,
        ),
        label,
        sortOrder: normalizeSortValue(entry?.sortOrder ?? entry?.sort_order, index),
        isHighlighted: normalizeBoolean(entry?.isHighlighted ?? entry?.is_highlighted, false),
        isActive: normalizeBoolean(entry?.isActive ?? entry?.is_active, true),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return dedupeByKey(prepared, buildAmenityKey).map((entry, index) => ({
    ...entry,
    sortOrder: index,
  }));
};

const hasOverrideContent = ({ profile, galleryItems, amenityItems, partnerProgram }) =>
  Boolean(
    profile?.headline ||
      profile?.description_override ||
      profile?.contact_name ||
      profile?.contact_email ||
      profile?.contact_phone ||
      profile?.website ||
      (canUseBookingInquiry(partnerProgram) &&
        (profile?.inquiry_enabled ||
          profile?.inquiry_email ||
          profile?.inquiry_phone ||
          profile?.inquiry_notes)) ||
      (canUseResponseTimeBadge(partnerProgram) &&
        profile?.response_time_badge_enabled &&
        profile?.response_time_badge_label) ||
      (canUseSpecialOffers(partnerProgram) &&
        profile?.special_offers_enabled &&
        (profile?.special_offers_title || profile?.special_offers_body)) ||
      (canUseFullProfileEditor(partnerProgram) &&
        Array.isArray(galleryItems) &&
        galleryItems.length > 0) ||
      (canUseFullProfileEditor(partnerProgram) &&
        Array.isArray(amenityItems) &&
        amenityItems.length > 0),
  );

const computeProfileCompletion = ({ profile, galleryItems, amenityItems, partnerProgram }) => {
  const checkpoints = [
    Boolean(profile?.headline || profile?.description_override),
    Boolean(
      profile?.contact_name || profile?.contact_email || profile?.contact_phone || profile?.website,
    ),
  ];
  if (canUseFullProfileEditor(partnerProgram)) {
    checkpoints.push(Boolean(Array.isArray(galleryItems) && galleryItems.length > 0));
    checkpoints.push(Boolean(Array.isArray(amenityItems) && amenityItems.length > 0));
  }
  if (canUseResponseTimeBadge(partnerProgram)) {
    checkpoints.push(
      Boolean(profile?.response_time_badge_enabled && profile?.response_time_badge_label),
    );
  }
  if (canUseSpecialOffers(partnerProgram)) {
    checkpoints.push(
      Boolean(
        profile?.special_offers_enabled &&
          (profile?.special_offers_title || profile?.special_offers_body),
      ),
    );
  }
  if (canUseBookingInquiry(partnerProgram)) {
    checkpoints.push(
      Boolean(profile?.inquiry_enabled && (profile?.inquiry_email || profile?.contact_email)),
    );
  }
  if (!checkpoints.length) return 0;
  const completed = checkpoints.filter(Boolean).length;
  return Math.round((completed / checkpoints.length) * 100);
};

const buildProfileFieldUpdates = ({ profile, payload, partnerProgram }) => {
  const updates = {};
  if (hasOwn(payload, "headline")) {
    updates.headline = normalizeTrimmedString(payload.headline, 160);
  }
  if (hasOwn(payload, "descriptionOverride")) {
    updates.description_override = normalizeMultilineText(payload.descriptionOverride);
  }
  if (hasOwn(payload, "contactName")) {
    updates.contact_name = normalizeTrimmedString(payload.contactName, 150);
  }
  if (hasOwn(payload, "contactEmail")) {
    updates.contact_email = normalizeEmail(payload.contactEmail);
  }
  if (hasOwn(payload, "contactPhone")) {
    updates.contact_phone = normalizeTrimmedString(payload.contactPhone, 40);
  }
  if (hasOwn(payload, "website")) {
    updates.website = normalizeUrl(payload.website);
  }

  if (canUseBookingInquiry(partnerProgram)) {
    if (hasOwn(payload, "inquiryEnabled")) {
      updates.inquiry_enabled = normalizeBoolean(
        payload.inquiryEnabled,
        Boolean(profile?.inquiry_enabled),
      );
    }
    if (hasOwn(payload, "inquiryEmail")) {
      updates.inquiry_email = normalizeEmail(payload.inquiryEmail);
    }
    if (hasOwn(payload, "inquiryPhone")) {
      updates.inquiry_phone = normalizeTrimmedString(payload.inquiryPhone, 40);
    }
    if (hasOwn(payload, "inquiryNotes")) {
      const inquiryNotes = normalizeMultilineText(payload.inquiryNotes);
      updates.inquiry_notes = inquiryNotes ? inquiryNotes.slice(0, 500) : null;
    }
  }

  if (canUseResponseTimeBadge(partnerProgram)) {
    if (hasOwn(payload, "responseTimeBadgeEnabled")) {
      updates.response_time_badge_enabled = normalizeBoolean(
        payload.responseTimeBadgeEnabled,
        Boolean(profile?.response_time_badge_enabled),
      );
    }
    if (hasOwn(payload, "responseTimeBadgeLabel")) {
      updates.response_time_badge_label = normalizeTrimmedString(
        payload.responseTimeBadgeLabel,
        80,
      );
    }
  }

  if (canUseSpecialOffers(partnerProgram)) {
    if (hasOwn(payload, "specialOffersEnabled")) {
      updates.special_offers_enabled = normalizeBoolean(
        payload.specialOffersEnabled,
        Boolean(profile?.special_offers_enabled),
      );
    }
    if (hasOwn(payload, "specialOffersTitle")) {
      updates.special_offers_title = normalizeTrimmedString(payload.specialOffersTitle, 160);
    }
    if (hasOwn(payload, "specialOffersBody")) {
      updates.special_offers_body = normalizeMultilineText(payload.specialOffersBody);
    }
  }

  return updates;
};

const requireOwnedPartnerClaim = async ({
  userId,
  hotelId,
  includeProfile = false,
  transaction = null,
}) => {
  const resolvedUserId = Number(userId);
  const resolvedHotelId = String(hotelId || "").trim();
  if (!Number.isFinite(resolvedUserId) || resolvedUserId <= 0) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }
  if (!resolvedHotelId) {
    const error = new Error("hotelId is required");
    error.status = 400;
    throw error;
  }

  const claim = await models.PartnerHotelClaim.findOne({
    where: {
      user_id: resolvedUserId,
      hotel_id: resolvedHotelId,
    },
    include: await buildClaimInclude({ includeProfile }),
    transaction,
  });
  if (!claim) {
    const error = new Error("Partner claim not found");
    error.status = 404;
    throw error;
  }
  return claim;
};

const ensureProfileForClaim = async ({ claim, userId, transaction = null }) => {
  const profileQueryOptions = await buildPartnerHotelProfileQueryOptions({
    includeCollections: true,
  });
  const existing =
    claim?.hotelProfile ||
    (await models.PartnerHotelProfile.findOne({
      where: { claim_id: claim.id },
      ...profileQueryOptions,
      transaction,
    }));
  if (existing) return existing;

  const createPayload = await filterPartnerHotelProfileWritePayload({
    hotel_id: claim.hotel_id,
    claim_id: claim.id,
    status: PARTNER_HOTEL_PROFILE_STATUS.draft,
    updated_by_user_id: Number(userId) || null,
    profile_completion: 0,
  });
  const created = await models.PartnerHotelProfile.create(createPayload, {
    fields: Object.keys(createPayload),
    transaction,
  });
  return models.PartnerHotelProfile.findByPk(created.id, {
    ...profileQueryOptions,
    transaction,
  });
};

const loadProviderEditorCollections = async (hotelId) => {
  const resolvedHotelId = String(hotelId || "").trim();
  const [providerImages, providerAmenities] = await Promise.all([
    models.WebbedsHotelImage.findAll({
      where: { hotel_id: resolvedHotelId },
      order: [
        ["runno", "ASC"],
        ["id", "ASC"],
      ],
    }),
    models.WebbedsHotelAmenity.findAll({
      where: { hotel_id: resolvedHotelId },
      order: [
        ["category", "ASC"],
        ["item_name", "ASC"],
        ["id", "ASC"],
      ],
    }),
  ]);

  return {
    providerImages: providerImages
      .map((entry, index) => {
        const plain = toPlain(entry);
        const imageUrl = normalizeTrimmedString(plain?.url || null);
        if (!imageUrl) return null;
        return {
          sourceType: PARTNER_HOTEL_PROFILE_IMAGE_SOURCE.provider,
          providerImageUrl: imageUrl,
          imageUrl,
          caption: normalizeTrimmedString(plain?.alt || plain?.category_name || null, 255),
          sortOrder: normalizeSortValue(plain?.runno, index),
          isCover: Boolean(plain?.is_thumbnail) || index === 0,
          isActive: true,
        };
      })
      .filter(Boolean),
    providerAmenities: providerAmenities
      .map((entry, index) => {
        const plain = toPlain(entry);
        const label = normalizeTrimmedString(plain?.item_name || null, 255);
        if (!label) return null;
        return {
          sourceType: PARTNER_HOTEL_PROFILE_AMENITY_SOURCE.provider,
          providerCategory: normalizeAmenityCategory(plain?.category || "General"),
          providerCatalogCode:
            plain?.catalog_code != null ? String(plain.catalog_code) : null,
          providerItemId: normalizeTrimmedString(plain?.item_id || null, 80),
          label,
          sortOrder: index,
          isHighlighted: false,
          isActive: true,
        };
      })
      .filter(Boolean),
  };
};

const buildEditorCollections = ({
  providerImages,
  providerAmenities,
  profile,
  partnerProgram,
}) => {
  if (!canUseFullProfileEditor(partnerProgram)) {
    return {
      galleryItems: providerImages,
      amenityItems: providerAmenities,
    };
  }

  const profileImages = sortProfileImages(profile?.profileImages || [])
    .map((entry, index) => serializeProfileImage(entry, index))
    .filter(Boolean);
  const profileAmenities = sortProfileAmenities(profile?.profileAmenities || [])
    .map((entry, index) => serializeProfileAmenity(entry, index))
    .filter(Boolean);

  return {
    galleryItems: profileImages.length ? profileImages : providerImages,
    amenityItems: profileAmenities.length ? profileAmenities : providerAmenities,
  };
};

const presignEditorGalleryItems = async (items = []) =>
  Promise.all(
    (Array.isArray(items) ? items : []).map(async (item) => {
      const imageUrl = normalizeTrimmedString(item?.imageUrl || null);
      const providerImageUrl = normalizeTrimmedString(item?.providerImageUrl || null);
      return {
        ...item,
        imageUrl: (await presignIfS3Url(imageUrl)) || imageUrl || providerImageUrl || null,
        providerImageUrl: (await presignIfS3Url(providerImageUrl)) || providerImageUrl || null,
      };
    }),
  );

const buildDashboardProfilePayload = async ({
  claim,
  profile,
  partnerProgram,
  providerImages,
  providerAmenities,
  inquirySummary = null,
}) => {
  const baseHotel = claim?.hotel ? formatStaticHotel(claim.hotel) : null;
  const editorDraft = buildEditorCollections({
    providerImages,
    providerAmenities,
    profile,
    partnerProgram,
  });
  const editor = {
    ...editorDraft,
    galleryItems: await presignEditorGalleryItems(editorDraft.galleryItems),
  };
  const effectiveProfile = buildEffectivePartnerHotelProfile({
    item: baseHotel || {},
    claim,
    profile,
    partnerProgram,
    includeSavedDraft: false,
  });
  const inquiryStatus = resolvePartnerInquiryStatus({
    claim,
    profile,
    partnerProgram,
    latestInquiry: inquirySummary?.latestInquiry || null,
    metrics: inquirySummary?.metrics || null,
  });

  return {
    hotelId: claim?.hotel_id != null ? String(claim.hotel_id) : null,
    claimId: claim?.id ?? null,
    partnerProgram,
    baseHotel,
    profile: serializePartnerHotelProfile(profile),
    editor,
    defaults: {
      galleryItems: providerImages,
      amenityItems: providerAmenities,
    },
    effectiveProfile,
    inquiryStatus,
    fieldAccess: {
      basicProfile: canEditBasicProfile(partnerProgram),
      fullProfileEditor: canUseFullProfileEditor(partnerProgram),
      bookingInquiry: canUseBookingInquiry(partnerProgram),
      responseTimeBadge: canUseResponseTimeBadge(partnerProgram),
      specialOffers: canUseSpecialOffers(partnerProgram),
    },
  };
};

export const getPartnerHotelProfileEditorPayload = async ({ userId, hotelId }) => {
  const claim = await requireOwnedPartnerClaim({
    userId,
    hotelId,
    includeProfile: true,
  });
  const profile = await ensureProfileForClaim({ claim, userId });
  const partnerProgram = resolvePartnerProgramFromClaim(claim);
  const { providerImages, providerAmenities } = await loadProviderEditorCollections(claim.hotel_id);
  const inquirySummary = await getPartnerInquirySummaryForClaim({ claimId: claim.id });

  return buildDashboardProfilePayload({
    claim,
    profile,
    partnerProgram,
    providerImages,
    providerAmenities,
    inquirySummary,
  });
};

export const savePartnerHotelProfileEditorPayload = async ({ userId, hotelId, payload = {} }) => {
  const result = await sequelize.transaction(async (transaction) => {
    const claim = await requireOwnedPartnerClaim({
      userId,
      hotelId,
      includeProfile: true,
      transaction,
    });
    const partnerProgram = resolvePartnerProgramFromClaim(claim);
    if (!canEditBasicProfile(partnerProgram)) {
      const error = new Error("Profile editing is not available for the current plan");
      error.status = 403;
      throw error;
    }

    const profile = await ensureProfileForClaim({
      claim,
      userId,
      transaction,
    });

    const updates = await filterPartnerHotelProfileWritePayload(
      buildProfileFieldUpdates({
        profile: toPlain(profile),
        payload,
        partnerProgram,
      }),
    );
    if (Object.keys(updates).length) {
      updates.updated_by_user_id = Number(userId) || null;
      await profile.update(updates, { transaction });
    }

    let nextGalleryItems = sortProfileImages(profile.profileImages || [])
      .map((entry, index) => serializeProfileImage(entry, index))
      .filter(Boolean);
    let nextAmenityItems = sortProfileAmenities(profile.profileAmenities || [])
      .map((entry, index) => serializeProfileAmenity(entry, index))
      .filter(Boolean);

    if (canUseFullProfileEditor(partnerProgram) && hasOwn(payload, "galleryItems")) {
      const normalizedGallery = normalizeGalleryInput(payload.galleryItems);
      await models.PartnerHotelProfileImage.destroy({
        where: { partner_hotel_profile_id: profile.id },
        transaction,
      });
      if (normalizedGallery.length) {
        await models.PartnerHotelProfileImage.bulkCreate(
          normalizedGallery.map((entry) => ({
            partner_hotel_profile_id: profile.id,
            source_type: entry.sourceType,
            provider_image_url: entry.providerImageUrl,
            image_url: entry.imageUrl,
            caption: entry.caption,
            sort_order: entry.sortOrder,
            is_cover: entry.isCover,
            is_active: entry.isActive,
          })),
          { transaction },
        );
      }
      nextGalleryItems = normalizedGallery;
    }

    if (canUseFullProfileEditor(partnerProgram) && hasOwn(payload, "amenityItems")) {
      const normalizedAmenities = normalizeAmenityInput(payload.amenityItems);
      await models.PartnerHotelProfileAmenity.destroy({
        where: { partner_hotel_profile_id: profile.id },
        transaction,
      });
      if (normalizedAmenities.length) {
        await models.PartnerHotelProfileAmenity.bulkCreate(
          normalizedAmenities.map((entry) => ({
            partner_hotel_profile_id: profile.id,
            source_type: entry.sourceType,
            provider_category: entry.providerCategory,
            provider_catalog_code: entry.providerCatalogCode || null,
            provider_item_id: entry.providerItemId,
            label: entry.label,
            sort_order: entry.sortOrder,
            is_highlighted: entry.isHighlighted,
            is_active: entry.isActive,
          })),
          { transaction },
        );
      }
      nextAmenityItems = normalizedAmenities;
    }

    const profilePlain = {
      ...toPlain(profile),
      ...updates,
    };
    const completion = computeProfileCompletion({
      profile: profilePlain,
      galleryItems: nextGalleryItems.filter((entry) => entry.isActive),
      amenityItems: nextAmenityItems.filter((entry) => entry.isActive),
      partnerProgram,
    });
    const isActive = hasOverrideContent({
      profile: profilePlain,
      galleryItems: nextGalleryItems.filter((entry) => entry.isActive),
      amenityItems: nextAmenityItems.filter((entry) => entry.isActive),
      partnerProgram,
    });
    await profile.update(
      {
        updated_by_user_id: Number(userId) || null,
        profile_completion: completion,
        status: isActive
          ? PARTNER_HOTEL_PROFILE_STATUS.active
          : PARTNER_HOTEL_PROFILE_STATUS.draft,
        published_at: isActive ? profile.published_at || new Date() : null,
      },
      { transaction },
    );

    const refreshedClaim = await requireOwnedPartnerClaim({
      userId,
      hotelId,
      includeProfile: true,
      transaction,
    });
    const { providerImages, providerAmenities } = await loadProviderEditorCollections(
      refreshedClaim.hotel_id,
    );
    return buildDashboardProfilePayload({
      claim: refreshedClaim,
      profile: refreshedClaim.hotelProfile,
      partnerProgram: resolvePartnerProgramFromClaim(refreshedClaim),
      providerImages,
      providerAmenities,
      inquirySummary: await getPartnerInquirySummaryForClaim({ claimId: refreshedClaim.id }),
    });
  });
  await bumpPartnerHotelProfileCacheVersion();
  return result;
};

export const applyEffectivePartnerProfilesToHotelItems = async (items = [], claims = []) => {
  const claimMap = new Map(
    (Array.isArray(claims) ? claims : []).map((claim) => [String(claim.hotel_id), claim]),
  );

  return (Array.isArray(items) ? items : []).map((item) => {
    const hotelId =
      item?.hotelId ??
      item?.hotelCode ??
      item?.id ??
      item?.hotelDetails?.hotelId ??
      item?.hotelDetails?.hotelCode ??
      null;
    if (hotelId == null) return item;
    const claim = claimMap.get(String(hotelId));
    if (!claim?.hotelProfile) return item;

    const effectiveProfile = buildEffectivePartnerHotelProfile({
      item,
      claim,
      profile: claim.hotelProfile,
      partnerProgram: item?.partnerProgram || resolvePartnerProgramFromClaim(claim),
      includeSavedDraft: false,
    });
    return applyEffectiveProfileToItem({ item, effectiveProfile });
  });
};

export const getPartnerClaimsWithProfilesByHotelIds = async (hotelIds = []) => {
  const targetIds = Array.from(
    new Set(
      (Array.isArray(hotelIds) ? hotelIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (!targetIds.length) return [];

  return models.PartnerHotelClaim.findAll({
    where: {
      hotel_id: { [Op.in]: targetIds },
    },
    include: await buildClaimInclude({ includeHotel: false, includeProfile: true }),
  });
};
