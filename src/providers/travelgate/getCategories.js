import cache from "../../services/cache.js"
import { fetchCategoriesTGX, mapCategories, fetchAllCategories } from "./services/categories.service.js"

export const getCategories = async (req, res, next) => {
  try {
    const { access, categoryCodes, group, fetchAll = "false" } = req.query
    if (!access) return res.status(400).json({ error: "access param required" })

    const cacheKey = `categories:${access}:${categoryCodes || "all"}:${group || "none"}:${fetchAll}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = {
      access,
      ...(categoryCodes && { categoryCodes: categoryCodes.split(",") }),
      ...(group && { group }),
    }

    let raw
    if (fetchAll === "true") raw = await fetchAllCategories(criteria)
    else raw = await fetchCategoriesTGX(criteria)

    const result = {
      count: raw.edges?.length || 0,
      categories: mapCategories(raw),
      ...(raw.token && { token: raw.token }),
    }

    await cache.set(cacheKey, result, 300)
    res.json(result)
  } catch (err) {
    if (err.response?.errors) {
      console.error("Categories GraphQL Errors:", JSON.stringify(err.response.errors, null, 2))
    }
    console.error("Categories error:", err)
    next(err)
  }
}



