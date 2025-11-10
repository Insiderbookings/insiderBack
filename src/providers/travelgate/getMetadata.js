import cache from "../../services/cache.js"
import { fetchMetadataTGX, mapMetadata } from "./services/metadata.service.js"

export const getMetadata = async (req, res, next) => {
  try {
    const { supplierCodes } = req.query
    if (!supplierCodes) return res.status(400).json({ error: "supplierCodes param required" })

    const cacheKey = `metadata:${supplierCodes}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = { supplierCodes: supplierCodes.split(",") }
    const raw = await fetchMetadataTGX(criteria)
    const result = {
      count: raw.edges?.length || 0,
      metadata: mapMetadata(raw),
    }

    await cache.set(cacheKey, result, 3600)
    res.json(result)
  } catch (err) {
    if (err.response?.errors) {
      console.error("Metadata GraphQL Errors:", JSON.stringify(err.response.errors, null, 2))
    }
    console.error("Metadata error:", err)
    next(err)
  }
}



