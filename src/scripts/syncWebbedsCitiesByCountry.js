#!/usr/bin/env node
import "dotenv/config"
import yargs from "yargs/yargs"
import { hideBin } from "yargs/helpers"
import models, { sequelize } from "../models/index.js"
import { syncWebbedsCities } from "../services/webbedsStatic.service.js"

const toPositiveInt = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.trunc(parsed)
  return normalized > 0 ? normalized : null
}

const toNonNegativeInt = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  const normalized = Math.trunc(parsed)
  return normalized >= 0 ? normalized : 0
}

const run = async () => {
  const argv = yargs(hideBin(process.argv))
    .option("country", {
      type: "number",
      describe: "Sync only one country code from webbeds_country",
    })
    .option("limit", {
      type: "number",
      describe: "Limit number of countries to process",
    })
    .option("offset", {
      type: "number",
      default: 0,
      describe: "Skip N countries from the ordered list",
    })
    .option("dryRun", {
      type: "boolean",
      default: false,
      describe: "Print provider payloads without writing to DB",
    })
    .option("failFast", {
      type: "boolean",
      default: false,
      describe: "Stop immediately on first country failure",
    })
    .help()
    .alias("h", "help")
    .parse()

  await sequelize.authenticate()

  const countryCode = Number.isFinite(Number(argv.country)) ? Number(argv.country) : null
  const limit = toPositiveInt(argv.limit)
  const offset = toNonNegativeInt(argv.offset)

  const where = {}
  if (countryCode != null) {
    where.code = countryCode
  }

  const countries = await models.WebbedsCountry.findAll({
    attributes: ["code", "name"],
    where,
    order: [["code", "ASC"]],
    ...(limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
    raw: true,
  })

  if (!countries.length) {
    console.log("[webbeds-cities-sync] No countries found for requested filters.")
    await sequelize.close()
    process.exit(0)
  }

  const startedAt = Date.now()
  const failures = []
  let totalInserted = 0

  console.log("[webbeds-cities-sync] Starting cities sync by country", {
    countryCount: countries.length,
    countryCode,
    dryRun: argv.dryRun,
    failFast: argv.failFast,
  })

  for (const [index, country] of countries.entries()) {
    const current = index + 1
    const code = Number(country.code)
    const name = country.name ?? null
    const countryStart = Date.now()

    console.log("[webbeds-cities-sync] country start", {
      progress: `${current}/${countries.length}`,
      countryCode: code,
      countryName: name,
    })

    try {
      const summary = await syncWebbedsCities({ countryCode: code, dryRun: argv.dryRun })
      const inserted = Number(summary?.inserted ?? 0)
      const normalizedInserted = Number.isFinite(inserted) ? inserted : 0
      totalInserted += normalizedInserted

      console.log("[webbeds-cities-sync] country done", {
        progress: `${current}/${countries.length}`,
        countryCode: code,
        countryName: name,
        inserted: normalizedInserted,
        durationMs: Date.now() - countryStart,
      })
    } catch (error) {
      failures.push({
        countryCode: code,
        countryName: name,
        message: error?.message ?? String(error),
      })

      console.error("[webbeds-cities-sync] country failed", {
        progress: `${current}/${countries.length}`,
        countryCode: code,
        countryName: name,
        durationMs: Date.now() - countryStart,
        message: error?.message ?? String(error),
      })

      if (argv.failFast) {
        break
      }
    }
  }

  const durationMs = Date.now() - startedAt
  const jobSummary = {
    countriesProcessed: countries.length,
    countriesFailed: failures.length,
    totalInserted,
    durationMs,
    dryRun: argv.dryRun,
  }

  if (failures.length) {
    console.error("[webbeds-cities-sync] Completed with failures", {
      ...jobSummary,
      failedCountries: failures.map((item) => ({
        countryCode: item.countryCode,
        countryName: item.countryName,
      })),
    })
  } else {
    console.log("[webbeds-cities-sync] Completed successfully", jobSummary)
  }

  await sequelize.close()
  process.exit(failures.length ? 1 : 0)
}

run().catch(async (error) => {
  console.error("[webbeds-cities-sync] Fatal error", error)
  try {
    await sequelize.close()
  } catch {
    // ignore
  }
  process.exit(1)
})
