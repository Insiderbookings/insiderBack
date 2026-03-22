import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { Op } from "sequelize"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"

import models, { sequelize } from "../models/index.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "../..")

const parseListArg = (value) => {
  if (!value) return []
  return String(value)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
}

function normalizeUsPhone(raw) {
  if (!raw) return ""
  const str = String(raw).trim()
  if (!str) return ""

  const extMatch = str.match(/(?:ext\.?|x)\s*(\d{1,8})\s*$/i)
  const ext = extMatch ? extMatch[1] : null
  const base = extMatch ? str.slice(0, extMatch.index).trim() : str

  const digits = base.replace(/\D/g, "")
  // Provider placeholders seen in static data (keep blank when normalizing)
  if (digits === "12123" || digits === "121234" || digits === "1231234" || digits === "1234567") return ""

  if (digits.length === 11 && digits.startsWith("1")) {
    const area = digits.slice(1, 4)
    const mid = digits.slice(4, 7)
    const last = digits.slice(7, 11)
    return `+1 ${area}-${mid}-${last}${ext ? ` x${ext}` : ""}`
  }
  if (digits.length === 10) {
    const area = digits.slice(0, 3)
    const mid = digits.slice(3, 6)
    const last = digits.slice(6, 10)
    return `+1 ${area}-${mid}-${last}${ext ? ` x${ext}` : ""}`
  }
  return str
}

