// src/controllers/vcc.controller.js
import models from '../models/index.js'
import { Op } from 'sequelize'

function assertTenantScope(req) {
  if (!req.tenant?.id) {
    const err = new Error('Tenant not resolved')
    err.status = 400
    throw err
  }
}

export async function getQueueCount(req, res) {
  try {
    assertTenantScope(req)
    const tenantId = req.tenant.id
    const pending = await models.WcVCard.count({ where: { tenant_id: tenantId, status: 'pending' } })
    const locked = await models.WcVCard.count({ where: { tenant_id: tenantId, status: 'claimed' } })
    const awaitingApproval = await models.WcVCard.count({ where: { tenant_id: tenantId, status: 'delivered' } })
    res.json({ pending, locked, awaitingApproval })
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Server error' })
  }
}

export async function claimNext(req, res) {
  try {
    assertTenantScope(req)
    const tenantId = req.tenant.id
    const accountId = req.user?.accountId
    if (!accountId) return res.status(403).json({ error: 'Forbidden' })

    // Bloquear si ya tiene una activa
    const existing = await models.WcVCard.findOne({
      where: {
        tenant_id: tenantId,
        claimed_by_account_id: accountId,
        status: { [Op.in]: ['claimed', 'delivered'] },
      },
      order: [['createdAt', 'ASC']],
      paranoid: true,
    })
    if (existing) return res.status(409).json({ error: 'You already have an active card' })

    // Transacción desde la instancia del modelo (fix principal)
    const sequelize = models.WcVCard.sequelize
    const t = await sequelize.transaction()
    try {
      // Tomar la más vieja pendiente con FOR UPDATE SKIP LOCKED
      const next = await models.WcVCard.findOne({
        where: { tenant_id: tenantId, status: 'pending' },
        order: [['createdAt', 'ASC']],
        transaction: t,
        lock: t.LOCK.UPDATE,
        skipLocked: true, // Postgres/MySQL 8+: evita colisiones entre operadores
      })

      if (!next) {
        await t.rollback()
        return res.status(404).json({ error: 'No cards pending' })
      }

      await next.update(
        { status: 'claimed', claimed_by_account_id: accountId, claimed_at: new Date() },
        { transaction: t }
      )
      await t.commit()
      // Return sanitized (no PAN/CVV)
      const safe = next.toJSON()
      delete safe.card_number
      delete safe.card_cvv
      return res.json(safe)
    } catch (e) {
      await t.rollback()
      throw e
    }
  } catch (e) {
    console.error('claimNext error', e)
    res.status(500).json({ error: 'Server error' })
  }
}

export async function markDelivered(req, res) {
  try {
    assertTenantScope(req)
    const tenantId = req.tenant.id
    const accountId = req.user?.accountId
    const id = Number(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid id' })
    const card = await models.WcVCard.findByPk(id)
    if (!card || card.tenant_id !== tenantId) return res.status(404).json({ error: 'Not found' })
    if (card.claimed_by_account_id !== accountId) return res.status(403).json({ error: 'Not your card' })
    if (card.status !== 'claimed') return res.status(409).json({ error: 'Invalid state' })
    await card.update({ status: 'delivered', delivered_at: new Date(), delivered_by_account_id: accountId })
    res.json({ ok: true })
  } catch (e) {
    console.error('markDelivered error', e)
    res.status(500).json({ error: 'Server error' })
  }
}

export async function getActiveForOperator(req, res) {
  try {
    assertTenantScope(req)
    const tenantId = req.tenant.id
    const accountId = req.user?.accountId
    if (!accountId) return res.status(403).json({ error: 'Forbidden' })
    const card = await models.WcVCard.findOne({
      where: {
        tenant_id: tenantId,
        claimed_by_account_id: accountId,
        status: { [Op.in]: ['claimed', 'delivered'] },
      },
      order: [['createdAt', 'ASC']],
      attributes: { exclude: ['card_number','card_cvv'] },
    })
    if (!card) return res.status(404).json({ error: 'No active card' })
    res.json(card)
  } catch (e) {
    console.error('getActiveForOperator error', e)
    res.status(500).json({ error: 'Server error' })
  }
}

export async function adminListCards(req, res) {
  try {
    const { status, tenantId } = req.query
    const where = {}
    if (status) where.status = String(status)
    if (tenantId) where.tenant_id = Number(tenantId)
    const items = await models.WcVCard.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 500,
      attributes: { exclude: ['card_number','card_cvv'] },
    })
    res.json({ items })
  } catch (e) {
    console.error('adminListCards error', e)
    res.status(500).json({ error: 'Server error' })
  }
}

