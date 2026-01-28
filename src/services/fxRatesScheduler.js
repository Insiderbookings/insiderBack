import { refreshRates } from "./currency.service.js"

const DEFAULT_TICK_MS = 1000 * 60 * 60 * 12 // 12 hours

export const startFxRatesScheduler = () => {
  const enabled = String(process.env.FX_RATES_SCHEDULER_ENABLED || "true").toLowerCase() === "true"
  if (!enabled) {
    console.log("[fx-rates-scheduler] disabled by FX_RATES_SCHEDULER_ENABLED")
    return
  }

  const tickMs = Number(process.env.FX_RATES_SCHEDULER_TICK_MS || DEFAULT_TICK_MS)

  const tick = async () => {
    try {
      const refreshed = await refreshRates({ force: true })
      if (refreshed?.rates) {
        console.log("[fx-rates-scheduler] refreshed", {
          source: refreshed.source,
          date: refreshed.date || null,
          count: Object.keys(refreshed.rates || {}).length,
        })
      } else {
        console.log("[fx-rates-scheduler] no refresh performed (cache available)")
      }
    } catch (error) {
      console.error("[fx-rates-scheduler] refresh error", error?.message || error)
    }
  }

  console.log("[fx-rates-scheduler] started", { tickMs })
  setInterval(() => {
    tick().catch((err) => console.error("[fx-rates-scheduler] tick error", err?.message || err))
  }, tickMs)

  tick().catch((err) => console.error("[fx-rates-scheduler] initial tick error", err?.message || err))
}

export default {
  startFxRatesScheduler,
}
