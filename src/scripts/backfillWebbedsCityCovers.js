/**
 * Backfill `cover_image_url` for `webbeds_city` rows from Unsplash.
 *
 * Usage:
 *   UNSPLASH_ACCESS_KEY=xxx node scripts/backfill-city-covers.js [--limit=50] [--force] [--dry-run]
 *
 * Flags:
 *   --limit=N      Process at most N cities this run (default: 50).
 *   --force        Re-fetch covers for cities that already have one.
 *   --dry-run      Print actions without writing to DB.
 *   --min-hotels=N Only consider cities with at least N hotels (default: 1).
 *
 * Notes:
 * - Unsplash free tier: 50 requests/hour. We sleep 75s between calls to stay under.
 * - We follow Unsplash API guidelines: ping `links.download_location` after picking a photo.
 *   This tracks downloads for photographer attribution; required for compliant API use.
 * - Cities are processed in `hotel_count DESC` order so the popular ones get covered first.
 */

import "dotenv/config"
import { QueryTypes } from "sequelize"
import models, { sequelize } from "../models/index.js"

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || ""
const UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos"
const UNSPLASH_RATE_LIMIT_PAUSE_MS = Number(process.env.UNSPLASH_PAUSE_MS) || 75_000

const args = process.argv.slice(2).reduce((acc, raw) => {
  if (raw.startsWith("--")) {
    const [key, value] = raw.slice(2).split("=")
    acc[key] = value === undefined ? true : value
  }
  return acc
}, {})

const limit = Number(args.limit) > 0 ? Number(args.limit) : 50
const minHotels = Number(args["min-hotels"]) > 0 ? Number(args["min-hotels"]) : 1
const dryRun = Boolean(args["dry-run"])
const force = Boolean(args.force)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fetchUnsplashCover = async (city) => {
  const cityName = String(city.name || "").trim()
  const countryName = String(city.country_name || "").trim()
  const queries = [
    cityName && countryName ? `${cityName} ${countryName} skyline` : null,
    cityName && countryName ? `${cityName} ${countryName} cityscape` : null,
    cityName ? `${cityName} city` : null,
    cityName,
  ].filter(Boolean)

  for (const query of queries) {
    const url = new URL(UNSPLASH_SEARCH_URL)
    url.searchParams.set("query", query)
    url.searchParams.set("per_page", "1")
    url.searchParams.set("orientation", "landscape")
    url.searchParams.set("content_filter", "high")

    const res = await fetch(url, {
      headers: {
        Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
        "Accept-Version": "v1",
      },
    })

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Unsplash auth failed (${res.status}). Check UNSPLASH_ACCESS_KEY.`,
      )
    }
    if (res.status === 429) {
      throw new Error("Unsplash rate-limited (429). Pause and resume later.")
    }
    if (!res.ok) {
      console.warn(`  query "${query}" failed: ${res.status} ${res.statusText}`)
      continue
    }

    const data = await res.json()
    const photo = data?.results?.[0]
    if (!photo) {
      console.warn(`  query "${query}" returned no results`)
      continue
    }

    // Ping download_location per Unsplash API guideline. We don't need the
    // response — just letting them count the download for attribution.
    if (photo?.links?.download_location) {
      try {
        await fetch(photo.links.download_location, {
          headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
        })
      } catch {
        // Non-fatal. We still got the URL we needed.
      }
    }

    const baseUrl = photo?.urls?.regular || photo?.urls?.full || photo?.urls?.raw
    if (!baseUrl) continue

    const photographer = photo?.user?.name || "Unsplash"
    const photographerUrl = photo?.user?.links?.html || "https://unsplash.com"
    const attribution = `Photo by ${photographer} on Unsplash (${photographerUrl})`

    return {
      url: baseUrl,
      source: "unsplash",
      attribution: attribution.slice(0, 255),
      query,
      photoId: photo?.id || null,
    }
  }

  return null
}

const main = async () => {
  if (!UNSPLASH_ACCESS_KEY) {
    console.error(
      "Missing UNSPLASH_ACCESS_KEY. Get a free key at https://unsplash.com/developers",
    )
    process.exit(1)
  }

  await sequelize.authenticate()

  // We use raw SQL to avoid pulling all WebbedsHotel rows and to order by
  // computed hotel_count cheaply.
  const dialect = sequelize.getDialect()
  const isPostgres = dialect.startsWith("postgres")
  const intCast = isPostgres ? "::int" : ""

  const filterCovered = force ? "" : 'AND (c.cover_image_url IS NULL OR c.cover_image_url = \'\')'
  const sql = `
    SELECT
      c.code,
      c.name,
      c.country_name,
      c.cover_image_url,
      (
        SELECT COUNT(*)${intCast}
        FROM webbeds_hotel h
        WHERE h.city_code::text = c.code::text AND h.deleted_at IS NULL
      ) AS hotel_count
    FROM webbeds_city c
    WHERE c.deleted_at IS NULL ${filterCovered}
    GROUP BY c.code, c.name, c.country_name, c.cover_image_url
    HAVING (
      SELECT COUNT(*)${intCast}
      FROM webbeds_hotel h
      WHERE h.city_code::text = c.code::text AND h.deleted_at IS NULL
    ) >= :minHotels
    ORDER BY hotel_count DESC, c.name ASC
    LIMIT :limit
  `

  const cities = await sequelize.query(sql, {
    replacements: { minHotels, limit },
    type: QueryTypes.SELECT,
  })

  console.log(
    `Found ${cities.length} cities to process (minHotels=${minHotels}, limit=${limit}, force=${force}, dryRun=${dryRun}).`,
  )

  let success = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < cities.length; i += 1) {
    const city = cities[i]
    const tag = `[${i + 1}/${cities.length}] ${city.name} (${city.country_name}) — ${city.hotel_count} hotels`
    console.log(tag)

    try {
      const cover = await fetchUnsplashCover(city)
      if (!cover) {
        console.warn("  no cover found for any query, skipping")
        skipped += 1
      } else if (dryRun) {
        console.log(`  [dry-run] would set cover_image_url = ${cover.url}`)
        success += 1
      } else {
        await models.WebbedsCity.update(
          {
            cover_image_url: cover.url,
            cover_image_source: cover.source,
            cover_image_attribution: cover.attribution,
          },
          { where: { code: city.code } },
        )
        console.log(`  saved (${cover.query} → ${cover.photoId})`)
        success += 1
      }
    } catch (error) {
      console.error(`  error: ${error?.message || error}`)
      failed += 1
      // Stop early on hard auth errors so we don't burn the rate window.
      if (/Unsplash auth failed|rate-limited/i.test(String(error?.message || ""))) {
        console.error("Aborting run.")
        break
      }
    }

    // Pace ourselves to stay under Unsplash free-tier rate limit (50/hour).
    if (i < cities.length - 1) {
      await sleep(UNSPLASH_RATE_LIMIT_PAUSE_MS)
    }
  }

  console.log(`Done. success=${success} skipped=${skipped} failed=${failed}`)
  await sequelize.close()
}

main().catch(async (error) => {
  console.error("Backfill failed:", error)
  try {
    await sequelize.close()
  } catch {
    // ignore
  }
  process.exit(1)
})
