import { Op } from "sequelize";
import models from "../models/index.js";
import {
  PARTNER_CLAIM_STATUSES,
  resolvePartnerProgramFromClaim,
} from "./partnerCatalog.service.js";
import { sendPartnerHotelInquiryEmail } from "./partnerEmail.service.js";
import { buildPartnerHotelProfileAssociation } from "./partnerHotelProfileSchema.service.js";

export const PARTNER_HOTEL_INQUIRY_DELIVERY_STATUSES = Object.freeze({
  pending: "PENDING",
  sent: "SENT",
  failed: "FAILED",
});

export const PARTNER_HOTEL_INQUIRY_SURFACES = Object.freeze({
  hotelDetail: "hotel_detail",
  exploreCard: "explore_card",
  mapCard: "map_card",
});

const ACTIVE_INQUIRY_CLAIM_STATUSES = new Set([
  PARTNER_CLAIM_STATUSES.trialActive,
  PARTNER_CLAIM_STATUSES.trialEnding,
  PARTNER_CLAIM_STATUSES.paymentDue,
  PARTNER_CLAIM_STATUSES.subscribed,
]);

const normalizeTrimmedString = (value, maxLength = null) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (Number.isFinite(Number(maxLength)) && Number(maxLength) > 0) {
    return text.slice(0, Number(maxLength));
  }
  return text;
};

const normalizeEmail = (value) => {
  const normalized = normalizeTrimmedString(value, 150);
  return normalized ? normalized.toLowerCase() : null;
};

const normalizeDateOnly = (value) => {
  const normalized = normalizeTrimmedString(value, 10);
  if (!normalized) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const normalizeSurface = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    Object.values(PARTNER_HOTEL_INQUIRY_SURFACES).find((item) => item === normalized) ||
    PARTNER_HOTEL_INQUIRY_SURFACES.hotelDetail
  );
};

const isClaimStatusInquiryEligible = (claimStatus) =>
  ACTIVE_INQUIRY_CLAIM_STATUSES.has(String(claimStatus || "").trim().toUpperCase());

export const resolvePartnerInquiryConfiguration = ({
  claim = null,
  profile = null,
  partnerProgram = null,
} = {}) => {
  const destinationEmail = normalizeEmail(
    profile?.inquiry_email || profile?.contact_email || claim?.contact_email || null,
  );
  const destinationPhone = normalizeTrimmedString(
    profile?.inquiry_phone || profile?.contact_phone || claim?.contact_phone || null,
    40,
  );
  const inquiryNotes = normalizeTrimmedString(profile?.inquiry_notes || null, 500);
  const enabled = Boolean(profile?.inquiry_enabled);
  const planAllowsInquiry = Boolean(partnerProgram?.capabilities?.bookingInquiry);
  const claimStateAllowsInquiry = isClaimStatusInquiryEligible(claim?.claim_status);

  let state = "locked";
  let detail = "Direct traveler inquiry unlocks from Preferred.";
  if (planAllowsInquiry && !claimStateAllowsInquiry) {
    detail = "Inquiry is only live while the partner visibility state is active.";
  } else if (planAllowsInquiry && claimStateAllowsInquiry && !enabled) {
    state = "missing_setup";
    detail = "Enable the inquiry path so travelers can contact the hotel directly.";
  } else if (planAllowsInquiry && claimStateAllowsInquiry && !destinationEmail) {
    state = "missing_setup";
    detail = "Add a delivery email for traveler inquiries.";
  } else if (planAllowsInquiry && claimStateAllowsInquiry && enabled && destinationEmail) {
    state = "ready";
    detail = "Traveler inquiries are live and route directly to the hotel.";
  }

  return {
    enabled,
    destinationEmail,
    destinationPhone,
    inquiryNotes,
    planAllowsInquiry,
    claimStateAllowsInquiry,
    ready: state === "ready",
    state,
    detail,
  };
};

