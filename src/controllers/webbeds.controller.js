import { Op } from "sequelize"
import models from "../models/index.js"
import { WebbedsProvider } from "../providers/webbeds/provider.js"

const provider = new WebbedsProvider()

export const search = (req, res, next) => provider.search(req, res, next)

const ensureArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const extractTextList = (node, entryKey) => {
  const languages = ensureArray(node?.language ?? node)
  const collected = []
  languages.forEach((languageNode) => {
    const entries = ensureArray(languageNode?.[entryKey])
    entries.forEach((entry) => {
      if (!entry) return
      if (typeof entry === "string") {
        collected.push(entry)
        return
      }
      collected.push(entry?.["#text"] ?? entry?.text ?? entry?.name ?? null)
    })
  })
  return collected.filter(Boolean)
}

const pickCoverImage = (imagesPayload) => {
  if (!imagesPayload) return null
  const hotelImages = imagesPayload?.hotelImages ?? imagesPayload
  if (hotelImages?.thumb) {
    return hotelImages.thumb
  }
  const imageList = ensureArray(hotelImages?.image)
  const found = imageList.find((image) => image?.url)
  return found?.url ?? null
}

const extractShortDescription = (descriptions) => {
  const descNode = descriptions?.description1 ?? descriptions?.description2 ?? null
  if (!descNode) return null
  const languageNode = Array.isArray(descNode)
    ? descNode.find((entry) => entry?.language)?.language
    : descNode.language ?? descNode
  if (!languageNode) return null
  return languageNode?.["#text"] ?? languageNode?.text ?? null
}

const formatStaticHotel = (hotel) => {
  const plain = hotel.get ? hotel.get({ plain: true }) : hotel
  const coverImage = pickCoverImage(plain.images)
  const amenityList = extractTextList(plain.amenities, "amenitieItem").slice(0, 6)
  const leisureList = extractTextList(plain.leisure, "leisureItem").slice(0, 4)
  const businessList = extractTextList(plain.business, "businessItem").slice(0, 4)

  return {
    id: String(plain.hotel_id),
    name: plain.name,
    city: plain.city_name,
    cityCode: plain.city_code != null ? String(plain.city_code) : null,
    country: plain.country_name,
    countryCode: plain.country_code != null ? String(plain.country_code) : null,
    rating: plain.rating,
    address:
      plain.full_address?.hotelStreetAddress ??
      plain.address ??
      [plain.city_name, plain.country_name].filter(Boolean).join(", "),
    geoPoint:
      plain.lat != null && plain.lng != null ? { lat: Number(plain.lat), lng: Number(plain.lng) } : null,
    priority: plain.priority,
    preferred: Boolean(plain.preferred),
    exclusive: Boolean(plain.exclusive),
    chain: plain.chainCatalog
      ? { code: String(plain.chainCatalog.code), name: plain.chainCatalog.name }
      : plain.chain
        ? { code: plain.chain, name: plain.chain }
        : null,
    classification: plain.classification
      ? { code: String(plain.classification.code), name: plain.classification.name }
      : plain.classification_code
        ? { code: String(plain.classification_code), name: null }
        : null,
    coverImage,
    imagesCount:
      Number(plain.images?.hotelImages?.["@_count"] ?? plain.images?.["@count"]) ||
      (plain.images?.hotelImages?.image?.length ?? null),
    shortDescription: extractShortDescription(plain.descriptions),
    amenities: amenityList,
    leisure: leisureList,
    business: businessList,
  }
}

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
