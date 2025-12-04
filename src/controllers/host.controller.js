import { Op } from "sequelize";
import models from "../models/index.js";

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
  [Op.or]: [{ host_id: hostId }, { host_id: null }],
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

const parseDateOnly = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
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
    const earningsSum = await models.Stay.sum("gross_price", {
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneYearAgo = new Date(today);
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);

  try {
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

    for (const stay of stays) {
      const home = stay.homeStay?.home;
      if (!home || home.host_id !== hostId) continue;
      const checkOutDate = parseDateOnly(stay.check_out) ?? parseDateOnly(stay.check_in);
      const keyDate = checkOutDate || today;
      const monthKey = `${keyDate.getUTCFullYear()}-${String(keyDate.getUTCMonth() + 1).padStart(2, "0")}`;
      const amount = Number(stay.gross_price ?? 0);
      const stayPayload = {
        id: stay.id,
        checkIn: stay.check_in,
        checkOut: stay.check_out,
        nights: stay.nights ?? null,
        amount,
        status: stay.status,
        paymentStatus: stay.payment_status || null,
        home: getHomeSnapshot(home),
      };

      monthTotals.set(monthKey, (monthTotals.get(monthKey) || 0) + amount);
      reports.set(monthKey, {
        gross: (reports.get(monthKey)?.gross || 0) + amount,
        adjustments: 0,
        serviceFees: 0,
        taxes: 0,
      });
      if (!staysByMonth.has(monthKey)) staysByMonth.set(monthKey, []);
      staysByMonth.get(monthKey).push(stayPayload);

      const listingKey = home.id;
      listingTotals.set(listingKey, {
        home: getHomeSnapshot(home),
        total: (listingTotals.get(listingKey)?.total || 0) + amount,
      });

      const nights = Number(stay.nights ?? 0);
      if (Number.isFinite(nights) && nights > 0) {
        nightsReserved += nights;
        totalStaysCount += 1;
      }

      const payout = {
        id: stay.id,
        date: stay.check_out,
        amount,
        status: stay.payment_status || "PENDING",
        home: getHomeSnapshot(home),
      };

      const isPaid = String(stay.payment_status || "").toUpperCase() === "PAID";
      const isUpcoming =
        (parseDateOnly(stay.check_out) ?? today) >= today && !isPaid;

      if (isPaid) {
        paid.push(payout);
      } else if (isUpcoming) {
        upcoming.push(payout);
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
        const net = gross + adjustments - serviceFees - taxes;
        return {
          key,
          year: Number(year),
          month: Number(month),
          gross,
          adjustments,
          serviceFees,
          taxes,
          net,
          stays: staysByMonth.get(key) || [],
        };
      });

    const topListings = Array.from(listingTotals.values())
      .filter((item) => item.home)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    upcoming.sort((a, b) => (a.date > b.date ? 1 : -1));
    paid.sort((a, b) => (a.date > b.date ? -1 : 1));

    return res.json({
      currency: "USD",
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
        currency: stay.currency || pricingSnapshot.currency || "USD",
        baseSubtotal: pricingSnapshot.subtotalBeforeTax ?? null,
        nightlyBreakdown: pricingSnapshot.nightlyBreakdown || [],
        cleaningFee: pricingSnapshot.cleaningFee ?? pricingSnapshot.cleaning_fee ?? null,
        guestServiceFee: pricingSnapshot.serviceFee ?? pricingSnapshot.service_fee ?? null,
        taxes: pricingSnapshot.taxAmount ?? pricingSnapshot.taxes ?? null,
        total: pricingSnapshot.total ?? stay.gross_price ?? null,
      },
      hostPayout: {
        hostServiceFee: pricingSnapshot.hostServiceFee ?? pricingSnapshot.host_service_fee ?? null,
        hostEarnings: pricingSnapshot.hostEarnings ?? pricingSnapshot.host_earnings ?? null,
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
    }));

    return res.json({ listings });
  } catch (error) {
    console.error("getHostListings error:", error);
    return res.status(500).json({ error: "Unable to load listings" });
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

export const updatePayoutMethod = async (req, res) => {
  const hostId = Number(req.user?.id);
  const { routingNumber, accountNumber, accountHolder } = req.body;

  if (!hostId) return res.status(400).json({ error: "Invalid host ID" });
  if (!routingNumber || !accountNumber) {
    return res.status(400).json({ error: "Routing number and account number are required" });
  }

  try {
    const hostProfile = await models.HostProfile.findOne({ where: { user_id: hostId } });
    if (!hostProfile) {
      // Should exist due to hooks, but just in case
      return res.status(404).json({ error: "Host profile not found" });
    }

    await hostProfile.update({
      bank_routing_number: routingNumber,
      bank_account_number: accountNumber,
      bank_account_holder: accountHolder,
      payout_status: "READY",
    });

    return res.json({ success: true, message: "Payout method updated" });
  } catch (error) {
    console.error("updatePayoutMethod error:", error);
    return res.status(500).json({ error: "Unable to update payout method" });
  }
};
