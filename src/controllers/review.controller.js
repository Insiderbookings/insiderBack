// src/controllers/review.controller.js
import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
import { getCoverImage } from "../utils/homeMapper.js";

const REVIEW_WINDOW_DAYS = Number(process.env.REVIEW_WINDOW_DAYS || 30);
const STATUS_PUBLISHED = "PUBLISHED";
const HOME_INVENTORY_TYPE = "HOME";
const HOTEL_INVENTORY_TYPES = new Set(["WEBBEDS_HOTEL", "LOCAL_HOTEL", "MANUAL_HOTEL"]);

const allowedGuestStatuses = new Set(["CONFIRMED", "COMPLETED"]);
const truthySet = new Set(["1", "true", "yes", "y", "on"]);

const parseDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const dateOnly = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(dateOnly.getTime()) ? null : dateOnly;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toInventoryType = (value) => String(value || "").trim().toUpperCase();

const isHomeInventory = (value) => toInventoryType(value) === HOME_INVENTORY_TYPE;

const isHotelInventory = (value) => HOTEL_INVENTORY_TYPES.has(toInventoryType(value));

const toInventoryIdString = (value) => {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const parseBoolean = (value) => truthySet.has(String(value || "").trim().toLowerCase());

const isDateReached = (value, now = new Date()) => {
  const date = parseDateValue(value);
  if (!date) return false;
  return now >= date;
};

const clampRating = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(5, Math.max(1, Number(numeric.toFixed(2))));
};

const serializeUser = (user) => {
  if (!user) return null;
  const displayName =
    user.name ||
    user.display_name ||
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
    user.email ||
    "Guest";
  return {
    id: user.id,
    name: displayName,
    email: user.email || null,
    avatarUrl: user.avatar_url || null,
  };
};

const serializeReview = (review) => ({
  id: review.id,
  bookingId: review.stay_id,
  homeId: review.home_id,
  hostId: review.host_id,
  guestId: review.guest_id,
  inventoryType: review.inventory_type || null,
  inventoryId: review.inventory_id || null,
  authorType: review.author_type,
  targetType: review.target_type,
  rating: review.rating_overall != null ? Number(review.rating_overall) : null,
  ratings: {
    cleanliness: review.rating_cleanliness != null ? Number(review.rating_cleanliness) : null,
    communication: review.rating_communication != null ? Number(review.rating_communication) : null,
    accuracy: review.rating_accuracy != null ? Number(review.rating_accuracy) : null,
    value: review.rating_value != null ? Number(review.rating_value) : null,
    location: review.rating_location != null ? Number(review.rating_location) : null,
  },
  comment: review.comment || "",
  publishedAt: review.published_at,
  createdAt: review.createdAt,
  author: serializeUser(review.author),
});

const getReviewSummary = async (where) => {
  const summary = await models.Review.findOne({
    where,
    attributes: [
      [sequelize.fn("COUNT", sequelize.col("id")), "count"],
      [sequelize.fn("AVG", sequelize.col("rating_overall")), "avgOverall"],
      [sequelize.fn("AVG", sequelize.col("rating_cleanliness")), "avgCleanliness"],
      [sequelize.fn("AVG", sequelize.col("rating_communication")), "avgCommunication"],
      [sequelize.fn("AVG", sequelize.col("rating_accuracy")), "avgAccuracy"],
      [sequelize.fn("AVG", sequelize.col("rating_value")), "avgValue"],
      [sequelize.fn("AVG", sequelize.col("rating_location")), "avgLocation"],
    ],
    raw: true,
  });

  return {
    count: Number(summary?.count || 0),
    averageRating: summary?.avgOverall ? Number(Number(summary.avgOverall).toFixed(2)) : null,
    details: {
      cleanliness: summary?.avgCleanliness ? Number(Number(summary.avgCleanliness).toFixed(2)) : null,
      communication: summary?.avgCommunication ? Number(Number(summary.avgCommunication).toFixed(2)) : null,
      accuracy: summary?.avgAccuracy ? Number(Number(summary.avgAccuracy).toFixed(2)) : null,
      value: summary?.avgValue ? Number(Number(summary.avgValue).toFixed(2)) : null,
      location: summary?.avgLocation ? Number(Number(summary.avgLocation).toFixed(2)) : null,
    },
  };
};

