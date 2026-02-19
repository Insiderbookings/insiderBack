#!/usr/bin/env node
import "dotenv/config"
import yargs from "yargs/yargs"
import { hideBin } from "yargs/helpers"
import { Op, fn, col } from "sequelize"
import models, { sequelize } from "../models/index.js"

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = Math.trunc(parsed)
  return normalized > 0 ? normalized : fallback
}

const toNonNegativeInt = (value, fallback = 0) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = Math.trunc(parsed)
  return normalized >= 0 ? normalized : fallback
}

const parseCityCodes = (value) =>
  String(value || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)

const roundCoordinate = (value, precision = 8) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Number.parseFloat(numeric.toFixed(precision))
}

const run = async () => {
  const argv = yargs(hideBin(process.argv))
    .option("city", {
      type: "string",
      describe: "Comma-separated city codes to process",
    })
    .option("country", {
      type: "number",
      describe: "Filter by Webbeds country code",
    })
    .option("limit", {
      type: "number",
      describe: "Limit cities to process",
    })
    .option("offset", {
      type: "number",
      default: 0,
      describe: "Skip N cities from the ordered target set",
    })
    .option("batchSize", {
      type: "number",
      default: 200,
      describe: "City batch size per aggregation query",
    })
    .option("force", {
      type: "boolean",
      default: false,
      describe: "Recompute lat/lng even if city already has coordinates",
    })
    .option("dryRun", {
      type: "boolean",
      default: false,
      describe: "Print intended updates without writing to DB",
    })
    .help()
    .alias("h", "help")
    .parse()

  await sequelize.authenticate()

  const cityCodes = parseCityCodes(argv.city)
  const countryCode = Number.isFinite(Number(argv.country)) ? Number(argv.country) : null
  const limit = toPositiveInt(argv.limit, null)
  const offset = toNonNegativeInt(argv.offset, 0)
  const batchSize = toPositiveInt(argv.batchSize, 200)

  const where = {}
  if (cityCodes.length) where.code = { [Op.in]: cityCodes }
  if (countryCode != null) where.country_code = countryCode
  if (!argv.force) {
    where[Op.or] = [{ lat: null }, { lng: null }]
  }

  const targetCities = await models.WebbedsCity.findAll({
    where,
    attributes: ["code", "name", "country_code", "country_name", "lat", "lng"],
    order: [["country_code", "ASC"], ["name", "ASC"], ["code", "ASC"]],
    ...(limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
    raw: true,
  })

  if (!targetCities.length) {
    console.log("[webbeds-city-coords] No cities found for requested filters.")
    await sequelize.close()
    process.exit(0)
  }

  const startedAt = Date.now()
  let updated = 0
  let skippedNoHotels = 0
  let skippedNoAverage = 0
  const failed = []

  console.log("[webbeds-city-coords] Starting", {
    cityCount: targetCities.length,
    countryCode,
    force: argv.force,
    dryRun: argv.dryRun,
    batchSize,
  })

  for (let index = 0; index < targetCities.length; index += batchSize) {
    const batch = targetCities.slice(index, index + batchSize)
    const batchCodes = batch.map((city) => String(city.code))

    const aggregates = await models.WebbedsHotel.findAll({
      attributes: [
        "city_code",
        [fn("AVG", col("lat")), "avg_lat"],
        [fn("AVG", col("lng")), "avg_lng"],
        [fn("COUNT", col("hotel_id")), "hotel_count"],
      ],
      where: {
        city_code: { [Op.in]: batchCodes },
        lat: { [Op.ne]: null },
        lng: { [Op.ne]: null },
      },
      group: ["city_code"],
      raw: true,
    })

    const aggregateMap = new Map(
      aggregates.map((row) => [String(row.city_code), row]),
    )

    for (const city of batch) {
      const key = String(city.code)
      const aggregate = aggregateMap.get(key)
      if (!aggregate) {
        skippedNoHotels += 1
        continue
      }

      const lat = roundCoordinate(aggregate.avg_lat)
      const lng = roundCoordinate(aggregate.avg_lng)
      if (lat == null || lng == null) {
        skippedNoAverage += 1
        continue
      }

      try {
        if (!argv.dryRun) {
          await models.WebbedsCity.update(
            { lat, lng },
            { where: { code: city.code } },
          )
        }
        updated += 1
      } catch (error) {
        failed.push({
          cityCode: city.code,
          cityName: city.name,
          message: error?.message || String(error),
        })
      }
    }

    console.log("[webbeds-city-coords] batch processed", {
      progress: `${Math.min(index + batchSize, targetCities.length)}/${targetCities.length}`,
      updated,
      skippedNoHotels,
      skippedNoAverage,
      failed: failed.length,
    })
  }

  const summary = {
    processed: targetCities.length,
    updated,
    skippedNoHotels,
    skippedNoAverage,
    failed: failed.length,
    dryRun: argv.dryRun,
    durationMs: Date.now() - startedAt,
  }

  if (failed.length) {
    console.error("[webbeds-city-coords] Completed with failures", {
      ...summary,
      failedCities: failed.slice(0, 20),
    })
  } else {
    console.log("[webbeds-city-coords] Completed successfully", summary)
  }

  await sequelize.close()
  process.exit(failed.length ? 1 : 0)
}

run().catch(async (error) => {
  console.error("[webbeds-city-coords] Fatal error", error)
  try {
    await sequelize.close()
  } catch {
    // ignore
  }
  process.exit(1)
})
