/* ────────────────────────────────────────────────
   src/services/cache.js
   Cache simple en memoria (Map)
   ──────────────────────────────────────────────── */

const store = new Map()   // key -> { value, exp }

/** Guarda value con TTL en segundos (default 60) */
async function set (key, value, ttl = 60) {
  const exp = Date.now() + ttl * 1000
  store.set(key, { value, exp })
}

/** Devuelve value o null si no existe / expiró */
async function get (key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.exp) {
    store.delete(key)
    return null
  }
  return entry.value
}

async function del (key) {
  store.delete(key)
}

export default { set, get, del }