const enforceReviewWindow = (referenceDate) => {
  if (REVIEW_WINDOW_DAYS <= 0) return; // allow always if configured to 0 or negative
  const checkOutDate = parseDateValue(referenceDate);
  if (!checkOutDate) return;
  const limit = new Date(checkOutDate);
  limit.setDate(limit.getDate() + REVIEW_WINDOW_DAYS);
  if (Date.now() > limit.getTime()) {
    throw Object.assign(new Error("The review window for this booking has expired."), { status: 400 });
  }
};

const isWithinReviewWindow = (referenceDate, now = new Date()) => {
  if (REVIEW_WINDOW_DAYS <= 0) return true;
  const checkOutDate = parseDateValue(referenceDate);
  if (!checkOutDate) return true;
  const limit = new Date(checkOutDate);
  limit.setDate(limit.getDate() + REVIEW_WINDOW_DAYS);
  return now <= limit;
};

const resolveHotelSummaryFromBooking = (booking) => {
  const snapshotHotel = booking?.inventory_snapshot?.hotel || {};
  const stayHotel = booking?.hotelStay || {};
  const localHotel = stayHotel?.hotel || {};
  const webbedsHotel = stayHotel?.webbedsHotel || {};

  const name =
    snapshotHotel?.name ||
    booking?.inventory_snapshot?.hotelName ||
    localHotel?.name ||
    webbedsHotel?.name ||
    booking?.hotel_name ||
    null;

  return {
    inventoryType: toInventoryType(booking?.inventory_type),
    inventoryId:
      toInventoryIdString(booking?.inventory_id) ||
      toInventoryIdString(stayHotel?.webbeds_hotel_id) ||
      toInventoryIdString(stayHotel?.hotel_id),
    hotel: {
      id: localHotel?.id ?? null,
      webbedsHotelId: toInventoryIdString(stayHotel?.webbeds_hotel_id),
      name,
      city:
        snapshotHotel?.city ||
        booking?.inventory_snapshot?.city ||
        localHotel?.city ||
        webbedsHotel?.city_name ||
        null,
      country:
        snapshotHotel?.country ||
        booking?.inventory_snapshot?.country ||
        localHotel?.country ||
        webbedsHotel?.country_name ||
        null,
      image:
        snapshotHotel?.image ||
        snapshotHotel?.coverImage ||
        booking?.inventory_snapshot?.hotelImage ||
        localHotel?.image ||
        null,
    },
  };
};

export const createHomeReview = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const {
      bookingId,
      rating,
      cleanlinessRating,
      communicationRating,
      accuracyRating,
      valueRating,
      locationRating,
      comment,
    } = req.body || {};

    if (!bookingId || !rating) {
      return res.status(400).json({ error: "bookingId and rating are required" });
    }
    const ratingValue = clampRating(rating);
    if (!ratingValue) {
      return res.status(400).json({ error: "rating must be between 1 and 5" });
    }

    const booking = await models.Booking.findOne({
      where: { id: bookingId },
      include: [{ model: models.StayHome, as: "homeStay" }],
    });
    if (!booking || !isHomeInventory(booking.inventory_type)) {
      return res.status(404).json({ error: "Booking not found for a home stay" });
    }
    if (booking.user_id !== userId) {
      return res.status(403).json({ error: "You can only review your own stays" });
    }
    if (!allowedGuestStatuses.has(String(booking.status).toUpperCase())) {
      return res.status(400).json({ error: "This booking cannot be reviewed yet" });
    }
    if (!isDateReached(booking.check_out)) {
      return res.status(400).json({ error: "This booking can be reviewed after check-out" });
    }
    enforceReviewWindow(booking.check_out);

    const existing = await models.Review.findOne({
      where: { stay_id: bookingId, author_id: userId, author_type: "GUEST" },
    });
    if (existing) {
      return res.status(409).json({ error: "Review already submitted for this stay" });
    }

    const review = await models.Review.create({
      stay_id: booking.id,
      home_id: booking.homeStay?.home_id ?? null,
      host_id: booking.homeStay?.host_id ?? null,
      guest_id: booking.user_id,
      author_id: userId,
      author_type: "GUEST",
      target_type: "HOME",
      rating_overall: ratingValue,
      rating_cleanliness: clampRating(cleanlinessRating),
      rating_communication: clampRating(communicationRating),
      rating_accuracy: clampRating(accuracyRating),
      rating_value: clampRating(valueRating),
      rating_location: clampRating(locationRating),
      comment: comment || "",
      status: STATUS_PUBLISHED,
      published_at: new Date(),
    });

    const record = await models.Review.findByPk(review.id, {
      include: [{ model: models.User, as: "author", attributes: ["id", "name", "email", "avatar_url"] }],
    });

    return res.status(201).json({ review: serializeReview(record) });
  } catch (error) {
    const status = error?.status || 500;
    console.error("createHomeReview error:", error);
    return res.status(status).json({ error: error.message || "Unable to submit review" });
  }
};

