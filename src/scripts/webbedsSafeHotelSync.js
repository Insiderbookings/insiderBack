#!/usr/bin/env node
import "dotenv/config"
import fs from "fs"
import os from "os"
import { spawn } from "child_process"
import yargs from "yargs/yargs"
import { hideBin } from "yargs/helpers"

import { sequelize } from "../models/index.js"

const parseListArg = (value) => {
  if (!value) return []
  return String(value)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
}

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const readMemAvailableMb = () => {
  try {
    if (process.platform === "linux" && fs.existsSync("/proc/meminfo")) {
      const content = fs.readFileSync("/proc/meminfo", "utf8")
      const match = content.match(/^MemAvailable:\s+(\d+)\s+kB$/m)
      if (match) {
        return Math.round(Number(match[1]) / 1024)
      }
    }
  } catch {
    // ignore and fall back
  }
  return Math.round(os.freemem() / 1024 / 1024)
}

const formatMemorySnapshot = () => ({
  availableMb: readMemAvailableMb(),
  totalMb: Math.round(os.totalmem() / 1024 / 1024),
})

const mergeNodeOptions = (base, heapMb) => {
  const options = String(base || "").trim()
  if (!Number.isFinite(heapMb) || heapMb <= 0) return options
  const heapFlag = `--max-old-space-size=${Math.trunc(heapMb)}`
  if (options.includes("--max-old-space-size=")) return options
  return [options, heapFlag].filter(Boolean).join(" ")
}

const resolveSyncColumn = (mode) => {
  if (mode === "new") return "last_new_sync"
  if (mode === "updated") return "last_incremental_sync"
  return "last_full_sync"
}

const buildCandidatesQuery = ({
  cityCodes = [],
  countryCode = null,
  excludeCityCodes = [],
  skipSynced = false,
  onlyWithoutHotels = false,
  mode = "full",
  limit = null,
  offset = 0,
}) => {
  const replacements = {}
  const where = ["c.deleted_at IS NULL"]
  const having = []

  if (cityCodes.length) {
    replacements.cityCodes = cityCodes
    where.push("c.code IN (:cityCodes)")
  }

  if (countryCode != null) {
    replacements.countryCode = Number(countryCode)
    where.push("c.country_code = :countryCode")
  }

  if (excludeCityCodes.length) {
    replacements.excludeCityCodes = excludeCityCodes
    where.push("c.code NOT IN (:excludeCityCodes)")
  }

  if (onlyWithoutHotels) {
    having.push("COUNT(DISTINCT h.hotel_id) = 0")
  }

  if (skipSynced) {
    having.push(`MAX(s.${resolveSyncColumn(mode)}) IS NULL`)
  }

  if (Number.isFinite(limit) && limit > 0) {
    replacements.limit = Math.trunc(limit)
  }

  if (Number.isFinite(offset) && offset > 0) {
    replacements.offset = Math.trunc(offset)
  }

  const sql = [
    "SELECT",
    "  c.code AS city_code,",
    "  c.name AS city_name,",
    "  c.country_code,",
    "  c.country_name,",
    "  COUNT(DISTINCT h.hotel_id) AS hotel_count,",
    "  MAX(s.last_full_sync) AS last_full_sync,",
    "  MAX(s.last_new_sync) AS last_new_sync,",
    "  MAX(s.last_incremental_sync) AS last_incremental_sync",
    "FROM webbeds_city c",
    "LEFT JOIN webbeds_hotel h",
    "  ON h.city_code = c.code",
    " AND h.deleted_at IS NULL",
    "LEFT JOIN webbeds_sync_log s",
    "  ON s.scope = 'city'",
    " AND s.city_code = c.code",
    " AND s.deleted_at IS NULL",
    `WHERE ${where.join("\n  AND ")}`,
    "GROUP BY c.code, c.name, c.country_code, c.country_name",
    having.length ? `HAVING ${having.join("\n   AND ")}` : null,
    "ORDER BY COUNT(DISTINCT h.hotel_id) ASC, c.code ASC",
    Number.isFinite(limit) && limit > 0 ? "LIMIT :limit" : null,
    Number.isFinite(offset) && offset > 0 ? "OFFSET :offset" : null,
  ]
    .filter(Boolean)
    .join("\n")

  return { sql, replacements }
}

const resolveCandidates = async ({
  cityArg,
  countryCode,
  excludeCityCodes = [],
  skipSynced,
  onlyWithoutHotels,
  mode,
  limit,
  offset,
}) => {
  const directCityCodes = parseListArg(cityArg)
  const { sql, replacements } = buildCandidatesQuery({
    cityCodes: directCityCodes,
    countryCode,
    excludeCityCodes,
    skipSynced,
    onlyWithoutHotels,
    mode,
    limit: directCityCodes.length ? null : limit,
    offset: directCityCodes.length ? 0 : offset,
  })

  const [rows] = await sequelize.query(sql, { replacements })

  if (!directCityCodes.length) {
    return rows
  }

  const orderMap = new Map(directCityCodes.map((code, index) => [String(code), index]))
  return rows.sort(
    (a, b) =>
      (orderMap.get(String(a.city_code)) ?? Number.MAX_SAFE_INTEGER) -
      (orderMap.get(String(b.city_code)) ?? Number.MAX_SAFE_INTEGER),
  )
}

