import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import models from "../models/index.js";
import { issueUserSession, loadSafeUser } from "./auth.controller.js";
import { authenticate, authorizeRoles } from "../middleware/auth.js";
import {
  activatePartnerClaimPlan,
  buildPartnerDashboardPayload,
  cancelPartnerClaimOrSubscription,
  createPartnerCardCheckout,
  ensurePartnerVerificationCode,
  ensurePartnerClaim,
  generatePartnerMonthlyReport,
  listPartnerDestinationEmailCandidates,
  listPartnerClaimsForUser,
  logPartnerEmail,
  requestPartnerInvoice,
  sendPartnerDestinationEmailTest,
  searchPartnerHotels,
  submitPartnerHotelInquiry,
  updatePartnerClaimProfile,
  verifyPartnerHotelCode,
  sendPartnerSequenceEmailIfDue,
  sendPartnerInvoiceRequestedEmail,
  sendPartnerPlanConfirmationEmail,
  hydrateSinglePartnerDashboardClaim,
  updatePartnerClaimAccountManager,
} from "../services/partnerLifecycle.service.js";
import {
  getPartnerPlanByCode,
  getPartnerPlans,
} from "../services/partnerCatalog.service.js";
import {
  createPartnerMetricAdjustment,
  listPartnerMetricAdjustments,
  trackPartnerMetricEvent,
} from "../services/partnerMetrics.service.js";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
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

const resolveOptionalUserFromRequest = async (req) => {
  const header = String(req.headers?.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    const userId = Number(payload?.id || 0);
    if (!userId) return null;
    return models.User.findByPk(userId);
  } catch {
    return null;
  }
};