export const createHotelReview = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const {
      bookingId,
      rating,
      cleanlinessRating,
      communicationRating,
      accuracyRating,
      valueRating,
      locationRating,
      comment,
    } = req.body || {};

    if (!bookingId || !rating) {
      return res.status(400).json({ error: "bookingId and rating are required" });
    }

    const ratingValue = clampRating(rating);
    if (!ratingValue) {
      return res.status(400).json({ error: "rating must be between 1 and 5" });
    }

    const booking = await models.Booking.findOne({
      where: { id: bookingId },
      include: [
        {
          model: models.StayHotel,
          as: "hotelStay",
          required: false,
          include: [
            { model: models.Hotel, as: "hotel", required: false },
            { model: models.WebbedsHotel, as: "webbedsHotel", required: false },
          ],
        },
      ],
    });

    if (!booking || !isHotelInventory(booking.inventory_type)) {
      return res.status(404).json({ error: "Booking not found for a hotel stay" });
    }
    if (booking.user_id !== userId) {
      return res.status(403).json({ error: "You can only review your own stays" });
    }
    if (!allowedGuestStatuses.has(String(booking.status).toUpperCase())) {
      return res.status(400).json({ error: "This booking cannot be reviewed yet" });
    }
    if (!isDateReached(booking.check_out)) {
      return res.status(400).json({ error: "This booking can be reviewed after check-out" });
    }
    enforceReviewWindow(booking.check_out);

    const hotelSummary = resolveHotelSummaryFromBooking(booking);
    const inventoryType = hotelSummary.inventoryType;
    const inventoryId = hotelSummary.inventoryId;
    if (!inventoryType || !inventoryId) {
      return res.status(400).json({
        error: "This hotel booking is missing inventory identifiers and cannot be reviewed.",
      });
    }

    const existing = await models.Review.findOne({
      where: { stay_id: booking.id, author_id: userId, author_type: "GUEST" },
    });
    if (existing) {
      return res.status(409).json({ error: "Review already submitted for this stay" });
    }

    const review = await models.Review.create({
      stay_id: booking.id,
      guest_id: booking.user_id,
      inventory_type: inventoryType,
      inventory_id: inventoryId,
      author_id: userId,
      author_type: "GUEST",
      target_type: "HOTEL",
      rating_overall: ratingValue,
      rating_cleanliness: clampRating(cleanlinessRating),
      rating_communication: clampRating(communicationRating),
      rating_accuracy: clampRating(accuracyRating),
      rating_value: clampRating(valueRating),
      rating_location: clampRating(locationRating),
      comment: comment || "",
      metadata: { hotel: hotelSummary.hotel },
      status: STATUS_PUBLISHED,
      published_at: new Date(),
    });

    const record = await models.Review.findByPk(review.id, {
      include: [{ model: models.User, as: "author", attributes: ["id", "name", "email", "avatar_url"] }],
    });

    return res.status(201).json({ review: serializeReview(record) });
  } catch (error) {
    const status = error?.status || 500;
    console.error("createHotelReview error:", error);
    return res.status(status).json({ error: error.message || "Unable to submit hotel review" });
  }
};

