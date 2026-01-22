import axios from "axios"
import cache from "./cache.js"

// Safe fallback rates if API fails completely AND cache is empty
const FALLBACK_RATES = {
    USD: 1,
    EUR: 0.95,
    GBP: 0.79,
    CAD: 1.35,
    AUD: 1.50,
}

const CACHE_KEY = "currency:rates"
const CACHE_TTL_SECONDS = 3600 // 1 Hour

export const getExchangeRate = async (toCurrency = "USD") => {
    const target = toCurrency.toUpperCase()
    if (target === "USD") return 1

    // 1. Try to get from Shared Cache (Redis/Memory)
    let rates = await cache.get(CACHE_KEY)

    if (!rates) {
        console.log("[CurrencyService] Cache miss. Fetching fresh rates...")
        try {
            // Using Frankfurter public API
            const response = await axios.get("https://api.frankfurter.app/latest?from=USD")

            if (response.data && response.data.rates) {
                rates = { USD: 1, ...response.data.rates }
                // Save to Shared Cache
                await cache.set(CACHE_KEY, rates, CACHE_TTL_SECONDS)
                console.log("[CurrencyService] Rates updated and cached.")
            }
        } catch (error) {
            console.error("[CurrencyService] API failed.", error.message)
        }
    }

    // 2. If still no rates (API failed + Cache empty), use Fallback
    if (!rates) {
        console.warn("[CurrencyService] Using HARDCODED fallback rates.")
        rates = { ...FALLBACK_RATES }
    }

    const rate = rates[target]
    if (!rate) {
        console.warn(`[CurrencyService] No rate found for ${target}, defaulting to USD (1.0).`)
        return 1
    }

    return rate
}

export const convertCurrency = async (amountInUsd, targetCurrency) => {
    const rate = await getExchangeRate(targetCurrency)
    return {
        amount: amountInUsd * rate,
        rate,
        currency: targetCurrency.toUpperCase(),
    }
}
