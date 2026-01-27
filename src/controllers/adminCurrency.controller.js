import models from "../models/index.js";
import { ensureDefaultCurrencySettings, invalidateCurrencySettingsCache } from "../services/currencySettings.service.js";

const normalizeCurrencyCode = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  return raw.slice(0, 3);
};

export const adminListCurrencies = async (req, res) => {
  try {
    const currencies = await models.CurrencySetting.findAll({
      order: [["sortOrder", "ASC"], ["code", "ASC"]],
    });
    return res.json({
      currencies: currencies.map((row) => ({
        code: row.code,
        name: row.name,
        symbol: row.symbol,
        enabled: Boolean(row.enabled),
        sortOrder: Number(row.sortOrder || 0),
        updatedBy: row.updatedBy ?? row.updated_by ?? null,
        updatedAt: row.updated_at ?? row.updatedAt ?? null,
        createdAt: row.created_at ?? row.createdAt ?? null,
      })),
    });
  } catch (error) {
    console.error("[admin] currencies list error", error);
    return res.status(500).json({ error: "Failed to load currencies" });
  }
};

export const adminSeedCurrencies = async (req, res) => {
  try {
    await ensureDefaultCurrencySettings();
    await invalidateCurrencySettingsCache();
    return adminListCurrencies(req, res);
  } catch (error) {
    console.error("[admin] currencies seed error", error);
    return res.status(500).json({ error: "Failed to seed currencies" });
  }
};

export const adminUpdateCurrency = async (req, res) => {
  try {
    const code = normalizeCurrencyCode(req.params.code);
    if (!code) {
      return res.status(400).json({ error: "Currency code is required" });
    }

    const payload = {};
    if (req.body?.name !== undefined) payload.name = String(req.body.name || "").trim() || null;
    if (req.body?.symbol !== undefined) payload.symbol = String(req.body.symbol || "").trim() || null;
    if (req.body?.enabled !== undefined) payload.enabled = Boolean(req.body.enabled);
    if (req.body?.sortOrder !== undefined) {
      const nextOrder = Number(req.body.sortOrder);
      if (Number.isFinite(nextOrder)) payload.sortOrder = Math.trunc(nextOrder);
    }
    payload.updatedBy = req.user?.id || null;

    const [count] = await models.CurrencySetting.update(payload, {
      where: { code },
    });

    if (!count) {
      return res.status(404).json({ error: "Currency not found" });
    }

    await invalidateCurrencySettingsCache();

    const updated = await models.CurrencySetting.findByPk(code);
    return res.json({
      currency: updated
        ? {
            code: updated.code,
            name: updated.name,
            symbol: updated.symbol,
            enabled: Boolean(updated.enabled),
            sortOrder: Number(updated.sortOrder || 0),
            updatedBy: updated.updatedBy ?? updated.updated_by ?? null,
            updatedAt: updated.updated_at ?? updated.updatedAt ?? null,
            createdAt: updated.created_at ?? updated.createdAt ?? null,
          }
        : null,
    });
  } catch (error) {
    console.error("[admin] currencies update error", error);
    return res.status(500).json({ error: "Failed to update currency" });
  }
};