const runChildSync = ({
  mode,
  cityCode,
  hotelLimit,
  since,
  dryRun,
  heapMb,
  resultsPerPage,
  maxPages,
  xmlDebug,
  xmlDebugDir,
}) =>
  new Promise((resolve) => {
    const args = ["src/scripts/webbedsSync.js", `--mode=${mode}`, `--city=${cityCode}`]

    if (Number.isFinite(hotelLimit) && hotelLimit > 0) {
      args.push(`--hotelLimit=${Math.trunc(hotelLimit)}`)
    }
    if (since) {
      args.push(`--since=${since}`)
    }
    if (dryRun) {
      args.push("--dryRun")
    }
    if (xmlDebug) {
      args.push("--xmlDebug")
    }
    if (xmlDebugDir) {
      args.push(`--xmlDebugDir=${xmlDebugDir}`)
    }

    const env = {
      ...process.env,
      NODE_OPTIONS: mergeNodeOptions(process.env.NODE_OPTIONS, heapMb),
    }

    if (Number.isFinite(resultsPerPage) && resultsPerPage > 0) {
      env.WEBBEDS_STATIC_HOTELS_RESULTS_PER_PAGE = String(Math.trunc(resultsPerPage))
    }
    if (Number.isFinite(maxPages) && maxPages > 0) {
      env.WEBBEDS_STATIC_HOTELS_MAX_PAGES = String(Math.trunc(maxPages))
    }

    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      env,
      cwd: process.cwd(),
    })

    child.on("close", (code, signal) => {
      resolve({
        code: Number.isFinite(code) ? code : null,
        signal: signal ?? null,
        ok: code === 0,
      })
    })
  })