export const createGuestReview = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { bookingId, rating, communicationRating, cleanlinessRating, comment } = req.body || {};
    if (!bookingId || !rating) {
      return res.status(400).json({ error: "bookingId and rating are required" });
    }

    const ratingValue = clampRating(rating);
    if (!ratingValue) return res.status(400).json({ error: "rating must be between 1 and 5" });

    const booking = await models.Booking.findOne({
      where: { id: bookingId },
      include: [{ model: models.StayHome, as: "homeStay" }],
    });
    if (!booking || !isHomeInventory(booking.inventory_type)) {
      return res.status(404).json({ error: "Booking not found for a home stay" });
    }
    const hostId = booking.homeStay?.host_id;
    if (!hostId) {
      return res.status(400).json({ error: "This booking does not have an assigned host" });
    }
    if (hostId !== userId) {
      return res.status(403).json({ error: "You can only review your own guests" });
    }
    if (!allowedGuestStatuses.has(String(booking.status).toUpperCase())) {
      return res.status(400).json({ error: "This booking cannot be reviewed yet" });
    }
    if (!isDateReached(booking.check_out)) {
      return res.status(400).json({ error: "This booking can be reviewed after check-out" });
    }
    enforceReviewWindow(booking.check_out);

    const existing = await models.Review.findOne({
      where: { stay_id: bookingId, author_id: userId, author_type: "HOST" },
    });
    if (existing) {
      return res.status(409).json({ error: "Review already submitted for this guest" });
    }

    const review = await models.Review.create({
      stay_id: booking.id,
      home_id: booking.homeStay?.home_id ?? null,
      host_id: hostId,
      guest_id: booking.user_id,
      author_id: userId,
      author_type: "HOST",
      target_type: "GUEST",
      rating_overall: ratingValue,
      rating_cleanliness: clampRating(cleanlinessRating),
      rating_communication: clampRating(communicationRating),
      comment: comment || "",
      status: STATUS_PUBLISHED,
      published_at: new Date(),
    });

    const record = await models.Review.findByPk(review.id, {
      include: [{ model: models.User, as: "author", attributes: ["id", "name", "email", "avatar_url"] }],
    });

    return res.status(201).json({ review: serializeReview(record) });
  } catch (error) {
    const status = error?.status || 500;
    console.error("createGuestReview error:", error);
    return res.status(status).json({ error: error.message || "Unable to submit review" });
  }
};

export const getHomeReviews = async (req, res) => {
  const homeId = Number(req.params.homeId);
  if (!homeId) return res.status(400).json({ error: "homeId is required" });

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = {
    home_id: homeId,
    target_type: "HOME",
    status: STATUS_PUBLISHED,
  };

  const { rows, count } = await models.Review.findAndCountAll({
    where,
    include: [{ model: models.User, as: "author", attributes: ["id", "name", "email", "avatar_url"] }],
    order: [
      ["published_at", "DESC"],
      ["created_at", "DESC"],
    ],
    limit,
    offset,
  });

  const summary = await getReviewSummary(where);
  return res.json({
    reviews: rows.map(serializeReview),
    meta: { total: count, limit, offset },
    summary,
  });
};

export const getHotelReviews = async (req, res) => {
  const inventoryId = toInventoryIdString(req.params.inventoryId);
  if (!inventoryId) return res.status(400).json({ error: "inventoryId is required" });

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const requestedInventoryType = toInventoryType(req.query.inventoryType || req.query.inventory_type);

  const where = {
    target_type: "HOTEL",
    inventory_id: inventoryId,
    status: STATUS_PUBLISHED,
  };

  if (requestedInventoryType) {
    where.inventory_type = requestedInventoryType;
  }

  const { rows, count } = await models.Review.findAndCountAll({
    where,
    include: [{ model: models.User, as: "author", attributes: ["id", "name", "email", "avatar_url"] }],
    order: [
      ["published_at", "DESC"],
      ["created_at", "DESC"],
    ],
    limit,
    offset,
  });

  const summary = await getReviewSummary(where);
  return res.json({
    reviews: rows.map(serializeReview),
    meta: { total: count, limit, offset },
    summary,
  });
};

