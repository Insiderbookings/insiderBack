/* ────────────────────────────────────────────────
   src/services/cache.js
   Hybrid Cache: Redis (Production/Cloud) OR Memory (Local/Dev)
   ──────────────────────────────────────────────── */
import Redis from "ioredis"

// 1. Detect if Redis config is available
const useRedis = process.env.REDIS_URL || process.env.REDIS_HOST
let redisClient = null
let store = null // Fallback memory store
let storeBytes = 0

const toBoundedNumber = (value, fallback, minimum) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.floor(parsed))
}

const MEMORY_CACHE_MAX_ENTRIES = toBoundedNumber(
  process.env.MEMORY_CACHE_MAX_ENTRIES,
  200,
  10,
)
const MEMORY_CACHE_MAX_BYTES = toBoundedNumber(
  process.env.MEMORY_CACHE_MAX_BYTES,
  50 * 1024 * 1024,
  1024 * 1024,
)
const MEMORY_CACHE_MAX_ENTRY_BYTES = toBoundedNumber(
  process.env.MEMORY_CACHE_MAX_ENTRY_BYTES,
  2 * 1024 * 1024,
  16 * 1024,
)

const getSerializedValue = (value) => {
  if (value === undefined) return "null"
  return JSON.stringify(value)
}

const getSerializedSize = (value) => Buffer.byteLength(String(value || ""), "utf8")

const deleteMemoryEntry = (key, entry = null) => {
  if (!store) return
  const existing = entry || store.get(key)
  if (!existing) return
  store.delete(key)
  storeBytes = Math.max(0, storeBytes - Number(existing.bytes || 0))
}

const pruneExpiredMemoryEntries = (now = Date.now()) => {
  if (!store?.size) return
  for (const [key, entry] of store.entries()) {
    if (Number(entry?.exp || 0) <= now) {
      deleteMemoryEntry(key, entry)
    }
  }
}

const touchMemoryEntry = (key, entry) => {
  if (!store || !entry) return
  store.delete(key)
  store.set(key, entry)
}

const enforceMemoryLimits = () => {
  if (!store?.size) return
  while (store.size > MEMORY_CACHE_MAX_ENTRIES || storeBytes > MEMORY_CACHE_MAX_BYTES) {
    const oldestKey = store.keys().next().value
    if (!oldestKey) break
    deleteMemoryEntry(oldestKey)
  }
}

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
      pruneExpiredMemoryEntries()
      const raw = getSerializedValue(value)
      const bytes = getSerializedSize(raw)
      if (bytes > MEMORY_CACHE_MAX_ENTRY_BYTES) {
        deleteMemoryEntry(key)
        return
      }
      const exp = Date.now() + ttl * 1000
      deleteMemoryEntry(key)
      store.set(key, { raw, exp, bytes })
      storeBytes += bytes
      enforceMemoryLimits()
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
      pruneExpiredMemoryEntries()
      const entry = store.get(key)
      if (!entry) return null
      if (Date.now() > entry.exp) {
        deleteMemoryEntry(key, entry)
        return null
      }
      touchMemoryEntry(key, entry)
      return JSON.parse(entry.raw)
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
      deleteMemoryEntry(key)
    }
  } catch (e) {
    console.error("[Cache] Del error", e)
  }
}

export default { set, get, del }
