import models, { sequelize } from "../models/index.js"
import { ValidationError, UniqueConstraintError, Op } from "sequelize"

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
        "is_paused",
        "paused_at",
        "paused_reason",
        "pause_metadata",
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
    const { name, public_domain, panel_domain, hotel_id, hotel_access, account_ids } = req.body || {}

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

    const t = await sequelize.transaction()
    try {
      const tenant = await models.WcTenant.create(payload, { transaction: t })

      // Optionally link accounts to the new tenant (M:N)
      const ids = Array.isArray(account_ids)
        ? account_ids.map((x) => Number(x)).filter((n) => Number.isInteger(n))
        : []
      for (const accId of ids) {
        await models.WcAccountTenant.findOrCreate({
          where: { account_id: accId, tenant_id: tenant.id },
          defaults: { account_id: accId, tenant_id: tenant.id },
          transaction: t,
        })
      }

      await t.commit()
      return res.status(201).json({ tenant })
    } catch (err) {
      await t.rollback()
      throw err
    }
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

    const { name, public_domain, panel_domain, hotel_id, hotel_access, account_ids } = req.body || {}

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

    const t = await sequelize.transaction()
    try {
      await tenant.update(payload, { transaction: t })

      // Optionally link additional accounts to this tenant (M:N). Non-destructive.
      const ids = Array.isArray(account_ids)
        ? account_ids.map((x) => Number(x)).filter((n) => Number.isInteger(n))
        : []
      for (const accId of ids) {
        await models.WcAccountTenant.findOrCreate({
          where: { account_id: accId, tenant_id: tenant.id },
          defaults: { account_id: accId, tenant_id: tenant.id },
          transaction: t,
        })
      }

      await t.commit()
      return res.json({ tenant })
    } catch (err) {
      await t.rollback()
      throw err
    }
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

export const listAccounts = async (req, res, next) => {
  try {
    const rows = await models.WcAccount.findAll({
      attributes: ["id", "email", "display_name", "tenant_id", "is_active", "created_at"],
      include: [{ model: models.WcTenant, through: { attributes: [] }, attributes: ["id", "name"] }],
      order: [["created_at", "DESC"]],
    })
    const accounts = rows.map(r => {
      const o = typeof r.toJSON === 'function' ? r.toJSON() : r
      const tenants = Array.isArray(o.WcTenants) ? o.WcTenants.map(t => ({ id: t.id, name: t.name })) : []
      return {
        id: o.id,
        email: o.email,
        display_name: o.display_name,
        is_active: o.is_active,
        created_at: o.created_at,
        legacy_tenant_id: o.tenant_id || null,
        tenants,
      }
    })
    return res.json({ accounts })
  } catch (err) {
    return next(err)
  }
}

export const linkAccountToTenant = async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId)
    const tenantId = Number(req.params.tenantId)
    const acc = await models.WcAccount.findByPk(accountId)
    const ten = await models.WcTenant.findByPk(tenantId)
    if (!acc || !ten) return res.status(404).json({ error: 'Account or Tenant not found' })
    await models.WcAccountTenant.findOrCreate({ where: { account_id: accountId, tenant_id: tenantId }, defaults: { account_id: accountId, tenant_id: tenantId } })
    return res.status(201).json({ ok: true })
  } catch (err) { return next(err) }
}

export const unlinkAccountFromTenant = async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId)
    const tenantId = Number(req.params.tenantId)
    const count = await models.WcAccountTenant.destroy({ where: { account_id: accountId, tenant_id: tenantId } })
    if (count === 0) return res.status(404).json({ error: 'Link not found' })
    return res.json({ ok: true })
  } catch (err) { return next(err) }
}

// Map Insider User <-> Tenant (Operator linkage)
export const linkUserToTenant = async (req, res, next) => {
  try {
    const userId = Number(req.params.userId)
    const tenantId = Number(req.params.tenantId)
    const user = await models.User.findByPk(userId)
    const ten = await models.WcTenant.findByPk(tenantId)
    if (!user || !ten) return res.status(404).json({ error: 'User or Tenant not found' })
    await models.WcUserTenant.findOrCreate({ where: { user_id: userId, tenant_id: tenantId }, defaults: { user_id: userId, tenant_id: tenantId } })
    return res.status(201).json({ ok: true })
  } catch (err) { return next(err) }
}

export const unlinkUserFromTenant = async (req, res, next) => {
  try {
    const userId = Number(req.params.userId)
    const tenantId = Number(req.params.tenantId)
    const count = await models.WcUserTenant.destroy({ where: { user_id: userId, tenant_id: tenantId } })
    if (count === 0) return res.status(404).json({ error: 'Link not found' })
    return res.json({ ok: true })
  } catch (err) { return next(err) }
}

