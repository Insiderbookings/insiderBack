import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { Op, col, fn, where as sequelizeWhere } from "sequelize"

import models, { sequelize } from "../models/index.js"
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

const buildRawRoomTypeSummary = (roomTypeRow) => {
  const rawPayload = roomTypeRow?.raw_payload ?? roomTypeRow ?? null
  const description = extractDescription(rawPayload)
  const imageUrls = extractImageUrls(rawPayload)
  return {
    roomTypeCode: resolveRoomTypeCode(roomTypeRow),
    name: roomTypeRow?.name ?? rawPayload?.name ?? null,
    imagesCount: imageUrls.length,
    firstImages: imageUrls.slice(0, 3),
    hasDescription: Boolean(description),
    descriptionPreview: description?.slice(0, 220) ?? null,
  }
}

const buildFormattedRoomTypeSummary = (roomType) => {
  const description = extractDescription(roomType)
  const imageUrls = extractImageUrls(roomType)
  return {
    roomTypeCode: resolveRoomTypeCode(roomType),
    name: roomType?.name ?? null,
    imagesCount: imageUrls.length,
    firstImages: imageUrls.slice(0, 3),
    hasDescription: Boolean(description),
    descriptionPreview: description?.slice(0, 220) ?? null,
    imageInheritance: roomType?.imageInheritance ?? null,
  }
}