export const resolvePartnerInquiryStatus = ({
  claim = null,
  profile = null,
  partnerProgram = null,
  latestInquiry = null,
  metrics = null,
} = {}) => {
  const configuration = resolvePartnerInquiryConfiguration({
    claim,
    profile,
    partnerProgram,
  });

  let state = configuration.state;
  let label =
    state === "ready"
      ? "Ready"
      : state === "missing_setup"
        ? "Needs setup"
        : "Locked by plan";
  let detail = configuration.detail;

  if (
    configuration.ready &&
    String(latestInquiry?.delivery_status || "").trim().toUpperCase() ===
      PARTNER_HOTEL_INQUIRY_DELIVERY_STATUSES.failed
  ) {
    state = "delivery_issue";
    label = "Delivery issue";
    detail =
      latestInquiry?.error_message ||
      "The latest inquiry delivery failed. Check the routing email and try again.";
  }

  return {
    state,
    label,
    detail,
    ready: state === "ready",
    enabled: configuration.enabled,
    destinationEmail: configuration.destinationEmail,
    destinationPhone: configuration.destinationPhone,
    inquiryNotes: configuration.inquiryNotes,
    lastInquiryAt: latestInquiry?.created_at || latestInquiry?.createdAt || null,
    lastDeliveryStatus: latestInquiry?.delivery_status || null,
    lastDeliveryError: latestInquiry?.error_message || null,
    metrics: {
      total: Number(metrics?.total || 0) || 0,
      last30Days: Number(metrics?.last30Days || 0) || 0,
    },
  };
};

export const buildPublicPartnerInquiryPayload = ({
  claim = null,
  profile = null,
  partnerProgram = null,
} = {}) => {
  const configuration = resolvePartnerInquiryConfiguration({
    claim,
    profile,
    partnerProgram,
  });
  if (!configuration.ready) return null;
  return {
    enabled: true,
    ctaLabel: "Send inquiry",
    notes: configuration.inquiryNotes || null,
  };
};

export const getPartnerInquirySummaryForClaim = async ({ claimId } = {}) => {
  const resolvedClaimId = Number(claimId || 0);
  if (!Number.isFinite(resolvedClaimId) || resolvedClaimId <= 0) {
    return {
      latestInquiry: null,
      metrics: {
        total: 0,
        last30Days: 0,
      },
    };
  }

  const since30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [latestInquiry, total, last30Days] = await Promise.all([
    models.PartnerHotelInquiry.findOne({
      where: { claim_id: resolvedClaimId },
      order: [["created_at", "DESC"]],
    }),
    models.PartnerHotelInquiry.count({
      where: { claim_id: resolvedClaimId },
    }),
    models.PartnerHotelInquiry.count({
      where: {
        claim_id: resolvedClaimId,
        created_at: { [Op.gte]: since30Days },
      },
    }),
  ]);

  return {
    latestInquiry,
    metrics: {
      total,
      last30Days,
    },
  };
};

