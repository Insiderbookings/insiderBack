import { Op } from "sequelize";
import models from "../models/index.js";
import {
  buildHostOnboardingState,
  ensureHostOnboardingMetadata,
} from "../utils/hostOnboarding.js";
import { getStripeClient } from "../services/payoutProviders.js";
import {
  confirmPhoneVerificationCode,
  isPhoneVerificationConfigured,
  requestPhoneVerificationCode,
} from "../services/phoneVerification.service.js";
import { createCurrencyConverter } from "../services/currency.service.js";
import { computeHomeFinancialsFromStay } from "../utils/homePricing.js";

// Format YYYY-MM-DD using local time to avoid timezone off-by-one errors
const formatDate = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = ("0" + (d.getMonth() + 1)).slice(-2);
  const day = ("0" + d.getDate()).slice(-2);
  return `${year}-${month}-${day}`;
};

const getCoverImage = (home) => {
  const media = home?.media ?? [];
  const cover = media.find((item) => item.is_cover) ?? media[0];
  return cover?.url ?? null;
};

const buildStayHomeFilter = (hostId) => ({
  host_id: hostId,
});

const getHomeSnapshot = (home) => {
  if (!home) return null;
  return {
    id: home.id,
    title: home.title,
    city: home.address?.city || null,
    country: home.address?.country || null,
    coverImage: getCoverImage(home),
  };
};

const ensurePayoutItemsForHost = async (hostId) => {
  if (!hostId) return;
  const existing = await models.PayoutItem.findAll({
    attributes: ["stay_id"],
    where: { user_id: hostId },
  });
  const existingIds = new Set(existing.map((row) => row.stay_id));

  const stays = await models.Stay.findAll({
    where: {
      inventory_type: "HOME",
      status: "COMPLETED",
      payment_status: "PAID",
      id: { [Op.notIn]: Array.from(existingIds) },
    },
    include: [
      {
        model: models.StayHome,
        as: "homeStay",
        required: true,
        where: buildStayHomeFilter(hostId),
      },
    ],
  });

  if (!stays.length) return;
  const payload = stays.map((stay) => {
    const financials = computeHomeFinancialsFromStay(stay);
    return {
      stay_id: stay.id,
      user_id: hostId,
      amount: financials.hostPayout,
      currency: financials.currency || stay.currency || "USD",
      status: "PENDING",
      scheduled_for: stay.check_out || stay.check_in || null,
      metadata: {
        source: "earnings-backfill",
        createdAt: new Date(),
        pricing_model: financials.model,
        guest_total: financials.guestTotal,
        gross_price: financials.hostSubtotal,
        fee_amount: financials.hostServiceFee,
        platform_markup_amount: financials.platformMarkupAmount,
        effective_platform_revenue: financials.effectivePlatformRevenue,
      },
    };
  });

  try {
    await models.PayoutItem.bulkCreate(payload, { ignoreDuplicates: true });
  } catch {
    for (const item of payload) {
      try {
        await models.PayoutItem.create(item);
      } catch (err) {
        if (!String(err?.name || "").includes("SequelizeUniqueConstraintError")) {
          console.warn("[host-earnings] payout item create failed", err?.message || err);
        }
      }
    }
  }
};

const parseDateOnly = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
};

const toMillis = (value) => {
  if (!value) return 0;
  const parsed = new Date(value);
  const time = parsed.getTime();
  return Number.isNaN(time) ? 0 : time;
};

const asPlainObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const PHONE_CHANNELS = new Set(["sms", "call"]);
const PHONE_CODE_PATTERN = /^\d{4,10}$/;
const PHONE_RESEND_SECONDS_RAW = Number(process.env.PHONE_VERIFICATION_RESEND_SECONDS);
const PHONE_RESEND_SECONDS =
  Number.isFinite(PHONE_RESEND_SECONDS_RAW) && PHONE_RESEND_SECONDS_RAW >= 30
    ? Math.min(PHONE_RESEND_SECONDS_RAW, 300)
    : 60;

const normalizePhoneChannel = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  return PHONE_CHANNELS.has(raw) ? raw : "sms";
};

