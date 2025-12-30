import { QueryTypes } from "sequelize";
import models, { sequelize } from "../models/index.js";
import { mapHomeToCard } from "../utils/homeMapper.js";

const ensureUser = (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
};

const parseHomeId = (value) => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
};

const parseListId = (value) => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
};

const mapFavoriteItem = (fav) => {
  if (!fav?.home) return null;
  const card = mapHomeToCard(fav.home);
  if (!card) return null;
  const addedAtRaw = fav.created_at ?? fav.createdAt ?? fav.addedAt ?? null;
  const addedDate = addedAtRaw ? new Date(addedAtRaw) : new Date();
  const safeAddedAt = Number.isNaN(addedDate.getTime()) ? new Date() : addedDate;
  const base = {
    id: fav.id,
    homeId: fav.home_id,
    addedAt: safeAddedAt,
    card,
  };
  if (fav.list_id) base.listId = fav.list_id;
  return base;
};

const ensureListOwnership = async (userId, listId, res) => {
  const list = await models.HomeFavoriteList.findOne({
    where: { id: listId, user_id: userId },
  });
  if (!list) {
    if (res) res.status(404).json({ error: "List not found" });
    return null;
  }
  return list;
};

const includeForHomeCard = [
  {
    model: models.HomeAddress,
    as: "address",
    attributes: ["address_line1", "city", "state", "country"],
  },
  {
    model: models.HomePricing,
    as: "pricing",
    attributes: ["currency", "base_price"],
  },
  {
    model: models.HomeMedia,
    as: "media",
    attributes: ["id", "url", "is_cover", "order"],
    separate: true,
    limit: 6,
    order: [
      ["is_cover", "DESC"],
      ["order", "ASC"],
      ["id", "ASC"],
    ],
  },
  {
    model: models.User,
    as: "host",
    attributes: ["id", "name", "email", "avatar_url", "role"],
    include: [
      {
        model: models.HostProfile,
        as: "hostProfile",
        attributes: ["metadata"],
        required: false,
      },
    ],
  },
];

export const listFavoriteLists = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  try {
    const lists = await models.HomeFavoriteList.findAll({
      where: { user_id: userId },
      order: [["created_at", "DESC"]],
      include: [
        {
          model: models.HomeFavorite,
          as: "items",
          include: [
            {
              model: models.Home,
              as: "home",
              include: includeForHomeCard,
            },
          ],
          separate: true,
          limit: 8,
          order: [["created_at", "DESC"]],
        },
      ],
    });

    const allFavoriteRows = await models.HomeFavorite.findAll({
      where: { user_id: userId },
      attributes: ["list_id", "home_id"],
    });
    const listHomeIdsMap = new Map();
    allFavoriteRows.forEach((row) => {
      const listKey = row.list_id;
      if (!listKey) return;
      const homeId = Number(row.home_id);
      if (!Number.isFinite(homeId)) return;
      if (!listHomeIdsMap.has(listKey)) listHomeIdsMap.set(listKey, new Set());
      listHomeIdsMap.get(listKey).add(homeId);
    });

    const mappedLists = lists.map((list) => {
      const items = Array.isArray(list.items) ? list.items.map(mapFavoriteItem).filter(Boolean) : [];
      const homeIdSet =
        listHomeIdsMap.get(list.id) || new Set(items.map((item) => item.homeId).filter((id) => Number.isFinite(id)));
      return {
        id: list.id,
        name: list.name,
        createdAt: list.created_at,
        preview: items.slice(0, 4).map((item) => item.card),
        homeIds: Array.from(homeIdSet),
        itemCount: homeIdSet.size,
      };
    });

    const recentViews = await models.HomeRecentView.findAll({
      where: { user_id: userId },
      include: [
        {
          model: models.Home,
          as: "home",
          include: includeForHomeCard,
        },
      ],
      order: [["viewed_at", "DESC"]],
      limit: 12,
    });

    const recent = recentViews
      .map((view) => ({
        homeId: view.home_id,
        viewedAt: view.viewed_at,
        card: mapHomeToCard(view.home),
      }))
      .filter((entry) => entry.card);

    res.json({
      lists: mappedLists,
      recent,
    });
  } catch (err) {
    console.error("[favorites] listFavoriteLists error:", err);
    res.status(500).json({ error: "Unable to load favorites." });
  }
};