export const submitPartnerHotelInquiry = async ({
  hotelId,
  travelerUserId = null,
  travelerName,
  travelerEmail,
  travelerPhone = null,
  checkIn = null,
  checkOut = null,
  guestsSummary = null,
  message,
  sourceSurface = PARTNER_HOTEL_INQUIRY_SURFACES.hotelDetail,
} = {}) => {
  const resolvedHotelId = String(hotelId || "").trim();
  if (!resolvedHotelId) {
    const error = new Error("hotelId is required");
    error.status = 400;
    throw error;
  }

  let resolvedTravelerName = normalizeTrimmedString(travelerName, 150);
  let resolvedTravelerEmail = normalizeEmail(travelerEmail);
  const resolvedTravelerPhone = normalizeTrimmedString(travelerPhone, 40);
  const resolvedCheckIn = normalizeDateOnly(checkIn);
  const resolvedCheckOut = normalizeDateOnly(checkOut);
  const resolvedGuestsSummary = normalizeTrimmedString(guestsSummary, 120);
  const resolvedMessage = normalizeTrimmedString(message, 2000);
  const resolvedTravelerUserId = Number(travelerUserId || 0) || null;

  if (resolvedTravelerUserId && (!resolvedTravelerName || !resolvedTravelerEmail)) {
    const travelerUser = await models.User.findByPk(resolvedTravelerUserId, {
      attributes: ["id", "name", "email"],
    });
    if (!resolvedTravelerName) {
      resolvedTravelerName = normalizeTrimmedString(travelerUser?.name || null, 150);
    }
    if (!resolvedTravelerEmail) {
      resolvedTravelerEmail = normalizeEmail(travelerUser?.email || null);
    }
  }

  if (!resolvedTravelerName) {
    const error = new Error("Traveler name is required");
    error.status = 400;
    throw error;
  }
  if (!resolvedTravelerEmail) {
    const error = new Error("Traveler email is required");
    error.status = 400;
    throw error;
  }
  if (!resolvedMessage) {
    const error = new Error("Inquiry message is required");
    error.status = 400;
    throw error;
  }
  if (resolvedCheckIn && resolvedCheckOut && resolvedCheckOut < resolvedCheckIn) {
    const error = new Error("Check-out must be after check-in");
    error.status = 400;
    throw error;
  }

  const claim = await models.PartnerHotelClaim.findOne({
    where: { hotel_id: resolvedHotelId },
    include: [
      {
        model: models.WebbedsHotel,
        as: "hotel",
        required: false,
      },
      await buildPartnerHotelProfileAssociation(),
    ],
  });
  if (!claim) {
    const error = new Error("Partner hotel not found");
    error.status = 404;
    throw error;
  }

  const partnerProgram = resolvePartnerProgramFromClaim(claim);
  const inquiryStatus = resolvePartnerInquiryStatus({
    claim,
    profile: claim.hotelProfile,
    partnerProgram,
  });
  if (!inquiryStatus.ready) {
    const error = new Error(
      inquiryStatus.state === "locked"
        ? "Inquiry is not available for this hotel."
        : "This hotel is not ready to receive inquiries yet.",
    );
    error.status = 403;
    throw error;
  }

  const inquiry = await models.PartnerHotelInquiry.create({
    hotel_id: claim.hotel_id,
    claim_id: claim.id,
    traveler_user_id: resolvedTravelerUserId,
    traveler_name: resolvedTravelerName,
    traveler_email: resolvedTravelerEmail,
    traveler_phone: resolvedTravelerPhone,
    check_in: resolvedCheckIn,
    check_out: resolvedCheckOut,
    guests_summary: resolvedGuestsSummary,
    inquiry_message: resolvedMessage,
    source_surface: normalizeSurface(sourceSurface),
    delivery_status: PARTNER_HOTEL_INQUIRY_DELIVERY_STATUSES.pending,
    delivered_to_email: inquiryStatus.destinationEmail,
  });

  try {
    await sendPartnerHotelInquiryEmail({
      claim,
      hotel: claim.hotel,
      inquiry,
      destinationEmail: inquiryStatus.destinationEmail,
    });
    await inquiry.update({
      delivery_status: PARTNER_HOTEL_INQUIRY_DELIVERY_STATUSES.sent,
      delivered_at: new Date(),
      error_message: null,
    });
  } catch (deliveryError) {
    await inquiry.update({
      delivery_status: PARTNER_HOTEL_INQUIRY_DELIVERY_STATUSES.failed,
      error_message: String(deliveryError?.message || "Inquiry delivery failed"),
    });
    const error = new Error("Unable to send the inquiry right now.");
    error.status = 502;
    throw error;
  }

  return {
    inquiry,
    item: {
      inquiryId: inquiry.id,
      hotelId: claim.hotel_id != null ? String(claim.hotel_id) : null,
      status: "sent",
      deliveredToEmail: inquiryStatus.destinationEmail,
      deliveredAt: inquiry.delivered_at || new Date(),
    },
  };
};