export const getHostReviews = async (req, res) => {
  const hostId = Number(req.params.hostId);
  if (!hostId) return res.status(400).json({ error: "hostId is required" });

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = {
    host_id: hostId,
    author_type: "GUEST",
    status: STATUS_PUBLISHED,
  };

  const { rows, count } = await models.Review.findAndCountAll({
    where,
    include: [{ model: models.User, as: "author", attributes: ["id", "name", "email", "avatar_url"] }],
    order: [
      ["published_at", "DESC"],
      ["created_at", "DESC"],
    ],
    limit,
    offset,
  });

  const summary = await getReviewSummary(where);
  return res.json({
    reviews: rows.map(serializeReview),
    meta: { total: count, limit, offset },
    summary,
  });
};

export const getGuestReviews = async (req, res) => {
  const guestId = Number(req.params.guestId);
  if (!guestId) return res.status(400).json({ error: "guestId is required" });

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = {
    guest_id: guestId,
    target_type: "GUEST",
    status: STATUS_PUBLISHED,
  };

  const { rows, count } = await models.Review.findAndCountAll({
    where,
    include: [{ model: models.User, as: "author", attributes: ["id", "name", "email", "avatar_url"] }],
    order: [
      ["published_at", "DESC"],
      ["created_at", "DESC"],
    ],
    limit,
    offset,
  });

  const summary = await getReviewSummary(where);
  return res.json({
    reviews: rows.map(serializeReview),
    meta: { total: count, limit, offset },
    summary,
  });
};

