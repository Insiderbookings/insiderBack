import axios from "axios"
import cache from "./cache.js"
import { getEnabledCurrencySettings } from "./currencySettings.service.js"

// Safe fallback rates if API fails completely AND cache is empty
const FALLBACK_RATES = {
    USD: 1,
    EUR: 0.95,
    GBP: 0.79,
    CAD: 1.35,
    AUD: 1.50,
    AED: 3.67,
    ARS: 1050,
    MXN: 17.2,
    BRL: 5.2,
}

const CACHE_KEY = "currency:rates"
const STALE_CACHE_KEY = "currency:rates:stale"
const CACHE_TTL_SECONDS = Number(process.env.CURRENCY_RATE_TTL_SECONDS || 43200) // 12 hours
const STALE_CACHE_TTL_SECONDS = Number(process.env.CURRENCY_RATE_STALE_TTL_SECONDS || 2592000) // 30 days
const STALE_SERVE_TTL_SECONDS = Math.max(
    60,
    Number(process.env.CURRENCY_RATE_STALE_SERVE_TTL_SECONDS || 600),
) // 10 minutes
const API_RETRY_COUNT = Math.max(0, Number(process.env.CURRENCY_RATE_API_RETRIES || 1))
const API_RETRY_DELAY_MS = Math.max(250, Number(process.env.CURRENCY_RATE_RETRY_DELAY_MS || 1500))
const API_RETRY_MAX_DELAY_MS = Math.max(
    1000,
    Number(process.env.CURRENCY_RATE_RETRY_MAX_DELAY_MS || 10000),
)
const API_RATE_LIMIT_COOLDOWN_MS = Math.max(
    10000,
    Number(process.env.CURRENCY_RATE_RATE_LIMIT_COOLDOWN_MS || 300000),
)
const API_TIMEOUT_MS = Math.max(1000, Number(process.env.CURRENCY_RATE_API_TIMEOUT_MS || 5000))
const API_HARD_TIMEOUT_MS = Math.max(
    API_TIMEOUT_MS,
    Number(process.env.CURRENCY_RATE_API_HARD_TIMEOUT_MS || 12000),
)

let fetchRatesInFlight = null
let apiRateLimitUntil = 0

const resolveCachedRates = (cached) => {
    if (!cached) return { rates: null, date: null, source: null }
    if (cached.rates) {
        return {
            rates: cached.rates,
            date: cached.date ?? cached.rateDate ?? null,
            source: cached.source ?? null,
        }
    }
    return { rates: cached, date: null, source: null }
}

const APILAYER_BASE_URL =
    process.env.APILAYER_EXCHANGE_URL ||
    process.env.APILAYER_BASE_URL ||
    "https://api.apilayer.com/exchangerates_data/latest"
const APILAYER_API_KEY = process.env.APILAYER_API_KEY || process.env.APILAYER_ACCESS_KEY || null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const withTimeout = (promise, ms, label = "operation") =>
    new Promise((resolve, reject) => {
        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            reject(new Error(`${label} timed out after ${ms}ms`))
        }, ms)
        promise
            .then((value) => {
                if (timedOut) return
                clearTimeout(timer)
                resolve(value)
            })
            .catch((error) => {
                if (timedOut) return
                clearTimeout(timer)
                reject(error)
            })
    })

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const parseRetryAfterMs = (raw) => {
    if (raw == null) return null
    const value = String(raw).trim()
    if (!value) return null

    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
        // Retry-After standard is seconds; some providers return milliseconds.
        const asMs = numeric > 100000 ? numeric : numeric * 1000
        return clamp(Math.round(asMs), 250, API_RETRY_MAX_DELAY_MS)
    }

    const when = Date.parse(value)
    if (Number.isFinite(when)) {
        const diff = when - Date.now()
        if (diff > 0) return clamp(diff, 250, API_RETRY_MAX_DELAY_MS)
    }
    return null
}

const resolveRetryDelay = (error, attempt) => {
    const retryAfterRaw = error?.response?.headers?.["retry-after"]
    const retryAfterMs = parseRetryAfterMs(retryAfterRaw)
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        return retryAfterMs
    }
    return clamp(API_RETRY_DELAY_MS * (attempt + 1), 250, API_RETRY_MAX_DELAY_MS)
}

const persistRates = async (payload) => {
    await cache.set(CACHE_KEY, payload, CACHE_TTL_SECONDS)
    await cache.set(STALE_CACHE_KEY, payload, STALE_CACHE_TTL_SECONDS)
}

const resolveSymbolsParam = async () => {
    if (process.env.APILAYER_SYMBOLS) return process.env.APILAYER_SYMBOLS
    try {
        const enabled = await getEnabledCurrencySettings()
        const symbols = enabled
            .map((item) => String(item.code || "").toUpperCase())
            .filter((code) => code && code !== "USD")
        return symbols.length ? symbols.join(",") : ""
    } catch {
        return ""
    }
}