const main = async () => {
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
      describe: "Country code to iterate cities automatically",
    })
    .option("limit", {
      type: "number",
      describe: "Limit number of cities to process when using --country",
    })
    .option("offset", {
      type: "number",
      default: 0,
      describe: "Skip the first N candidate cities when using --country",
    })
    .option("drain", {
      type: "boolean",
      default: false,
      describe: "Keep fetching the next pending batch until there are no more candidate cities",
    })
    .option("batchSize", {
      type: "number",
      default: 500,
      describe: "Batch size used by --drain when selecting candidate cities",
    })
    .option("skipSynced", {
      type: "boolean",
      default: true,
      describe: "Skip cities that already have a sync timestamp for the selected mode",
    })
    .option("onlyWithoutHotels", {
      type: "boolean",
      default: false,
      describe: "Only target cities that currently have 0 hotels in DB",
    })
    .option("hotelLimit", {
      type: "number",
      describe: "Pass-through limit of hotels per city for smoke tests",
    })
    .option("pauseMs", {
      type: "number",
      default: 1500,
      describe: "Pause between cities to keep pressure low",
    })
    .option("minAvailableMb", {
      type: "number",
      default: 250,
      describe: "Stop before starting a city if available system memory goes below this threshold",
    })
    .option("heapMb", {
      type: "number",
      default: 1536,
      describe: "Set Node max old space size for each child sync process",
    })
    .option("resultsPerPage", {
      type: "number",
      default: 20,
      describe: "Override WEBBEDS_STATIC_HOTELS_RESULTS_PER_PAGE for child sync processes",
    })
    .option("maxPages", {
      type: "number",
      describe: "Optional override for WEBBEDS_STATIC_HOTELS_MAX_PAGES",
    })
    .option("since", {
      type: "string",
      describe: "ISO date to start incremental range (mode=updated)",
    })
    .option("continueOnError", {
      type: "boolean",
      default: true,
      describe: "Continue with next city if one city fails",
    })
    .option("dryRun", {
      type: "boolean",
      default: false,
      describe: "Pass dry-run through to the child sync command",
    })
    .option("xmlDebug", {
      type: "boolean",
      default: false,
      describe: "Pass XML debug mode through to child sync command",
    })
    .option("xmlDebugDir", {
      type: "string",
      describe: "Directory where XML debug files will be written",
    })
    .check((args) => {
      if (!args.city && !args.country) {
        throw new Error("Provide --city or --country")
      }
      if (args.hotelLimit != null && (!Number.isFinite(args.hotelLimit) || args.hotelLimit <= 0)) {
        throw new Error("--hotelLimit must be a positive number")
      }
      if (args.limit != null && (!Number.isFinite(args.limit) || args.limit <= 0)) {
        throw new Error("--limit must be a positive number")
      }
      if (args.batchSize != null && (!Number.isFinite(args.batchSize) || args.batchSize <= 0)) {
        throw new Error("--batchSize must be a positive number")
      }
      return true
    })
    .help()
    .alias("h", "help")
    .parse()

  await sequelize.authenticate()

  const failures = []
  const attemptedCityCodes = new Set()
  let processed = 0
  let selected = 0
  let batches = 0
  let stoppedForMemory = false
  let firstBatch = true

  try {
    console.log("[webbeds-safe-sync] Starting", {
      mode: argv.mode,
      selectionMode: argv.drain ? "drain" : "single-batch",
      skipSynced: argv.skipSynced,
      onlyWithoutHotels: argv.onlyWithoutHotels,
      pauseMs: argv.pauseMs,
      minAvailableMb: argv.minAvailableMb,
      heapMb: argv.heapMb,
      resultsPerPage: argv.resultsPerPage,
      limit: argv.limit ?? null,
      offset: argv.offset ?? 0,
      batchSize: argv.drain ? argv.batchSize : null,
    })

    while (true) {
      const candidates = await resolveCandidates({
        cityArg: argv.city,
        countryCode: argv.country,
        excludeCityCodes: Array.from(attemptedCityCodes),
        skipSynced: argv.skipSynced,
        onlyWithoutHotels: argv.onlyWithoutHotels,
        mode: argv.mode,
        limit: argv.drain ? argv.batchSize : argv.limit,
        offset: argv.drain ? (firstBatch ? argv.offset : 0) : argv.offset,
      })

      firstBatch = false

      if (!candidates.length) {
        if (processed === 0) {
          console.log("[webbeds-safe-sync] No candidate cities found")
        }
        break
      }

      batches += 1
      selected += candidates.length
      console.log("[webbeds-safe-sync] Loaded batch", {
        batch: batches,
        batchCandidates: candidates.length,
        selectedSoFar: selected,
      })

      for (const candidate of candidates) {
        const memory = formatMemorySnapshot()
        if (Number.isFinite(argv.minAvailableMb) && memory.availableMb < argv.minAvailableMb) {
          stoppedForMemory = true
          console.warn("[webbeds-safe-sync] Stopping before next city due to low available memory", {
            cityCode: String(candidate.city_code),
            cityName: candidate.city_name,
            availableMb: memory.availableMb,
            thresholdMb: argv.minAvailableMb,
          })
          break
        }

        processed += 1
        attemptedCityCodes.add(String(candidate.city_code))
        console.log("[webbeds-safe-sync] Launching city", {
          position: `${processed}${argv.drain ? "" : `/${candidates.length}`}`,
          batch: batches,
          cityCode: String(candidate.city_code),
          cityName: candidate.city_name,
          country: candidate.country_name,
          hotelsInDb: Number(candidate.hotel_count ?? 0),
          memory,
        })

        const startedAt = Date.now()
        const result = await runChildSync({
          mode: argv.mode,
          cityCode: String(candidate.city_code),
          hotelLimit: argv.hotelLimit,
          since: argv.since,
          dryRun: argv.dryRun,
          heapMb: argv.heapMb,
          resultsPerPage: argv.resultsPerPage,
          maxPages: argv.maxPages,
          xmlDebug: argv.xmlDebug,
          xmlDebugDir: argv.xmlDebugDir,
        })

        const durationMs = Date.now() - startedAt
        if (!result.ok) {
          failures.push({
            cityCode: String(candidate.city_code),
            cityName: candidate.city_name,
            code: result.code,
            signal: result.signal,
            durationMs,
          })
          console.error("[webbeds-safe-sync] City failed", failures[failures.length - 1])
          if (!argv.continueOnError) {
            break
          }
        } else {
          console.log("[webbeds-safe-sync] City completed", {
            cityCode: String(candidate.city_code),
            cityName: candidate.city_name,
            durationMs,
            memoryAfter: formatMemorySnapshot(),
          })
        }

        if (argv.pauseMs > 0) {
          await sleep(argv.pauseMs)
        }
      }

      if (stoppedForMemory || (!argv.continueOnError && failures.length) || !argv.drain) {
        break
      }
    }
  } finally {
    await sequelize.close()
  }

  const summary = {
    selected,
    processed,
    batches,
    failed: failures.length,
    stoppedForMemory,
    nextSuggestedCity: null,
    failures,
  }

  if (failures.length || stoppedForMemory) {
    console.error("[webbeds-safe-sync] Finished with warnings", summary)
    process.exit(1)
  }

  console.log("[webbeds-safe-sync] Finished successfully", summary)
}

main().catch(async (error) => {
  console.error("[webbeds-safe-sync] Fatal error", error)
  try {
    await sequelize.close()
  } catch {
    // ignore
  }
  process.exit(1)
})
