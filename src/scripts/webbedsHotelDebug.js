#!/usr/bin/env node
import "dotenv/config"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import dayjs from "dayjs"
import yargs from "yargs/yargs"
import { hideBin } from "yargs/helpers"

import models, { sequelize } from "../models/index.js"
import { syncWebbedsHotels } from "../services/webbedsStatic.service.js"
import { WebbedsProvider } from "../providers/webbeds/provider.js"
import { buildGetRoomsPayload, mapGetRoomsResponse } from "../providers/webbeds/getRooms.js"
import { formatStaticHotel } from "../utils/webbedsMapper.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "../..")

const ensureArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const stripHtml = (value) => {
  if (value == null) return value
  return String(value).replace(/<\/?[^>]+>/g, "").trim()
}

const normalizeText = (value) => {
  const cleaned = stripHtml(value == null ? "" : value).replace(/\s+/g, " ").trim()
  return cleaned || null
}

const toSafeSlug = (value, fallback = "report") => {
  const cleaned = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return cleaned || fallback
}

const buildStamp = () => new Date().toISOString().replace(/[:.]/g, "-")

const writeJson = (targetPath, data) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

const writeText = (targetPath, text) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, text, "utf8")
}

const relativeToRepo = (targetPath) => path.relative(repoRoot, targetPath).replace(/\\/g, "/")

const normalizeNumericCode = (value, fallback) => {
  if (value === undefined || value === null || value === "") {
    return fallback
  }
  const stringValue = String(value).trim()
  return /^\d+$/.test(stringValue) ? stringValue : fallback
}

const resolveRateBasis = (value) => {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) return String(parsed)
  const stringValue = String(value ?? "").trim()
  if (/^\d+$/.test(stringValue) && Number(stringValue) > 0) return stringValue
  return "-1"
}

const resolveRoomTypeCode = (roomType) =>
  String(
    roomType?.roomTypeCode ??
      roomType?.roomtypecode ??
      roomType?.["@_roomtypecode"] ??
      roomType?.roomtype_code ??
      roomType?.code ??
      roomType?.id ??
      "",
  ).trim()

const extractImageUrls = (roomType) => {
  if (!roomType) return []

  const readUrl = (value) => {
    if (!value) return null
    if (typeof value === "string" || typeof value === "number") return String(value)
    return (
      value?.url ??
      value?.["@_url"] ??
      value?.["#text"] ??
      value?.text ??
      value?.value ??
      value?.["#cdata-section"] ??
      null
    )
  }

  const sources = [
    roomType?.roomImages,
    roomType?.room_images,
    roomType?.roomImage,
    roomType?.room_image,
    roomType?.images,
    roomType?.image,
    roomType?.photos,
    roomType?.photo,
    roomType?.raw_payload?.roomImages,
    roomType?.raw_payload?.room_images,
    roomType?.raw_payload?.roomImage,
    roomType?.raw_payload?.room_image,
    roomType?.raw_payload?.images,
    roomType?.raw_payload?.image,
    roomType?.raw_payload?.photos,
    roomType?.raw_payload?.photo,
  ]

  const urls = new Set()
  sources.forEach((source) => {
    if (!source) return
    const thumb = readUrl(source?.thumb)
    if (thumb) urls.add(thumb)
    const node =
      source?.image ??
      source?.images ??
      source?.roomImage ??
      source?.roomImages ??
      source?.room_image ??
      source?.room_images ??
      source?.photo ??
      source?.photos ??
      source
    ensureArray(node).forEach((entry) => {
      const url = readUrl(entry?.url ?? entry)
      if (url) urls.add(url)
    })
  })

  return Array.from(urls)
}

const extractDescription = (roomType) => {
  const readText = (value) => {
    if (!value) return null
    if (typeof value === "string" || typeof value === "number") {
      return normalizeText(value)
    }
    if (typeof value === "object") {
      const direct =
        value?.["#text"] ??
        value?.["#cdata-section"] ??
        value?.text ??
        value?.description ??
        value?.value ??
        value?.name ??
        null
      return normalizeText(direct)
    }
    return null
  }

  const candidates = [
    roomType?.roomDescription,
    roomType?.room_description,
    roomType?.description,
    roomType?.shortDescription,
    roomType?.raw_payload?.roomDescription,
    roomType?.raw_payload?.room_description,
    roomType?.raw_payload?.description,
  ]

  for (const candidate of candidates) {
    const text = readText(candidate)
    if (text) return text
  }
  return null
}

