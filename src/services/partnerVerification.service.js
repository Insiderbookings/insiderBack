import models from "../models/index.js";

export const PARTNER_VERIFICATION_CODE_PATTERN = /^\d+$/;

export const PARTNER_VERIFICATION_STATUSES = Object.freeze({
  active: "ACTIVE",
  claimed: "CLAIMED",
});

const HOTEL_ATTRIBUTES = Object.freeze([
  "hotel_id",
  "name",
  "city_name",
  "country_name",
  "address",
]);

const CLAIM_ATTRIBUTES = Object.freeze([
  "id",
  "hotel_id",
  "user_id",
  "claim_status",
  "onboarding_step",
]);

export const normalizePartnerVerificationCodeInput = (value) =>
  String(value || "")
    .replace(/\D/g, "")
    .trim();

const serializeHotel = (hotel) =>
  hotel
    ? {
        hotelId: hotel.hotel_id != null ? String(hotel.hotel_id) : null,
        name: hotel.name || null,
        city: hotel.city_name || null,
        country: hotel.country_name || null,
        address: hotel.address || null,
      }
    : null;

export const buildPartnerVerificationPayload = (record, { currentUserId = null } = {}) => {
  if (!record) return null;
  const hotel = record.hotel || null;
  const claim = record.claim || null;
  const resolvedCurrentUserId = Number(currentUserId || 0);
  const claimedByCurrentUser =
    Boolean(resolvedCurrentUserId) && Number(claim?.user_id || 0) === resolvedCurrentUserId;
  const alreadyClaimed = Boolean(claim?.id || record.claim_id);

  return {
    verificationId: null,
    code: record.code || (hotel?.hotel_id != null ? String(hotel.hotel_id) : null),
    status: alreadyClaimed ? PARTNER_VERIFICATION_STATUSES.claimed : PARTNER_VERIFICATION_STATUSES.active,
    hotelId: hotel?.hotel_id != null ? String(hotel.hotel_id) : null,
    hotel: serializeHotel(hotel),
    canActivate: !alreadyClaimed || claimedByCurrentUser,
    alreadyClaimed,
    claimedByCurrentUser,
    claim: alreadyClaimed
      ? {
          claimId: claim?.id || null,
          claimStatus: claim?.claim_status || null,
          hotelId: hotel?.hotel_id != null ? String(hotel.hotel_id) : null,
        }
      : null,
  };
};

const ensureHotelExists = async (hotelId) => {
  const resolvedHotelId = String(hotelId || "").trim();
  if (!resolvedHotelId) {
    const error = new Error("hotelId is required");
    error.status = 400;
    throw error;
  }
  const hotel = await models.WebbedsHotel.findByPk(resolvedHotelId, {
    attributes: HOTEL_ATTRIBUTES,
  });
  if (!hotel) {
    const error = new Error("Hotel not found");
    error.status = 404;
    throw error;
  }
  return hotel;
};

const findClaimByHotelId = async (hotelId) =>
  models.PartnerHotelClaim.findOne({
    where: { hotel_id: String(hotelId) },
    attributes: CLAIM_ATTRIBUTES,
  });

export const getOrCreatePartnerVerificationCode = async ({
  hotelId,
} = {}) => {
  const hotel = await ensureHotelExists(hotelId);
  const claim = await findClaimByHotelId(hotel.hotel_id);
  const record = {
    code: String(hotel.hotel_id),
    hotel,
    claim,
  };
  return {
    created: false,
    record,
    item: buildPartnerVerificationPayload(record),
  };
};

export const findPartnerVerificationCodeRecord = async ({
  code,
} = {}) => {
  const normalizedCode = normalizePartnerVerificationCodeInput(code);
  if (!normalizedCode || !PARTNER_VERIFICATION_CODE_PATTERN.test(normalizedCode)) {
    const error = new Error("Enter a valid hotel verification id.");
    error.status = 400;
    throw error;
  }

  const hotel = await models.WebbedsHotel.findByPk(normalizedCode, {
    attributes: HOTEL_ATTRIBUTES,
  });
  if (!hotel) {
    const error = new Error("Hotel not found for this verification id.");
    error.status = 404;
    throw error;
  }

  const claim = await findClaimByHotelId(hotel.hotel_id);
  return {
    code: normalizedCode,
    hotel,
    claim,
  };
};

export const lookupPartnerVerificationCode = async ({
  code,
  currentUserId = null,
} = {}) => {
  const record = await findPartnerVerificationCodeRecord({ code });
  return {
    record,
    item: buildPartnerVerificationPayload(record, { currentUserId }),
  };
};

export const markPartnerVerificationCodeClaimed = async ({
  record,
  claim,
} = {}) => {
  if (!record || !claim?.id) return record || null;
  return {
    ...record,
    claim,
  };
};