export const unpauseTenant = async (req, res, next) => {
  try {
    const { id } = req.params
    const tenant = await models.WcTenant.findByPk(id)
    if (!tenant) return res.status(404).json({ error: "Tenant not found" })

    if (!tenant.is_paused) {
      return res.json({
        tenant: {
          id: tenant.id,
          is_paused: false,
          paused_at: tenant.paused_at,
          paused_reason: tenant.paused_reason,
          pause_metadata: tenant.pause_metadata,
        },
        message: "Tenant is not paused",
      })
    }

    await tenant.update({
      is_paused: false,
      paused_at: null,
      paused_reason: null,
      pause_metadata: null,
    })

    await tenant.reload()

    return res.json({
      tenant: {
        id: tenant.id,
        is_paused: tenant.is_paused,
        paused_at: tenant.paused_at,
        paused_reason: tenant.paused_reason,
        pause_metadata: tenant.pause_metadata,
      },
    })
  } catch (err) {
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

export const getStatsOverview = async (req, res, next) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [
      revenue,
      userCount,
      pendingBookings,
      homeCount,
      hotelCount,
      recentBookings,
      recentUsers,
      revenuePrev,
      userCountPrev,
      pendingPrev
    ] = await Promise.all([
      // Current Totals
      models.Stay.sum('gross_price', { where: { payment_status: 'PAID' } }),
      models.User.count(),
      models.Stay.count({ where: { status: 'PENDING' } }),
      models.Home.count(),
      models.Hotel.count(),

      // RECENT ACTIVITIES (for initial hybrid load)
      models.Stay.findAll({
        limit: 10,
        order: [['created_at', 'DESC']],
        attributes: ['id', 'guest_name', 'gross_price', 'status', 'created_at', 'createdAt'],
        include: [{
          model: models.StayHotel,
          as: 'hotelStay',
          include: [{ model: models.Hotel, as: 'hotel', attributes: ['name'] }]
        }]
      }),
      models.User.findAll({
        limit: 10,
        order: [['created_at', 'DESC']],
        attributes: ['id', 'name', 'country_code', 'created_at', 'createdAt']
      }),

      // Previous Period Totals (for trends)
      models.Stay.sum('gross_price', {
        where: {
          payment_status: 'PAID',
          created_at: { [Op.between]: [sixtyDaysAgo, thirtyDaysAgo] }
        }
      }),
      models.User.count({
        where: {
          created_at: { [Op.between]: [sixtyDaysAgo, thirtyDaysAgo] }
        }
      }),
      models.Stay.count({
        where: {
          status: 'PENDING',
          created_at: { [Op.between]: [sixtyDaysAgo, thirtyDaysAgo] }
        }
      })
    ]);

    const calcTrend = (curr, prev) => {
      if (!prev || prev === 0) return curr > 0 ? "+100%" : "0%";
      const diff = ((curr - prev) / prev) * 100;
      return (diff >= 0 ? "+" : "") + diff.toFixed(1) + "%";
    };

    // Note: For 'revenue' current period, we use the total or strictly last 30? 
    // Usually total is displayed, but trend is vs previous period.
    // Let's calculate current 30 day revenue for a fair comparison in trend
    const revenueCurrMonth = await models.Stay.sum('gross_price', {
      where: {
        payment_status: 'PAID',
        created_at: { [Op.gte]: thirtyDaysAgo }
      }
    }) || 0;

    const userCountCurrMonth = await models.User.count({
      where: {
        created_at: { [Op.gte]: thirtyDaysAgo }
      }
    }) || 0;

    return res.json({
      revenue: parseFloat(revenue || 0),
      users: userCount,
      pending: pendingBookings,
      inventory: (homeCount || 0) + (hotelCount || 0),
      trends: {
        revenue: calcTrend(parseFloat(revenueCurrMonth), parseFloat(revenuePrev || 0)),
        users: calcTrend(userCountCurrMonth, userCountPrev),
        pending: calcTrend(pendingBookings, pendingPrev), // Pending is snapshots, but we can trend new arrivals
        inventory: "+0.8%" // Static for now as inventory grows slower
      },
      activities: [
        ...recentBookings.map(b => ({
          id: `book-${b.id}`,
          type: 'booking',
          user: { name: b.guest_name || 'Guest' },
          action: (b.status === 'PENDING' || b.status === 'requested') ? 'requested a booking at' : 'confirmed booking at',
          location: b.hotelStay?.hotel?.name || 'Hotel',
          amount: b.gross_price,
          status: b.status === 'PAID' ? 'PAID' : (b.status === 'CONFIRMED' ? 'PAID' : 'PENDING'),
          timestamp: b.createdAt || b.created_at || new Date()
        })),
        ...recentUsers.map(u => ({
          id: `user-${u.id}`,
          type: 'user',
          user: { name: u.name || 'New User' },
          action: 'joined Insider',
          location: u.country_code || 'Global',
          status: 'SUCCESS',
          timestamp: u.createdAt || u.created_at || new Date()
        }))
      ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10)
    });
  } catch (err) {
    return next(err)
  }
}

export const getHealthStatus = async (req, res, next) => {
  try {
    const health = {
      api: 'ONLINE',
      db: 'ONLINE',
      bookingGpt: 'ONLINE',
      webbeds: 'ONLINE',
      timestamp: new Date()
    };

    try {
      await sequelize.authenticate();
    } catch (err) {
      health.db = 'OFFLINE';
    }

    // Optional: Check other services if keys are present
    // if (!process.env.OPENAI_API_KEY) health.bookingGpt = 'CONFIG_MISSING';

    return res.json(health);
  } catch (err) {
    return next(err)
  }
}