export const createFavoriteList = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "List name is required" });
    return;
  }
  try {
    const [list] = await models.HomeFavoriteList.findOrCreate({
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
    console.error("[favorites] createFavoriteList error:", err);
    res.status(500).json({ error: "Unable to create the list." });
  }
};

export const getFavoriteListDetail = async (req, res) => {
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
    const favorites = await models.HomeFavorite.findAll({
      where: { list_id: listId, user_id: userId },
      include: [
        {
          model: models.Home,
          as: "home",
          include: includeForHomeCard,
        },
      ],
      order: [["created_at", "DESC"]],
    });

    const grouped = {};
    favorites.forEach((fav) => {
      const mapped = mapFavoriteItem(fav);
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
    console.error("[favorites] getFavoriteListDetail error:", err);
    res.status(500).json({ error: "Unable to load the list." });
  }
};

export const getRecentViews = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  try {
    const recents = await models.HomeRecentView.findAll({
      where: { user_id: userId },
      include: [
        {
          model: models.Home,
          as: "home",
          include: includeForHomeCard,
        },
      ],
      order: [["viewed_at", "DESC"]],
      limit: 100,
    });

    const grouped = {};
    recents.forEach((entry) => {
      const card = mapHomeToCard(entry.home);
      if (!card) return;
      const key = entry.viewed_at.toISOString().slice(0, 10);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        homeId: entry.home_id,
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
    console.error("[favorites] getRecentViews error:", err);
    res.status(500).json({ error: "Unable to load recently viewed homes." });
  }
};

export const addFavoriteToList = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  const listId = parseListId(req.params?.listId);
  const homeId = parseHomeId(req.body?.homeId ?? req.params?.homeId);
  if (!listId || !homeId) {
    res.status(400).json({ error: "Invalid list or home id" });
    return;
  }
  try {
    const list = await ensureListOwnership(userId, listId, res);
    if (!list) return;
    const home = await models.Home.findOne({
      where: { id: homeId, status: "PUBLISHED", is_visible: true },
      attributes: ["id"],
    });
    if (!home) {
      res.status(404).json({ error: "Home not found" });
      return;
    }

    const [favorite] = await sequelize.query(
      `
        INSERT INTO home_favorite (user_id, home_id, list_id, created_at, updated_at, deleted_at)
        VALUES (:userId, :homeId, :listId, NOW(), NOW(), NULL)
        ON CONFLICT (user_id, home_id, list_id) WHERE deleted_at IS NULL
        DO UPDATE SET
          deleted_at = NULL,
          updated_at = EXCLUDED.updated_at
        RETURNING id, created_at;
      `,
      {
        replacements: { userId, homeId, listId },
        type: QueryTypes.SELECT,
      }
    );

    res.status(200).json({
      favorite: {
        id: favorite?.id ?? null,
        homeId,
        listId,
        addedAt: favorite?.created_at ?? new Date(),
      },
    });
  } catch (err) {
    console.error("[favorites] addFavoriteToList error:", err);
    res.status(500).json({ error: "Unable to save favorite." });
  }
};

export const removeFavoriteFromList = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  const listId = parseListId(req.params?.listId);
  const homeId = parseHomeId(req.params?.homeId);
  if (!listId || !homeId) {
    res.status(400).json({ error: "Invalid list or home id" });
    return;
  }
  try {
    const list = await ensureListOwnership(userId, listId, res);
    if (!list) return;
    await models.HomeFavorite.destroy({
      where: { user_id: userId, list_id: listId, home_id: homeId },
    });
    res.json({ removed: true });
  } catch (err) {
    console.error("[favorites] removeFavoriteFromList error:", err);
    res.status(500).json({ error: "Unable to update favorite." });
  }
};

export const recordHomeRecentView = async (req, res) => {
  const userId = ensureUser(req, res);
  if (!userId) return;
  const homeId = parseHomeId(req.params?.homeId);
  if (!homeId) {
    res.status(400).json({ error: "Invalid home id" });
    return;
  }
  try {
    const [entry, created] = await models.HomeRecentView.findOrCreate({
      where: { user_id: userId, home_id: homeId },
      defaults: { user_id: userId, home_id: homeId, viewed_at: new Date() },
    });
    if (!created) {
      entry.viewed_at = new Date();
      await entry.save();
    }
    res.json({ recorded: true });
  } catch (err) {
    console.error("[favorites] recordHomeRecentView error:", err);
    res.status(500).json({ error: "Unable to record view." });
  }
};
