import models, { sequelize } from "../models/index.js";

const PARTNER_HOTEL_PROFILE_TABLE = "partner_hotel_profile";
const SCHEMA_CACHE_TTL_MS = 60 * 1000;

const PARTNER_HOTEL_PROFILE_INQUIRY_ATTRIBUTES = Object.freeze([
  "inquiry_enabled",
  "inquiry_email",
  "inquiry_phone",
  "inquiry_notes",
]);

const PARTNER_HOTEL_PROFILE_ATTRIBUTE_FIELD_MAP = Object.freeze(
  Object.fromEntries(
    Object.entries(models.PartnerHotelProfile?.rawAttributes || {}).map(
      ([attributeName, attribute]) => [attributeName, attribute?.field || attributeName],
    ),
  ),
);

const LEGACY_SAFE_PROFILE_ATTRIBUTES = Object.freeze(
  Object.keys(PARTNER_HOTEL_PROFILE_ATTRIBUTE_FIELD_MAP).filter(
    (attributeName) =>
      !PARTNER_HOTEL_PROFILE_INQUIRY_ATTRIBUTES.includes(attributeName),
  ),
);

let cachedAvailableColumns = null;
let cachedAtMs = 0;
let pendingColumnsPromise = null;

const buildProfileCollectionInclude = () => [
  {
    model: models.PartnerHotelProfileImage,
    as: "profileImages",
    required: false,
  },
  {
    model: models.PartnerHotelProfileAmenity,
    as: "profileAmenities",
    required: false,
  },
];

const isAttributeBackedByAvailableColumn = (attributeName, availableColumns) =>
  availableColumns.has(
    PARTNER_HOTEL_PROFILE_ATTRIBUTE_FIELD_MAP[attributeName] || attributeName,
  );

const buildFallbackAvailableColumns = () =>
  new Set(
    LEGACY_SAFE_PROFILE_ATTRIBUTES.map(
      (attributeName) =>
        PARTNER_HOTEL_PROFILE_ATTRIBUTE_FIELD_MAP[attributeName] || attributeName,
    ),
  );

const loadAvailableColumns = async () => {
  const now = Date.now();
  if (
    cachedAvailableColumns &&
    now - cachedAtMs < SCHEMA_CACHE_TTL_MS
  ) {
    return cachedAvailableColumns;
  }

  if (!pendingColumnsPromise) {
    pendingColumnsPromise = (async () => {
      try {
        const description = await sequelize
          .getQueryInterface()
          .describeTable(PARTNER_HOTEL_PROFILE_TABLE);
        const availableColumns = new Set(Object.keys(description || {}));
        cachedAvailableColumns = availableColumns.size
          ? availableColumns
          : buildFallbackAvailableColumns();
      } catch (_error) {
        cachedAvailableColumns = buildFallbackAvailableColumns();
      } finally {
        cachedAtMs = Date.now();
        pendingColumnsPromise = null;
      }
      return cachedAvailableColumns;
    })();
  }

  return pendingColumnsPromise;
};

export const getPartnerHotelProfileSelectableAttributes = async () => {
  const availableColumns = await loadAvailableColumns();
  const requestedAttributes = Object.keys(PARTNER_HOTEL_PROFILE_ATTRIBUTE_FIELD_MAP);
  return requestedAttributes.filter((attributeName) =>
    isAttributeBackedByAvailableColumn(attributeName, availableColumns),
  );
};

export const buildPartnerHotelProfileQueryOptions = async ({
  includeCollections = false,
} = {}) => {
  const attributes = await getPartnerHotelProfileSelectableAttributes();
  const include = includeCollections ? buildProfileCollectionInclude() : [];
  return {
    attributes,
    ...(include.length ? { include } : {}),
  };
};

export const buildPartnerHotelProfileAssociation = async ({
  includeCollections = false,
  required = false,
} = {}) => ({
  model: models.PartnerHotelProfile,
  as: "hotelProfile",
  required,
  ...(await buildPartnerHotelProfileQueryOptions({ includeCollections })),
});

export const filterPartnerHotelProfileWritePayload = async (payload = {}) => {
  const availableColumns = await loadAvailableColumns();
  return Object.fromEntries(
    Object.entries(payload || {}).filter(([attributeName]) =>
      isAttributeBackedByAvailableColumn(attributeName, availableColumns),
    ),
  );
};
