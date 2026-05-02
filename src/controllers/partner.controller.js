import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import models from "../models/index.js";
import { issueUserSession, loadSafeUser } from "./auth.controller.js";
import { authenticate, authorizeRoles } from "../middleware/auth.js";
import {
  activatePartnerClaimPlan,
  approvePendingPartnerClaim,
  buildPartnerAdminClaimPayload,
  buildPartnerDashboardPayload,
  createPartnerCardCheckout,
  ensurePartnerClaim,
  getPartnerClaimReviewState,
  listPartnerClaimsForAdmin,
  listPartnerClaimsForUser,
  requestPartnerInvoice,
  searchPartnerHotels,
  sendPartnerSequenceEmailIfDue,
  sendPartnerInvoiceRequestedEmail,
  sendPartnerPlanConfirmationEmail,
  simulatePartnerClaimTrial,
} from "../services/partnerLifecycle.service.js";
import {
  getPartnerHotelProfileEditorPayload,
  PARTNER_HOTEL_PROFILE_IMAGE_SOURCE,
  savePartnerHotelProfileEditorPayload,
} from "../services/partnerHotelProfile.service.js";
import { presignIfS3Url } from "../utils/s3Presign.js";
import {
  getPartnerPlanByCode,
  getPartnerPlans,
} from "../services/partnerCatalog.service.js";
import {
  getOrCreatePartnerVerificationCode,
  lookupPartnerVerificationCode,
  markPartnerVerificationCodeClaimed,
} from "../services/partnerVerification.service.js";
import { submitPartnerHotelInquiry } from "../services/partnerInquiry.service.js";
import {
  getPartnerMonthlyReportOverviewForClaim,
  getPartnerMonthlyReportPdfDownloadForClaim,
} from "../services/partnerMonthlyReport.service.js";
import { sendPartnerInternalManualReviewAlert } from "../services/partnerEmail.service.js";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
const DEBUG_PARTNER_GALLERY =
  ["1", "true", "yes", "on"].includes(String(process.env.DEBUG_PARTNER_GALLERY || "").trim().toLowerCase()) ||
  process.env.NODE_ENV !== "production";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const parseBooleanFlag = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};
