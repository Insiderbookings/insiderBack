import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import models from "../models/index.js";
import { issueUserSession, loadSafeUser } from "./auth.controller.js";
import { authenticate, authorizeRoles } from "../middleware/auth.js";
import {
  activatePartnerClaimPlan,
  buildPartnerDashboardPayload,
  createPartnerCardCheckout,
  ensurePartnerClaim,
  listPartnerClaimsForUser,
  logPartnerEmail,
  requestPartnerInvoice,
  searchPartnerHotels,
  sendPartnerSequenceEmailIfDue,
  sendPartnerInvoiceRequestedEmail,
  sendPartnerPlanConfirmationEmail,
} from "../services/partnerLifecycle.service.js";
import {
  getPartnerPlanByCode,
  getPartnerPlans,
} from "../services/partnerCatalog.service.js";

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
  if (authenticatedUser) return { user: authenticatedUser, issuedSession: null };

  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const name = normalizeName({
    name: req.body?.name,
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
        name: req.body?.name || user.name,
        firstName: req.body?.firstName || user.first_name,
        lastName: req.body?.lastName || user.last_name,
        fallbackEmail: user.email,
      }),
      contactEmail: normalizeEmail(req.body?.email || user.email),
      contactPhone: req.body?.phone || user.phone || null,
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

    const safeUser = await loadSafeUser(user.id);
    const response = {
      created,
      user: safeUser,
      claim: buildPartnerDashboardPayload(claim),
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
    const claims = await listPartnerClaimsForUser({ userId, hotelId });
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

    const claims = await listPartnerClaimsForUser({ userId, hotelId });
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
      return res.json({
        mode: "invoice",
        invoiceId: invoiceResult.invoiceId,
        invoiceUrl: invoiceResult.invoiceUrl,
        claim: buildPartnerDashboardPayload(invoiceResult.claim),
      });
    }

    const checkout = await createPartnerCardCheckout({
      claim,
      user,
      planCode,
      successUrl: req.body?.successUrl || null,
      cancelUrl: req.body?.cancelUrl || null,
    });
    return res.json({
      mode: checkout.mode,
      checkoutUrl: checkout.url,
      claim: checkout.claim ? buildPartnerDashboardPayload(checkout.claim) : null,
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
    return res.json({
      claim: buildPartnerDashboardPayload(activated),
    });
  } catch (error) {
    return next(error);
  }
};

export const partnerControllerMiddleware = {
  authenticate,
  authorizeAdmin: authorizeRoles(100),
};
