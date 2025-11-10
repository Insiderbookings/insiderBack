import cache from "../../services/cache.js"
import { fetchRoomsTGX, mapRooms, fetchAllRooms } from "./services/rooms.service.js"

export const getRooms = async (req, res, next) => {
  try {
    const { access, roomCodes, maxSize = "15", token = "", fetchAll = "false" } = req.query
    if (!access) return res.status(400).json({ error: "access param required" })

    const cacheKey = `rooms:${access}:${roomCodes || "all"}:${maxSize}:${token}:${fetchAll}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = {
      access,
      maxSize: Number.parseInt(maxSize),
      ...(roomCodes && { roomCodes: roomCodes.split(",") }),
    }

    let raw
    if (fetchAll === "true") raw = await fetchAllRooms(criteria)
    else raw = await fetchRoomsTGX(criteria, token)

    const result = {
      count: raw.edges?.length || 0,
      returned: raw.edges?.length || 0,
      rooms: mapRooms(raw),
      ...(raw.token && { nextToken: raw.token }),
    }

    await cache.set(cacheKey, result, 300)
    res.json(result)
  } catch (err) {
    if (err.response?.errors) {
      console.error("Rooms GraphQL Errors:", JSON.stringify(err.response.errors, null, 2))
    }
    console.error("Rooms error:", err)
    next(err)
  }
}