const normalizeName = ({ name, firstName, lastName, fallbackEmail }) => {
  const explicit = String(name || "").trim();
  if (explicit) return explicit;
  const combined = [String(firstName || "").trim(), String(lastName || "").trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (combined) return combined;
  return String(fallbackEmail || "Partner").split("@")[0] || "Partner";
};

const getBearerTokenFromRequest = (req) => {
  const header = String(req.headers?.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
};

const summarizeGalleryDebugUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return { empty: true };
  try {
    const url = new URL(raw);
    return {
      host: url.host,
      path: url.pathname,
      hasSignature: url.searchParams.has("X-Amz-Signature"),
      queryKeys: Array.from(url.searchParams.keys()),
    };
  } catch {
    return {
      raw: raw.slice(0, 180),
    };
  }
};

const summarizeGalleryDebugItem = (item, index = 0) => ({
  index,
  sourceType: item?.sourceType || null,
  isCover: Boolean(item?.isCover),
  isActive: item?.isActive !== false,
  imageUrl: summarizeGalleryDebugUrl(item?.imageUrl),
  providerImageUrl: summarizeGalleryDebugUrl(item?.providerImageUrl),
});

const probeGalleryDebugItem = async (item, index = 0) => ({
  ...summarizeGalleryDebugItem(item, index),
  imageProbe: await probeGalleryDebugUrl(item?.imageUrl),
  providerImageProbe: await probeGalleryDebugUrl(item?.providerImageUrl),
});

const logGalleryDebug = (label, payload) => {
  if (!DEBUG_PARTNER_GALLERY) return;
  console.log(`[partners-gallery-debug] ${label} ${JSON.stringify(payload, null, 2)}`);
};

const probeGalleryDebugUrl = async (value) => {
  const raw = String(value || "").trim();
  if (!raw) return { empty: true };
  try {
    const response = await fetch(raw, {
      method: "HEAD",
      redirect: "follow",
    });
    return {
      ok: response.ok,
      status: response.status,
      redirected: response.redirected,
      location: response.headers.get("location") || null,
      bucketRegion: response.headers.get("x-amz-bucket-region") || null,
      contentType: response.headers.get("content-type") || null,
      contentLength: response.headers.get("content-length") || null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
    };
  }
};

const resolveOptionalUserTokenPayload = (req) => {
  if (Object.prototype.hasOwnProperty.call(req, "_partnerOptionalUserTokenPayload")) {
    return req._partnerOptionalUserTokenPayload;
  }
  const token = getBearerTokenFromRequest(req);
  if (!token) {
    req._partnerOptionalUserTokenPayload = null;
    return null;
  }
  try {
    req._partnerOptionalUserTokenPayload = jwt.verify(token, ACCESS_SECRET);
  } catch {
    req._partnerOptionalUserTokenPayload = null;
  }
  return req._partnerOptionalUserTokenPayload;
};

const resolveOptionalUserIdFromRequest = (req) => {
  const payload = resolveOptionalUserTokenPayload(req);
  const userId = Number(payload?.id || 0);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
};

const resolveOptionalUserFromRequest = async (req) => {
  if (Object.prototype.hasOwnProperty.call(req, "_partnerOptionalResolvedUser")) {
    return req._partnerOptionalResolvedUser;
  }
  const userId = resolveOptionalUserIdFromRequest(req);
  if (!userId) {
    req._partnerOptionalResolvedUser = null;
    return null;
  }
  req._partnerOptionalResolvedUser = await models.User.findByPk(userId);
  return req._partnerOptionalResolvedUser;
};

const ensurePartnerUser = async (req, res, { allowCreate = true } = {}) => {
  const authenticatedUser = await resolveOptionalUserFromRequest(req);
  if (authenticatedUser) return { user: authenticatedUser, issuedSession: null };

  const email = normalizeEmail(req.body?.email || req.body?.contactEmail);
  const password = String(req.body?.password || "");
  const name = normalizeName({
    name: req.body?.name || req.body?.contactName,
    firstName: req.body?.firstName,
    lastName: req.body?.lastName,
    fallbackEmail: email,
  });

  if (!email || !password) {
    const error = new Error("email and password are required");
    error.status = 400;
    throw error;
  }

  let user = await models.User.findOne({ where: { email } });
  if (user) {
    if (!user.password_hash) {
      const error = new Error("This account does not have a local password");
      error.status = 409;
      throw error;
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const error = new Error("Invalid credentials");
      error.status = 401;
      throw error;
    }
  } else {
    if (!allowCreate) {
      const error = new Error("Sign in with the original partner account for this hotel.");
      error.status = 401;
      throw error;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    user = await models.User.create({
      name,
      first_name: String(req.body?.firstName || "").trim() || null,
      last_name: String(req.body?.lastName || "").trim() || null,
      email,
      password_hash: passwordHash,
      last_login_at: new Date(),
    });
    if (models.GuestProfile) {
      await models.GuestProfile.findOrCreate({ where: { user_id: user.id } });
    }
  }

  await user.update({ last_login_at: new Date() });
  const { accessToken, refreshToken } = await issueUserSession({ user, req, res });
  return {
    user,
    issuedSession: {
      token: accessToken,
      refreshToken,
    },
  };
};

export const listPartnerPlans = async (_req, res) => {
  return res.json({
    items: getPartnerPlans(),
  });
};

export const searchPartnerHotelsController = async (req, res, next) => {
  try {
    const items = await searchPartnerHotels({
      query: req.query?.q ?? req.query?.query,
      limit: req.query?.limit,
    });
    return res.json({ items });
  } catch (error) {
    return next(error);
  }
};

export const previewPartnerVerificationCodeController = async (req, res, next) => {
  try {
    const lookup = await lookupPartnerVerificationCode({
      code: req.body?.code ?? req.body?.verificationCode ?? req.query?.code,
      currentUserId: resolveOptionalUserIdFromRequest(req),
    });
    return res.json({
      item: lookup.item,
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const claimPartnerHotelController = async (req, res, next) => {
  try {
    const directHotelId = String(req.body?.hotelId || "").trim();
    const verificationCodeInput = req.body?.verificationCode ?? req.body?.code;
    let hotelId = directHotelId;
    let verificationLookup = null;

    if (!hotelId) {
      verificationLookup = await lookupPartnerVerificationCode({
        code: verificationCodeInput,
        currentUserId: resolveOptionalUserIdFromRequest(req),
      });
      hotelId = String(verificationLookup?.item?.hotelId || "").trim();
    }

    if (!hotelId) {
      return res.status(400).json({ error: "hotelId or verificationCode is required" });
    }

    const { user, issuedSession } = await ensurePartnerUser(req, res, {
      allowCreate: !verificationLookup?.item?.alreadyClaimed,
    });

    if (verificationLookup) {
      verificationLookup = await lookupPartnerVerificationCode({
        code: verificationLookup.item.code,
        currentUserId: user.id,
      });
    }

    if (
      verificationLookup &&
      !verificationLookup.item.canActivate &&
      !verificationLookup.item.claimedByCurrentUser
    ) {
      const message = verificationLookup.item.alreadyClaimed
        ? "This hotel is already claimed."
        : "This verification code is not available.";
      return res.status(409).json({ error: message });
    }

    const { claim, hotel, created } = await ensurePartnerClaim({
      hotelId,
      userId: user.id,
      contactName: normalizeName({
        name: req.body?.name || req.body?.contactName || user.name,
        firstName: req.body?.firstName || user.first_name,
        lastName: req.body?.lastName || user.last_name,
        fallbackEmail: user.email,
      }),
      contactEmail: normalizeEmail(req.body?.email || req.body?.contactEmail || user.email),
      contactPhone: req.body?.phone || req.body?.contactPhone || user.phone || null,
      claimSource: verificationLookup ? "verify" : req.body?.claimSource || "search",
      requiresManualApproval: !verificationLookup,
    });
    if (verificationLookup?.record) {
      await markPartnerVerificationCodeClaimed({
        record: verificationLookup.record,
        claim,
        userId: user.id,
      });
    }

    const review = getPartnerClaimReviewState(claim);
    const welcomeAlreadySent = Array.isArray(claim?.emailLogs)
      ? claim.emailLogs.some((entry) => entry.email_key === "day_1_welcome")
      : false;
    if (!review.blocked && !welcomeAlreadySent) {
      await sendPartnerSequenceEmailIfDue({
        claim,
        hotel,
        step: { key: "day_1_welcome", day: 1, stopWhenSubscribed: true },
        now: new Date(),
      }).catch(() => {});
    }
    if (created && review.blocked) {
      await sendPartnerInternalManualReviewAlert({
        claim,
        hotel,
        user,
        review,
      }).catch(() => {});
    }

    const safeUser = await loadSafeUser(user.id);
    const claimPayload = buildPartnerDashboardPayload(claim);
    const response = {
      created,
      user: safeUser,
      claim: claimPayload,
      item: claimPayload,
    };
    if (issuedSession?.token) response.token = issuedSession.token;
    if (issuedSession?.refreshToken) response.refreshToken = issuedSession.refreshToken;
    return res.status(created ? 201 : 200).json(response);
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const createPartnerInquiryController = async (req, res, next) => {
  try {
    const result = await submitPartnerHotelInquiry({
      hotelId: req.body?.hotelId,
      travelerUserId: resolveOptionalUserIdFromRequest(req),
      travelerName: req.body?.travelerName ?? req.body?.name,
      travelerEmail: req.body?.travelerEmail ?? req.body?.email,
      travelerPhone: req.body?.travelerPhone ?? req.body?.phone,
      checkIn: req.body?.checkIn,
      checkOut: req.body?.checkOut,
      guestsSummary: req.body?.guestsSummary ?? req.body?.guests,
      message: req.body?.message,
      sourceSurface: req.body?.sourceSurface,
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const getMyPartnerClaimsController = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const hotelId = String(req.query?.hotelId || "").trim() || null;
    const claims = await listPartnerClaimsForUser({ userId, hotelId });
    return res.json({
      items: claims.map((claim) => buildPartnerDashboardPayload(claim)),
    });
  } catch (error) {
    return next(error);
  }
};

const assertPartnerClaimManagementEnabled = (claim, actionLabel = "manage this hotel") => {
  const review = getPartnerClaimReviewState(claim);
  if (!review.blocked) return;
  const error = new Error(
    `This hotel claim is pending manual review. We will unlock the dashboard after the partners team verifies the request, so you cannot ${actionLabel} yet.`,
  );
  error.status = 403;
  throw error;
};

const resolvePartnerHotelIdFromRequest = (req) =>
  String(req.query?.hotelId || req.body?.hotelId || "").trim();

const loadPartnerClaimForProfileManagement = async ({
  userId,
  hotelId,
  actionLabel = "edit the hotel profile",
}) => {
  if (!userId) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }
  if (!hotelId) {
    const error = new Error("hotelId is required");
    error.status = 400;
    throw error;
  }
  const claims = await listPartnerClaimsForUser({ userId, hotelId });
  const claim = claims[0] || null;
  if (!claim) {
    const error = new Error("Partner claim not found");
    error.status = 404;
    throw error;
  }
  assertPartnerClaimManagementEnabled(claim, actionLabel);
  return claim;
};

const buildPartnerGalleryUploadDraftItems = async (uploaded = []) =>
  Promise.all(
    (Array.isArray(uploaded) ? uploaded : []).map(async (item) => ({
      sourceType: PARTNER_HOTEL_PROFILE_IMAGE_SOURCE.partnerUpload,
      providerImageUrl: null,
      imageUrl: (await presignIfS3Url(item?.url || null)) || item?.url || null,
      caption: "",
      isCover: false,
      isActive: true,
    })),
  );

export const listPartnerClaimsAdminController = async (req, res, next) => {
  try {
    const claims = await listPartnerClaimsForAdmin({
      query: req.query?.q ?? req.query?.query,
      status: req.query?.status,
      limit: req.query?.limit,
    });
    return res.json({
      items: claims.map((claim) => buildPartnerAdminClaimPayload(claim)),
    });
  } catch (error) {
    return next(error);
  }
};

export const selectPartnerSubscriptionController = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id || 0);
    const hotelId = String(req.body?.hotelId || "").trim();
    const planCode = String(req.body?.planCode || "").trim().toLowerCase();
    const paymentMethod = String(req.body?.paymentMethod || "card").trim().toLowerCase();
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!hotelId || !planCode) {
      return res.status(400).json({ error: "hotelId and planCode are required" });
    }
    if (!getPartnerPlanByCode(planCode)) {
      return res.status(400).json({ error: "Invalid planCode" });
    }

    const claims = await listPartnerClaimsForUser({ userId, hotelId });
    const claim = claims[0] || null;
    if (!claim) return res.status(404).json({ error: "Partner claim not found" });
    assertPartnerClaimManagementEnabled(claim, "change the subscription");
    const user = await models.User.findByPk(userId);
    const requestBilling = req.body?.billingDetails && typeof req.body.billingDetails === "object"
      ? req.body.billingDetails
      : {};

    if (paymentMethod === "invoice") {
      const accountManagerEmail = normalizeEmail(
        req.body?.accountManagerEmail ||
          requestBilling.accountManagerEmail ||
          requestBilling.accountManager ||
          "",
      );
      const invoiceResult = await requestPartnerInvoice({
        claim,
        user,
        planCode,
        billingDetails: {
          billingName:
            req.body?.billingName ||
            requestBilling.billingName ||
            requestBilling.companyName ||
            claim.contact_name ||
            user?.name ||
            null,
          billingEmail:
            req.body?.billingEmail ||
            requestBilling.billingEmail ||
            claim.contact_email ||
            user?.email ||
            null,
          billingAddress:
            req.body?.billingAddress ||
            requestBilling.billingAddress ||
            requestBilling.notes ||
            null,
          accountManagerEmail: accountManagerEmail || null,
        },
      });
      await sendPartnerInvoiceRequestedEmail({ claim: invoiceResult.claim }).catch(() => {});
      await hydratePartnerClaimsPerformance([invoiceResult.claim]);
      const claimPayload = buildPartnerDashboardPayload(invoiceResult.claim);
      return res.json({
        mode: "invoice",
        invoiceId: invoiceResult.invoiceId,
        invoiceUrl: invoiceResult.invoiceUrl,
        claim: claimPayload,
        item: claimPayload,
      });
    }

    const checkout = await createPartnerCardCheckout({
      claim,
      user,
      planCode,
      successUrl: req.body?.successUrl || null,
      cancelUrl: req.body?.cancelUrl || null,
    });
    if (checkout.claim) {
      await hydratePartnerClaimsPerformance([checkout.claim]);
    }
    const claimPayload = checkout.claim ? buildPartnerDashboardPayload(checkout.claim) : null;
    return res.json({
      mode: checkout.mode,
      checkoutUrl: checkout.url,
      claim: claimPayload,
      item: claimPayload,
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const getOrCreatePartnerVerificationCodeController = async (req, res, next) => {
  try {
    const hotelId = String(req.params?.hotelId || req.body?.hotelId || "").trim();
    if (!hotelId) {
      return res.status(400).json({ error: "hotelId is required" });
    }
    const result = await getOrCreatePartnerVerificationCode({
      hotelId,
      createdByUserId: req.user?.id || null,
    });
    return res.status(result.created ? 201 : 200).json({
      created: result.created,
      item: result.item,
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const getMyPartnerHotelProfileController = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id || 0);
    const hotelId = resolvePartnerHotelIdFromRequest(req);
    await loadPartnerClaimForProfileManagement({ userId, hotelId });

    const payload = await getPartnerHotelProfileEditorPayload({ userId, hotelId });
    const galleryItems = Array.isArray(payload?.editor?.galleryItems) ? payload.editor.galleryItems : [];
    const galleryDebugItems = await Promise.all(
      galleryItems.slice(-3).map((item, index) => probeGalleryDebugItem(item, index)),
    );
    logGalleryDebug("profile-payload", {
      hotelId,
      galleryCount: galleryItems.length,
      items: galleryDebugItems,
    });
    return res.json(payload);
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const getMyPartnerMonthlyReportsController = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id || 0);
    const hotelId = String(req.query?.hotelId || "").trim();
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!hotelId) return res.status(400).json({ error: "hotelId is required" });
    const claims = await listPartnerClaimsForUser({ userId, hotelId });
    const claim = claims[0] || null;
    if (!claim) return res.status(404).json({ error: "Partner claim not found" });
    assertPartnerClaimManagementEnabled(claim, "review monthly reports");

    const payload = await getPartnerMonthlyReportOverviewForClaim({ claim });
    return res.json(payload);
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const downloadMyPartnerMonthlyReportController = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id || 0);
    const hotelId = String(req.query?.hotelId || "").trim();
    const reportMonth = String(req.params?.reportMonth || req.query?.reportMonth || "").trim();
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!hotelId) return res.status(400).json({ error: "hotelId is required" });
    if (!reportMonth) return res.status(400).json({ error: "reportMonth is required" });
    const claims = await listPartnerClaimsForUser({ userId, hotelId });
    const claim = claims[0] || null;
    if (!claim) return res.status(404).json({ error: "Partner claim not found" });
    assertPartnerClaimManagementEnabled(claim, "download monthly reports");

    const result = await getPartnerMonthlyReportPdfDownloadForClaim({
      claim,
      reportMonth,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${result.filename}`);
    return res.end(result.buffer);
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const updateMyPartnerHotelProfileController = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id || 0);
    const hotelId = resolvePartnerHotelIdFromRequest(req);
    await loadPartnerClaimForProfileManagement({ userId, hotelId });

    const payload = await savePartnerHotelProfileEditorPayload({
      userId,
      hotelId,
      payload: req.body || {},
    });
    return res.json(payload);
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const loadMyPartnerHotelProfileClaimController = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id || 0);
    const hotelId = resolvePartnerHotelIdFromRequest(req);
    const claim = await loadPartnerClaimForProfileManagement({ userId, hotelId });
    req.partnerClaim = claim;
    req.partnerHotelId = hotelId;
    return next();
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const uploadMyPartnerHotelProfileGalleryController = async (req, res) => {
  try {
    const uploaded = Array.isArray(req.uploadedImages) ? req.uploadedImages : [];
    const signedUploaded = await Promise.all(
      uploaded.map(async (item) => ({
        ...item,
        url: (await presignIfS3Url(item?.url || null)) || item?.url || null,
      })),
    );
    const draftItems = await buildPartnerGalleryUploadDraftItems(signedUploaded);
    const uploadedDebug = await Promise.all(
      signedUploaded.map(async (item, index) => ({
        index,
        key: item?.key || null,
        url: summarizeGalleryDebugUrl(item?.url),
        urlProbe: await probeGalleryDebugUrl(item?.url),
      })),
    );
    const itemDebug = await Promise.all(
      draftItems.map((item, index) => probeGalleryDebugItem(item, index)),
    );
    logGalleryDebug("upload-response", {
      hotelId: String(req.partnerHotelId || resolvePartnerHotelIdFromRequest(req) || "").trim(),
      uploaded: uploadedDebug,
      items: itemDebug,
    });
    return res.json({
      hotelId: String(req.partnerHotelId || resolvePartnerHotelIdFromRequest(req) || "").trim(),
      uploaded: signedUploaded,
      items: draftItems,
    });
  } catch (error) {
    console.error("[uploadMyPartnerHotelProfileGalleryController]", error);
    return res.status(500).json({ error: "Failed to process gallery upload" });
  }
};

export const activatePartnerInvoiceController = async (req, res, next) => {
  try {
    const claimId = Number(req.params?.claimId || 0);
    if (!claimId) return res.status(400).json({ error: "claimId is required" });
    const claim = await models.PartnerHotelClaim.findByPk(claimId, {
      include: [
        { model: models.WebbedsHotel, as: "hotel", required: false },
        { model: models.PartnerEmailLog, as: "emailLogs", required: false },
      ],
    });
    if (!claim) return res.status(404).json({ error: "Partner claim not found" });
    const planCode = String(
      req.body?.planCode || claim.pending_plan_code || claim.current_plan_code || "",
    )
      .trim()
      .toLowerCase();
    if (!getPartnerPlanByCode(planCode)) {
      return res.status(400).json({ error: "Invalid planCode" });
    }
    const activated = await activatePartnerClaimPlan({
      claim,
      planCode,
      billingMethod: "invoice",
      invoiceId: req.body?.invoiceId || claim.stripe_invoice_id || null,
    });
    await sendPartnerPlanConfirmationEmail({ claim: activated }).catch(() => {});
    await hydratePartnerClaimsPerformance([activated]);
    return res.json({
      claim: buildPartnerDashboardPayload(activated),
    });
  } catch (error) {
    return next(error);
  }
};

export const approvePartnerClaimReviewController = async (req, res, next) => {
  try {
    const claimId = Number(req.params?.claimId || 0);
    if (!claimId) return res.status(400).json({ error: "claimId is required" });
    const claim = await models.PartnerHotelClaim.findByPk(claimId, {
      include: [
        { model: models.WebbedsHotel, as: "hotel", required: false },
        { model: models.PartnerEmailLog, as: "emailLogs", required: false },
      ],
    });
    if (!claim) return res.status(404).json({ error: "Partner claim not found" });
    const approved = await approvePendingPartnerClaim({
      claim,
      approvedByUserId: req.user?.id || null,
    });
    await hydratePartnerClaimsPerformance([approved]);
    return res.json({
      claim: buildPartnerDashboardPayload(approved),
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const simulatePartnerClaimTrialController = async (req, res, next) => {
  try {
    const claimId = Number(req.params?.claimId || 0);
    const result = await simulatePartnerClaimTrial({
      claimId,
      targetDay: req.body?.targetDay ?? req.body?.day,
      resetEmailTimeline: parseBooleanFlag(req.body?.resetEmailTimeline, false),
      runLifecycle: parseBooleanFlag(req.body?.runLifecycle, true),
    });
    return res.json({
      claim: buildPartnerDashboardPayload(result.claim),
      simulation: result.simulation,
      lifecycle: result.lifecycle,
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const partnerControllerMiddleware = {
  authenticate,
  authorizeAdmin: authorizeRoles(100),
};
