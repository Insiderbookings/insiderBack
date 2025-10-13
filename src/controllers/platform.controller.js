import models from "../models/index.js";
import { PLATFORM_STATUS } from "../constants/platforms.js";
import { getTenantPlatformSnapshot } from "../services/platform.service.js";

export const adminListPlatforms = async (req, res, next) => {
  try {
    const rows = await models.Platform.findAll({
      order: [["requiresFaceVerification", "DESC"], ["name", "ASC"]],
      attributes: ["id", "name", "slug", "requiresFaceVerification", "description", "created_at", "updated_at"],
    });
    const platforms = rows.map((row) => {
      const data = typeof row.toJSON === "function" ? row.toJSON() : row;
      return {
        id: data.id,
        name: data.name,
        slug: data.slug,
        requiresFaceVerification: Boolean(data.requiresFaceVerification),
        description: data.description || "",
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    });
    return res.json({ platforms, statuses: PLATFORM_STATUS });
  } catch (err) {
    return next(err);
  }
};

export const adminGetTenantPlatforms = async (req, res, next) => {
  try {
    const tenantId = Number(req.params.id);
    if (!tenantId) return res.status(400).json({ error: "tenantId requerido" });

    const tenant = await models.WcTenant.findByPk(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant no encontrado" });

    const snapshot = await getTenantPlatformSnapshot(tenantId);
    return res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        panelDomain: tenant.panel_domain,
        publicDomain: tenant.public_domain,
      },
      platforms: snapshot,
      statuses: PLATFORM_STATUS,
    });
  } catch (err) {
    return next(err);
  }
};

export const adminUpsertTenantPlatform = async (req, res, next) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const platformId = Number(req.params.platformId);
    if (!tenantId || !platformId) {
      return res.status(400).json({ error: "tenantId y platformId requeridos" });
    }

    const tenant = await models.WcTenant.findByPk(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant no encontrado" });

    const platform = await models.Platform.findByPk(platformId);
    if (!platform) return res.status(404).json({ error: "Plataforma no encontrada" });

    const { status, username, password } = req.body || {};
    const trimmedStatus = typeof status === "string" ? status.trim() : status;
    const trimmedUsername = typeof username === "string" ? username.trim() : username;
    const trimmedPassword = typeof password === "string" ? password.trim() : password;

    const updates = {};
    if (trimmedStatus !== undefined) {
      if (typeof trimmedStatus !== "string" || !trimmedStatus) {
        return res.status(400).json({ error: "Estado requerido" });
      }
      if (!PLATFORM_STATUS.includes(trimmedStatus)) {
        return res.status(400).json({ error: "Estado inválido" });
      }
      updates.status = trimmedStatus;
    }

    if (platform.requiresFaceVerification) {
      if (trimmedUsername !== undefined) {
        updates.username = typeof trimmedUsername === "string" ? trimmedUsername : "";
      }
      if (trimmedPassword !== undefined) {
        updates.password = typeof trimmedPassword === "string" ? trimmedPassword : "";
      }
    } else {
      updates.username = null;
      updates.password = null;
    }

    const defaults = {
      tenant_id: tenantId,
      platform_id: platformId,
      status: updates.status || PLATFORM_STATUS[0],
      username: platform.requiresFaceVerification
        ? (updates.username !== undefined ? updates.username : "")
        : null,
      password: platform.requiresFaceVerification
        ? (updates.password !== undefined ? updates.password : "")
        : null,
    };

    const [link, created] = await models.WcTenantPlatform.findOrCreate({
      where: { tenant_id: tenantId, platform_id: platformId },
      defaults,
    });

    const updatePayload = {};
    if (!created) {
      if (updates.status !== undefined) updatePayload.status = updates.status;
      if (updates.username !== undefined) updatePayload.username = updates.username;
      if (updates.password !== undefined) updatePayload.password = updates.password;
      if (!platform.requiresFaceVerification) {
        updatePayload.username = null;
        updatePayload.password = null;
      }
      if (Object.keys(updatePayload).length > 0) {
        await link.update(updatePayload);
      }
    }

    const snapshot = await getTenantPlatformSnapshot(tenantId);
    return res.json({
      ok: true,
      platforms: snapshot,
    });
  } catch (err) {
    return next(err);
  }
};

export const operatorGetTenantPlatforms = async (req, res, next) => {
  try {
    const tenantId = Number(req.tenant?.id);
    if (!tenantId) return res.status(400).json({ error: "Tenant requerido" });

    const data = await getTenantPlatformSnapshot(tenantId);
    const filtered = data.map((entry) => ({
      id: entry.id,
      name: entry.name,
      slug: entry.slug,
      requiresFaceVerification: entry.requiresFaceVerification,
      status: entry.status,
      username: entry.requiresFaceVerification ? entry.username : "",
      password: entry.requiresFaceVerification ? entry.password : "",
      updatedAt: entry.updatedAt,
      description: entry.description || "",
    }));

    return res.json({ platforms: filtered, statuses: PLATFORM_STATUS });
  } catch (err) {
    return next(err);
  }
};