export const getPendingReviews = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const includeHotel = parseBoolean(req.query.includeHotel ?? req.query.includeHotels);

    const guestBookings = await models.Booking.findAll({
      where: {
        user_id: userId,
        inventory_type: includeHotel
          ? { [Op.in]: [HOME_INVENTORY_TYPE, ...Array.from(HOTEL_INVENTORY_TYPES)] }
          : HOME_INVENTORY_TYPE,
        status: { [Op.in]: Array.from(allowedGuestStatuses) },
      },
      include: [
        {
          model: models.StayHome,
          as: "homeStay",
          required: false,
          include: [
            {
              model: models.Home,
              as: "home",
              attributes: ["id", "title"],
              include: [
                {
                  model: models.HomeAddress,
                  as: "address",
                  attributes: ["city", "country", "state"],
                },
                {
                  model: models.HomeMedia,
                  as: "media",
                  attributes: ["url", "is_cover", "order"],
                },
              ],
            },
          ],
        },
        ...(includeHotel
          ? [
              {
                model: models.StayHotel,
                as: "hotelStay",
                required: false,
                include: [
                  {
                    model: models.Hotel,
                    as: "hotel",
                    required: false,
                    attributes: ["id", "name", "city", "country", "image"],
                  },
                  {
                    model: models.WebbedsHotel,
                    as: "webbedsHotel",
                    required: false,
                    attributes: ["hotel_id", "name", "city_name", "country_name"],
                  },
                ],
              },
            ]
          : []),
      ],
      order: [["check_out", "DESC"]],
      limit: 50,
    });

    const hostBookings = await models.Booking.findAll({
      where: {
        inventory_type: "HOME",
        status: { [Op.in]: Array.from(allowedGuestStatuses) },
      },
      include: [
        {
          model: models.StayHome,
          as: "homeStay",
          where: { host_id: userId },
          required: true,
          include: [
            {
              model: models.Home,
              as: "home",
              attributes: ["id", "title"],
              include: [
                {
                  model: models.HomeAddress,
                  as: "address",
                  attributes: ["city", "country", "state"],
                },
                {
                  model: models.HomeMedia,
                  as: "media",
                  attributes: ["url", "is_cover", "order"],
                },
              ],
            },
          ],
        },
      ],
      order: [["check_out", "DESC"]],
      limit: 50,
    });

    const allBookingIds = [
      ...guestBookings.map((b) => b.id),
      ...hostBookings.map((b) => b.id),
    ];
    let existingMap = new Map();
    if (allBookingIds.length) {
      const existing = await models.Review.findAll({
        where: { stay_id: { [Op.in]: allBookingIds }, author_id: userId },
        attributes: ["stay_id", "author_type"],
      });
      existingMap = new Map(existing.map((row) => [row.stay_id, true]));
    }

    const formatPendingHome = (booking, role) => {
      const homeTitle =
        booking.homeStay?.home?.title ||
        booking.inventory_snapshot?.title ||
        (booking.homeStay?.home_id ? `Home #${booking.homeStay.home_id}` : "Stay");
      return {
        bookingId: booking.id,
        role,
        inventoryType: HOME_INVENTORY_TYPE,
        inventoryId: toInventoryIdString(booking.inventory_id),
        home: {
          id: booking.homeStay?.home?.id ?? booking.homeStay?.home_id ?? null,
          title: homeTitle,
          city: booking.homeStay?.home?.address?.city ?? null,
          country: booking.homeStay?.home?.address?.country ?? null,
          coverImage: getCoverImage(booking.homeStay?.home) ?? null,
        },
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        hostId: booking.homeStay?.host_id ?? null,
        guestId: booking.user_id,
        guestName: booking.guest_name ?? null,
        guestEmail: booking.guest_email ?? null,
      };
    };

    const formatPendingHotel = (booking, role) => {
      const hotelSummary = resolveHotelSummaryFromBooking(booking);
      const hotelName =
        hotelSummary.hotel.name ||
        booking.inventory_snapshot?.title ||
        (hotelSummary.inventoryId ? `Hotel #${hotelSummary.inventoryId}` : "Stay");
      return {
        bookingId: booking.id,
        role,
        inventoryType: hotelSummary.inventoryType || toInventoryType(booking.inventory_type),
        inventoryId: hotelSummary.inventoryId,
        hotel: {
          ...hotelSummary.hotel,
          name: hotelName,
        },
        stay: {
          title: hotelName,
          city: hotelSummary.hotel.city ?? null,
          country: hotelSummary.hotel.country ?? null,
          coverImage: hotelSummary.hotel.image ?? null,
        },
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        hostId: null,
        guestId: booking.user_id,
        guestName: booking.guest_name ?? null,
        guestEmail: booking.guest_email ?? null,
      };
    };

    const now = new Date();

    const pendingAsGuestHome = guestBookings
      .filter((booking) => !existingMap.get(booking.id))
      .filter((booking) => isHomeInventory(booking.inventory_type))
      .filter((booking) => isDateReached(booking.check_out, now))
      .filter((booking) => isWithinReviewWindow(booking.check_out, now))
      .map((booking) => formatPendingHome(booking, "GUEST"));

    const pendingAsGuestHotel = includeHotel
      ? guestBookings
          .filter((booking) => !existingMap.get(booking.id))
          .filter((booking) => isHotelInventory(booking.inventory_type))
          .filter((booking) => isDateReached(booking.check_out, now))
          .filter((booking) => isWithinReviewWindow(booking.check_out, now))
          .map((booking) => formatPendingHotel(booking, "GUEST"))
      : [];

    const pendingAsGuest = [...pendingAsGuestHome, ...pendingAsGuestHotel].sort(
      (a, b) => new Date(b.checkOut || 0) - new Date(a.checkOut || 0)
    );

    const pendingAsHost = hostBookings
      .filter((booking) => !existingMap.get(booking.id))
      .filter((booking) => isDateReached(booking.check_out, now))
      .filter((booking) => isWithinReviewWindow(booking.check_out, now))
      .map((booking) => formatPendingHome(booking, "HOST"));

    return res.json({
      guest: pendingAsGuest,
      host: pendingAsHost,
      meta: {
        includeHotel,
      },
    });
  } catch (error) {
    console.error("getPendingReviews error:", error);
    return res.status(500).json({ error: "Unable to load pending reviews" });
  }
};
