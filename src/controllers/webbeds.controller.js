import { Op } from "sequelize"
import models from "../models/index.js"
import { WebbedsProvider } from "../providers/webbeds/provider.js"
import { formatStaticHotel } from "../utils/webbedsMapper.js"

const provider = new WebbedsProvider()

export const search = (req, res, next) => provider.search(req, res, next)
export const getRooms = (req, res, next) => provider.getRooms(req, res, next)

export const listStaticHotels = async (req, res, next) => {
  try {
    const { cityCode, countryCode, q, limit = 20, offset = 0, preferred } = req.query

    const where = {}
    if (cityCode) {
      where.city_code = String(cityCode).trim()
    }
    if (countryCode) {
      where.country_code = String(countryCode).trim()
    }
    if (q) {
      where.name = { [Op.iLike]: `%${q.trim()}%` }
    }
    if (preferred === "true") {
      where.preferred = true
    }

    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20))
    const safeOffset = Math.max(0, Number(offset) || 0)

    const { rows, count } = await models.WebbedsHotel.findAndCountAll({
      where,
      attributes: [
        "hotel_id",
        "name",
        "city_name",
        "city_code",
        "country_name",
        "country_code",
        "address",
        "full_address",
        "lat",
        "lng",
        "rating",
        "priority",
        "preferred",
        "exclusive",
        "chain",
        "chain_code",
        "classification_code",
        "images",
        "amenities",
        "leisure",
        "business",
        "descriptions",
      ],
      include: [
        {
          model: models.WebbedsHotelChain,
          as: "chainCatalog",
          attributes: ["code", "name"],
        },
        {
          model: models.WebbedsHotelClassification,
          as: "classification",
          attributes: ["code", "name"],
        },
      ],
      order: [
        ["priority", "DESC"],
        ["name", "ASC"],
      ],
      limit: safeLimit,
      offset: safeOffset,
    })

    return res.json({
      items: rows.map(formatStaticHotel),
      pagination: {
        total: count,
        limit: safeLimit,
        offset: safeOffset,
      },
    })
  } catch (error) {
    return next(error)
  }
}

export const listCountries = async (_req, res, next) => {
  try {
    const rows = await models.WebbedsCountry.findAll({
      attributes: ["code", "name"],
      order: [["name", "ASC"]],
    })
    const items = rows.map((row) => ({
      code: row.code != null ? String(row.code) : null,
      name: row.name,
    }))
    return res.json({ items })
  } catch (error) {
    return next(error)
  }
}
