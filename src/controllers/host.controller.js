import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";

const formatDate = (date) => date.toISOString().slice(0, 10);

const getCoverImage = (home) => {
  const media = home?.media ?? [];
  const cover = media.find((item) => item.is_cover) ?? media[0];
  return cover?.url ?? null;
};

const buildHostFilter = (hostId) => ({
  [Op.or]: [
    { "$homeStay.host_id$": hostId },
    sequelize.where(sequelize.col("homeStay->home.host_id"), hostId),
  ],
});

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
          where: buildHostFilter(hostId),
          include: [
            {
              model: models.Home,
              as: "home",
              attributes: ["id", "title", "status", "host_id", "city", "country"],
              include: [
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
              city: home.city,
              country: home.country,
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
          where: buildHostFilter(hostId),
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
      attributes: ["id", "title", "status", "property_type", "space_type", "city", "country", "is_visible", "created_at"],
      include: [
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
      city: home.city,
      country: home.country,
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

  try {
    const homes = await models.Home.findAll({
      where: { host_id: hostId },
      attributes: ["id", "title", "status", "city", "country"],
      include: [
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

    const days = Array.from({ length: 7 }).map((_, idx) => {
      const d = new Date(start);
      d.setDate(d.getDate() + idx);
      return formatDate(d);
    });

    const items = homes.map((home) => {
      const calendarMap = new Map((home.calendar ?? []).map((entry) => [entry.date, entry.status]));
      return {
        id: home.id,
        title: home.title,
        city: home.city,
        country: home.country,
        coverImage: getCoverImage(home),
        days: days.map((date) => ({
          date,
          status: calendarMap.get(date) ?? "AVAILABLE",
        })),
      };
    });

    return res.json({ days, items });
  } catch (error) {
    console.error("getHostCalendar error:", error);
    return res.status(500).json({ error: "Unable to load calendar data" });
  }
};
