/* ────────────────────────────────────────────────
   src/services/cache.js
   Hybrid Cache: Redis (Production/Cloud) OR Memory (Local/Dev)
   ──────────────────────────────────────────────── */
import Redis from "ioredis"

// 1. Detect if Redis config is available
const useRedis = process.env.REDIS_URL || process.env.REDIS_HOST
let redisClient = null
let store = null // Fallback memory store

if (useRedis) {
  console.log("[Cache] Initializing Redis connection...")
  // ioredis auto-connects
  redisClient = new Redis(process.env.REDIS_URL || {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined
  })

  redisClient.on("error", (err) => {
    console.error("[Cache] Redis Error:", err)
  })

  redisClient.on("connect", () => {
    console.log("[Cache] Redis Connected!")
  })
} else {
  console.log("[Cache] No Redis config found. Using In-Memory Map.")
  store = new Map()
}

/** Guarda value con TTL en segundos (default 60) */
async function set(key, value, ttl = 60) {
  try {
    if (redisClient) {
      // Redis handles serialization and expiration automatically
      await redisClient.set(key, JSON.stringify(value), "EX", ttl)
    } else {
      // Fallback Memory
      const exp = Date.now() + ttl * 1000
      store.set(key, { value, exp })
    }
  } catch (e) {
    console.error("[Cache] Set error", e)
  }
}

/** Devuelve value (objeto ya parseado) o null si no existe / expiró */
async function get(key) {
  try {
    if (redisClient) {
      const raw = await redisClient.get(key)
      if (!raw) return null
      return JSON.parse(raw)
    } else {
      // Fallback Memory
      const entry = store.get(key)
      if (!entry) return null
      if (Date.now() > entry.exp) {
        store.delete(key)
        return null
      }
      return entry.value
    }
  } catch (e) {
    console.error("[Cache] Get error", e)
    return null
  }
}

async function del(key) {
  try {
    if (redisClient) {
      await redisClient.del(key)
    } else {
      store.delete(key)
    }
  } catch (e) {
    console.error("[Cache] Del error", e)
  }
}

export default { set, get, del }
