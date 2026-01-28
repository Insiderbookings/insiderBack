import { convertCurrency, getExchangeRateMeta } from "../services/currency.service.js"
import { getEnabledCurrencySettings, normalizeCurrency, resolveEnabledCurrency } from "../services/currencySettings.service.js"

const normalizeCurrencyCode = (value) => normalizeCurrency(value)

export const getCurrencyRate = async (req, res) => {
  try {
    const requested = normalizeCurrencyCode(req.query?.target ?? req.query?.currency ?? "USD")
    const target = await resolveEnabledCurrency(requested)
    const meta = await getExchangeRateMeta(target)
    const resolvedTarget = meta.currency || target
    return res.json({
      base: "USD",
      target: resolvedTarget,
      requested,
      normalized: resolvedTarget !== requested,
      rate: meta.rate,
      rateDate: meta.date,
      source: meta.source,
      missing: meta.missing,
    })
  } catch (error) {
    console.error("[currency] rate error", error)
    return res.status(500).json({ error: "Failed to fetch currency rate" })
  }
}

export const convertCurrencyAmount = async (req, res) => {
  try {
    const requested = normalizeCurrencyCode(req.query?.target ?? req.query?.currency ?? req.body?.currency ?? "USD")
    const target = await resolveEnabledCurrency(requested)
    const amountRaw = req.query?.amount ?? req.body?.amount ?? 0
    const amount = Number(amountRaw)
    if (!Number.isFinite(amount)) {
      return res.status(400).json({ error: "Invalid amount" })
    }
    const converted = await convertCurrency(amount, target)
    return res.json({
      base: "USD",
      target: converted.currency,
      requested,
      normalized: converted.currency !== requested,
      amount: converted.amount,
      rate: converted.rate,
      rateDate: converted.rateDate,
      source: converted.source,
      missing: converted.missing,
    })
  } catch (error) {
    console.error("[currency] convert error", error)
    return res.status(500).json({ error: "Failed to convert currency" })
  }
}

export const getCurrencyOptions = async (req, res) => {
  try {
    const currencies = await getEnabledCurrencySettings()
    return res.json({
      currencies,
      count: currencies.length,
    })
  } catch (error) {
    console.error("[currency] options error", error)
    return res.status(500).json({ error: "Failed to fetch currency options" })
  }
}