const fetchRatesFromApiLayer = async () => {
    const now = Date.now()
    if (apiRateLimitUntil > now) {
        const waitMs = apiRateLimitUntil - now
        const err = new Error(`APILayer cooldown active for ${waitMs}ms`)
        err.code = "APILAYER_RATE_LIMIT_COOLDOWN"
        throw err
    }

    let attempt = 0
    while (true) {
        try {
            const symbols = await resolveSymbolsParam()
            const url = new URL(APILAYER_BASE_URL)
            const isCurrencyData = /currency_data/i.test(APILAYER_BASE_URL)
            const baseParam = isCurrencyData ? "source" : "base"
            const symbolsParam = isCurrencyData ? "currencies" : "symbols"
            if (!url.searchParams.get(baseParam)) url.searchParams.set(baseParam, "USD")
            if (symbols) url.searchParams.set(symbolsParam, symbols)
            if (process.env.APILAYER_ACCESS_KEY) {
                url.searchParams.set("access_key", process.env.APILAYER_ACCESS_KEY)
            }
            const headers = APILAYER_API_KEY ? { apikey: APILAYER_API_KEY } : undefined
            const response = await axios.get(url.toString(), { headers, timeout: API_TIMEOUT_MS })
            const data = response?.data || {}
            if (data?.success === false) {
                const message = data?.error?.info || data?.message || "APILayer error"
                throw new Error(message)
            }
            let rates = data?.rates || null
            if (!rates && data?.quotes) {
                rates = Object.entries(data.quotes).reduce((acc, [key, value]) => {
                    const code = String(key || "").replace(/^USD/, "")
                    if (code) acc[code] = value
                    return acc
                }, {})
            }
            if (!rates) return null
            const date =
                data?.date ||
                (data?.timestamp ? new Date(Number(data.timestamp) * 1000).toISOString().slice(0, 10) : null)
            return { rates: { USD: 1, ...rates }, date, source: "apilayer" }
        } catch (error) {
            const status = Number(error?.response?.status || 0)
            if (status === 429) {
                const retryAfterRaw = error?.response?.headers?.["retry-after"]
                const retryAfterMs = parseRetryAfterMs(retryAfterRaw)
                const cooldownMs = Math.max(API_RATE_LIMIT_COOLDOWN_MS, retryAfterMs || 0)
                apiRateLimitUntil = Date.now() + cooldownMs
                console.warn(
                    `[CurrencyService] APILayer rate-limited (429). Cooldown ${cooldownMs}ms before next attempt.`,
                )
                throw error
            }
            const retryable = status >= 500
            if (!retryable || attempt >= API_RETRY_COUNT) {
                throw error
            }
            const delayMs = resolveRetryDelay(error, attempt)
            attempt += 1
            console.warn(
                `[CurrencyService] APILayer ${status || "error"} retry ${attempt}/${API_RETRY_COUNT} in ${delayMs}ms`,
            )
            await sleep(delayMs)
        }
    }
}

const fetchAndCacheRates = async () => {
    if (fetchRatesInFlight) return fetchRatesInFlight
    fetchRatesInFlight = withTimeout(
        (async () => {
            const apiResult = await fetchRatesFromApiLayer()
            if (!apiResult?.rates) return null
            await persistRates(apiResult)
            return apiResult
        })(),
        API_HARD_TIMEOUT_MS,
        "CurrencyService fetchAndCacheRates",
    ).finally(() => {
        fetchRatesInFlight = null
    })
    return fetchRatesInFlight
}

export const refreshRates = async ({ force = false } = {}) => {
    if (!force) {
        const cached = await cache.get(CACHE_KEY)
        const { rates } = resolveCachedRates(cached)
        if (rates) return null
    }
    return fetchAndCacheRates()
}

const loadRates = async ({ force = false } = {}) => {
    let cached = await cache.get(CACHE_KEY)
    let { rates, date, source } = resolveCachedRates(cached)

    if (!rates || force) {
        if (!rates) {
            console.log("[CurrencyService] Cache miss. Fetching fresh rates...")
        }
        try {
            const refreshed = await fetchAndCacheRates()
            if (refreshed?.rates) {
                rates = refreshed.rates
                date = refreshed.date
                source = refreshed.source
                console.log("[CurrencyService] Rates updated and cached.")
            }
        } catch (error) {
            const status = Number(error?.response?.status || 0)
            console.error("[CurrencyService] API failed.", status || "", error.message)
        }
    }

    if (!rates) {
        const stale = await cache.get(STALE_CACHE_KEY)
        const staleResolved = resolveCachedRates(stale)
        if (staleResolved.rates) {
            rates = staleResolved.rates
            date = staleResolved.date
            source = staleResolved.source || "stale-cache"
            console.warn("[CurrencyService] Using STALE cached rates.")
            await cache.set(
                CACHE_KEY,
                { rates, date, source: "stale-cache" },
                STALE_SERVE_TTL_SECONDS,
            )
        }
    }

    if (!rates) {
        console.warn("[CurrencyService] Using HARDCODED fallback rates.")
        rates = { ...FALLBACK_RATES }
        source = "fallback"
        date = null
    }

    return { rates, date, source }
}

export const getExchangeRateMeta = async (toCurrency = "USD") => {
    const target = toCurrency.toUpperCase()
    if (target === "USD") {
        return { rate: 1, date: null, source: "base", currency: "USD", missing: false }
    }
    const { rates, date, source } = await loadRates()
    const rate = rates[target]
    if (!rate) {
        console.warn(`[CurrencyService] No rate found for ${target}, defaulting to USD (1.0).`)
        return { rate: 1, date, source: source || "fallback", currency: "USD", missing: true }
    }
    return { rate, date, source, currency: target, missing: false }
}

export const getExchangeRate = async (toCurrency = "USD") => {
    const meta = await getExchangeRateMeta(toCurrency)
    return meta.rate
}

export const convertCurrency = async (amountInUsd, targetCurrency) => {
    const meta = await getExchangeRateMeta(targetCurrency)
    if (meta.currency === "USD") {
        return {
            amount: amountInUsd,
            rate: 1,
            currency: "USD",
            source: meta.source,
            rateDate: meta.date,
            missing: meta.missing,
        }
    }
    return {
        amount: amountInUsd * meta.rate,
        rate: meta.rate,
        currency: meta.currency,
        source: meta.source,
        rateDate: meta.date,
        missing: meta.missing,
    }
}
