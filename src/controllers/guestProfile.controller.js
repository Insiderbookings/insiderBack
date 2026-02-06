import models from "../models/index.js"
import { Op, fn, col, literal } from "sequelize"

const pick = (value, fallback = null) => (value === undefined ? fallback : value)

const serializeVisitedPlaces = (stays = []) => {
  const accumulator = new Map()
  stays.forEach((stay) => {
    const address = stay?.homeStay?.home?.address
    if (!address) return
    const city = address.city || null
    const country = address.country || null
    const state = address.state || null
    const key = [city, state, country].filter(Boolean).join(" | ")
    if (!key) return
    const entry = accumulator.get(key) || {
      city,
      state,
      country,
      visits: 0,
      lastVisit: stay.check_in || stay.checkIn || null,
    }
    entry.visits += 1
    if (stay.check_in && entry.lastVisit) {
      entry.lastVisit = new Date(stay.check_in) > new Date(entry.lastVisit) ? stay.check_in : entry.lastVisit
    }
    accumulator.set(key, entry)
  })
  return Array.from(accumulator.values())
}

const computeYearsOnPlatform = (user) => {
  if (!user?.createdAt) return null
  const created = new Date(user.createdAt)
  if (Number.isNaN(created.valueOf())) return null
  const diffYears = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24 * 365)
  return Math.max(0, Math.floor(diffYears))
}

export const getGuestProfile = async (req, res) => {
  try {
    const guestId = Number(req.params.guestId)
    if (!guestId) return res.status(400).json({ error: "guestId is required" })
    const userId = Number(req.user?.id)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    const role = Number(req.user?.role)
    const isPrivileged = role === 1 || role === 100
    if (!isPrivileged && userId !== guestId) {
      return res.status(403).json({ error: "Forbidden" })
    }

    const user = await models.User.findByPk(guestId, {
      attributes: ["id", "name", "email", "avatar_url", "createdAt", "email_verified"],
    })
    if (!user) return res.status(404).json({ error: "Guest not found" })

    const profile =
      (await models.GuestProfile.findOne({
        where: { user_id: guestId },
      })) ||
      (await models.GuestProfile.create({ user_id: guestId }))

    const tripsCount = await models.Stay.count({
      where: {
        user_id: guestId,
        status: { [Op.in]: ["CONFIRMED", "COMPLETED"] },
      },
    })

    const guestReviewWhere = {
      guest_id: guestId,
      target_type: "GUEST",
      status: "PUBLISHED",
    }
    const guestReviews = await models.Review.findAll({
      where: guestReviewWhere,
      attributes: ["id", "rating_overall", "comment", "published_at", "created_at"],
      include: [{ model: models.User, as: "author", attributes: ["id", "name", "avatar_url"] }],
      order: [
        ["published_at", "DESC"],
        ["created_at", "DESC"],
      ],
      limit: 10,
    })
    const reviewsCount = await models.Review.count({ where: guestReviewWhere })
    const reviewAverageRow = await models.Review.findOne({
      where: guestReviewWhere,
      attributes: [[fn("AVG", col("rating_overall")), "avg"]],
      raw: true,
    })
    const reviewAverage = reviewAverageRow?.avg ? Number(reviewAverageRow.avg).toFixed(2) : null

    const stays = await models.Stay.findAll({
      where: {
        user_id: guestId,
        status: { [Op.in]: ["CONFIRMED", "COMPLETED"] },
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
              include: [{ model: models.HomeAddress, as: "address", attributes: ["city", "state", "country"] }],
            },
          ],
        },
      ],
      limit: 50,
      order: [["check_in", "DESC"]],
    })
    const visitedPlaces = profile.show_visited === false ? [] : serializeVisitedPlaces(stays)

    const yearsOnPlatform = computeYearsOnPlatform(user)

    return res.json({
      id: user.id,
      name: user.name,
      avatarUrl: profile.avatar_url || user.avatar_url,
      location: profile.home_base || null,
      identityVerified: profile.identity_verified || user.email_verified || false,
      stats: {
        trips: tripsCount,
        reviews: reviewsCount,
        yearsOnPlatform: yearsOnPlatform,
        averageRating: reviewAverage,
      },
      profile: {
        bio: profile.bio || "",
        occupation: pick(profile.occupation, null),
        leastUsefulSkill: pick(profile.least_useful_skill, null),
        pets: pick(profile.pets, null),
        birthDecade: pick(profile.birth_decade, null),
        interests: Array.isArray(profile.interests) ? profile.interests : [],
        homeBase: profile.home_base || null,
      },
      visitedPlaces,
      reviews: guestReviews.map((r) => ({
        id: r.id,
        rating: Number(r.rating_overall),
        comment: r.comment,
        publishedAt: r.published_at || r.created_at,
        author: r.author
          ? {
            id: r.author.id,
            name: r.author.name,
            avatarUrl: r.author.avatar_url,
          }
          : null,
      })),
    })
  } catch (err) {
    console.error("getGuestProfile error:", err)
    return res.status(500).json({ error: "Unable to load guest profile" })
  }
}

export const updateGuestProfile = async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    const {
      bio,
      occupation,
      leastUsefulSkill,
      pets,
      birthDecade,
      homeBase,
      interests,
      showVisited,
      avatarUrl,
    } = req.body || {}

    const [profile] = await models.GuestProfile.findOrCreate({ where: { user_id: userId } })
    const updates = {}
    if (bio !== undefined) updates.bio = String(bio || "").slice(0, 3000)
    if (occupation !== undefined) updates.occupation = occupation || null
    if (leastUsefulSkill !== undefined) updates.least_useful_skill = leastUsefulSkill || null
    if (pets !== undefined) updates.pets = pets || null
    if (birthDecade !== undefined) updates.birth_decade = birthDecade || null
    if (homeBase !== undefined) updates.home_base = homeBase || null
    if (avatarUrl !== undefined) updates.avatar_url = avatarUrl || null
    if (showVisited !== undefined) updates.show_visited = Boolean(showVisited)
    if (interests !== undefined) {
      updates.interests = Array.isArray(interests) ? interests.slice(0, 20) : []
    }

    await profile.update(updates)

    const userUpdates = {}
    if (avatarUrl !== undefined) userUpdates.avatar_url = avatarUrl || null
    // [MODIFIED] Allow updating name if provided
    if (req.body.name && typeof req.body.name === 'string') {
      const newName = req.body.name.trim();
      if (newName.length > 0) {
        userUpdates.name = newName;
      }
    }

    if (Object.keys(userUpdates).length > 0) {
      await models.User.update(
        userUpdates,
        { where: { id: userId } },
      )
    }
    return res.json({ message: "Profile updated", profile: profile.get({ plain: true }) })
  } catch (err) {
    console.error("updateGuestProfile error:", err)
    return res.status(500).json({ error: "Unable to update guest profile" })
  }
}
