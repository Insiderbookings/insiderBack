import { Op, QueryTypes } from "sequelize";
import models from "../models/index.js";
import { createFxRateChangeLogs, ratesAreEqual } from "../services/fxRateChangeLog.service.js";
import { sequelize } from "../models/index.js";

const normalizeCode = (value) => String(value || "").trim().toUpperCase().slice(0, 3);
const normalizeProvider = (value) => String(value || "").trim().toLowerCase().slice(0, 40);
const normalizeSource = (value) => String(value || "").trim().slice(0, 80) || "unknown";
const pickRaw = (row, ...keys) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return null;
};

const serializeFxRate = (row) => ({
  id: row.id,
  baseCurrency: row.baseCurrency ?? row.base_currency ?? null,
  quoteCurrency: row.quoteCurrency ?? row.quote_currency ?? null,
  rate: row.rate != null ? Number(row.rate) : null,
  provider: row.provider ?? null,
  enabled: row.enabled !== undefined ? Boolean(row.enabled) : true,
  rateDate: row.rateDate ?? row.rate_date ?? null,
  fetchedAt: row.fetchedAt ?? row.fetched_at ?? null,
  expiresAt: row.expiresAt ?? row.expires_at ?? null,
  createdAt: row.createdAt ?? row.created_at ?? null,
  updatedAt: row.updatedAt ?? row.updated_at ?? null,
});

const serializeFxRateChange = (row) => ({
  id: row.id,
  batchId: row.batchId ?? row.batch_id ?? null,
  source: row.source ?? null,
  triggeredBy: row.triggeredBy ?? row.triggered_by ?? null,
  baseCurrency: row.baseCurrency ?? row.base_currency ?? null,
  quoteCurrency: row.quoteCurrency ?? row.quote_currency ?? null,
  provider: row.provider ?? null,
  oldRate: row.oldRate != null ? Number(row.oldRate) : null,
  newRate: row.newRate != null ? Number(row.newRate) : null,
  changedAt: row.changedAt ?? row.changed_at ?? null,
  createdAt: row.createdAt ?? row.created_at ?? null,
  updatedAt: row.updatedAt ?? row.updated_at ?? null,
});

export const adminListFxRates = async (_req, res) => {
  try {
    const rows = await models.FxRate.findAll({
      order: [
        ["baseCurrency", "ASC"],
        ["quoteCurrency", "ASC"],
        ["provider", "ASC"],
        ["fetchedAt", "DESC"],
      ],
      limit: 5000,
    });

    const latestMap = new Map();
    for (const row of rows) {
      const base = row.baseCurrency ?? row.base_currency;
      const quote = row.quoteCurrency ?? row.quote_currency;
      const provider = row.provider;
      const key = `${base}|${quote}|${provider}`;
      if (!latestMap.has(key)) latestMap.set(key, row);
    }

    return res.json({
      rates: Array.from(latestMap.values()).map(serializeFxRate),
    });
  } catch (error) {
    console.error("[admin.fx-rates] list error", error);
    return res.status(500).json({ error: "Failed to load fx rates" });
  }
};