const normalizePhoneE164 = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const compact = raw.replace(/[\s\-()]/g, "");
  if (!compact.startsWith("+")) return "";
  const normalized = `+${compact.slice(1).replace(/\D/g, "")}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return "";
  return normalized;
};

const maskPhone = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "your phone number";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "your phone number";
  if (digits.length <= 4) return `+${digits}`;
  return `+${digits.slice(0, 2)}******${digits.slice(-2)}`;
};

const resolveIdentityReturnUrl = () => {
  const explicit = String(process.env.STRIPE_IDENTITY_RETURN_URL || "").trim();
  if (explicit) return explicit;
  return "https://bookinggpt.app/host-identity/complete";
};

const normalizeIdentityReturnUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    const protocol = String(parsed.protocol || "").toLowerCase();
    if (protocol !== "https:" && protocol !== "http:") return null;
    if (isProd && protocol !== "https:") return null;

    const host = String(parsed.hostname || "").toLowerCase();
    const isBookingHost = host === "bookinggpt.app" || host.endsWith(".bookinggpt.app");
    const isLocalHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
    if (!isBookingHost && !( !isProd && isLocalHost)) return null;

    const path = String(parsed.pathname || "");
    if (!path.startsWith("/host-identity")) return null;

    return parsed.toString();
  } catch {
    return null;
  }
};

export const getHostBookingsList = async (req, res) => {
  const hostId = Number(req.user?.id);
  if (!hostId) return res.status(400).json({ error: "Invalid host ID" });

  const {
    status,
    from,
    to,
    limit = 50,
    offset = 0,
  } = req.query;

  const parsedStatuses = typeof status === "string"
    ? status
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
    : [];

  const where = {
    inventory_type: "HOME",
  };

  if (parsedStatuses.length) {
    where.status = { [Op.in]: parsedStatuses };
  }

  const andConditions = [];
  if (from) {
    andConditions.push({ check_out: { [Op.gt]: from } });
  }
  if (to) {
    andConditions.push({ check_in: { [Op.lt]: to } });
  }
  if (andConditions.length) {
    where[Op.and] = andConditions;
  }

  try {
    const result = await models.Stay.findAndCountAll({
      where,
      include: [
        {
          model: models.StayHome,
          as: "homeStay",
          required: true,
          where: buildStayHomeFilter(hostId),
          include: [
            {
              model: models.Home,
              as: "home",
              required: true,
              where: { host_id: hostId },
              attributes: ["id", "title", "city", "country", "status"],
              include: [
                {
                  model: models.HomeMedia,
                  as: "media",
                  attributes: ["id", "url", "is_cover", "order"],
                  separate: true,
                  limit: 1,
                  order: [
                    ["is_cover", "DESC"],
                    ["order", "ASC"],
                    ["id", "ASC"],
                  ],
                },
              ],
            },
          ],
        },
        {
          model: models.User,
          attributes: ["id", "name", "email", "phone"],
          required: false,
        },
      ],
      order: [
        ["check_in", "DESC"],
        ["id", "DESC"],
      ],
      limit: Number(limit),
      offset: Number(offset),
    });

    const items = result.rows.map((stay) => {
      const home = stay.homeStay?.home;
      return {
        id: stay.id,
        bookingRef: stay.booking_ref ?? stay.id,
        checkIn: stay.check_in,
        checkOut: stay.check_out,
        nights: stay.nights,
        status: stay.status,
        paymentStatus: stay.payment_status,
        grossPrice: Number(stay.gross_price ?? 0),
        currency: stay.currency,
        guest: {
          name: stay.guest_name,
          email: stay.guest_email,
          phone: stay.guest_phone,
          userId: stay.User?.id ?? null,
        },
        home: home
          ? {
            id: home.id,
            title: home.title,
            city: home.city,
            country: home.country,
            status: home.status,
            coverImage: getCoverImage(home),
          }
          : null,
        createdAt: stay.createdAt,
        updatedAt: stay.updatedAt,
      };
    });

    return res.json({
      total: result.count,
      items,
    });
  } catch (error) {
    console.error("getHostBookingsList error:", error);
    return res.status(500).json({ error: "Unable to load bookings" });
  }
};

export const getHostDashboard = async (req, res) => {
  const hostId = Number(req.user?.id);
  if (!hostId) return res.status(400).json({ error: "Invalid host ID" });

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  const startDate = formatDate(start);
  const endDate = formatDate(end);

  try {
    const reservations = await models.Stay.findAll({
      where: {
        inventory_type: "HOME",
        status: { [Op.in]: ["PENDING", "CONFIRMED"] },
        [Op.or]: [
          // In-house right now
          {
            check_in: { [Op.lte]: startDate },
            check_out: { [Op.gte]: startDate },
          },
          // Arrivals within the next 30 days
          {
            check_in: { [Op.between]: [startDate, endDate] },
          },
        ],
      },
      include: [
        {
          model: models.StayHome,
          as: "homeStay",
          required: true,
          where: buildStayHomeFilter(hostId),
          include: [
            {
              model: models.Home,
              as: "home",
              required: true,
              where: { host_id: hostId },
              attributes: ["id", "title", "status"],
              include: [
                {
                  model: models.HomeAddress,
                  as: "address",
                  attributes: ["address_line1", "city", "state", "country"],
                },
                {
                  model: models.HomeMedia,
                  as: "media",
                  attributes: ["id", "url", "is_cover", "order"],
                  separate: true,
                  limit: 3,
                  order: [
                    ["is_cover", "DESC"],
                    ["order", "ASC"],
                    ["id", "ASC"],
                  ],
                },
              ],
            },
          ],
        },
      ],
      order: [
        ["check_in", "ASC"],
        ["id", "ASC"],
      ],
      limit: 20,
    });

    const reservationsPayload = reservations.map((stay) => {
      const home = stay.homeStay?.home;
      return {
        id: stay.id,
        checkIn: stay.check_in,
        checkOut: stay.check_out,
        nights: stay.nights,
        guestName: stay.guest_name,
        guests: stay.adults + stay.children,
        status: stay.status,
        home: home
          ? {
            id: home.id,
            title: home.title,
            city: home.address?.city ?? null,
            country: home.address?.country ?? null,
            coverImage: getCoverImage(home),
          }
          : null,
      };
    });

    // Aggregate metrics across confirmed/completed stays (all time)
    const staysAll = await models.Stay.findAll({
      where: {
        inventory_type: "HOME",
        status: { [Op.in]: ["CONFIRMED", "COMPLETED"] },
      },
      include: [
        {
          model: models.StayHome,
          as: "homeStay",
          required: true,
          attributes: [],
          where: buildStayHomeFilter(hostId),
        },
      ],
    });

    let nightsSum = 0;
    let staysCount = 0;
    staysAll.forEach((stay) => {
      let nights = Number(stay.nights ?? 0);
      if (!Number.isFinite(nights) || nights <= 0) {
        const ci = stay.check_in ? new Date(stay.check_in) : null;
        const co = stay.check_out ? new Date(stay.check_out) : null;
        if (ci && co) {
          const diff = (co - ci) / (1000 * 60 * 60 * 24);
          if (Number.isFinite(diff) && diff > 0) nights = diff;
        }
      }
      if (Number.isFinite(nights) && nights > 0) {
        nightsSum += nights;
        staysCount += 1;
      }
    });

    const averageNights = staysCount > 0 ? nightsSum / staysCount : 0;

    const earningsStart = new Date();
    earningsStart.setDate(1);
    earningsStart.setHours(0, 0, 0, 0);
    const earningsStays = await models.Stay.findAll({
      where: {
        inventory_type: "HOME",
        status: "COMPLETED",
        check_in: { [Op.gte]: formatDate(earningsStart) },
      },
      include: [
        {
          model: models.StayHome,
          as: "homeStay",
          required: true,
          attributes: [],
          where: { host_id: hostId },
        },
      ],
    });
    const earningsSum = earningsStays.reduce(
      (sum, stay) => sum + Number(computeHomeFinancialsFromStay(stay).hostPayout || 0),
      0,
    );

    return res.json({
      reservations: reservationsPayload,
      metrics: {
        monthlyEarnings: Number(earningsSum || 0),
        upcomingCount: reservationsPayload.length,
        nightsBooked: Math.round(nightsSum),
        averageNights: Number(averageNights.toFixed(1)),
      },
    });
  } catch (error) {
    console.error("getHostDashboard error:", error);
    return res.status(500).json({ error: "Unable to load host dashboard" });
  }
};

export const getHostEarnings = async (req, res) => {
  const hostId = Number(req.user?.id);
  if (!hostId) return res.status(400).json({ error: "Invalid host ID" });

  const requestedCurrency = String(req.query?.currency || "USD").trim().toUpperCase();
  const currencyConverter = createCurrencyConverter(requestedCurrency);
  const displayCurrency = currencyConverter.targetCurrency;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneYearAgo = new Date(today);
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);

  try {
    await ensurePayoutItemsForHost(hostId);
    const payoutItems = await models.PayoutItem.findAll({
      where: { user_id: hostId },
      include: [
        {
          model: models.Stay,
          as: "stay",
          required: true,
          where: { inventory_type: "HOME" },
          include: [
            {
              model: models.StayHome,
              as: "homeStay",
              required: true,
              where: buildStayHomeFilter(hostId),
              include: [
                {
                  model: models.Home,
                  as: "home",
                  required: true,
                  where: { host_id: hostId },
                  attributes: ["id", "title", "host_id"],
                  include: [
                    { model: models.HomeAddress, as: "address", attributes: ["city", "country"] },
                    {
                      model: models.HomeMedia,
                      as: "media",
                      attributes: ["id", "url", "is_cover", "order"],
                      separate: true,
                      limit: 1,
                      order: [
                        ["is_cover", "DESC"],
                        ["order", "ASC"],
                        ["id", "ASC"],
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const stays = await models.Stay.findAll({
      where: {
        inventory_type: "HOME",
        status: { [Op.in]: ["PENDING", "CONFIRMED", "COMPLETED"] },
        check_in: { [Op.gte]: formatDate(oneYearAgo) },
      },
      include: [
        {
          model: models.StayHome,
          as: "homeStay",
          required: true,
          where: buildStayHomeFilter(hostId),
          include: [
            {
              model: models.Home,
              as: "home",
              required: true,
              where: { host_id: hostId },
              attributes: ["id", "title", "host_id"],
              include: [
                { model: models.HomeAddress, as: "address", attributes: ["city", "country"] },
                {
                  model: models.HomeMedia,
                  as: "media",
                  attributes: ["id", "url", "is_cover", "order"],
                  separate: true,
                  limit: 1,
                  order: [
                    ["is_cover", "DESC"],
                    ["order", "ASC"],
                    ["id", "ASC"],
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const monthTotals = new Map();
    const reports = new Map();
    const listingTotals = new Map();
    let nightsReserved = 0;
    let totalStaysCount = 0;
    const upcoming = [];
    const paid = [];
    const staysByMonth = new Map();

    for (const item of payoutItems) {
      const stay = item.stay;
      const stayHostId = stay?.homeStay?.host_id;
      const home = stay?.homeStay?.home;
      if (!home || stayHostId !== hostId) continue;

      const keyDate =
        parseDateOnly(item.scheduled_for) ||
        parseDateOnly(stay.check_out) ||
        parseDateOnly(stay.check_in) ||
        today;
      if (keyDate < oneYearAgo) continue;

      const monthKey = `${keyDate.getUTCFullYear()}-${String(keyDate.getUTCMonth() + 1).padStart(2, "0")}`;
      const financials = computeHomeFinancialsFromStay(stay);
      const sourceCurrency = String(item.currency || financials.currency || stay.currency || "USD").toUpperCase();
      const sourceNetAmount = Number(item.amount ?? financials.hostPayout ?? 0);
      const sourceGrossAmount = Number(item.metadata?.gross_price ?? financials.hostSubtotal ?? sourceNetAmount);
      const sourceFeeAmount = Number(item.metadata?.fee_amount ?? financials.hostServiceFee ?? 0);
      const sourceTaxAmount = 0;

      const [netAmount, grossAmount, feeAmount, taxAmount] = await Promise.all([
        currencyConverter.convert(sourceNetAmount, sourceCurrency),
        currencyConverter.convert(sourceGrossAmount, sourceCurrency),
        currencyConverter.convert(sourceFeeAmount, sourceCurrency),
        currencyConverter.convert(sourceTaxAmount, sourceCurrency),
      ]);

      const stayPayload = {
        id: stay.id,
        checkIn: stay.check_in,
        checkOut: stay.check_out,
        nights: stay.nights ?? null,
        amount: netAmount,
        currency: displayCurrency,
        sourceAmount: sourceNetAmount,
        sourceCurrency,
        status: stay.status,
        paymentStatus: stay.payment_status || null,
        home: getHomeSnapshot(home),
      };

      monthTotals.set(monthKey, (monthTotals.get(monthKey) || 0) + netAmount);
      reports.set(monthKey, {
        gross: (reports.get(monthKey)?.gross || 0) + grossAmount,
        adjustments: 0,
        serviceFees: (reports.get(monthKey)?.serviceFees || 0) + feeAmount,
        taxes: (reports.get(monthKey)?.taxes || 0) + taxAmount,
      });
      if (!staysByMonth.has(monthKey)) staysByMonth.set(monthKey, []);
      staysByMonth.get(monthKey).push(stayPayload);

      const scheduledFor = item.scheduled_for || stay.check_out || stay.check_in || null;
      const paidAt = item.paid_at || null;
      const payout = {
        id: item.id,
        date: paidAt || scheduledFor,
        scheduledFor,
        paidAt,
        amount: netAmount,
        currency: displayCurrency,
        sourceAmount: sourceNetAmount,
        sourceCurrency,
        status: item.status,
        home: getHomeSnapshot(home),
      };

      if (item.status === "PAID") {
        paid.push(payout);
      } else if (["PENDING", "QUEUED", "PROCESSING", "ON_HOLD"].includes(item.status)) {
        upcoming.push(payout);
      }
    }

    for (const stay of stays) {
      const stayHostId = stay.homeStay?.host_id;
      const home = stay.homeStay?.home;
      if (!home || stayHostId !== hostId) continue;

      const listingKey = home.id;
      const financials = computeHomeFinancialsFromStay(stay);
      const sourceCurrency = String(financials.currency || stay.currency || "USD").toUpperCase();
      const sourceAmount = Number(financials.hostPayout ?? 0);
      const amount = await currencyConverter.convert(sourceAmount, sourceCurrency);

      listingTotals.set(listingKey, {
        home: getHomeSnapshot(home),
        total: (listingTotals.get(listingKey)?.total || 0) + amount,
      });

      const nights = Number(stay.nights ?? 0);
      if (Number.isFinite(nights) && nights > 0) {
        nightsReserved += nights;
        totalStaysCount += 1;
      }
    }

    const sortedMonths = Array.from(monthTotals.entries()).sort(([a], [b]) => (a > b ? 1 : -1));
    const monthlyBars = sortedMonths.map(([key, total]) => {
      const [year, month] = key.split("-");
      return { key, year: Number(year), month: Number(month), total };
    });

    const currentMonthKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
    const currentMonthTotal = monthTotals.get(currentMonthKey) || 0;

    const reportCards = Array.from(reports.entries())
      .sort(([a], [b]) => (a > b ? -1 : 1))
      .slice(0, 6)
      .map(([key, values]) => {
        const [year, month] = key.split("-");
        const gross = values.gross || 0;
        const adjustments = values.adjustments || 0;
        const serviceFees = values.serviceFees || 0;
        const taxes = values.taxes || 0;
        const net = gross + adjustments - serviceFees;
        return {
          key,
          year: Number(year),
          month: Number(month),
          gross,
          adjustments,
          serviceFees,
          taxes,
          net,
          currency: displayCurrency,
          stays: staysByMonth.get(key) || [],
        };
      });

    const topListings = Array.from(listingTotals.values())
      .filter((item) => item.home)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    upcoming.sort(
      (a, b) =>
        toMillis(a.scheduledFor || a.date) -
        toMillis(b.scheduledFor || b.date)
    );
    paid.sort(
      (a, b) =>
        toMillis(b.paidAt || b.scheduledFor || b.date) -
        toMillis(a.paidAt || a.scheduledFor || a.date)
    );

    return res.json({
      currency: displayCurrency,
      monthSummary: { currentMonthTotal, monthlyBars },
      payouts: {
        upcoming: upcoming.slice(0, 10),
        paid: paid.slice(0, 10),
      },
      reports: reportCards,
      performance: {
        nightsReserved,
        averageNights: totalStaysCount ? Number((nightsReserved / totalStaysCount).toFixed(2)) : 0,
        staysCount: totalStaysCount,
      },
      listings: topListings,
    });
  } catch (error) {
    console.error("getHostEarnings error:", error);
    return res.status(500).json({ error: "Unable to load earnings" });
  }
};

export const getHostBookingDetail = async (req, res) => {
  const hostId = Number(req.user?.id)
  const stayId = Number(req.params?.stayId)
  if (!hostId || !stayId) return res.status(400).json({ error: "Invalid host or stay id" })

  try {
    const stay = await models.Stay.findOne({
      where: { id: stayId, inventory_type: "HOME" },
      include: [
        {
          model: models.StayHome,
          as: "homeStay",
          required: true,
          where: buildStayHomeFilter(hostId),
          include: [
            {
              model: models.Home,
              as: "home",
              required: true,
              where: { host_id: hostId },
              attributes: ["id", "title", "status"],
              include: [
                { model: models.HomeAddress, as: "address", attributes: ["address_line1", "city", "state", "country"] },
                {
                  model: models.HomeMedia,
                  as: "media",
                  attributes: ["id", "url", "is_cover", "order"],
                  separate: true,
                  limit: 1,
                  order: [
                    ["is_cover", "DESC"],
                    ["order", "ASC"],
                    ["id", "ASC"],
                  ],
                },
              ],
            },
          ],
        },
      ],
    })

    if (!stay) return res.status(404).json({ error: "Booking not found" })

    const home = stay.homeStay?.home
    const pricingSnapshot = stay.pricing_snapshot || stay.meta || {}
    const feeSnapshot = stay.meta?.fees_snapshot || stay.meta?.fees || stay.homeStay?.fees_snapshot || {}
    const financials = computeHomeFinancialsFromStay(stay)
    const cancellation =
      stay.meta?.cancellationPolicy ||
      stay.homeStay?.house_rules_snapshot?.cancellation_policy ||
      stay.meta?.cancellation ||
      null

    const response = {
      id: stay.id,
      bookingRef: stay.booking_ref || stay.reference || null,
      status: stay.status,
      paymentStatus: stay.payment_status || "UNPAID",
      checkIn: stay.check_in,
      checkOut: stay.check_out,
      nights: stay.nights ?? null,
      guests: {
        adults: stay.adults ?? 0,
        children: stay.children ?? 0,
      },
      guest: {
        id: stay.user_id || null,
        name: stay.guest_name ?? null,
        email: stay.guest_email ?? null,
        phone: stay.guest_phone ?? null,
      },
      home: home
        ? {
          id: home.id,
          title: home.title,
          address: home.address || null,
          coverImage: getCoverImage(home),
        }
        : null,
      pricing: {
        currency: financials.currency || stay.currency || pricingSnapshot.currency || "USD",
        pricingModel: financials.model,
        baseSubtotal:
          pricingSnapshot.guestBaseSubtotal ?? pricingSnapshot.baseSubtotal ?? financials.guestBaseSubtotal ?? null,
        extraGuestSubtotal:
          pricingSnapshot.guestExtraGuestSubtotal ?? pricingSnapshot.extraGuestSubtotal ?? financials.guestExtraGuestSubtotal ?? null,
        platformMarkupAmount:
          pricingSnapshot.platformMarkupAmount ?? pricingSnapshot.platform_markup_amount ?? financials.platformMarkupAmount ?? null,
        discountAmount:
          pricingSnapshot.guestDiscountAmount ?? pricingSnapshot.discountAmount ?? financials.guestDiscountAmount ?? null,
        nightlyBreakdown: pricingSnapshot.nightlyBreakdown || financials.nightlyBreakdown || [],
        cleaningFee: null,
        guestServiceFee: null,
        taxes: 0,
        total: pricingSnapshot.total ?? stay.gross_price ?? financials.guestTotal ?? null,
      },
      hostPayout: {
        baseSubtotal:
          pricingSnapshot.hostBaseSubtotal ?? pricingSnapshot.baseSubtotal ?? financials.hostBaseSubtotal ?? null,
        extraGuestSubtotal:
          pricingSnapshot.hostExtraGuestSubtotal ?? financials.hostExtraGuestSubtotal ?? null,
        hostServiceFee:
          pricingSnapshot.hostServiceFee ?? pricingSnapshot.host_service_fee ?? financials.hostServiceFee ?? 0,
        hostEarnings:
          pricingSnapshot.hostEarnings ?? pricingSnapshot.host_earnings ?? financials.hostPayout ?? null,
      },
      policies: {
        cancellation,
      },
      createdAt: stay.created_at || null,
      meta: feeSnapshot,
    }

    return res.json(response)
  } catch (error) {
    console.error("getHostBookingDetail error:", error)
    return res.status(500).json({ error: "Unable to load booking detail" })
  }
}



export const getHostListings = async (req, res) => {
  const hostId = Number(req.user?.id);
  if (!hostId) return res.status(400).json({ error: "Invalid host ID" });

  try {
    const hostProfile = await models.HostProfile.findOne({
      where: { user_id: hostId },
      attributes: ["metadata"],
    });
    const hostOnboarding = buildHostOnboardingState(hostProfile?.metadata || {});
    const requiresHostPersonalInfo = !hostOnboarding.completed;

    const homes = await models.Home.findAll({
      where: { host_id: hostId },
      attributes: ["id", "title", "status", "property_type", "space_type", "draft_step", "is_visible", "created_at"],
      include: [
        {
          model: models.HomeAddress,
          as: "address",
          attributes: ["city", "country"],
        },
        {
          model: models.HomeMedia,
          as: "media",
          attributes: ["id", "url", "is_cover", "order"],
          separate: true,
          limit: 3,
          order: [
            ["is_cover", "DESC"],
            ["order", "ASC"],
            ["id", "ASC"],
          ],
        },
        {
          model: models.HomeCalendar,
          as: "calendar",
          attributes: [],
        },
      ],
      order: [
        ["created_at", "DESC"],
      ],
    });

    const listings = homes.map((home) => ({
      id: home.id,
      title: home.title,
      status: home.status,
      propertyType: home.property_type,
      spaceType: home.space_type,
      draftStep: home.draft_step || 1,
      city: home.address?.city || null,
      country: home.address?.country || null,
      isVisible: home.is_visible,
      coverImage: getCoverImage(home),
      requiresHostPersonalInfo,
    }));

    return res.json({
      listings,
      hostOnboarding,
    });
  } catch (error) {
    console.error("getHostListings error:", error);
    return res.status(500).json({ error: "Unable to load listings" });
  }
};

const normalizeHostOnboardingMetadata = (metadataInput = {}) => {
  const metadata = asPlainObject(metadataInput);
  const normalized = buildHostOnboardingState(metadata);
  return {
    ...metadata,
    hostOnboarding: {
      verifyIdentity: normalized.steps.verifyIdentity,
      confirmRealPerson: normalized.steps.confirmRealPerson,
      confirmPhone: normalized.steps.confirmPhone,
    },
  };
};

const ensureHostProfileForVerification = async (hostId) => {
  const [hostProfile] = await models.HostProfile.findOrCreate({
    where: { user_id: hostId },
    defaults: {
      user_id: hostId,
      kyc_status: "PENDING",
      payout_status: "INCOMPLETE",
      metadata: ensureHostOnboardingMetadata({}),
    },
  });
  return hostProfile;
};

export const requestHostPhoneVerificationCode = async (req, res) => {
  const hostId = Number(req.user?.id);
  if (!hostId) return res.status(400).json({ error: "Invalid host ID" });

  const phoneNumber = normalizePhoneE164(req.body?.phoneNumber || req.body?.phone);
  if (!phoneNumber) {
    return res.status(400).json({
      error: "Use a valid phone number in international format (example: +14155552671).",
    });
  }

  const channel = normalizePhoneChannel(req.body?.channel);
  if (!isPhoneVerificationConfigured()) {
    return res.status(503).json({
      error: "Phone verification is temporarily unavailable.",
      code: "PHONE_VERIFICATION_UNAVAILABLE",
    });
  }

  try {
    const hostProfile = await ensureHostProfileForVerification(hostId);
    const metadata = asPlainObject(hostProfile.metadata);
    const normalizedOnboarding = buildHostOnboardingState(metadata);
    if (normalizedOnboarding.steps.confirmPhone) {
      return res.json({
        status: "approved",
        phoneMasked: maskPhone(phoneNumber),
        channel,
        hostOnboarding: normalizedOnboarding,
      });
    }

    const phoneVerification = asPlainObject(metadata.phoneVerification);
    const lastRequestedAtMs = Date.parse(String(phoneVerification.requestedAt || ""));
    if (Number.isFinite(lastRequestedAtMs)) {
      const elapsed = Date.now() - lastRequestedAtMs;
      if (elapsed < PHONE_RESEND_SECONDS * 1000) {
        const remaining = Math.max(1, Math.ceil((PHONE_RESEND_SECONDS * 1000 - elapsed) / 1000));
        return res.status(429).json({
          error: `Please wait ${remaining}s before requesting another code.`,
          resendAfterSeconds: remaining,
        });
      }
    }

    const verification = await requestPhoneVerificationCode({
      phoneNumber,
      channel,
    });

    const nextMetadata = normalizeHostOnboardingMetadata({
      ...metadata,
      phoneVerification: {
        ...phoneVerification,
        provider: "twilio_verify",
        status: verification.status || "pending",
        channel,
        phoneNumber,
        phoneMasked: maskPhone(phoneNumber),
        sid: verification.sid || phoneVerification.sid || null,
        requestedAt: new Date().toISOString(),
        resendAfterSeconds: PHONE_RESEND_SECONDS,
      },
    });

    await hostProfile.update({
      metadata: nextMetadata,
    });

    return res.json({
      status: "pending",
      channel,
      phoneMasked: nextMetadata.phoneVerification.phoneMasked,
      resendAfterSeconds: PHONE_RESEND_SECONDS,
    });
  } catch (error) {
    const status = Number(error?.status || error?.response?.status || 500);
    const message =
      error?.message || error?.response?.data?.error || "Unable to start phone verification right now.";
    return res.status(status).json({
      error: message,
      code: error?.code || "HOST_PHONE_VERIFICATION_REQUEST_FAILED",
    });
  }
};

export const confirmHostPhoneVerificationCode = async (req, res) => {
  const hostId = Number(req.user?.id);
  if (!hostId) return res.status(400).json({ error: "Invalid host ID" });

  const code = String(req.body?.code || "").trim();
  if (!PHONE_CODE_PATTERN.test(code)) {
    return res.status(400).json({ error: "Enter a valid verification code." });
  }

  if (!isPhoneVerificationConfigured()) {
    return res.status(503).json({
      error: "Phone verification is temporarily unavailable.",
      code: "PHONE_VERIFICATION_UNAVAILABLE",
    });
  }

  try {
    const hostProfile = await ensureHostProfileForVerification(hostId);
    const metadata = asPlainObject(hostProfile.metadata);
    const phoneVerification = asPlainObject(metadata.phoneVerification);
    const resolvedPhone =
      normalizePhoneE164(req.body?.phoneNumber || req.body?.phone) ||
      normalizePhoneE164(phoneVerification.phoneNumber);

    if (!resolvedPhone) {
      return res.status(400).json({
        error: "Phone number is required to confirm verification.",
      });
    }

    const verification = await confirmPhoneVerificationCode({
      phoneNumber: resolvedPhone,
      code,
    });

    if (!verification.valid) {
      return res.status(400).json({ error: "Invalid verification code." });
    }

    const nextMetadata = normalizeHostOnboardingMetadata({
      ...metadata,
      phoneVerified: true,
      phone_verified: true,
      phoneVerification: {
        ...phoneVerification,
        provider: "twilio_verify",
        status: "approved",
        channel: phoneVerification.channel || "sms",
        phoneNumber: resolvedPhone,
        phoneMasked: maskPhone(resolvedPhone),
        sid: verification.sid || phoneVerification.sid || null,
        verifiedAt: new Date().toISOString(),
      },
      hostOnboarding: {
        ...asPlainObject(metadata.hostOnboarding || metadata.host_onboarding),
        confirmPhone: true,
        phoneVerified: true,
      },
    });

    await Promise.all([
      hostProfile.update({
        phone_number: resolvedPhone,
        metadata: nextMetadata,
      }),
      models.User.update(
        {
          phone: resolvedPhone,
        },
        {
          where: { id: hostId },
        }
      ),
    ]);

    return res.json({
      status: "approved",
      phoneMasked: nextMetadata.phoneVerification.phoneMasked,
      hostOnboarding: buildHostOnboardingState(nextMetadata),
    });
  } catch (error) {
    const status = Number(error?.status || error?.response?.status || 500);
    const message =
      error?.message || error?.response?.data?.error || "Unable to verify the phone code.";
    return res.status(status).json({
      error: message,
      code: error?.code || "HOST_PHONE_VERIFICATION_CONFIRM_FAILED",
    });
  }
};

export const createHostIdentityVerificationSession = async (req, res) => {
  const hostId = Number(req.user?.id);
  if (!hostId) return res.status(400).json({ error: "Invalid host ID" });

  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(500).json({
        error: "Identity verification is temporarily unavailable.",
        code: "HOST_IDENTITY_UNAVAILABLE",
      });
    }

    const hostProfile = await models.HostProfile.findOne({
      where: { user_id: hostId },
      attributes: ["id", "metadata", "kyc_status"],
    });
    if (!hostProfile) {
      return res.status(404).json({ error: "Host profile not found." });
    }

    const params = {
      type: "document",
      options: {
        document: {
          require_matching_selfie: true,
        },
      },
      metadata: {
        hostId: String(hostId),
        flow: "host_verify_identity",
      },
    };
    const returnUrl =
      normalizeIdentityReturnUrl(req.body?.returnUrl) || resolveIdentityReturnUrl();
    if (returnUrl) params.return_url = returnUrl;

    const session = await stripe.identity.verificationSessions.create(params);
    const metadata = asPlainObject(hostProfile.metadata);
    const nextMetadata = {
      ...metadata,
      identityVerification: {
        sessionId: session.id,
        status: session.status || "requires_input",
        lastCreatedAt: new Date().toISOString(),
      },
      hostOnboarding: {
        ...asPlainObject(metadata.hostOnboarding),
      },
    };

    await hostProfile.update({
      metadata: nextMetadata,
      kyc_status: hostProfile.kyc_status || "PENDING",
    });

    return res.json({
      sessionId: session.id,
      status: session.status || "requires_input",
      url: session.url || null,
      clientSecret: session.client_secret || null,
      expiresAt: session.expires_at || null,
    });
  } catch (error) {
    console.error(
      "createHostIdentityVerificationSession error:",
      error?.raw?.message || error?.message || error
    );
    return res.status(500).json({
      error: "Unable to start identity verification right now.",
      code: "HOST_IDENTITY_SESSION_ERROR",
    });
  }
};

export const getHostCalendar = async (req, res) => {
  const hostId = Number(req.user?.id);
  if (!hostId) return res.status(400).json({ error: "Invalid host ID" });

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  const afterEnd = new Date(end);
  afterEnd.setDate(afterEnd.getDate() + 1);
  const afterEndDate = formatDate(afterEnd);

  const parseDateOnly = (value) => {
    if (!value) return null;
    const parts = String(value).split("-").map(Number);
    if (parts.length !== 3) return null;
    const [year, month, day] = parts;
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return new Date(Date.UTC(year, month - 1, day));
  };

  try {
    const homes = await models.Home.findAll({
      where: { host_id: hostId },
      attributes: ["id", "title", "status"],
      include: [
        {
          model: models.HomeAddress,
          as: "address",
          attributes: ["city", "country"],
        },
        {
          model: models.HomeCalendar,
          as: "calendar",
          required: false,
          where: {
            date: { [Op.between]: [startDate, endDate] },
          },
          attributes: ["date", "status"],
        },
        {
          model: models.HomeMedia,
          as: "media",
          attributes: ["id", "url", "is_cover", "order"],
          separate: true,
          limit: 1,
          order: [
            ["is_cover", "DESC"],
            ["order", "ASC"],
            ["id", "ASC"],
          ],
        },
      ],
      order: [
        ["title", "ASC"],
      ],
    });

    const homeIds = homes.map((home) => home.id);

    const reservationsByHome = new Map();
    if (homeIds.length) {
      const reservationStays = await models.Stay.findAll({
        where: {
          inventory_type: "HOME",
          status: { [Op.in]: ["PENDING", "CONFIRMED"] },
          check_in: { [Op.lt]: afterEndDate },
          check_out: { [Op.gt]: startDate },
        },
        include: [
          {
            model: models.StayHome,
            as: "homeStay",
            required: true,
            where: { home_id: { [Op.in]: homeIds } },
            attributes: ["home_id"],
          },
        ],
      });

      for (const stay of reservationStays) {
        const stayHomeId = stay.homeStay?.home_id;
        if (!stayHomeId) continue;
        const checkIn = parseDateOnly(stay.check_in);
        const checkOut = parseDateOnly(stay.check_out);
        if (!checkIn || !checkOut) continue;

        const startLoop = checkIn > start ? checkIn : new Date(start.getTime());
        const checkoutMinusOne = new Date(checkOut.getTime());
        checkoutMinusOne.setUTCDate(checkoutMinusOne.getUTCDate() - 1);
        const endLoop = checkoutMinusOne < end ? checkoutMinusOne : new Date(end.getTime());

        let mapForHome = reservationsByHome.get(stayHomeId);
        if (!mapForHome) {
          mapForHome = new Map();
          reservationsByHome.set(stayHomeId, mapForHome);
        }

        const cursor = new Date(startLoop.getTime());
        while (cursor <= endLoop) {
          mapForHome.set(formatDate(cursor), "RESERVED");
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
    }

    const days = Array.from({ length: 7 }).map((_, idx) => {
      const d = new Date(start);
      d.setDate(d.getDate() + idx);
      return formatDate(d);
    });

    const items = homes.map((home) => {
      const calendarMap = new Map((home.calendar ?? []).map((entry) => [entry.date, entry.status]));
      const reservedMap = reservationsByHome.get(home.id) ?? new Map();
      return {
        id: home.id,
        title: home.title,
        city: home.address?.city || null,
        country: home.address?.country || null,
        coverImage: getCoverImage(home),
        days: days.map((date) => ({
          date,
          status: reservedMap.has(date) ? "RESERVED" : calendarMap.get(date) ?? "AVAILABLE",
        })),
      };
    });

    return res.json({ days, items });
  } catch (error) {
    console.error("getHostCalendar error:", error);
    return res.status(500).json({ error: "Unable to load calendar data" });
  }
};