const ensurePartnerUser = async (req, res) => {
  const authenticatedUser = await resolveOptionalUserFromRequest(req);
  const email = normalizeEmail(req.body?.email || req.body?.contactEmail);
  const password = String(req.body?.password || "");
  if (authenticatedUser) {
    const authenticatedEmail = normalizeEmail(authenticatedUser.email);
    if (!email || email === authenticatedEmail) {
      return { user: authenticatedUser, issuedSession: null };
    }
    if (!password) {
      const error = new Error("Password is required to switch the partner claim to another account");
      error.status = 400;
      throw error;
    }
  }
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

export const claimPartnerHotelController = async (req, res, next) => {
  try {
    const hotelId = String(req.body?.hotelId || "").trim();
    if (!hotelId) {
      return res.status(400).json({ error: "hotelId is required" });
    }

    const { user, issuedSession } = await ensurePartnerUser(req, res);
    const { claim, hotel, created } = await ensurePartnerClaim({
      hotelId,
      userId: user.id,
      contactName: normalizeName({
        name: req.body?.contactName || req.body?.name || user.name,
        firstName: req.body?.firstName || user.first_name,
        lastName: req.body?.lastName || user.last_name,
        fallbackEmail: user.email,
      }),
      contactEmail: normalizeEmail(req.body?.contactEmail || req.body?.email || user.email),
      contactPhone: req.body?.contactPhone || req.body?.phone || user.phone || null,
    });

    const welcomeAlreadySent = Array.isArray(claim?.emailLogs)
      ? claim.emailLogs.some((entry) => entry.email_key === "day_1_welcome")
      : false;
    if (!welcomeAlreadySent) {
      await sendPartnerSequenceEmailIfDue({
        claim,
        hotel,
        step: { key: "day_1_welcome", day: 1, stopWhenSubscribed: true },
        now: new Date(),
      }).catch(async () => {
        await logPartnerEmail({
          claim,
          emailKey: "day_1_welcome",
          scheduleDay: 1,
          meta: { skippedByError: true },
        }).catch(() => {});
      });
    }

    await hydrateSinglePartnerDashboardClaim(claim);
    const safeUser = await loadSafeUser(user.id);
    const response = {
      created,
      user: safeUser,
      claim: buildPartnerDashboardPayload(claim),
      item: buildPartnerDashboardPayload(claim),
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

export const verifyPartnerHotelController = async (req, res, next) => {
  try {
    const verificationCode = String(req.body?.verificationCode || req.body?.code || "").trim();
    if (!verificationCode) {
      return res.status(400).json({ error: "verificationCode is required" });
    }

    const { user, issuedSession } = await ensurePartnerUser(req, res);
    const { claim, hotel, created, verificationCode: normalizedCode } = await verifyPartnerHotelCode({
      verificationCode,
      userId: user.id,
      contactName: normalizeName({
        name: req.body?.contactName || req.body?.name || user.name,
        firstName: req.body?.firstName || user.first_name,
        lastName: req.body?.lastName || user.last_name,
        fallbackEmail: user.email,
      }),
      contactEmail: normalizeEmail(req.body?.contactEmail || req.body?.email || user.email),
      contactPhone: req.body?.contactPhone || req.body?.phone || user.phone || null,
    });

    const welcomeAlreadySent = Array.isArray(claim?.emailLogs)
      ? claim.emailLogs.some((entry) => entry.email_key === "day_1_welcome")
      : false;
    if (!welcomeAlreadySent) {
      await sendPartnerSequenceEmailIfDue({
        claim,
        hotel,
        step: { key: "day_1_welcome", day: 1, stopWhenSubscribed: true },
        now: new Date(),
      }).catch(async () => {
        await logPartnerEmail({
          claim,
          emailKey: "day_1_welcome",
          scheduleDay: 1,
          meta: { skippedByError: true },
        }).catch(() => {});
      });
    }

    await hydrateSinglePartnerDashboardClaim(claim);
    const safeUser = await loadSafeUser(user.id);
    const response = {
      created,
      verificationCode: normalizedCode,
      user: safeUser,
      claim: buildPartnerDashboardPayload(claim),
      item: buildPartnerDashboardPayload(claim),
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

export const getMyPartnerClaimsController = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const hotelId = String(req.query?.hotelId || "").trim() || null;
    const claims = await listPartnerClaimsForUser({
      userId,
      userEmail: normalizeEmail(req.user?.email),
      hotelId,
    });
    return res.json({
      items: claims.map((claim) => buildPartnerDashboardPayload(claim)),
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

    const claims = await listPartnerClaimsForUser({
      userId,
      userEmail: normalizeEmail(req.user?.email),
      hotelId,
    });
    const claim = claims[0] || null;
    if (!claim) return res.status(404).json({ error: "Partner claim not found" });
    const user = await models.User.findByPk(userId);

    if (paymentMethod === "invoice") {
      const invoiceResult = await requestPartnerInvoice({
        claim,
        user,
        planCode,
        billingDetails: {
          billingName: req.body?.billingName || claim.contact_name || user?.name || null,
          billingEmail: req.body?.billingEmail || claim.contact_email || user?.email || null,
          billingAddress: req.body?.billingAddress || null,
        },
      });
      await sendPartnerInvoiceRequestedEmail({ claim: invoiceResult.claim }).catch(() => {});
      await hydrateSinglePartnerDashboardClaim(invoiceResult.claim);
      return res.json({
        mode: "invoice",
        invoiceId: invoiceResult.invoiceId,
        invoiceUrl: invoiceResult.invoiceUrl,
        claim: buildPartnerDashboardPayload(invoiceResult.claim),
        item: buildPartnerDashboardPayload(invoiceResult.claim),
      });
    }

    const checkout = await createPartnerCardCheckout({
      claim,
      user,
      planCode,
      successUrl: req.body?.successUrl || null,
      cancelUrl: req.body?.cancelUrl || null,
    });
    await hydrateSinglePartnerDashboardClaim(checkout.claim);
    return res.json({
      mode: checkout.mode,
      checkoutUrl: checkout.url,
      claim: checkout.claim ? buildPartnerDashboardPayload(checkout.claim) : null,
      item: checkout.claim ? buildPartnerDashboardPayload(checkout.claim) : null,
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const cancelPartnerSubscriptionController = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id || 0);
    const hotelId = String(req.body?.hotelId || "").trim();
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!hotelId) return res.status(400).json({ error: "hotelId is required" });

    const claims = await listPartnerClaimsForUser({
      userId,
      userEmail: normalizeEmail(req.user?.email),
      hotelId,
    });
    const claim = claims[0] || null;
    if (!claim) return res.status(404).json({ error: "Partner claim not found" });

    const cancelled = await cancelPartnerClaimOrSubscription({
      claim,
      reason: String(req.body?.reason || "dashboard_request").trim() || "dashboard_request",
    });
    await hydrateSinglePartnerDashboardClaim(cancelled);

    return res.json({
      claim: buildPartnerDashboardPayload(cancelled),
      item: buildPartnerDashboardPayload(cancelled),
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const updatePartnerProfileController = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id || 0);
    const hotelId = String(req.body?.hotelId || "").trim();
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!hotelId) return res.status(400).json({ error: "hotelId is required" });

    const claims = await listPartnerClaimsForUser({
      userId,
      userEmail: normalizeEmail(req.user?.email),
      hotelId,
    });
    const claim = claims[0] || null;
    if (!claim) return res.status(404).json({ error: "Partner claim not found" });

    const updated = await updatePartnerClaimProfile({
      claim,
      updates: req.body || {},
    });
    await hydrateSinglePartnerDashboardClaim(updated);
    return res.json({
      claim: buildPartnerDashboardPayload(updated),
      item: buildPartnerDashboardPayload(updated),
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const submitPartnerInquiryController = async (req, res, next) => {
  try {
    const optionalUser = await resolveOptionalUserFromRequest(req);
    const result = await submitPartnerHotelInquiry({
      hotelId: req.body?.hotelId,
      travelerName: req.body?.travelerName || req.body?.name || optionalUser?.name || null,
      travelerEmail: req.body?.travelerEmail || req.body?.email || optionalUser?.email || null,
      travelerPhone: req.body?.travelerPhone || req.body?.phone || optionalUser?.phone || null,
      message: req.body?.message,
      checkIn: req.body?.checkIn || null,
      checkOut: req.body?.checkOut || null,
      sourceSurface: req.body?.sourceSurface || null,
    });

    return res.status(201).json({
      ok: true,
      item: result,
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
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
    await hydrateSinglePartnerDashboardClaim(activated);
    return res.json({
      claim: buildPartnerDashboardPayload(activated),
      item: buildPartnerDashboardPayload(activated),
    });
  } catch (error) {
    return next(error);
  }
};

export const ensurePartnerVerificationCodeController = async (req, res, next) => {
  try {
    const hotelId = String(req.params?.hotelId || req.body?.hotelId || "").trim();
    if (!hotelId) return res.status(400).json({ error: "hotelId is required" });
    const verification = await ensurePartnerVerificationCode({
      hotelId,
      generatedByUserId: req.user?.id || null,
    });

    return res.json({
      item: {
        hotelId: String(verification.hotel_id),
        verificationCode: verification.verification_code,
        generatedAt: verification.generated_at || verification.created_at || null,
        usedAt: verification.used_at || null,
      },
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const updatePartnerAccountManagerController = async (req, res, next) => {
  try {
    const claimId = Number(req.params?.claimId || req.body?.claimId || 0);
    if (!claimId) return res.status(400).json({ error: "claimId is required" });

    const claim = await models.PartnerHotelClaim.findByPk(claimId, {
      include: [
        {
          model: models.WebbedsHotel,
          as: "hotel",
          required: false,
          include: [
            {
              model: models.WebbedsHotelAmenity,
              as: "hotelAmenities",
              required: false,
              attributes: ["id", "category", "item_name", "catalog_code"],
            },
          ],
        },
        { model: models.PartnerEmailLog, as: "emailLogs", required: false },
        { model: models.PartnerInquiryLog, as: "inquiryLogs", required: false },
      ],
    });
    if (!claim) return res.status(404).json({ error: "Partner claim not found" });

    const updated = await updatePartnerClaimAccountManager({
      claim,
      updates: req.body || {},
      updatedByUserId: req.user?.id || null,
    });
    await hydrateSinglePartnerDashboardClaim(updated);
    return res.json({
      claim: buildPartnerDashboardPayload(updated),
      item: buildPartnerDashboardPayload(updated),
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const trackPartnerMetricEventController = async (req, res, next) => {
  try {
    const result = await trackPartnerMetricEvent({
      hotelId: req.body?.hotelId,
      userId: req.user?.id || null,
      sessionId: req.body?.sessionId || null,
      dedupeKey: req.body?.dedupeKey || null,
      eventType: req.body?.eventType,
      surface: req.body?.surface,
      placement: req.body?.placement || null,
      sourceChannel: req.body?.sourceChannel || null,
      pagePath: req.body?.pagePath || req.body?.url || null,
      referrer: req.body?.referrer || null,
      meta: req.body?.meta || null,
    });
    return res.status(200).json({ ok: true, tracked: Boolean(result?.tracked) });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const listPartnerMetricAdjustmentsController = async (req, res, next) => {
  try {
    const hotelId = String(req.params?.hotelId || "").trim();
    if (!hotelId) return res.status(400).json({ error: "hotelId is required" });
    const items = await listPartnerMetricAdjustments({
      hotelId,
      limit: req.query?.limit,
    });
    return res.json({
      items: items.map((item) => ({
        id: item.id,
        hotelId: String(item.hotel_id),
        metricType: item.metric_type,
        source: item.source,
        periodStart: item.period_start,
        periodEnd: item.period_end,
        value: item.value,
        note: item.note || "",
        createdAt: item.created_at || null,
        enteredBy: item.enteredBy
          ? {
              id: item.enteredBy.id,
              name: item.enteredBy.name || null,
              email: item.enteredBy.email || null,
            }
          : null,
      })),
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const createPartnerMetricAdjustmentController = async (req, res, next) => {
  try {
    const hotelId = String(req.params?.hotelId || "").trim();
    if (!hotelId) return res.status(400).json({ error: "hotelId is required" });
    const adjustment = await createPartnerMetricAdjustment({
      hotelId,
      value: req.body?.value,
      note: req.body?.note || null,
      periodStart: req.body?.periodStart,
      periodEnd: req.body?.periodEnd,
      enteredByUserId: req.user?.id || null,
      source: req.body?.source || null,
      meta: req.body?.meta || null,
    });
    return res.status(201).json({
      item: {
        id: adjustment.id,
        hotelId: String(adjustment.hotel_id),
        metricType: adjustment.metric_type,
        source: adjustment.source,
        periodStart: adjustment.period_start,
        periodEnd: adjustment.period_end,
        value: adjustment.value,
        note: adjustment.note || "",
        createdAt: adjustment.created_at || null,
      },
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const previewPartnerDestinationEmailController = async (req, res, next) => {
  try {
    const items = await listPartnerDestinationEmailCandidates({
      city: req.query?.city || req.query?.destination || null,
      country: req.query?.country || null,
      limit: req.query?.limit || null,
    });
    return res.json({ items });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const sendPartnerDestinationEmailTestController = async (req, res, next) => {
  try {
    const result = await sendPartnerDestinationEmailTest({
      city: req.body?.city || req.body?.destination || null,
      country: req.body?.country || null,
      recipients: req.body?.recipients || req.body?.recipientEmail || null,
      subject: req.body?.subject || null,
      intro: req.body?.intro || null,
      limit: req.body?.limit || null,
      triggeredByUser: req.user || null,
    });
    return res.status(201).json({
      item: result,
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
};

export const downloadPartnerMonthlyReportController = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id || 0);
    const hotelId = String(req.params?.hotelId || req.query?.hotelId || "").trim();
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!hotelId) return res.status(400).json({ error: "hotelId is required" });

    const claims = await listPartnerClaimsForUser({
      userId,
      userEmail: normalizeEmail(req.user?.email),
      hotelId,
    });
    const claim = claims[0] || null;
    if (!claim) return res.status(404).json({ error: "Partner claim not found" });

    const report = await generatePartnerMonthlyReport({
      claim,
      month: req.query?.month || null,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${report.filename}`);
    return res.send(report.pdfBuffer);
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
