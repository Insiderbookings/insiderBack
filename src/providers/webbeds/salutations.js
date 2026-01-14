import { createWebbedsClient } from "./client.js"
import { getWebbedsConfig } from "./config.js"

const ensureArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const SALUTATION_IDS = {
  child: 14632,
  dr: 558,
  madame: 1671,
  mademoiselle: 74195,
  messrs: 9234,
  miss: 15134,
  monsieur: 74185,
  mr: 147,
  mrs: 149,
  ms: 148,
  sir: 1328,
  "sir/madam": 3801,
}

const normalizeSalutationKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z/]/g, "")

const resolveSalutationIdFromMap = (map, value) => {
  if (value == null || value === "") return null
  if (typeof value === "number" && Number.isFinite(value)) return value
  const text = String(value).trim()
  if (/^\d+$/.test(text)) return Number(text)
  const key = normalizeSalutationKey(text)
  return map?.get(key) ?? SALUTATION_IDS[key] ?? null
}

let salutationsCache = null
let cacheExpiresAt = 0
let refreshPromise = null

const getCacheTtlMs = () => {
  const parsed = Number(process.env.WEBBEDS_SALUTATION_TTL_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24 * 60 * 60 * 1000
}

const extractOptions = (result) => {
  const node =
    result?.salutations ??
    result?.salutation ??
    result?.salutationIds ??
    result?.salutationID ??
    result?.salutationids ??
    null
  if (!node) return []
  if (Array.isArray(node)) return node
  if (Array.isArray(node?.option)) return node.option
  return ensureArray(node?.option ?? node)
}

const buildCache = (options) => {
  const map = new Map()
  ensureArray(options).forEach((option) => {
    if (!option) return
    const rawValue =
      option?.["@_value"] ??
      option?.value ??
      option?.["@value"] ??
      option?.["@_id"] ??
      option?.["@id"] ??
      null
    if (rawValue == null) return
    const value = Number(rawValue)
    if (!Number.isFinite(value)) return
    const label =
      typeof option === "string"
        ? option
        : option?.["#text"] ?? option?.text ?? option?.name ?? null
    if (!label) return
    const key = normalizeSalutationKey(label)
    if (!key) return
    map.set(key, value)
  })
  return map
}

const getClient = () => {
  try {
    const config = getWebbedsConfig()
    return createWebbedsClient(config)
  } catch (error) {
    console.warn("[webbeds] salutations client unavailable:", error.message)
    return null
  }
}

export const refreshSalutationsCache = async ({ force = false } = {}) => {
  if (!force && salutationsCache && Date.now() < cacheExpiresAt) {
    return salutationsCache
  }
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const client = getClient()
    if (!client) return salutationsCache
    const { result } = await client.send("getsalutationsids", {})
    const options = extractOptions(result)
    if (!options.length) {
      console.warn("[webbeds] salutations list empty")
      return salutationsCache
    }
    salutationsCache = buildCache(options)
    cacheExpiresAt = Date.now() + getCacheTtlMs()
    console.info("[webbeds] salutations cache refreshed", { count: salutationsCache.size })
    return salutationsCache
  })()

  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

export const warmSalutationsCache = async () => {
  try {
    await refreshSalutationsCache({ force: true })
  } catch (error) {
    console.warn("[webbeds] salutations cache warm failed:", error.message)
  }
}

export const ensureSalutationsCacheWarm = () => {
  if (!salutationsCache || Date.now() >= cacheExpiresAt) {
    refreshSalutationsCache().catch((error) => {
      console.warn("[webbeds] salutations cache refresh failed:", error.message)
    })
  }
}

export const resolveSalutationId = (value) =>
  resolveSalutationIdFromMap(salutationsCache, value)

export const getDefaultSalutationId = () => SALUTATION_IDS.mr