function csvCell(value) {
  if (value === null || value === undefined) return ""
  const str = String(value)
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function pickWebbedsAddress(hotel) {
  const isPlaceholder = (value) => {
    if (!value) return true
    const str = String(value).trim()
    if (!str) return true
    if (/^\.+$/.test(str)) return true
    if (/^0+$/.test(str)) return true
    if (/^\?+$/.test(str)) return true
    if (/^(null|undefined)$/i.test(str)) return true
    return false
  }

  const parts = [hotel.address, hotel.location1, hotel.location2, hotel.location3]
    .filter((value) => !isPlaceholder(value))

  const line = parts.join(", ")
  const zip = isPlaceholder(hotel.zip_code) ? "" : String(hotel.zip_code).trim()
  if (line) return zip ? `${line} ${zip}` : line
  if (!hotel.full_address) return ""
  try {
    if (typeof hotel.full_address === "string") return hotel.full_address
    return JSON.stringify(hotel.full_address)
  } catch {
    return ""
  }
}

function buildDefaultOutputPath({ source }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return path.join(repoRoot, "exports", `hotels_${source}_${stamp}.csv`)
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("source", {
      type: "string",
      default: "webbeds",
      choices: ["webbeds", "hotel"],
      describe: "Tabla origen: webbeds_hotel (webbeds) o hotel (hotel)",
    })
    .option("output", {
      type: "string",
      default: undefined,
      describe: "Ruta del CSV de salida",
    })
    .option("append", {
      type: "boolean",
      default: false,
      describe: "Agrega al archivo existente (no lo pisa). No re-escribe header.",
    })
    .option("normalizePhones", {
      type: "boolean",
      default: false,
      describe: "Normaliza teléfonos (solo presentación) a formato US: +1 AAA-BBB-CCCC",
    })
    .option("limit", {
      type: "number",
      default: 5000,
      describe: "Cantidad máxima a exportar (use 0 para sin límite)",
    })
    .option("batchSize", {
      type: "number",
      default: 2000,
      describe: "Tamaño de batch para paginado",
    })
    .option("city", {
      type: "string",
      default: undefined,
      describe: "Filtro por ciudad (substring, case-insensitive)",
    })
    .option("cityCode", {
      type: "string",
      default: undefined,
      describe: "Filtro por city_code (solo source=webbeds). Acepta lista separada por comas.",
    })
    .option("country", {
      type: "string",
      default: undefined,
      describe: "Filtro por país (substring, case-insensitive; solo source=webbeds)",
    })
    .option("countryCode", {
      type: "number",
      default: undefined,
      describe: "Filtro por country_code (solo source=webbeds)",
    })
    .strict()
    .help()
    .parseSync()

  const outputPath = path.resolve(argv.output || buildDefaultOutputPath({ source: argv.source }))
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  const shouldAppend = Boolean(argv.append) && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0
  const out = fs.createWriteStream(outputPath, { encoding: "utf8", flags: shouldAppend ? "a" : "w" })

  if (!shouldAppend) {
    // BOM UTF-8 para que Excel en Windows detecte bien acentos sin importar locale
    out.write("\uFEFF")
    const header = ["hotelId", "name", "city", "phone", "address"]
    out.write(`${header.join(",")}\r\n`)
  }

  await sequelize.authenticate()

  const batchSize = Math.max(100, Math.min(20000, Number(argv.batchSize) || 2000))
  const limit = Number(argv.limit) || 0
  let exported = 0

  try {
    if (argv.source === "webbeds") {
      const where = {}
      const cityCodes = parseListArg(argv.cityCode).map((c) => Number(c)).filter((n) => Number.isFinite(n))
      if (cityCodes.length === 1) where.city_code = cityCodes[0]
      if (cityCodes.length > 1) where.city_code = { [Op.in]: cityCodes }

      const countryCodes = parseListArg(argv.countryCode).map((c) => Number(c)).filter((n) => Number.isFinite(n))
      if (countryCodes.length === 1) where.country_code = countryCodes[0]
      if (countryCodes.length > 1) where.country_code = { [Op.in]: countryCodes }

      if (argv.city) where.city_name = { [Op.like]: `%${argv.city}%` }
      if (argv.country) where.country_name = { [Op.like]: `%${argv.country}%` }

      let lastHotelId = 0n
      while (true) {
        const remaining = limit > 0 ? Math.max(0, limit - exported) : batchSize
        const take = limit > 0 ? Math.min(batchSize, remaining) : batchSize
        if (limit > 0 && take <= 0) break

        const rows = await models.WebbedsHotel.findAll({
          attributes: ["hotel_id", "name", "city_name", "hotel_phone", "address", "location1", "location2", "location3", "zip_code", "full_address"],
          where: {
            ...where,
            hotel_id: { [Op.gt]: lastHotelId },
          },
          order: [["hotel_id", "ASC"]],
          limit: take,
        })

        if (!rows.length) break

        for (const row of rows) {
          const hotel = row.get({ plain: true })
          const line = [
            csvCell(hotel.hotel_id),
            csvCell(hotel.name),
            csvCell(hotel.city_name),
            csvCell(argv.normalizePhones ? normalizeUsPhone(hotel.hotel_phone) : hotel.hotel_phone),
            csvCell(pickWebbedsAddress(hotel)),
          ].join(",")
          out.write(`${line}\r\n`)
          exported++
          lastHotelId = BigInt(hotel.hotel_id)
          if (limit > 0 && exported >= limit) break
        }

        if (limit > 0 && exported >= limit) break
      }
    } else {
      const where = {}
      if (argv.city) where.city = { [Op.like]: `%${argv.city}%` }

      let lastId = 0
      while (true) {
        const remaining = limit > 0 ? Math.max(0, limit - exported) : batchSize
        const take = limit > 0 ? Math.min(batchSize, remaining) : batchSize
        if (limit > 0 && take <= 0) break

        const rows = await models.Hotel.findAll({
          attributes: ["id", "name", "city", "phone", "address"],
          where: {
            ...where,
            id: { [Op.gt]: lastId },
          },
          order: [["id", "ASC"]],
          limit: take,
        })

        if (!rows.length) break

        for (const row of rows) {
          const hotel = row.get({ plain: true })
          const line = [
            csvCell(hotel.id),
            csvCell(hotel.name),
            csvCell(hotel.city),
            csvCell(argv.normalizePhones ? normalizeUsPhone(hotel.phone) : hotel.phone),
            csvCell(hotel.address),
          ].join(",")
          out.write(`${line}\r\n`)
          exported++
          lastId = Number(hotel.id)
          if (limit > 0 && exported >= limit) break
        }

        if (limit > 0 && exported >= limit) break
      }
    }
  } finally {
    out.end()
    await sequelize.close()
  }

  console.info(`[exportHotelsToCsv] Exported ${exported} rows -> ${outputPath}`)
}

main().catch((err) => {
  console.error("[exportHotelsToCsv] Failed:", err)
  process.exitCode = 1
})
