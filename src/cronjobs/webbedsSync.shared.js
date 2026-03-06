import models from "../models/index.js";
import { syncWebbedsCities, syncWebbedsCountries, syncWebbedsHotels, syncWebbedsHotelsIncremental } from "../services/webbedsStatic.service.js";

let activeWebbedsSyncJob = null;

const toIntegerOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
};

const toPositiveIntOrNull = (value) => {
  const parsed = toIntegerOrNull(value);
  if (parsed == null) return null;
  return parsed > 0 ? parsed : null;
};

const toNonNegativeInt = (value, fallback = 0) => {
  const parsed = toIntegerOrNull(value);
  if (parsed == null) return fallback;
  return parsed >= 0 ? parsed : fallback;
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const withWebbedsLock = async (jobName, run) => {
  const normalizedJobName = String(jobName || "").trim().toLowerCase() || "webbeds-sync";
  if (activeWebbedsSyncJob && activeWebbedsSyncJob !== normalizedJobName) {
    return {
      skipped: true,
      reason: `Another WebBeds sync is running (${activeWebbedsSyncJob})`,
      activeJob: activeWebbedsSyncJob,
    };
  }

  activeWebbedsSyncJob = normalizedJobName;
  try {
    return await run();
  } finally {
    if (activeWebbedsSyncJob === normalizedJobName) {
      activeWebbedsSyncJob = null;
    }
  }
};

const resolveCountryRows = async () => {
  const countryCode = toIntegerOrNull(process.env.WEBBEDS_CITY_SYNC_COUNTRY_CODE);
  const limit = toPositiveIntOrNull(process.env.WEBBEDS_CITY_SYNC_COUNTRY_LIMIT);
  const offset = toNonNegativeInt(process.env.WEBBEDS_CITY_SYNC_COUNTRY_OFFSET, 0);

  const where = {};
  if (countryCode != null) where.code = countryCode;

  return models.WebbedsCountry.findAll({
    attributes: ["code", "name"],
    where,
    order: [["code", "ASC"]],
    ...(limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
    raw: true,
  });
};

const resolveCityRows = async () => {
  const countryCode = toIntegerOrNull(process.env.WEBBEDS_HOTEL_SYNC_COUNTRY_CODE);
  const limit = toPositiveIntOrNull(process.env.WEBBEDS_HOTEL_SYNC_CITY_LIMIT);
  const offset = toNonNegativeInt(process.env.WEBBEDS_HOTEL_SYNC_CITY_OFFSET, 0);

  const where = {};
  if (countryCode != null) where.country_code = countryCode;

  return models.WebbedsCity.findAll({
    attributes: ["code", "country_code"],
    where,
    order: [["code", "ASC"]],
    ...(limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
    raw: true,
  });
};

const throwSummaryError = (message, summary) => {
  const error = new Error(message);
  error.summary = summary;
  throw error;
};

export const runWebbedsCitiesCatalogSyncJob = async ({ jobName }) =>
  withWebbedsLock(jobName, async () => {
    const startedAt = Date.now();
    const failFast = toBoolean(process.env.WEBBEDS_CITY_SYNC_FAIL_FAST, false);

    const countriesCatalog = await syncWebbedsCountries({ dryRun: false });
    const countries = await resolveCountryRows();

    if (!countries.length) {
      return {
        skipped: false,
        countriesCatalogInserted: Number(countriesCatalog?.inserted ?? 0) || 0,
        countriesSelected: 0,
        countriesProcessed: 0,
        countriesFailed: 0,
        totalInserted: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    let countriesProcessed = 0;
    let totalInserted = 0;
    const failures = [];

    for (const country of countries) {
      countriesProcessed += 1;
      const countryCode = Number(country?.code);
      const countryName = country?.name ?? null;
      try {
        const result = await syncWebbedsCities({ countryCode, dryRun: false });
        const inserted = Number(result?.inserted ?? 0);
        if (Number.isFinite(inserted)) totalInserted += inserted;
      } catch (error) {
        failures.push({
          countryCode,
          countryName,
          message: String(error?.message || error),
        });
        if (failFast) break;
      }
    }

    const summary = {
      skipped: false,
      countriesCatalogInserted: Number(countriesCatalog?.inserted ?? 0) || 0,
      countriesSelected: countries.length,
      countriesProcessed,
      countriesFailed: failures.length,
      totalInserted,
      durationMs: Date.now() - startedAt,
      failedCountries: failures,
    };

    if (failures.length) {
      throwSummaryError(
        `[webbeds-cities-sync] completed with ${failures.length} failing countries`,
        summary,
      );
    }

    return summary;
  });

export const runWebbedsHotelsSyncJob = async ({ jobName, mode }) =>
  withWebbedsLock(jobName, async () => {
    const normalizedMode = ["full", "new", "updated"].includes(mode) ? mode : "full";
    const startedAt = Date.now();
    const failFast = toBoolean(process.env.WEBBEDS_HOTEL_SYNC_FAIL_FAST, false);
    const since = String(process.env.WEBBEDS_HOTEL_SYNC_UPDATED_SINCE || "").trim() || undefined;

    const cities = await resolveCityRows();
    if (!cities.length) {
      return {
        skipped: false,
        mode: normalizedMode,
        citiesSelected: 0,
        citiesProcessed: 0,
        citiesFailed: 0,
        totalInserted: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    let citiesProcessed = 0;
    let totalInserted = 0;
    const failures = [];

    for (const city of cities) {
      citiesProcessed += 1;
      const cityCode = String(city?.code ?? "").trim();
      const countryCode = city?.country_code != null ? Number(city.country_code) : null;
      try {
        const result =
          normalizedMode === "full"
            ? await syncWebbedsHotels({ cityCode, dryRun: false })
            : await syncWebbedsHotelsIncremental({
                cityCode,
                mode: normalizedMode,
                dryRun: false,
                ...(normalizedMode === "updated" && since ? { since } : {}),
              });

        const inserted = Number(result?.inserted ?? 0);
        if (Number.isFinite(inserted)) totalInserted += inserted;
      } catch (error) {
        failures.push({
          cityCode,
          countryCode,
          message: String(error?.message || error),
        });
        if (failFast) break;
      }
    }

    const summary = {
      skipped: false,
      mode: normalizedMode,
      citiesSelected: cities.length,
      citiesProcessed,
      citiesFailed: failures.length,
      totalInserted,
      durationMs: Date.now() - startedAt,
      failedCities: failures,
    };

    if (failures.length) {
      throwSummaryError(
        `[webbeds-hotels-${normalizedMode}] completed with ${failures.length} failing cities`,
        summary,
      );
    }

    return summary;
  });
