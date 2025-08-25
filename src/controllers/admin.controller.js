import models from "../models/index.js"
import { ValidationError, UniqueConstraintError } from "sequelize"

const domainRe = /^[a-z0-9.-]+\.[a-z]{2,}$/i

export const listTenants = async (req, res, next) => {
  try {
    const tenants = await models.WcTenant.findAll({
      order: [["created_at", "DESC"]],
      attributes: [
        "id",
        "name",
        "public_domain",
        "panel_domain",
        "hotel_id",
        "hotel_access",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      // paranoid true por defecto: excluye soft-deleted
    })
    return res.json({ tenants })
  } catch (err) {
    return next(err)
  }
}

export const createTenant = async (req, res, next) => {
  try {
    const { name, public_domain, panel_domain, hotel_id, hotel_access } = req.body || {}

    if (!name?.trim()) return res.status(400).json({ error: "name es requerido" })
    if (!public_domain?.trim()) return res.status(400).json({ error: "public_domain es requerido" })
    if (!panel_domain?.trim()) return res.status(400).json({ error: "panel_domain es requerido" })
    if (!domainRe.test(public_domain)) return res.status(400).json({ error: "public_domain inválido" })
    if (!domainRe.test(panel_domain)) return res.status(400).json({ error: "panel_domain inválido" })

    const payload = {
      name: name.trim(),
      public_domain: public_domain.trim().toLowerCase(),
      panel_domain: panel_domain.trim().toLowerCase(),
      hotel_id: hotel_id ?? null,
      hotel_access: hotel_access ?? null,
    }

    const tenant = await models.WcTenant.create(payload)
    return res.status(201).json({ tenant })
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      const conflicts = (err.errors || []).map((e) => e.path)
      return res.status(409).json({ error: "Dominios ya utilizados", conflicts })
    }
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message })
    }
    return next(err)
  }
}

export const updateTenant = async (req, res, next) => {
  try {
    const { id } = req.params
    const tenant = await models.WcTenant.findByPk(id)
    if (!tenant) return res.status(404).json({ error: "Tenant no encontrado" })

    const { name, public_domain, panel_domain, hotel_id, hotel_access } = req.body || {}

    if (!name?.trim()) return res.status(400).json({ error: "name es requerido" })
    if (!public_domain?.trim()) return res.status(400).json({ error: "public_domain es requerido" })
    if (!panel_domain?.trim()) return res.status(400).json({ error: "panel_domain es requerido" })
    if (!domainRe.test(public_domain)) return res.status(400).json({ error: "public_domain inválido" })
    if (!domainRe.test(panel_domain)) return res.status(400).json({ error: "panel_domain inválido" })

    const payload = {
      name: name.trim(),
      public_domain: public_domain.trim().toLowerCase(),
      panel_domain: panel_domain.trim().toLowerCase(),
      hotel_id: hotel_id ?? null,
      hotel_access: hotel_access ?? null,
    }

    await tenant.update(payload)
    return res.json({ tenant })
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      const conflicts = (err.errors || []).map((e) => e.path)
      return res.status(409).json({ error: "Dominios ya utilizados", conflicts })
    }
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message })
    }
    return next(err)
  }
}

export const deleteTenant = async (req, res, next) => {
  try {
    const { id } = req.params
    // Soft delete por paranoid:true. Para hard delete, usa ?force=true
    const force = req.query.force === "true"
    const count = await models.WcTenant.destroy({ where: { id }, force })
    if (count === 0) return res.status(404).json({ error: "Tenant no encontrado" })
    return res.status(204).send()
  } catch (err) {
    return next(err)
  }
}