const summarizeRawStatic = (roomTypeRows = []) => {
  const uniqueCodes = new Set()
  let withImages = 0
  let withDescription = 0

  roomTypeRows.forEach((row) => {
    const code = resolveRoomTypeCode(row)
    if (code) uniqueCodes.add(code)
    if (extractImageUrls(row?.raw_payload ?? row).length > 0) withImages += 1
    if (extractDescription(row?.raw_payload ?? row)) withDescription += 1
  })

  return {
    totalRows: roomTypeRows.length,
    uniqueCodes: uniqueCodes.size,
    rowsWithImages: withImages,
    rowsWithoutImages: roomTypeRows.length - withImages,
    rowsWithDescription: withDescription,
    rowsWithoutDescription: roomTypeRows.length - withDescription,
  }
}

const summarizeFormattedStatic = (roomTypes = []) => ({
  roomTypesCount: roomTypes.length,
  roomTypesWithImages: roomTypes.filter((roomType) => extractImageUrls(roomType).length > 0).length,
  roomTypesWithDescription: roomTypes.filter((roomType) => Boolean(extractDescription(roomType))).length,
  roomTypesWithImageInheritance: roomTypes.filter((roomType) => Boolean(roomType?.imageInheritance?.source)).length,
})

const summarizeLiveMapped = (liveMapped) => {
  const liveRooms = ensureArray(liveMapped?.hotel?.rooms)
  const liveRoomTypes = liveRooms.flatMap((room) => ensureArray(room?.roomTypes))
  const uniqueCodes = new Set(
    liveRoomTypes
      .map((roomType) => resolveRoomTypeCode(roomType))
      .filter(Boolean),
  )

  return {
    roomsCount: liveRooms.length,
    roomTypesCount: liveRoomTypes.length,
    uniqueCodes: uniqueCodes.size,
    rateBasesCount: liveRoomTypes.reduce(
      (sum, roomType) => sum + ensureArray(roomType?.rateBases).length,
      0,
    ),
    currency: liveMapped?.currency ?? null,
  }
}