export const adminUpdateFxRate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid fx rate id" });
    }

    const row = await models.FxRate.findByPk(id);
    if (!row) return res.status(404).json({ error: "FX rate not found" });

    const oldRate = Number(row.rate);
    const payload = {};
    if (req.body?.baseCurrency !== undefined) {
      const code = normalizeCode(req.body.baseCurrency);
      if (!code) return res.status(400).json({ error: "Invalid baseCurrency" });
      payload.baseCurrency = code;
    }
    if (req.body?.quoteCurrency !== undefined) {
      const code = normalizeCode(req.body.quoteCurrency);
      if (!code) return res.status(400).json({ error: "Invalid quoteCurrency" });
      payload.quoteCurrency = code;
    }
    if (req.body?.rate !== undefined) {
      const value = Number(req.body.rate);
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ error: "Invalid rate" });
      }
      payload.rate = value;
    }
    if (req.body?.provider !== undefined) {
      const provider = normalizeProvider(req.body.provider);
      if (!provider) return res.status(400).json({ error: "Invalid provider" });
      payload.provider = provider;
    }
    if (req.body?.enabled !== undefined) payload.enabled = Boolean(req.body.enabled);
    if (req.body?.rateDate !== undefined) payload.rateDate = req.body.rateDate || null;
    if (req.body?.fetchedAt !== undefined) {
      payload.fetchedAt = req.body.fetchedAt ? new Date(req.body.fetchedAt) : row.fetchedAt;
    }
    if (req.body?.expiresAt !== undefined) payload.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;

    await row.update(payload);

    const newRate = Number(row.rate);
    if (Number.isFinite(oldRate) && Number.isFinite(newRate) && !ratesAreEqual(oldRate, newRate)) {
      await createFxRateChangeLogs({
        source: "edit",
        triggeredBy: req.user?.id || null,
        changedAt: new Date(),
        changes: [
          {
            baseCurrency: row.baseCurrency,
            quoteCurrency: row.quoteCurrency,
            provider: row.provider,
            oldRate,
            newRate,
          },
        ],
      });
    }

    return res.json({ rate: serializeFxRate(row) });
  } catch (error) {
    console.error("[admin.fx-rates] update error", error);
    return res.status(500).json({ error: "Failed to update fx rate" });
  }
};

export const adminListFxRateChanges = async (req, res) => {
  try {
    const limitRaw = Number(req.query?.limit ?? 10);
    const pageRaw = Number(req.query?.page ?? 1);
    const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 10));
    const page = Math.max(1, Number.isFinite(pageRaw) ? Math.trunc(pageRaw) : 1);
    const offset = (page - 1) * limit;

    const totalRows = await sequelize.query(
      "SELECT COUNT(DISTINCT batch_id) AS total FROM fx_rate_change_logs",
      { type: QueryTypes.SELECT }
    );
    const total = Number(totalRows?.[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(Number(total || 0) / limit));

    const batches = await sequelize.query(
      `
      SELECT
        batch_id AS batchId,
        MAX(changed_at) AS lastChangedAt,
        MAX(source) AS source,
        MAX(triggered_by) AS triggeredBy,
        COUNT(*) AS changesCount
      FROM fx_rate_change_logs
      GROUP BY batch_id
      ORDER BY lastChangedAt DESC
      LIMIT :limit OFFSET :offset
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { limit, offset },
      }
    );

    const batchIds = batches
      .map((row) => String(pickRaw(row, "batchId", "batchid", "batch_id") || ""))
      .filter(Boolean);

    let items = [];
    if (batchIds.length) {
      items = await models.FxRateChangeLog.findAll({
        where: { batchId: { [Op.in]: batchIds } },
        order: [
          ["changedAt", "DESC"],
          ["id", "DESC"],
        ],
      });
    }

    const itemMap = new Map();
    for (const item of items) {
      const key = String(item.batchId || "");
      if (!itemMap.has(key)) itemMap.set(key, []);
      itemMap.get(key).push(serializeFxRateChange(item));
    }

    const runs = batches.map((row) => ({
      batchId: pickRaw(row, "batchId", "batchid", "batch_id"),
      source: normalizeSource(pickRaw(row, "source")),
      triggeredBy: pickRaw(row, "triggeredBy", "triggeredby", "triggered_by"),
      changedAt: pickRaw(row, "lastChangedAt", "lastchangedat", "last_changed_at"),
      changesCount: Number(pickRaw(row, "changesCount", "changescount", "changes_count") || 0),
      changes:
        itemMap.get(
          String(pickRaw(row, "batchId", "batchid", "batch_id") || "")
        ) || [],
    }));

    return res.json({
      runs,
      pagination: {
        page,
        limit,
        total: Number(total || 0),
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    });
  } catch (error) {
    const message = String(error?.message || "");
    const code = String(error?.original?.code || error?.parent?.code || "");
    if (code === "ER_NO_SUCH_TABLE" || message.toLowerCase().includes("doesn't exist")) {
      return res.json({
        runs: [],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 1,
          hasPrev: false,
          hasNext: false,
        },
      });
    }
    console.error("[admin.fx-rates] list changes error", error);
    return res.status(500).json({ error: "Failed to load fx rate changes" });
  }
};
