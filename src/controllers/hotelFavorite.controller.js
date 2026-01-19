import models from "../models/index.js";
import { formatStaticHotel } from "../utils/webbedsMapper.js";

const ensureUser = (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
};

const parseListId = (value) => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
};

const parseHotelId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return trimmed;
};

const mapHotelFavoriteItem = (fav) => {
  if (!fav?.hotel) return null;
  const card = formatStaticHotel(fav.hotel);
  if (!card) return null;
  const addedAtRaw = fav.created_at ?? fav.createdAt ?? fav.addedAt ?? null;
  const addedDate = addedAtRaw ? new Date(addedAtRaw) : new Date();
  const safeAddedAt = Number.isNaN(addedDate.getTime()) ? new Date() : addedDate;
  const hotelId = fav.hotel_id != null ? String(fav.hotel_id) : card.id ?? null;
  const base = {
    id: fav.id,
    hotelId,
    addedAt: safeAddedAt,
    card,
  };
  if (fav.list_id) base.listId = fav.list_id;
  return base;
};

const ensureListOwnership = async (userId, listId, res) => {
  const list = await models.HotelFavoriteList.findOne({
    where: { id: listId, user_id: userId },
  });
  if (!list) {
    if (res) res.status(404).json({ error: "List not found" });
    return null;
  }
  return list;
};

const includeForHotelCard = [
  {
    model: models.WebbedsHotelChain,
    as: "chainCatalog",
    attributes: ["code", "name"],
    required: false,
  },
  {
    model: models.WebbedsHotelClassification,
    as: "classification",
    attributes: ["code", "name"],
    required: false,
  },
];

export const listHotelFavoriteLists = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  try {
    const lists = await models.HotelFavoriteList.findAll({
      where: { user_id: userId },
      order: [["created_at", "DESC"]],
      include: [
        {
          model: models.HotelFavorite,
          as: "items",
          include: [
            {
              model: models.WebbedsHotel,
              as: "hotel",
              include: includeForHotelCard,
            },
          ],
          separate: true,
          limit: 8,
          order: [["created_at", "DESC"]],
        },
      ],
    });

    const allFavoriteRows = await models.HotelFavorite.findAll({
      where: { user_id: userId },
      attributes: ["list_id", "hotel_id"],
    });
    const listHotelIdsMap = new Map();
    allFavoriteRows.forEach((row) => {
      const listKey = row.list_id;
      if (!listKey) return;
      const hotelId = row.hotel_id != null ? String(row.hotel_id) : null;
      if (!hotelId) return;
      if (!listHotelIdsMap.has(listKey)) listHotelIdsMap.set(listKey, new Set());
      listHotelIdsMap.get(listKey).add(hotelId);
    });

    const mappedLists = lists.map((list) => {
      const items = Array.isArray(list.items) ? list.items.map(mapHotelFavoriteItem).filter(Boolean) : [];
      const hotelIdSet =
        listHotelIdsMap.get(list.id) || new Set(items.map((item) => item.hotelId).filter(Boolean));
      return {
        id: list.id,
        name: list.name,
        createdAt: list.created_at,
        preview: items.slice(0, 4).map((item) => item.card),
        hotelIds: Array.from(hotelIdSet),
        itemCount: hotelIdSet.size,
      };
    });

    const recentViews = await models.HotelRecentView.findAll({
      where: { user_id: userId },
      include: [
        {
          model: models.WebbedsHotel,
          as: "hotel",
          include: includeForHotelCard,
        },
      ],
      order: [["viewed_at", "DESC"]],
      limit: 12,
    });

    const recent = recentViews
      .map((view) => ({
        hotelId: view.hotel_id != null ? String(view.hotel_id) : null,
        viewedAt: view.viewed_at,
        card: formatStaticHotel(view.hotel),
      }))
      .filter((entry) => entry.card);

    res.json({
      lists: mappedLists,
      recent,
    });
  } catch (err) {
    console.error("[hotel-favorites] listHotelFavoriteLists error:", err);
    res.status(500).json({ error: "Unable to load favorites." });
  }
};

export const createHotelFavoriteList = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "List name is required" });
    return;
  }
  try {
    const [list] = await models.HotelFavoriteList.findOrCreate({
      where: { user_id: userId, name },
      defaults: { user_id: userId, name },
    });
    res.status(201).json({
      list: {
        id: list.id,
        name: list.name,
        createdAt: list.created_at,
      },
    });
  } catch (err) {
    console.error("[hotel-favorites] createHotelFavoriteList error:", err);
    res.status(500).json({ error: "Unable to create the list." });
  }
};

export const getHotelFavoriteListDetail = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  const listId = parseListId(req.params?.listId);
  if (!listId) {
    res.status(400).json({ error: "Invalid list id" });
    return;
  }
  try {
    const list = await ensureListOwnership(userId, listId, res);
    if (!list) return;
    const favorites = await models.HotelFavorite.findAll({
      where: { list_id: listId, user_id: userId },
      include: [
        {
          model: models.WebbedsHotel,
          as: "hotel",
          include: includeForHotelCard,
        },
      ],
      order: [["created_at", "DESC"]],
    });

    const grouped = {};
    favorites.forEach((fav) => {
      const mapped = mapHotelFavoriteItem(fav);
      if (!mapped) return;
      const date = new Date(mapped.addedAt);
      const bucketKey = date.toISOString().slice(0, 10);
      if (!grouped[bucketKey]) grouped[bucketKey] = [];
      grouped[bucketKey].push(mapped);
    });

    const buckets = Object.entries(grouped)
      .sort(([a], [b]) => (a > b ? -1 : 1))
      .map(([key, items]) => {
        const date = new Date(key);
        const title = date.toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
        return { key, title, items };
      });

    res.json({
      list: { id: list.id, name: list.name, createdAt: list.created_at },
      groups: buckets,
    });
  } catch (err) {
    console.error("[hotel-favorites] getHotelFavoriteListDetail error:", err);
    res.status(500).json({ error: "Unable to load the list." });
  }
};