// Admin APIs
export async function adminCreateCards(req, res) {
  try {
    const payload = req.body
    const items = Array.isArray(payload) ? payload : [payload]
    if (items.length === 0) return res.status(400).json({ error: 'No items' })

    const created = []
    for (const it of items) {
      const tenantId = Number(it.tenantId || it.tenant_id)
      if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

      // Normalización y validación de expiración
      let exp_month = Number(it.exp_month ?? it.month)
      let exp_year = Number(it.exp_year ?? it.year)
      if (Number.isNaN(exp_month) || Number.isNaN(exp_year)) {
        return res.status(400).json({ error: 'exp_month/exp_year inválidos' })
      }
      if (exp_year < 100) exp_year = 2000 + exp_year // 28 -> 2028
      if (exp_month < 1 || exp_month > 12) {
        return res.status(400).json({ error: 'exp_month inválido (1-12)' })
      }
      if (exp_year < 2000) {
        return res.status(400).json({ error: 'exp_year inválido (>= 2000)' })
      }

      const data = {
        tenant_id: tenantId,
        card_number: String(it.card_number ?? it.number ?? '').replace(/\s|-/g, ''),
        card_cvv: String(it.card_cvv ?? it.cvv ?? ''),
        exp_month,
        exp_year,
        holder_name: it.holder_name ?? it.name ?? null,
        amount: it.amount ?? null,
        currency: it.currency ? String(it.currency).slice(0, 3).toUpperCase() : null,
        status: 'pending',
        metadata: it.metadata || {},
      }

      const rec = await models.WcVCard.create(data)
      created.push(rec)
    }
    res.status(201).json({ count: created.length, items: created })
  } catch (e) {
    console.error('adminCreateCards error', e)
    res.status(500).json({ error: 'Server error' })
  }
}

export async function adminApprove(req, res) {
  try {
    const id = Number(req.params.id)
    const approve = String(req.query.action || 'approve') === 'approve'
    const card = await models.WcVCard.findByPk(id)
    if (!card) return res.status(404).json({ error: 'Not found' })
    if (card.status !== 'delivered') return res.status(409).json({ error: 'Invalid state' })
    const patch = approve
      ? { status: 'approved', approved_at: new Date(), approved_by_account_id: req.user?.id || null }
      : { status: 'rejected' }
    await card.update(patch)
    res.json({ ok: true, status: card.status })
  } catch (e) {
    console.error('adminApprove error', e)
    res.status(500).json({ error: 'Server error' })
  }
}

// Reveal PAN/CVV only for the operator who claimed the card and while in 'claimed'
export async function revealCard(req, res) {
  try {
    assertTenantScope(req)
    const tenantId = req.tenant.id
    const accountId = req.user?.accountId
    const id = Number(req.params.id)
    if (!accountId) return res.status(403).json({ error: 'Forbidden' })
    if (!id) return res.status(400).json({ error: 'Invalid id' })

    const card = await models.WcVCard.findByPk(id, { paranoid: true })
    if (!card || card.tenant_id !== tenantId) return res.status(404).json({ error: 'Not found' })
    if (card.claimed_by_account_id !== accountId) return res.status(403).json({ error: 'Not your card' })
    if (card.status !== 'claimed') return res.status(409).json({ error: 'Invalid state' })

    res.set('Cache-Control', 'no-store')
    res.set('Pragma', 'no-cache')
    res.set('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'")

    return res.json({
      id: card.id,
      pan: card.card_number,
      cvv: card.card_cvv,
      exp_month: card.exp_month,
      exp_year: card.exp_year,
      holder_name: card.holder_name,
      amount: card.amount,
      currency: card.currency,
    })
  } catch (e) {
    console.error('revealCard error', e)
    res.status(500).json({ error: 'Server error' })
  }
}
