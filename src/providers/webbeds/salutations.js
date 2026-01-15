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

const SALUTATION_LABELS = {
  child: "Child",
  dr: "Dr.",
  madame: "Madame",
  mademoiselle: "Mademoiselle",
  messrs: "Messrs.",
  miss: "Miss",
  monsieur: "Monsieur",
  mr: "Mr.",
  mrs: "Mrs.",
  ms: "Ms.",
  sir: "Sir",
  "sir/madam": "Sir/Madam",
}

const SALUTATION_ORDER = [
  "child",
  "dr",
  "madame",
  "mademoiselle",
  "messrs",
  "miss",
  "monsieur",
  "mr",
  "mrs",
  "ms",
  "sir",
  "sir/madam",
]

const normalizeSalutationKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z/]/g, "")

let salutationIdSet = new Set(Object.values(SALUTATION_IDS))
let salutationsOptions = null

const resolveSalutationIdFromMap = (map, value) => {
  if (value == null || value === "") return null
  if (typeof value === "number" && Number.isFinite(value)) {
    return salutationIdSet.has(value) ? value : null
  }
  const text = String(value).trim()
  if (/^\d+$/.test(text)) {
    const numeric = Number(text)
    return salutationIdSet.has(numeric) ? numeric : null
  }
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

const buildFallbackOptions = () =>
  SALUTATION_ORDER.map((key, idx) => ({
    value: SALUTATION_IDS[key],
    label: SALUTATION_LABELS[key] ?? key,
    key,
    runno: idx,
  }))

const buildCache = (options) => {
  const map = new Map()
  const idSet = new Set(Object.values(SALUTATION_IDS))
  const normalizedOptions = []
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
    idSet.add(value)
    const label =
      typeof option === "string"
        ? option
        : option?.["#text"] ?? option?.text ?? option?.name ?? null
    if (label) {
      const key = normalizeSalutationKey(label)
      if (key) {
        map.set(key, value)
        normalizedOptions.push({
          value,
          label: String(label).trim(),
          key,
          runno: option?.["@_runno"] ?? option?.runno ?? normalizedOptions.length,
        })
      }
    }
  })
  salutationIdSet = idSet
  const sortedOptions = normalizedOptions
    .filter((item) => item.label && Number.isFinite(item.value))
    .sort((a, b) => Number(a.runno) - Number(b.runno))
    .map(({ runno, ...rest }) => rest)
  salutationsOptions = sortedOptions.length ? sortedOptions : buildFallbackOptions()
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

export const listSalutations = async ({ forceRefresh = false } = {}) => {
  if (forceRefresh) {
    await refreshSalutationsCache({ force: true })
  } else {
    ensureSalutationsCacheWarm()
  }
  if (!salutationsOptions || !salutationsOptions.length) {
    salutationsOptions = buildFallbackOptions()
  }
  return salutationsOptions
}