const pickBestStaticCandidate = (rows = []) =>
  ensureArray(rows)
    .map((row) => ({
      row,
      score: extractImageUrls(row?.raw_payload ?? row).length * 100 + (extractDescription(row?.raw_payload ?? row) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.row ?? null

const buildLiveVsStaticComparison = ({ rawRoomRows = [], formattedRoomTypes = [], liveMapped = null }) => {
  const rawRowsByCode = rawRoomRows.reduce((acc, row) => {
    const code = resolveRoomTypeCode(row)
    if (!code) return acc
    const list = acc.get(code) ?? []
    list.push(row)
    acc.set(code, list)
    return acc
  }, new Map())

  const formattedByCode = new Map(
    formattedRoomTypes.map((roomType) => [resolveRoomTypeCode(roomType), roomType]),
  )

  const liveRooms = ensureArray(liveMapped?.hotel?.rooms)
  const liveRoomTypes = liveRooms.flatMap((room) => ensureArray(room?.roomTypes))

  const rows = liveRoomTypes.map((roomType) => {
    const code = resolveRoomTypeCode(roomType)
    const rawMatches = rawRowsByCode.get(code) ?? []
    const bestRaw = pickBestStaticCandidate(rawMatches)
    const formatted = formattedByCode.get(code) ?? null

    return {
      roomTypeCode: code || null,
      liveName: roomType?.name ?? null,
      rawExactMatchCount: rawMatches.length,
      rawHasDescription: Boolean(bestRaw ? extractDescription(bestRaw?.raw_payload ?? bestRaw) : null),
      rawImagesCount: bestRaw ? extractImageUrls(bestRaw?.raw_payload ?? bestRaw).length : 0,
      formattedHasDescription: Boolean(formatted ? extractDescription(formatted) : null),
      formattedImagesCount: formatted ? extractImageUrls(formatted).length : 0,
      imageInheritanceSource: formatted?.imageInheritance?.source ?? null,
    }
  })

  return {
    summary: {
      liveRoomTypes: liveRoomTypes.length,
      exactRawMatches: rows.filter((row) => row.rawExactMatchCount > 0).length,
      missingExactRawMatches: rows.filter((row) => row.rawExactMatchCount === 0).length,
      formattedWithImageInheritance: rows.filter((row) => Boolean(row.imageInheritanceSource)).length,
    },
    rows,
  }
}

const buildMarkdownSummary = ({
  outputDir,
  hotelId,
  hotelBeforeSync,
  hotelAfterSync,
  staticSync,
  staticRawSummary,
  staticFormattedSummary,
  liveRun,
  liveSummary,
  comparison,
  checkIn,
  checkOut,
  occupancies,
}) => {
  const lines = [
    "# Webbeds Hotel Debug",
    "",
    "## Input",
    `- Hotel ID: ${hotelId}`,
    `- Hotel name (before sync): ${hotelBeforeSync?.name ?? "unknown"}`,
    `- City code: ${hotelAfterSync?.city_code ?? hotelBeforeSync?.city_code ?? staticSync?.cityCode ?? "unknown"}`,
    `- GetRooms dates: ${checkIn} -> ${checkOut}`,
    `- GetRooms occupancies: ${occupancies}`,
    `- Output dir: ${relativeToRepo(outputDir)}`,
    "",
    "## Static sync",
    `- Status: ${staticSync.status}`,
  ]

  if (staticSync.cityCode) lines.push(`- City code used: ${staticSync.cityCode}`)
  if (staticSync.error?.message) lines.push(`- Error: ${staticSync.error.message}`)
  if (staticSync.summary) lines.push(`- Provider summary: ${JSON.stringify(staticSync.summary)}`)
  lines.push(`- Logs dir: ${relativeToRepo(staticSync.outputDir)}`)

  if (staticRawSummary) {
    lines.push(`- Raw room rows: ${staticRawSummary.totalRows}`)
    lines.push(`- Raw unique roomTypeCode: ${staticRawSummary.uniqueCodes}`)
    lines.push(`- Raw rows with images: ${staticRawSummary.rowsWithImages}`)
    lines.push(`- Raw rows with descriptions: ${staticRawSummary.rowsWithDescription}`)
  }

  if (staticFormattedSummary) {
    lines.push(`- Formatted room types: ${staticFormattedSummary.roomTypesCount}`)
    lines.push(`- Formatted with images: ${staticFormattedSummary.roomTypesWithImages}`)
    lines.push(`- Formatted with descriptions: ${staticFormattedSummary.roomTypesWithDescription}`)
    lines.push(`- Formatted with image inheritance: ${staticFormattedSummary.roomTypesWithImageInheritance}`)
  }

  lines.push("")
  lines.push("## GetRooms")
  lines.push(`- Status: ${liveRun.status}`)
  lines.push(`- Logs dir: ${relativeToRepo(liveRun.outputDir)}`)
  if (liveRun.error?.message) lines.push(`- Error: ${liveRun.error.message}`)

  if (liveSummary) {
    lines.push(`- Live rooms: ${liveSummary.roomsCount}`)
    lines.push(`- Live room types: ${liveSummary.roomTypesCount}`)
    lines.push(`- Live unique roomTypeCode: ${liveSummary.uniqueCodes}`)
    lines.push(`- Live rate bases: ${liveSummary.rateBasesCount}`)
    lines.push(`- Live currency: ${liveSummary.currency ?? "unknown"}`)
  }

  if (comparison?.summary) {
    lines.push("")
    lines.push("## Live vs Static")
    lines.push(`- Exact raw static matches: ${comparison.summary.exactRawMatches}/${comparison.summary.liveRoomTypes}`)
    lines.push(`- Missing exact raw matches: ${comparison.summary.missingExactRawMatches}/${comparison.summary.liveRoomTypes}`)
    lines.push(`- Formatted rooms using image inheritance: ${comparison.summary.formattedWithImageInheritance}/${comparison.summary.liveRoomTypes}`)
  }

  lines.push("")
  lines.push("## Files")
  lines.push(`- Run metadata: ${relativeToRepo(path.join(outputDir, "run-meta.json"))}`)
  lines.push(`- Summary: ${relativeToRepo(path.join(outputDir, "summary.md"))}`)
  lines.push(`- Static comparison JSON: ${relativeToRepo(path.join(outputDir, "live-vs-static.json"))}`)

  return `${lines.join("\n")}\n`
}

const resolveOccupancies = (argv) => {
  if (argv.occupancies) return String(argv.occupancies).trim()
  const adults = Math.max(1, Number(argv.adults) || 1)
  const childrenAges = String(argv.childrenAges ?? "").trim()
  const childrenSegment = !childrenAges || childrenAges === "0" ? "0" : childrenAges
  return `${adults}|${childrenSegment}`
}

const resolveDates = (argv) => {
  const checkIn = String(argv.checkIn ?? dayjs().format("YYYY-MM-DD")).trim()
  const checkOut = String(argv.checkOut ?? dayjs(checkIn).add(1, "day").format("YYYY-MM-DD")).trim()
  return { checkIn, checkOut }
}

const loadHotelWithRoomTypes = async (hotelId) =>
  models.WebbedsHotel.findOne({
    where: { hotel_id: String(hotelId).trim() },
    include: [
      {
        model: models.WebbedsHotelRoomType,
        as: "roomTypes",
        attributes: ["id", "hotel_id", "roomtype_code", "name", "twin", "room_info", "room_capacity", "raw_payload"],
        required: false,
      },
    ],
  })

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("hotelId", {
      type: "string",
      demandOption: true,
      describe: "WebBeds hotel_id to debug",
    })
    .option("cityCode", {
      type: "string",
      describe: "Optional fallback city code when the hotel is not yet present in webbeds_hotel",
    })
    .option("checkIn", {
      type: "string",
      describe: "GetRooms check-in date (YYYY-MM-DD). Defaults to today.",
    })
    .option("checkOut", {
      type: "string",
      describe: "GetRooms check-out date (YYYY-MM-DD). Defaults to next day.",
    })
    .option("occupancies", {
      type: "string",
      default: undefined,
      describe: "Occupancy string for getrooms, e.g. 1|0 or 2|5-7",
    })
    .option("adults", {
      type: "number",
      default: 1,
      describe: "Single-room fallback adults count when --occupancies is not passed",
    })
    .option("childrenAges", {
      type: "string",
      default: "",
      describe: "Single-room fallback child ages joined with '-', e.g. 5-7. Use 0 for no children.",
    })
    .option("currency", {
      type: "string",
      default: process.env.WEBBEDS_DEFAULT_CURRENCY_CODE || "520",
      describe: "GetRooms currency code. USD is usually 520.",
    })
    .option("nationality", {
      type: "string",
      default: process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102",
      describe: "Passenger nationality country code for getrooms",
    })
    .option("residence", {
      type: "string",
      default: process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102",
      describe: "Passenger residence country code for getrooms",
    })
    .option("rateBasis", {
      type: "string",
      default: "-1",
      describe: "GetRooms rate basis. Defaults to -1.",
    })
    .option("outputDir", {
      type: "string",
      describe: "Optional custom output directory for this run",
    })
    .strict()
    .help()
    .alias("h", "help")
    .parseSync()

  const hotelId = String(argv.hotelId).trim()
  const { checkIn, checkOut } = resolveDates(argv)
  const occupancies = resolveOccupancies(argv)
  const currency = String(argv.currency).trim() || "520"
  const nationality = normalizeNumericCode(argv.nationality, process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102")
  const residence = normalizeNumericCode(argv.residence, process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102")

  await sequelize.authenticate()

  try {
    const hotelBeforeSync = await models.WebbedsHotel.findOne({
      where: { hotel_id: hotelId },
      attributes: ["hotel_id", "name", "city_code", "city_name", "country_code", "country_name"],
      raw: true,
    })

    const resolvedCityCode = String(argv.cityCode ?? hotelBeforeSync?.city_code ?? "").trim() || null
    const hotelSlug = toSafeSlug(hotelBeforeSync?.name ?? `hotel-${hotelId}`, `hotel-${hotelId}`)
    const outputDir = argv.outputDir
      ? path.resolve(argv.outputDir)
      : path.join(repoRoot, "out", "webbeds-hotel-debug", `${hotelId}_${hotelSlug}_${buildStamp()}`)

    const staticOutputDir = path.join(outputDir, "static-search")
    const getRoomsOutputDir = path.join(outputDir, "getrooms")
    fs.mkdirSync(staticOutputDir, { recursive: true })
    fs.mkdirSync(getRoomsOutputDir, { recursive: true })

    const runMeta = {
      generatedAt: new Date().toISOString(),
      input: {
        hotelId,
        cityCode: resolvedCityCode,
        checkIn,
        checkOut,
        occupancies,
        currency,
        nationality,
        residence,
        rateBasis: resolveRateBasis(argv.rateBasis),
      },
      hotelBeforeSync: hotelBeforeSync ?? null,
      paths: {
        outputDir,
        staticOutputDir,
        getRoomsOutputDir,
      },
    }

    const staticSync = {
      status: "skipped",
      cityCode: resolvedCityCode,
      outputDir: staticOutputDir,
      summary: null,
      error: null,
    }

    if (!resolvedCityCode) {
      staticSync.status = "skipped"
      staticSync.error = {
        message: "No cityCode could be resolved from DB. Pass --cityCode to enable the static sync step.",
      }
      writeJson(path.join(staticOutputDir, "searchhotels.error.json"), staticSync.error)
    } else {
      try {
        const summary = await syncWebbedsHotels({
          cityCode: resolvedCityCode,
          hotelLimit: 1,
          xmlDebug: {
            enabled: true,
            directory: staticOutputDir,
            hotelIds: [hotelId],
          },
          filterHotelIds: [hotelId],
        })
        staticSync.status = "ok"
        staticSync.summary = summary
        writeJson(path.join(staticOutputDir, "searchhotels.sync-summary.json"), summary)
      } catch (error) {
        staticSync.status = "failed"
        staticSync.error = {
          name: error?.name ?? "Error",
          message: error?.message ?? "Static sync failed",
          code: error?.code ?? null,
          details: error?.details ?? null,
          metadata: error?.metadata ?? null,
          stack: error?.stack ?? null,
        }
        writeJson(path.join(staticOutputDir, "searchhotels.error.json"), staticSync.error)
        if (error?.requestXml) {
          writeText(path.join(staticOutputDir, "searchhotels.error.request.xml"), error.requestXml)
        }
        if (error?.responseXml) {
          writeText(path.join(staticOutputDir, "searchhotels.error.response.xml"), error.responseXml)
        }
      }
    }

    const hotelAfterSync = await loadHotelWithRoomTypes(hotelId)
    let staticRawSummary = null
    let staticFormattedSummary = null
    let rawRoomRows = []
    let formattedRoomTypes = []

    if (hotelAfterSync) {
      const staticFormattedHotel = formatStaticHotel(hotelAfterSync)
      rawRoomRows = ensureArray(hotelAfterSync?.roomTypes)
      formattedRoomTypes = ensureArray(staticFormattedHotel?.roomTypes)
      staticRawSummary = summarizeRawStatic(rawRoomRows)
      staticFormattedSummary = summarizeFormattedStatic(formattedRoomTypes)

      writeJson(
        path.join(staticOutputDir, "static-hotel.json"),
        hotelAfterSync.toJSON ? hotelAfterSync.toJSON() : hotelAfterSync,
      )
      writeJson(path.join(staticOutputDir, "static-formatted.json"), staticFormattedHotel)
      writeJson(
        path.join(staticOutputDir, "static-raw-roomtypes.json"),
        rawRoomRows.map((row) => ({
          roomtype_code: row.roomtype_code,
          name: row.name,
          twin: row.twin,
          room_info: row.room_info,
          room_capacity: row.room_capacity,
          raw_payload: row.raw_payload,
        })),
      )
      writeJson(path.join(staticOutputDir, "static-raw-summary.json"), staticRawSummary)
      writeJson(path.join(staticOutputDir, "static-formatted-summary.json"), staticFormattedSummary)
    }

    const getRoomsPayload = buildGetRoomsPayload({
      checkIn,
      checkOut,
      currency,
      occupancies,
      rateBasis: resolveRateBasis(argv.rateBasis),
      nationality,
      residence,
      hotelId,
    })
    writeJson(path.join(getRoomsOutputDir, "getrooms.payload.json"), getRoomsPayload)

    const liveRun = {
      status: "failed",
      outputDir: getRoomsOutputDir,
      metadata: null,
      error: null,
    }
    let liveMapped = null
    let liveSummary = null

    try {
      const provider = new WebbedsProvider()
      const requestId = `webbeds-hotel-debug-${hotelId}-${Date.now()}`
      const {
        result,
        requestXml,
        responseXml,
        metadata,
      } = await provider.client.send("getrooms", getRoomsPayload, {
        requestId,
        productOverride: "hotel",
      })

      liveMapped = mapGetRoomsResponse(result)
      liveSummary = summarizeLiveMapped(liveMapped)
      liveRun.status = "ok"
      liveRun.metadata = metadata ?? null

      writeText(path.join(getRoomsOutputDir, "getrooms.request.xml"), requestXml || "")
      writeText(path.join(getRoomsOutputDir, "getrooms.response.xml"), responseXml || "")
      writeJson(path.join(getRoomsOutputDir, "getrooms.mapped.json"), liveMapped)
      writeJson(path.join(getRoomsOutputDir, "getrooms.metadata.json"), metadata ?? null)
      writeJson(path.join(getRoomsOutputDir, "getrooms.summary.json"), liveSummary)
    } catch (error) {
      liveRun.status = "failed"
      liveRun.error = {
        name: error?.name ?? "Error",
        message: error?.message ?? "GetRooms failed",
        code: error?.code ?? null,
        details: error?.details ?? null,
        extraDetails: error?.extraDetails ?? null,
        metadata: error?.metadata ?? null,
        stack: error?.stack ?? null,
      }
      writeJson(path.join(getRoomsOutputDir, "getrooms.error.json"), liveRun.error)
      if (error?.requestXml) {
        writeText(path.join(getRoomsOutputDir, "getrooms.request.xml"), error.requestXml)
      }
      if (error?.responseXml) {
        writeText(path.join(getRoomsOutputDir, "getrooms.response.xml"), error.responseXml)
      }
    }

    let comparison = null
    if (liveMapped && rawRoomRows.length) {
      comparison = buildLiveVsStaticComparison({
        rawRoomRows,
        formattedRoomTypes,
        liveMapped,
      })
      writeJson(path.join(outputDir, "live-vs-static.json"), comparison)
    } else {
      writeJson(path.join(outputDir, "live-vs-static.json"), {
        summary: null,
        rows: [],
        note: "Comparison skipped because either static room rows or getrooms live data were unavailable.",
      })
    }

    runMeta.hotelAfterSync =
      hotelAfterSync && hotelAfterSync.toJSON ? hotelAfterSync.toJSON() : hotelAfterSync ?? null
    runMeta.staticSync = staticSync
    runMeta.staticRawSummary = staticRawSummary
    runMeta.staticFormattedSummary = staticFormattedSummary
    runMeta.liveRun = liveRun
    runMeta.liveSummary = liveSummary
    runMeta.comparisonSummary = comparison?.summary ?? null

    const summaryMd = buildMarkdownSummary({
      outputDir,
      hotelId,
      hotelBeforeSync,
      hotelAfterSync: runMeta.hotelAfterSync,
      staticSync,
      staticRawSummary,
      staticFormattedSummary,
      liveRun,
      liveSummary,
      comparison,
      checkIn,
      checkOut,
      occupancies,
    })

    writeJson(path.join(outputDir, "run-meta.json"), runMeta)
    writeText(path.join(outputDir, "summary.md"), summaryMd)

    console.info("[webbedsHotelDebug] run ready", {
      hotelId,
      hotelName: hotelAfterSync?.name ?? hotelBeforeSync?.name ?? null,
      staticStatus: staticSync.status,
      getRoomsStatus: liveRun.status,
      outputDir,
    })
  } finally {
    await sequelize.close()
  }
}

main().catch((error) => {
  console.error("[webbedsHotelDebug] failed", {
    message: error?.message || error,
    stack: error?.stack || null,
  })
  process.exitCode = 1
})
