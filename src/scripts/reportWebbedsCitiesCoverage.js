import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"

import { sequelize } from "../models/index.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "../..")

function csvCell(value) {
  if (value === null || value === undefined) return ""
  const str = String(value)
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function buildDefaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return path.join(repoRoot, "exports", `webbeds_cities_coverage_${stamp}.csv`)
}

function normalizeLike(value) {
  const normalized = String(value ?? "").trim().toLowerCase()
  return normalized ? `%${normalized}%` : null
}

function buildCoverageQuery({
  minHotels,
  country,
  countryCode,
  city,
  includeSync,
  onlySynced,
  countOnly,
  limit,
}) {
  const replacements = { minHotels }
  const where = [
    "c.deleted_at IS NULL",
    "h.deleted_at IS NULL",
  ]

  if (country) {
    replacements.country = normalizeLike(country)
    where.push("LOWER(c.country_name) LIKE :country")
  }

  if (countryCode != null) {
    replacements.countryCode = Number(countryCode)
    where.push("c.country_code = :countryCode")
  }

  if (city) {
    replacements.city = normalizeLike(city)
    where.push("LOWER(c.name) LIKE :city")
  }

  const joinSync = includeSync || onlySynced
    ? [
        "LEFT JOIN webbeds_sync_log s",
        "  ON s.scope = 'city'",
        " AND s.city_code = c.code",
        " AND s.deleted_at IS NULL",
      ].join("\n")
    : ""

  if (onlySynced) {
    where.push("s.id IS NOT NULL")
  }

  const countExpression = "COUNT(DISTINCT h.hotel_id)"
  const groupBy = [
    "c.code",
    "c.name",
    "c.state_name",
    "c.country_name",
  ]

  const syncSelect = includeSync
    ? [
        ", MAX(s.last_full_sync) AS last_full_sync",
        ", MAX(s.last_new_sync) AS last_new_sync",
        ", MAX(s.last_incremental_sync) AS last_incremental_sync",
        ", MAX(s.last_result_count) AS last_result_count",
        ", MAX(s.last_error) AS last_error",
      ].join("\n")
    : ""

  if (countOnly) {
    const sql = [
      "SELECT COUNT(*) AS cities",
      "FROM (",
      "  SELECT c.code",
      "  FROM webbeds_city c",
      "  JOIN webbeds_hotel h ON h.city_code = c.code",
      joinSync ? `  ${joinSync.replace(/\n/g, "\n  ")}` : null,
      `  WHERE ${where.join("\n    AND ")}`,
      "  GROUP BY c.code",
      `  HAVING ${countExpression} >= :minHotels`,
      ") t",
    ]
      .filter(Boolean)
      .join("\n")

    return { sql, replacements }
  }

  const sql = [
    "SELECT",
    "  c.code AS city_code,",
    "  c.name AS city_name,",
    "  c.state_name,",
    "  c.country_name,",
    `  ${countExpression} AS hotels${syncSelect}`,
    "FROM webbeds_city c",
    "JOIN webbeds_hotel h ON h.city_code = c.code",
    joinSync,
    `WHERE ${where.join("\n  AND ")}`,
    `GROUP BY ${groupBy.join(", ")}`,
    `HAVING ${countExpression} >= :minHotels`,
    "ORDER BY hotels DESC, c.country_name ASC, c.name ASC",
    Number.isFinite(limit) ? "LIMIT :limit" : null,
  ]
    .filter(Boolean)
    .join("\n")

  return { sql, replacements }
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("limit", {
      type: "number",
      default: 200,
      describe: "Cantidad maxima de ciudades a listar",
    })
    .option("all", {
      type: "boolean",
      default: false,
      describe: "No limita resultados; devuelve todas las ciudades que hagan match",
    })
    .option("minHotels", {
      type: "number",
      default: 1,
      describe: "Minimo de hoteles por ciudad",
    })
    .option("country", {
      type: "string",
      describe: "Filtro opcional por nombre de pais",
    })
    .option("countryCode", {
      type: "number",
      describe: "Filtro opcional por country_code",
    })
    .option("city", {
      type: "string",
      describe: "Filtro opcional por nombre de ciudad",
    })
    .option("includeSync", {
      type: "boolean",
      default: false,
      describe: "Incluye metadatos del ultimo sync por ciudad",
    })
    .option("onlySynced", {
      type: "boolean",
      default: false,
      describe: "Solo lista ciudades que tengan registro en webbeds_sync_log",
    })
    .option("countOnly", {
      type: "boolean",
      default: false,
      describe: "Solo imprime el total de ciudades cubiertas",
    })
    .option("output", {
      type: "string",
      default: undefined,
      describe: "Ruta CSV de salida (opcional)",
    })
    .check((args) => {
      if (args.country && args.countryCode != null) {
        return true
      }
      return true
    })
    .strict()
    .help()
    .parseSync()

  const limit = argv.all
    ? null
    : Math.max(1, Math.min(10000, Number(argv.limit) || 200))
  const minHotels = Math.max(1, Number(argv.minHotels) || 1)

  await sequelize.authenticate()
  try {
    const baseOptions = {
      minHotels,
      country: argv.country,
      countryCode: argv.countryCode,
      city: argv.city,
      includeSync: argv.includeSync,
      onlySynced: argv.onlySynced,
    }

    if (argv.countOnly) {
      const { sql, replacements } = buildCoverageQuery({
        ...baseOptions,
        countOnly: true,
      })
      const [rows] = await sequelize.query(sql, { replacements })
      const cities = Number(rows?.[0]?.cities ?? 0)
      console.log({
        cities,
        minHotels,
        country: argv.country ?? null,
        countryCode: argv.countryCode ?? null,
        city: argv.city ?? null,
        onlySynced: argv.onlySynced,
      })
      return
    }

    const { sql, replacements } = buildCoverageQuery({
      ...baseOptions,
      countOnly: false,
      limit,
    })
    if (Number.isFinite(limit)) {
      replacements.limit = limit
    }

    const [rows] = await sequelize.query(sql, { replacements })

    console.table(rows)

    const outputPath = path.resolve(argv.output || buildDefaultOutputPath())
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })

    const headers = [
      "cityCode",
      "city",
      "state",
      "country",
      "hotels",
    ]

    if (argv.includeSync) {
      headers.push(
        "lastFullSync",
        "lastNewSync",
        "lastIncrementalSync",
        "lastResultCount",
        "lastError",
      )
    }

    const out = fs.createWriteStream(outputPath, { encoding: "utf8" })
    out.write("\uFEFF")
    out.write(headers.join(",") + "\r\n")

    for (const row of rows) {
      const values = [
        csvCell(row.city_code),
        csvCell(row.city_name),
        csvCell(row.state_name),
        csvCell(row.country_name),
        csvCell(row.hotels),
      ]

      if (argv.includeSync) {
        values.push(
          csvCell(row.last_full_sync),
          csvCell(row.last_new_sync),
          csvCell(row.last_incremental_sync),
          csvCell(row.last_result_count),
          csvCell(row.last_error),
        )
      }

      out.write(values.join(",") + "\r\n")
    }
    out.end()

    console.info(`[reportWebbedsCitiesCoverage] Wrote ${rows.length} rows -> ${outputPath}`)
  } finally {
    await sequelize.close()
  }
}

main().catch((err) => {
  console.error("[reportWebbedsCitiesCoverage] Failed:", err)
  process.exitCode = 1
})
