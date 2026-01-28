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
}

const CACHE_KEY = "currency:rates"
const CACHE_TTL_SECONDS = Number(process.env.CURRENCY_RATE_TTL_SECONDS || 43200) // 12 hours

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
    const response = await axios.get(url.toString(), { headers })
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
}

export const refreshRates = async ({ force = false } = {}) => {
    if (!force) {
        const cached = await cache.get(CACHE_KEY)
        const { rates } = resolveCachedRates(cached)
        if (rates) return null
    }
    const apiResult = await fetchRatesFromApiLayer()
    if (!apiResult?.rates) return null
    await cache.set(CACHE_KEY, apiResult, CACHE_TTL_SECONDS)
    return apiResult
}

const loadRates = async ({ force = false } = {}) => {
    let cached = await cache.get(CACHE_KEY)
    let { rates, date, source } = resolveCachedRates(cached)

    if (!rates || force) {
        if (!rates) {
            console.log("[CurrencyService] Cache miss. Fetching fresh rates...")
        }
        try {
            const refreshed = await fetchRatesFromApiLayer()
            if (refreshed?.rates) {
                rates = refreshed.rates
                date = refreshed.date
                source = refreshed.source
                await cache.set(CACHE_KEY, { rates, date, source }, CACHE_TTL_SECONDS)
                console.log("[CurrencyService] Rates updated and cached.")
            }
        } catch (error) {
            console.error("[CurrencyService] API failed.", error.message)
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
