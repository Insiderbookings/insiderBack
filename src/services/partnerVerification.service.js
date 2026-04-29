import { randomInt } from "node:crypto";
import models from "../models/index.js";

export const PARTNER_VERIFICATION_CODE_PATTERN = /^VRF\d{4}[A-Z]$/;

export const PARTNER_VERIFICATION_STATUSES = Object.freeze({
  active: "ACTIVE",
  claimed: "CLAIMED",
  claimedByMe: "CLAIMED_BY_ME",
});

const PARTNER_VERIFICATION_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PARTNER_VERIFICATION_CODE_PREFIX = "VRF";
const PARTNER_VERIFICATION_CODE_DIGITS = 4;
const PARTNER_VERIFICATION_CODE_MAX_ATTEMPTS = 40;

const HOTEL_ATTRIBUTES = Object.freeze([
  "hotel_id",
  "name",
  "city_name",
  "country_name",
  "address",
]);

const VERIFICATION_ATTRIBUTES = Object.freeze([
  "id",
  "hotel_id",
  "code",
  "created_by_user_id",
  "claimed_by_user_id",
  "claimed_at",
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
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);

const hasUniqueConstraintForField = (error, field) =>
  Array.isArray(error?.errors) &&
  error.errors.some((entry) => String(entry?.path || entry?.column || "").includes(field));

const buildPartnerVerificationCodeCandidate = () => {
  const digits = String(randomInt(0, 10 ** PARTNER_VERIFICATION_CODE_DIGITS)).padStart(
    PARTNER_VERIFICATION_CODE_DIGITS,
    "0",
  );
  const suffix =
    PARTNER_VERIFICATION_CODE_ALPHABET[randomInt(0, PARTNER_VERIFICATION_CODE_ALPHABET.length)];
  return `${PARTNER_VERIFICATION_CODE_PREFIX}${digits}${suffix}`;
};

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
    verificationId: Number(record.id || record.verificationId || 0) || null,
    code: record.code || null,
    status: alreadyClaimed
      ? claimedByCurrentUser
        ? PARTNER_VERIFICATION_STATUSES.claimedByMe
        : PARTNER_VERIFICATION_STATUSES.claimed
      : PARTNER_VERIFICATION_STATUSES.active,
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

const mapVerificationRecord = async (verificationRow, { hotel = null, claim = null } = {}) => {
  if (!verificationRow) return null;
  const plain = verificationRow.get ? verificationRow.get({ plain: true }) : verificationRow;
  const resolvedHotel =
    hotel ||
    plain.hotel ||
    (await models.WebbedsHotel.findByPk(plain.hotel_id, {
      attributes: HOTEL_ATTRIBUTES,
    }));
  const resolvedClaim = claim || (await findClaimByHotelId(plain.hotel_id));
  return {
    ...plain,
    hotel: resolvedHotel,
    claim: resolvedClaim,
  };
};

const findVerificationCodeByHotelId = async (hotelId) =>
  models.PartnerHotelVerificationCode.findOne({
    where: { hotel_id: String(hotelId) },
    attributes: VERIFICATION_ATTRIBUTES,
  });

const createPartnerVerificationCode = async ({ hotelId, createdByUserId = null } = {}) => {
  const resolvedHotelId = String(hotelId || "").trim();
  const resolvedCreatedByUserId = Number(createdByUserId || 0) || null;

  for (let attempt = 0; attempt < PARTNER_VERIFICATION_CODE_MAX_ATTEMPTS; attempt += 1) {
    const code = buildPartnerVerificationCodeCandidate();
    try {
      return await models.PartnerHotelVerificationCode.create({
        hotel_id: resolvedHotelId,
        code,
        created_by_user_id: resolvedCreatedByUserId,
      });
    } catch (error) {
      if (error?.name !== "SequelizeUniqueConstraintError") throw error;
      if (hasUniqueConstraintForField(error, "hotel_id")) {
        const existing = await findVerificationCodeByHotelId(resolvedHotelId);
        if (existing) return existing;
      }
      if (hasUniqueConstraintForField(error, "code")) continue;
      throw error;
    }
  }

  const error = new Error("Unable to generate a unique partner verification code.");
  error.status = 500;
  throw error;
};

export const getOrCreatePartnerVerificationCode = async ({
  hotelId,
  createdByUserId = null,
} = {}) => {
  const hotel = await ensureHotelExists(hotelId);
  let verification = await findVerificationCodeByHotelId(hotel.hotel_id);
  let created = false;
  if (!verification) {
    verification = await createPartnerVerificationCode({
      hotelId: hotel.hotel_id,
      createdByUserId,
    });
    created = true;
  }
  const claim = await findClaimByHotelId(hotel.hotel_id);
  const record = await mapVerificationRecord(verification, { hotel, claim });
  return {
    created,
    record,
    item: buildPartnerVerificationPayload(record),
  };
};

export const findPartnerVerificationCodeRecord = async ({
  code,
} = {}) => {
  const normalizedCode = normalizePartnerVerificationCodeInput(code);
  if (!normalizedCode || !PARTNER_VERIFICATION_CODE_PATTERN.test(normalizedCode)) {
    const error = new Error("Enter a valid hotel verification code.");
    error.status = 400;
    throw error;
  }

  const verification = await models.PartnerHotelVerificationCode.findOne({
    where: { code: normalizedCode },
    attributes: VERIFICATION_ATTRIBUTES,
  });
  if (!verification) {
    const error = new Error("Hotel not found for this verification code.");
    error.status = 404;
    throw error;
  }

  return mapVerificationRecord(verification);
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
  userId = null,
} = {}) => {
  if (!record || !claim?.id) return record || null;
  const verificationId = Number(record.id || record.verificationId || 0) || null;
  if (!verificationId) {
    return {
      ...record,
      claim,
    };
  }
  const verification = await models.PartnerHotelVerificationCode.findByPk(verificationId, {
    attributes: VERIFICATION_ATTRIBUTES,
  });
  if (!verification) {
    return {
      ...record,
      claim,
    };
  }

  const resolvedUserId = Number(userId || claim.user_id || 0) || null;
  const updates = {};
  if (!verification.claimed_at) updates.claimed_at = new Date();
  if (resolvedUserId && Number(verification.claimed_by_user_id || 0) !== resolvedUserId) {
    updates.claimed_by_user_id = resolvedUserId;
  }
  if (Object.keys(updates).length) {
    await verification.update(updates);
  }
  return {
    ...record,
    claimed_at: updates.claimed_at || verification.claimed_at || record.claimed_at || null,
    claimed_by_user_id:
      updates.claimed_by_user_id ||
      verification.claimed_by_user_id ||
      record.claimed_by_user_id ||
      null,
    claim,
  };
};