const pickBestStaticCandidate = (rows = []) =>
  ensureArray(rows)
    .map((row) => ({
      row,
      score: extractImageUrls(row?.raw_payload ?? row).length * 100 + (extractDescription(row?.raw_payload ?? row) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.row ?? null

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

const buildIssues = ({
  rawStaticSummary,
  liveRoomTypes,
  comparison,
}) => {
  const issues = []
  const liveCount = liveRoomTypes.length
  const missingExact = comparison.filter((entry) => !entry.staticRaw.exists).length
  const rawNoDescription = comparison.filter((entry) => !entry.staticRaw.hasDescription).length
  const rawNoImages = comparison.filter((entry) => !entry.staticRaw.imagesCount).length
  const inheritedImages = comparison.filter(
    (entry) => entry.staticFormatted.imageInheritanceSource === "roomProfile",
  ).length

  if (missingExact > 0) {
    issues.push({
      level: "high",
      code: "missing_static_codes",
      message: `${missingExact}/${liveCount} live roomTypeCode(s) are missing from the static pool.`,
    })
  }

  if (rawNoDescription > 0) {
    issues.push({
      level: rawNoDescription === liveCount ? "high" : "medium",
      code: "missing_static_descriptions",
      message: `${rawNoDescription}/${liveCount} live roomTypeCode(s) have no raw static description.`,
    })
  }

  if (rawNoImages > 0) {
    issues.push({
      level: rawNoImages === liveCount ? "high" : "medium",
      code: "missing_static_images",
      message: `${rawNoImages}/${liveCount} live roomTypeCode(s) have no raw static images.`,
    })
  }

  if (rawStaticSummary.rowsWithImages < rawStaticSummary.totalRows) {
    issues.push({
      level: "medium",
      code: "sparse_static_image_coverage",
      message: `Only ${rawStaticSummary.rowsWithImages}/${rawStaticSummary.totalRows} static room rows have images.`,
    })
  }

  if (rawStaticSummary.rowsWithDescription < rawStaticSummary.totalRows) {
    issues.push({
      level: "medium",
      code: "sparse_static_description_coverage",
      message: `Only ${rawStaticSummary.rowsWithDescription}/${rawStaticSummary.totalRows} static room rows have descriptions.`,
    })
  }

  if (inheritedImages > 0) {
    issues.push({
      level: "medium",
      code: "profile_fallback_images",
      message: `${inheritedImages}/${liveCount} live roomTypeCode(s) rely on profile-based inherited images in formatted static data.`,
    })
  }

  return issues
}

const buildMarkdownSummary = ({
  input,
  hotel,
  rawStaticSummary,
  liveSummary,
  issues,
  comparison,
  files,
}) => {
  const lines = [
    "# Hotel room diagnostics",
    "",
    "## Input",
    `- Hotel: ${hotel.name} (${hotel.hotelId})`,
    `- Dates: ${input.checkIn} -> ${input.checkOut}`,
    `- Occupancies: ${input.occupancies}`,
    `- Currency: ${input.currency}`,
    `- Nationality / Residence: ${input.nationality} / ${input.residence}`,
    "",
    "## Static summary",
    `- Raw rows: ${rawStaticSummary.totalRows}`,
    `- Unique roomTypeCode: ${rawStaticSummary.uniqueCodes}`,
    `- Rows with images: ${rawStaticSummary.rowsWithImages}`,
    `- Rows with descriptions: ${rawStaticSummary.rowsWithDescription}`,
    "",
    "## Live summary",
    `- Rooms: ${liveSummary.roomsCount}`,
    `- Room types: ${liveSummary.roomTypesCount}`,
    `- Rate bases: ${liveSummary.rateBasesCount}`,
    "",
    "## Issues",
  ]

  if (!issues.length) {
    lines.push("- No obvious mismatches were detected.")
  } else {
    issues.forEach((issue) => {
      lines.push(`- [${issue.level}] ${issue.code}: ${issue.message}`)
    })
  }

  lines.push("")
  lines.push("## Live vs Static")
  comparison.forEach((entry) => {
    const liveLabel = `${entry.live.roomTypeCode} - ${entry.live.name || "Unnamed room"}`
    const staticBits = [
      `rawImages=${entry.staticRaw.imagesCount}`,
      `rawDescription=${entry.staticRaw.hasDescription ? "yes" : "no"}`,
      `formattedImages=${entry.staticFormatted.imagesCount}`,
      `formattedDescription=${entry.staticFormatted.hasDescription ? "yes" : "no"}`,
    ]
    if (entry.staticFormatted.imageInheritanceSource) {
      staticBits.push(`imageInheritance=${entry.staticFormatted.imageInheritanceSource}`)
    }
    lines.push(`- ${liveLabel}: ${staticBits.join(", ")}`)
  })

  lines.push("")
  lines.push("## Files")
  lines.push(`- Report JSON: ${files.reportJson}`)
  lines.push(`- Summary MD: ${files.summaryMd}`)
  lines.push(`- Request XML: ${files.requestXml}`)
  lines.push(`- Response XML: ${files.responseXml}`)
  lines.push(`- Live mapped JSON: ${files.liveMappedJson}`)
  lines.push(`- Static formatted JSON: ${files.staticFormattedJson}`)

  return `${lines.join("\n")}\n`
}

const writeJson = (targetPath, data) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

const writeText = (targetPath, text) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, text, "utf8")
}

const resolveHotelByInput = async ({ hotelId, hotelName }) => {
  if (hotelId) {
    return models.WebbedsHotel.findOne({
      where: { hotel_id: String(hotelId).trim() },
      attributes: ["hotel_id", "name", "city_name", "country_name"],
      raw: true,
    })
  }

  const normalizedName = String(hotelName ?? "").trim().toLowerCase()
  if (!normalizedName) return null

  const rows = await models.WebbedsHotel.findAll({
    where: sequelizeWhere(fn("lower", col("name")), {
      [Op.like]: `%${normalizedName}%`,
    }),
    attributes: ["hotel_id", "name", "city_name", "country_name"],
    order: [["name", "ASC"]],
    limit: 10,
    raw: true,
  })

  return rows[0] ?? null
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("hotelId", {
      type: "string",
      describe: "WebBeds hotel_id",
    })
    .option("hotelName", {
      type: "string",
      describe: "Partial hotel name to resolve against webbeds_hotel",
    })
    .option("checkIn", {
      type: "string",
      demandOption: true,
      describe: "Check-in date (YYYY-MM-DD)",
    })
    .option("checkOut", {
      type: "string",
      demandOption: true,
      describe: "Check-out date (YYYY-MM-DD)",
    })
    .option("occupancies", {
      type: "string",
      default: undefined,
      describe: "Occupancy string, e.g. 1|0 or 2|5-7",
    })
    .option("adults", {
      type: "number",
      default: 1,
      describe: "Single-room fallback: adults count when --occupancies is not passed",
    })
    .option("childrenAges", {
      type: "string",
      default: "",
      describe: "Single-room fallback: child ages joined with '-', e.g. 5-7. Use 0 for no children.",
    })
    .option("currency", {
      type: "string",
      default: process.env.WEBBEDS_DEFAULT_CURRENCY_CODE || "520",
      describe: "WebBeds currency code. USD is usually 520.",
    })
    .option("nationality", {
      type: "string",
      default: process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102",
      describe: "Passenger nationality country code",
    })
    .option("residence", {
      type: "string",
      default: process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102",
      describe: "Passenger residence country code",
    })
    .option("outputDir", {
      type: "string",
      default: undefined,
      describe: "Optional output directory",
    })
    .check((args) => {
      if (!args.hotelId && !args.hotelName) {
        throw new Error("Pass --hotelId or --hotelName")
      }
      return true
    })
    .strict()
    .help()
    .parseSync()

  const resolvedOccupancies = (() => {
    if (argv.occupancies) return String(argv.occupancies).trim()
    const adults = Math.max(1, Number(argv.adults) || 1)
    const childrenAges = String(argv.childrenAges ?? "").trim()
    const childrenSegment = !childrenAges || childrenAges === "0" ? "0" : childrenAges
    return `${adults}|${childrenSegment}`
  })()

  await sequelize.authenticate()
  try {
    const hotelRow = await resolveHotelByInput({
      hotelId: argv.hotelId,
      hotelName: argv.hotelName,
    })

    if (!hotelRow) {
      throw new Error("Hotel not found in webbeds_hotel")
    }

    const hotelId = String(hotelRow.hotel_id).trim()
    const hotel = await models.WebbedsHotel.findOne({
      where: { hotel_id: hotelId },
      include: [
        {
          model: models.WebbedsHotelRoomType,
          as: "roomTypes",
          attributes: ["id", "hotel_id", "roomtype_code", "name", "room_info", "raw_payload"],
          required: false,
        },
      ],
    })

    if (!hotel) {
      throw new Error(`Hotel ${hotelId} could not be loaded with roomTypes`)
    }

    const rawRoomRows = ensureArray(hotel?.roomTypes)
    const rawStaticSummary = summarizeRawStatic(rawRoomRows)
    const rawRowsByCode = rawRoomRows.reduce((acc, row) => {
      const code = resolveRoomTypeCode(row)
      if (!code) return acc
      const list = acc.get(code) ?? []
      list.push(row)
      acc.set(code, list)
      return acc
    }, new Map())

    const staticFormattedHotel = formatStaticHotel(hotel)
    const formattedRoomTypes = ensureArray(staticFormattedHotel?.roomTypes)
    const formattedByCode = new Map(
      formattedRoomTypes.map((roomType) => [resolveRoomTypeCode(roomType), roomType]),
    )

    const provider = new WebbedsProvider()
    const requestId = `rooms-diag-${hotelId}-${Date.now()}`
    const payload = buildGetRoomsPayload({
      checkIn: argv.checkIn,
      checkOut: argv.checkOut,
      currency: argv.currency,
      occupancies: resolvedOccupancies,
      rateBasis: "-1",
      nationality: argv.nationality,
      residence: argv.residence,
      hotelId,
    })

    const {
      result,
      requestXml,
      responseXml,
      metadata,
    } = await provider.client.send("getrooms", payload, {
      requestId,
      productOverride: "hotel",
    })

    const liveMapped = mapGetRoomsResponse(result)
    const liveRooms = ensureArray(liveMapped?.hotel?.rooms)
    const liveRoomTypes = liveRooms.flatMap((room) => ensureArray(room?.roomTypes))
    const liveSummary = {
      roomsCount: liveRooms.length,
      roomTypesCount: liveRoomTypes.length,
      rateBasesCount: liveRoomTypes.reduce(
        (sum, roomType) => sum + ensureArray(roomType?.rateBases).length,
        0,
      ),
      currency: liveMapped?.currency ?? null,
    }

    const comparison = liveRoomTypes.map((roomType) => {
      const code = resolveRoomTypeCode(roomType)
      const rawMatches = rawRowsByCode.get(code) ?? []
      const rawBest = pickBestStaticCandidate(rawMatches)
      const formatted = formattedByCode.get(code) ?? null

      return {
        live: {
          roomTypeCode: code || null,
          name: roomType?.name ?? null,
          twin: roomType?.twin ?? null,
          rateBasesCount: ensureArray(roomType?.rateBases).length,
          roomInfo: roomType?.roomInfo ?? null,
        },
        staticRaw: {
          exists: rawMatches.length > 0,
          matchCount: rawMatches.length,
          ...(rawBest ? buildRawRoomTypeSummary(rawBest) : {
            roomTypeCode: code || null,
            name: null,
            imagesCount: 0,
            firstImages: [],
            hasDescription: false,
            descriptionPreview: null,
          }),
        },
        staticFormatted: formatted
          ? {
              exists: true,
              ...buildFormattedRoomTypeSummary(formatted),
              imageInheritanceSource: formatted?.imageInheritance?.source ?? null,
            }
          : {
              exists: false,
              roomTypeCode: code || null,
              name: null,
              imagesCount: 0,
              firstImages: [],
              hasDescription: false,
              descriptionPreview: null,
              imageInheritance: null,
              imageInheritanceSource: null,
            },
      }
    })

    const issues = buildIssues({
      rawStaticSummary,
      liveRoomTypes,
      comparison,
    })

    const report = {
      generatedAt: new Date().toISOString(),
      input: {
        hotelId,
        hotelName: hotelRow.name,
        checkIn: argv.checkIn,
        checkOut: argv.checkOut,
        occupancies: resolvedOccupancies,
        currency: String(argv.currency),
        nationality: String(argv.nationality),
        residence: String(argv.residence),
        requestId,
      },
      hotel: {
        hotelId,
        name: hotelRow.name,
        city: hotelRow.city_name ?? null,
        country: hotelRow.country_name ?? null,
      },
      provider: {
        metadata: metadata ?? null,
      },
      staticRawSummary: rawStaticSummary,
      staticFormattedSummary: {
        roomTypesCount: formattedRoomTypes.length,
        roomTypesWithImages: formattedRoomTypes.filter((roomType) => extractImageUrls(roomType).length > 0).length,
        roomTypesWithDescription: formattedRoomTypes.filter((roomType) => Boolean(extractDescription(roomType))).length,
      },
      liveSummary,
      issues,
      comparison,
    }

    const outputDir =
      argv.outputDir
        ? path.resolve(argv.outputDir)
        : path.join(
            repoRoot,
            "out",
            "room-diagnostics",
            `${hotelId}_${toSafeSlug(hotelRow.name, "hotel")}_${argv.checkIn}_${argv.checkOut}_${buildStamp()}`,
          )
    fs.mkdirSync(outputDir, { recursive: true })

    const files = {
      reportJson: path.join(outputDir, "report.json"),
      summaryMd: path.join(outputDir, "summary.md"),
      requestXml: path.join(outputDir, "getrooms.request.xml"),
      responseXml: path.join(outputDir, "getrooms.response.xml"),
      liveMappedJson: path.join(outputDir, "live-mapped.json"),
      staticFormattedJson: path.join(outputDir, "static-formatted.json"),
      staticRawJson: path.join(outputDir, "static-raw-roomtypes.json"),
    }

    const summaryMd = buildMarkdownSummary({
      input: report.input,
      hotel: report.hotel,
      rawStaticSummary,
      liveSummary,
      issues,
      comparison,
      files,
    })

    writeJson(files.reportJson, report)
    writeJson(files.liveMappedJson, liveMapped)
    writeJson(files.staticFormattedJson, staticFormattedHotel)
    writeJson(
      files.staticRawJson,
      rawRoomRows.map((row) => ({
        roomtype_code: row.roomtype_code,
        name: row.name,
        raw_payload: row.raw_payload,
      })),
    )
    writeText(files.requestXml, requestXml || "")
    writeText(files.responseXml, responseXml || "")
    writeText(files.summaryMd, summaryMd)

    console.info("[diagnoseHotelRooms] report ready", {
      hotelId,
      hotelName: hotelRow.name,
      liveRoomTypes: liveSummary.roomTypesCount,
      rawStaticRows: rawStaticSummary.totalRows,
      rawStaticWithImages: rawStaticSummary.rowsWithImages,
      rawStaticWithDescription: rawStaticSummary.rowsWithDescription,
      outputDir,
    })
    console.info("[diagnoseHotelRooms] files", files)
  } finally {
    await sequelize.close()
  }
}

main().catch((error) => {
  console.error("[diagnoseHotelRooms] failed", {
    message: error?.message || error,
    stack: error?.stack || null,
  })
  process.exitCode = 1
})
