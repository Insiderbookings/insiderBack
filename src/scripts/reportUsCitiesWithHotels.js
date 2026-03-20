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
  return path.join(repoRoot, "exports", `us_cities_with_hotels_${stamp}.csv`)
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("limit", {
      type: "number",
      default: 200,
      describe: "Cantidad de ciudades a listar",
    })
    .option("minHotels", {
      type: "number",
      default: 1,
      describe: "Mínimo de hoteles por ciudad",
    })
    .option("countOnly", {
      type: "boolean",
      default: false,
      describe: "Solo imprime el total de ciudades (no lista ni escribe CSV)",
    })
    .option("output", {
      type: "string",
      default: undefined,
      describe: "Ruta CSV de salida (opcional)",
    })
    .strict()
    .help()
    .parseSync()

  const limit = Math.max(1, Math.min(5000, Number(argv.limit) || 200))
  const minHotels = Math.max(1, Number(argv.minHotels) || 1)

  await sequelize.authenticate()
  try {
    if (argv.countOnly) {
      const countSql = [
        "SELECT COUNT(*) AS cities",
        "FROM (",
        "  SELECT c.code",
        "  FROM webbeds_city c",
        "  JOIN webbeds_hotel h ON h.city_code = c.code AND h.deleted_at IS NULL",
        "  WHERE c.deleted_at IS NULL",
        "    AND LOWER(c.country_name) LIKE '%united states%'",
        "  GROUP BY c.code",
        "  HAVING COUNT(h.hotel_id) >= :minHotels",
        ") t",
      ].join("\n")
      const [rows] = await sequelize.query(countSql, { replacements: { minHotels } })
      const cities = Number(rows?.[0]?.cities ?? 0)
      console.log({ cities, minHotels })
      return
    }

    const sql = [
      "SELECT",
      "  c.code AS city_code,",
      "  c.name AS city_name,",
      "  c.state_name,",
      "  c.country_name,",
      "  COUNT(h.hotel_id) AS hotels",
      "FROM webbeds_city c",
      "JOIN webbeds_hotel h ON h.city_code = c.code AND h.deleted_at IS NULL",
      "WHERE c.deleted_at IS NULL",
      "  AND LOWER(c.country_name) LIKE '%united states%'",
      "GROUP BY c.code, c.name, c.state_name, c.country_name",
      "HAVING COUNT(h.hotel_id) >= :minHotels",
      "ORDER BY hotels DESC",
      "LIMIT :limit",
    ].join("\n")

    const [rows] = await sequelize.query(sql, {
      replacements: { limit, minHotels },
    })

    console.table(rows)

    const outputPath = path.resolve(argv.output || buildDefaultOutputPath())
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })

    const out = fs.createWriteStream(outputPath, { encoding: "utf8" })
    out.write("\uFEFF")
    out.write(["cityCode", "city", "state", "country", "hotels"].join(",") + "\r\n")
    for (const row of rows) {
      out.write(
        [
          csvCell(row.city_code),
          csvCell(row.city_name),
          csvCell(row.state_name),
          csvCell(row.country_name),
          csvCell(row.hotels),
        ].join(",") + "\r\n",
      )
    }
    out.end()

    console.info(`[reportUsCitiesWithHotels] Wrote ${rows.length} rows -> ${outputPath}`)
  } finally {
    await sequelize.close()
  }
}

main().catch((err) => {
  console.error("[reportUsCitiesWithHotels] Failed:", err)
  process.exitCode = 1
})
