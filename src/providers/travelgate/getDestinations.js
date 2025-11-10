import cache from "../../services/cache.js"
import { fetchDestinationsTGX, mapDestinations, fetchAllDestinations } from "./services/destinations.service.js"

export const getDestinations = async (req, res, next) => {
  try {
    const {
      access,
      destinationCodes,
      group,
      maxSize = "15",
      token = "",
      fetchAll = "false",
      type,
    } = req.query

    if (!access) return res.status(400).json({ error: "access param required" })

    const cacheKey = `destinations:${access}:${destinationCodes || "all"}:${group || "none"}:${maxSize}:${token}:${fetchAll}:${type || "all"}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = {
      access,
      maxSize: Number.parseInt(maxSize),
      ...(destinationCodes && { destinationCodes: destinationCodes.split(",") }),
      ...(group && { group }),
    }

    let raw
    if (fetchAll === "true") raw = await fetchAllDestinations(criteria)
    else raw = await fetchDestinationsTGX(criteria, token)

    let mappedDestinations = mapDestinations(raw)
    if (type && (type === "CITY" || type === "ZONE")) {
      mappedDestinations = mappedDestinations.filter((dest) => dest.type === type)
    }

    const result = {
      count: mappedDestinations.length,
      returned: mappedDestinations.length,
      destinations: mappedDestinations,
      ...(raw.token && { nextToken: raw.token }),
    }

    await cache.set(cacheKey, result, 300)
    res.json(result)
  } catch (err) {
    if (err.response?.errors) {
      console.error("Destinations GraphQL Errors:", JSON.stringify(err.response.errors, null, 2))
    }
    console.error("Destinations error:", err)
    next(err)
  }
}



