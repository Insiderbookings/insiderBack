#!/usr/bin/env node
import "dotenv/config"
import yargs from "yargs/yargs"
import { hideBin } from "yargs/helpers"
import models, { sequelize } from "../models/index.js"
import {
  syncWebbedsHotels,
  syncWebbedsHotelsIncremental,
  syncWebbedsCurrencies,
  syncWebbedsAmenities,
  syncWebbedsLeisureAmenities,
  syncWebbedsBusinessAmenities,
  syncWebbedsRoomAmenities,
  syncWebbedsHotelChains,
  syncWebbedsHotelClassifications,
  syncWebbedsRateBasis,
} from "../services/webbedsStatic.service.js"

const parseListArg = (value) => {
  if (!value) return []
  return String(value)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
}

const resolveCityCodes = async ({ cityArg, countryCode, limit }) => {
  const directCities = parseListArg(cityArg)
  if (directCities.length) {
    return directCities
  }
  if (!countryCode) {
    throw new Error("Provide at least one city code or a country code")
  }
  const rows = await models.WebbedsCity.findAll({
    attributes: ["code"],
    where: { country_code: countryCode },
    order: [["code", "ASC"]],
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    raw: true,
  })
  return rows.map((row) => String(row.code))
}

const run = async () => {
  const argv = yargs(hideBin(process.argv))
    .option("mode", {
      choices: ["full", "new", "updated"],
      default: "full",
      describe: "Sync strategy",
    })
    .option("city", {
      type: "string",
      describe: "Comma separated list of city codes",
    })
    .option("country", {
      type: "number",
      describe: "Country code to iterate all cities",
    })
    .option("dryRun", {
      type: "boolean",
      default: false,
      describe: "Print payload without calling WebBeds",
    })
    .option("catalog", {
      type: "string",
      describe: "Comma separated catalog list (currencies,amenities,roomAmenities,chains,classifications,rateBasis)",
    })
    .option("since", {
      type: "string",
      describe: "ISO date to start incremental range (mode=updated)",
    })
    .option("limit", {
      type: "number",
      describe: "Limit number of cities when using --country",
    })
    .check((args) => {
      if (!args.city && !args.country && !args.catalog) {
        throw new Error("Provide --city/--country or --catalog")
      }
      return true
    })
    .help()
    .alias("h", "help")
    .parse()

  await sequelize.authenticate()

  const catalogHandlers = {
    currencies: syncWebbedsCurrencies,
    amenities: async (args) => {
      await syncWebbedsAmenities(args)
      await syncWebbedsLeisureAmenities(args)
      await syncWebbedsBusinessAmenities(args)
    },
    roomamenities: syncWebbedsRoomAmenities,
    chains: syncWebbedsHotelChains,
    classifications: syncWebbedsHotelClassifications,
    ratebasis: syncWebbedsRateBasis,
  }

  const catalogsRequested = parseListArg(argv.catalog).map((name) => name.toLowerCase())
  let catalogFailures = 0

  for (const catalog of catalogsRequested) {
    const handler = catalogHandlers[catalog]
    if (!handler) {
      console.warn("[webbeds-sync] Unknown catalog, skipping", { catalog })
      catalogFailures += 1
      continue
    }
    try {
      const summary = await handler({ dryRun: argv.dryRun })
      console.log("[webbeds-sync] catalog ok", { catalog, summary })
    } catch (error) {
      catalogFailures += 1
      console.error("[webbeds-sync] catalog failed", { catalog, message: error.message })
    }
  }

  const requiresCityLoop = argv.city || argv.country

  let cityCodes = []
  if (requiresCityLoop) {
    cityCodes = await resolveCityCodes({
      cityArg: argv.city,
      countryCode: argv.country,
      limit: argv.limit,
    })
  }

  if (!requiresCityLoop) {
    await sequelize.close()
    if (catalogFailures) {
      process.exit(1)
    }
    console.log("[webbeds-sync] Catalog job completed")
    process.exit(0)
  }

  if (!cityCodes.length) {
    console.log("[webbeds-sync] No city codes found for provided criteria.")
    await sequelize.close()
    process.exit(catalogFailures ? 1 : 0)
  }

  console.log("[webbeds-sync] Starting job", {
    mode: argv.mode,
    dryRun: argv.dryRun,
    cityCount: cityCodes.length,
  })

  let failures = 0

  for (const cityCode of cityCodes) {
    try {
      let summary
      if (argv.mode === "full") {
        summary = await syncWebbedsHotels({ cityCode, dryRun: argv.dryRun })
      } else {
        summary = await syncWebbedsHotelsIncremental({
          cityCode,
          dryRun: argv.dryRun,
          mode: argv.mode,
          since: argv.since,
        })
      }
      console.log("[webbeds-sync] ok", { cityCode, summary })
    } catch (error) {
      failures += 1
      console.error("[webbeds-sync] failed", {
        cityCode,
        message: error.message,
      })
    }
  }

  await sequelize.close()

  if (failures || catalogFailures) {
    console.error("[webbeds-sync] Completed with failures", { hotelFailures: failures, catalogFailures })
    process.exit(failures || catalogFailures ? 1 : 0)
  }
  console.log("[webbeds-sync] Completed successfully")
  process.exit(0)
}

run().catch(async (error) => {
  console.error("[webbeds-sync] Fatal error", error)
  try {
    await sequelize.close()
  } catch {
    // ignore
  }
  process.exit(1)
})
