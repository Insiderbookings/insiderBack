import cache from "../../services/cache.js"
import { fetchBoardsTGX, mapBoards, fetchAllBoards } from "./services/boards.service.js"

export const getBoards = async (req, res, next) => {
  try {
    const { access, boardCodes, group, fetchAll = "false" } = req.query
    if (!access) return res.status(400).json({ error: "access param required" })

    const cacheKey = `boards:${access}:${boardCodes || "all"}:${group || "none"}:${fetchAll}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = {
      access,
      ...(boardCodes && { boardCodes: boardCodes.split(",") }),
      ...(group && { group }),
    }

    let raw
    if (fetchAll === "true") raw = await fetchAllBoards(criteria)
    else raw = await fetchBoardsTGX(criteria)

    const result = {
      count: raw.edges?.length || 0,
      returned: raw.edges?.length || 0,
      boards: mapBoards(raw),
      ...(raw.token && { token: raw.token }),
    }

    await cache.set(cacheKey, result, 300)
    res.json(result)
  } catch (err) {
    if (err.response?.errors) {
      console.error("Boards GraphQL Errors:", JSON.stringify(err.response.errors, null, 2))
    }
    console.error("Boards error:", err)
    next(err)
  }
}