export const getHotelRecentViews = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  try {
    const recents = await models.HotelRecentView.findAll({
      where: { user_id: userId },
      include: [
        {
          model: models.WebbedsHotel,
          as: "hotel",
          include: includeForHotelCard,
        },
      ],
      order: [["viewed_at", "DESC"]],
      limit: 100,
    });

    const grouped = {};
    recents.forEach((entry) => {
      const card = formatStaticHotel(entry.hotel);
      if (!card) return;
      const key = entry.viewed_at.toISOString().slice(0, 10);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        hotelId: entry.hotel_id != null ? String(entry.hotel_id) : null,
        viewedAt: entry.viewed_at,
        card,
      });
    });

    const buckets = Object.entries(grouped)
      .sort(([a], [b]) => (a > b ? -1 : 1))
      .map(([key, items]) => {
        const date = new Date(key);
        const title = date.toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
        return { key, title, items };
      });

    res.json({ groups: buckets });
  } catch (err) {
    console.error("[hotel-favorites] getHotelRecentViews error:", err);
    res.status(500).json({ error: "Unable to load recently viewed hotels." });
  }
};

export const addHotelFavoriteToList = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  const listId = parseListId(req.params?.listId);
  const hotelId = parseHotelId(req.body?.hotelId ?? req.params?.hotelId);
  if (!listId || !hotelId) {
    res.status(400).json({ error: "Invalid list or hotel id" });
    return;
  }
  try {
    const list = await ensureListOwnership(userId, listId, res);
    if (!list) return;
    const hotel = await models.WebbedsHotel.findOne({
      where: { hotel_id: hotelId },
      attributes: ["hotel_id"],
    });
    if (!hotel) {
      res.status(404).json({ error: "Hotel not found" });
      return;
    }

    const existing = await models.HotelFavorite.findOne({
      where: { user_id: userId, hotel_id: hotelId, list_id: listId },
      paranoid: false,
    });

    if (existing) {
      if (existing.deletedAt ?? existing.deleted_at) {
        await existing.restore();
      } else {
        existing.updatedAt = new Date();
        await existing.save();
      }
      return res.status(200).json({
        favorite: {
          id: existing?.id ?? null,
          hotelId,
          listId,
          addedAt: existing?.created_at ?? existing?.createdAt ?? new Date(),
        },
      });
    }

    const favorite = await models.HotelFavorite.create({
      user_id: userId,
      hotel_id: hotelId,
      list_id: listId,
    });

    return res.status(200).json({
      favorite: {
        id: favorite?.id ?? null,
        hotelId,
        listId,
        addedAt: favorite?.created_at ?? favorite?.createdAt ?? new Date(),
      },
    });
  } catch (err) {
    if (err?.name === "SequelizeUniqueConstraintError") {
      const existing = await models.HotelFavorite.findOne({
        where: { user_id: userId, hotel_id: hotelId, list_id: listId },
        paranoid: false,
      });
      if (existing) {
        return res.status(200).json({
          favorite: {
            id: existing.id,
            hotelId,
            listId,
            addedAt: existing.created_at ?? existing.createdAt ?? new Date(),
          },
        });
      }
    }
    console.error("[hotel-favorites] addHotelFavoriteToList error:", err);
    res.status(500).json({ error: "Unable to save favorite." });
  }
};

export const removeHotelFavoriteFromList = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  const listId = parseListId(req.params?.listId);
  const hotelId = parseHotelId(req.params?.hotelId);
  if (!listId || !hotelId) {
    res.status(400).json({ error: "Invalid list or hotel id" });
    return;
  }
  try {
    const list = await ensureListOwnership(userId, listId, res);
    if (!list) return;
    await models.HotelFavorite.destroy({
      where: { user_id: userId, list_id: listId, hotel_id: hotelId },
    });
    res.json({ removed: true });
  } catch (err) {
    console.error("[hotel-favorites] removeHotelFavoriteFromList error:", err);
    res.status(500).json({ error: "Unable to update favorite." });
  }
};

export const recordHotelRecentView = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  const hotelId = parseHotelId(req.params?.hotelId);
  if (!hotelId) {
    res.status(400).json({ error: "Invalid hotel id" });
    return;
  }
  try {
    const [entry, created] = await models.HotelRecentView.findOrCreate({
      where: { user_id: userId, hotel_id: hotelId },
      defaults: { user_id: userId, hotel_id: hotelId, viewed_at: new Date() },
    });
    if (!created) {
      entry.viewed_at = new Date();
      await entry.save();
    }
    res.json({ recorded: true });
  } catch (err) {
    console.error("[hotel-favorites] recordHotelRecentView error:", err);
    res.status(500).json({ error: "Unable to record view." });
  }
};
