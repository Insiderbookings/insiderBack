import { syncWebbedsCountries, syncWebbedsCities, syncWebbedsHotels } from "../services/webbedsStatic.service.js"
import { runWebbedsCitiesCatalogSyncJob } from "../cronjobs/webbedsSync.shared.js"

export const syncWebbedsCountriesController = async (req, res, next) => {
  try {
    const summary = await syncWebbedsCountries({ dryRun: false })
    res.json({ message: "WebBeds countries synchronized", summary })
  } catch (error) {
    next(error)
  }
}

export const syncWebbedsCitiesController = async (req, res, next) => {
  try {
    const countryCode = req.body?.countryCode ?? req.query?.countryCode

    if (countryCode == null || String(countryCode).trim() === "") {
      // Full cities sync can be long-running; run it as a background job to avoid loading everything in one request.
      const jobName = "webbeds-cities-sync"
      Promise.resolve()
        .then(() => runWebbedsCitiesCatalogSyncJob({ jobName }))
        .then((summary) => {
          if (summary?.skipped) {
            console.log("[admin][webbeds][cities-sync] job skipped", summary)
            return
          }
          console.log("[admin][webbeds][cities-sync] job completed", {
            countriesSelected: summary?.countriesSelected,
            countriesProcessed: summary?.countriesProcessed,
            countriesFailed: summary?.countriesFailed,
            totalInserted: summary?.totalInserted,
            durationMs: summary?.durationMs,
          })
        })
        .catch((error) => {
          console.error("[admin][webbeds][cities-sync] job failed", {
            message: String(error?.message || error),
            summary: error?.summary,
          })
        })

      res.status(202).json({
        message: "WebBeds cities sync job started",
        jobName,
        note: "Use /api/admin/jobs and server logs to monitor progress.",
      })
      return
    }

    const summary = await syncWebbedsCities({ countryCode, dryRun: false })
    res.json({ message: "WebBeds cities synchronized", summary, countryCode })
  } catch (error) {
    next(error)
  }
}

export const syncWebbedsHotelsController = async (req, res, next) => {
  try {
    const cityCode = req.body?.cityCode ?? req.query?.cityCode
    const dryRunParam = String(req.body?.dryRun ?? req.query?.dryRun ?? "false").toLowerCase()
    const dryRun = ["1", "true", "yes"].includes(dryRunParam)
    const summary = await syncWebbedsHotels({ cityCode, dryRun })
    res.json({
      message: dryRun ? "WebBeds hotels sync dry-run" : "WebBeds hotels synchronized",
      summary,
      cityCode,
    })
  } catch (error) {
    next(error)
  }
}
