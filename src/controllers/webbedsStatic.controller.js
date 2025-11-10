import { syncWebbedsCountries, syncWebbedsCities, syncWebbedsHotels } from "../services/webbedsStatic.service.js"

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
    const summary = await syncWebbedsCities({ countryCode, dryRun: false })
    res.json({
      message: "WebBeds cities synchronized",
      summary,
      countryCode,
    })
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
