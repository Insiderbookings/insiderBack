// src/controllers/review.controller.js
import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
import { getCoverImage } from "../utils/homeMapper.js";

const REVIEW_WINDOW_DAYS = 30;
const STATUS_PUBLISHED = "PUBLISHED";

const allowedGuestStatuses = new Set(["CONFIRMED", "COMPLETED"]);

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

const enforceReviewWindow = (booking) => {
  if (!booking?.check_out) return;
  const checkOutDate = new Date(booking.check_out);
  if (Number.isNaN(checkOutDate.getTime())) return;
  const limit = new Date(checkOutDate);
  limit.setDate(limit.getDate() + REVIEW_WINDOW_DAYS);
  if (Date.now() > limit.getTime()) {
    throw Object.assign(new Error("The review window for this booking has expired."), { status: 400 });
  }
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
    if (!booking || String(booking.inventory_type).toUpperCase() !== "HOME") {
      return res.status(404).json({ error: "Booking not found for a home stay" });
    }
    if (booking.user_id !== userId) {
      return res.status(403).json({ error: "You can only review your own stays" });
    }
    if (!allowedGuestStatuses.has(String(booking.status).toUpperCase())) {
      return res.status(400).json({ error: "This booking cannot be reviewed yet" });
    }
    enforceReviewWindow(booking);

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
    if (!booking || String(booking.inventory_type).toUpperCase() !== "HOME") {
      return res.status(404).json({ error: "Booking not found for a home stay" });
    }
    const hostId = booking.homeStay?.host_id;
    if (!hostId) {
      return res.status(400).json({ error: "This booking does not have an assigned host" });
    }
    if (hostId !== userId) {
      return res.status(403).json({ error: "You can only review your own guests" });
    }
    enforceReviewWindow(booking);

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

    const guestBookings = await models.Booking.findAll({
      where: {
        user_id: userId,
        inventory_type: "HOME",
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

    const formatPending = (booking, role) => {
      const homeTitle =
        booking.homeStay?.home?.title ||
        booking.inventory_snapshot?.title ||
        (booking.homeStay?.home_id ? `Home #${booking.homeStay.home_id}` : "Stay");
      return {
        bookingId: booking.id,
        role,
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

    const pendingAsGuest = guestBookings
      .filter((booking) => !existingMap.get(booking.id))
      .map((booking) => formatPending(booking, "GUEST"));

    const pendingAsHost = hostBookings
      .filter((booking) => !existingMap.get(booking.id))
      .map((booking) => formatPending(booking, "HOST"));

    return res.json({
      guest: pendingAsGuest,
      host: pendingAsHost,
    });
  } catch (error) {
    console.error("getPendingReviews error:", error);
    return res.status(500).json({ error: "Unable to load pending reviews" });
  }
};
