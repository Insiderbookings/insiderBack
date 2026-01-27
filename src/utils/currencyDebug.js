const isEnabled = () => {
  const raw = String(process.env.DEBUG_CURRENCY || process.env.CURRENCY_DEBUG || "").toLowerCase()
  return ["1", "true", "yes", "y", "on"].includes(raw)
}

export const logCurrencyDebug = (tag, payload = {}) => {
  if (!isEnabled()) return
  try {
    console.log(`[currency.debug] ${tag}`, payload)
  } catch (error) {
    console.log(`[currency.debug] ${tag}`)
  }
}

export const currencyDebugEnabled = isEnabled
