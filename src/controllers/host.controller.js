import { Op } from "sequelize";
import models from "../models/index.js";

const formatDate = (date) => date.toISOString().slice(0, 10);

const getCoverImage = (home) => {
  const media = home?.media ?? [];
  const cover = media.find((item) => item.is_cover) ?? media[0];
  return cover?.url ?? null;
};

const buildStayHomeFilter = (hostId) => ({
  [Op.or]: [{ host_id: hostId }, { host_id: null }],
});

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
  end.setDate(end.getDate() + 7);
  const startDate = formatDate(start);
  const endDate = formatDate(end);

  try {
    const reservations = await models.Stay.findAll({
      where: {
        inventory_type: "HOME",
        status: { [Op.in]: ["PENDING", "CONFIRMED"] },
        check_in: { [Op.between]: [startDate, endDate] },
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
      },
    });
  } catch (error) {
    console.error("getHostDashboard error:", error);
    return res.status(500).json({ error: "Unable to load host dashboard" });
  }
};

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


