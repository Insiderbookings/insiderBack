// src/controllers/vcc.controller.js
import models from '../models/index.js'
import { Op } from 'sequelize'
import Stripe from 'stripe'

const stripeKey = process.env.STRIPE_SECRET_KEY
const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: '2022-11-15' }) : null

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

    // Transacción desde la instancia del modelo
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
    const { status, tenantId, approvedBy } = req.query
    const where = {}
    if (status) {
      const list = String(status)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      if (list.length > 1) where.status = { [Op.in]: list }
      else where.status = list[0]
    }
    if (tenantId) where.tenant_id = Number(tenantId)
    if (approvedBy) {
      if (approvedBy === 'me') where.approved_by_account_id = req.user?.id || null
      else if (!Number.isNaN(Number(approvedBy))) where.approved_by_account_id = Number(approvedBy)
    }
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

// Operator: history for current account within tenant
export async function getHistoryForOperator(req, res) {
  try {
    const tenantId = req.tenant?.id
    const accountId = req.user?.accountId
    if (!tenantId || !accountId) return res.status(403).json({ error: 'Forbidden' })
    const { status } = req.query
    const where = {
      tenant_id: tenantId,
      [Op.or]: [
        { claimed_by_account_id: accountId },
        { delivered_by_account_id: accountId },
      ],
    }
    if (status) {
      const list = String(status).split(',').map(s => s.trim()).filter(Boolean)
      if (list.length > 1) where.status = { [Op.in]: list }
      else where.status = list[0]
    }
    const items = await models.WcVCard.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 500,
      attributes: { exclude: ['card_number','card_cvv'] },
    })
    res.json({ items })
  } catch (e) {
    console.error('getHistoryForOperator error', e)
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
        return res.status(400).json({ error: 'Invalid exp_month/exp_year' })
      }
      if (exp_year < 100) exp_year = 2000 + exp_year // 28 -> 2028
      if (exp_month < 1 || exp_month > 12) {
        return res.status(400).json({ error: 'Invalid exp_month (1-12)' })
      }
      if (exp_year < 2000) {
        return res.status(400).json({ error: 'Invalid exp_year (>= 2000)' })
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
    // Enforce payment confirmation before approval
    if (approve) {
      const meta = card?.metadata || {}
      const paid = meta?.payment?.confirmed === true
      if (!paid) {
        return res.status(409).json({ error: 'Payment not confirmed yet' })
      }
    }
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

// Mark payment received for a delivered card (metadata only)
export async function adminMarkPaid(req, res) {
  try {
    const id = Number(req.params.id)
    const card = await models.WcVCard.findByPk(id)
    if (!card) return res.status(404).json({ error: 'Not found' })
    if (!['delivered', 'approved'].includes(card.status)) {
      return res.status(409).json({ error: 'Invalid state' })
    }

    const body = req.body || {}
    const prevMeta = (card.metadata && typeof card.metadata === 'object') ? card.metadata : {}
    const prevPay = (prevMeta.payment && typeof prevMeta.payment === 'object') ? prevMeta.payment : {}

    // amount: si vino en body, coerciona; si no, usa previo o el amount de la card
    let amount = body.amount !== undefined ? Number(body.amount) : (prevPay.amount ?? card.amount ?? null)
    if (body.amount !== undefined && Number.isNaN(amount)) {
      return res.status(400).json({ error: 'amount must be a number' })
    }

    // currency normalizada a 3 letras
    const rawCurrency = body.currency ?? prevPay.currency ?? card.currency ?? null
    const currency = rawCurrency
      ? String(rawCurrency).slice(0, 3).toUpperCase()
      : null

    const payment = {
      confirmed: true,
      at: new Date().toISOString(),
      method: body.method ?? prevPay.method ?? null,
      reference: body.reference ?? prevPay.reference ?? null,
      amount: amount,
      currency: currency,
      noted_by: req.user?.id ?? null,
    }

    const metadata = { ...prevMeta, payment }

    await card.update({ metadata })
    res.json({ ok: true, payment })
  } catch (e) {
    console.error('adminMarkPaid error', e)
    res.status(500).json({ error: 'Server error' })
  }
}


export async function markPaidByOperator(req, res) {
  try {
    assertTenantScope(req)
    const tenantId = req.tenant.id
    const accountId = req.user?.accountId
    const id = Number(req.params.id)
    if (!accountId) return res.status(403).json({ error: 'Forbidden' })
    if (!id) return res.status(400).json({ error: 'Invalid id' })

    const card = await models.WcVCard.findByPk(id)
    if (!card || card.tenant_id !== tenantId) return res.status(404).json({ error: 'Not found' })
    if (card.status !== 'delivered') return res.status(409).json({ error: 'Invalid state' })
    // Allow only the operator who delivered or claimed the card
    if (![card.claimed_by_account_id, card.delivered_by_account_id].includes(accountId)) {
      return res.status(403).json({ error: 'Not your card' })
    }

    const body = req.body || {}
    const metadata = Object.assign({}, card.metadata || {})
    const now = new Date()
    metadata.payment = Object.assign({}, metadata.payment || {}, {
      confirmed: true,
      at: now.toISOString(),
      method: body.method || metadata.payment?.method || null,
      reference: body.reference || metadata.payment?.reference || null,
      amount: body.amount != null ? Number(body.amount) : metadata.payment?.amount ?? null,
      currency: body.currency || metadata.payment?.currency || card.currency || null,
      noted_by: accountId,
      origin: 'operator',
    })
    await card.update({ metadata })
    res.json({ ok: true, payment: metadata.payment })
  } catch (e) {
    console.error('markPaidByOperator error', e)
    res.status(500).json({ error: 'Server error' })
  }
}

// Create a Stripe Checkout session so the operator can pay Insider
export async function createOperatorCheckout(req, res) {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' })
    assertTenantScope(req)
    const tenantId = req.tenant.id
    const accountId = req.user?.accountId
    const id = Number(req.params.id)
    if (!accountId) return res.status(403).json({ error: 'Forbidden' })
    if (!id) return res.status(400).json({ error: 'Invalid id' })

    const card = await models.WcVCard.findByPk(id)
    if (!card || card.tenant_id !== tenantId) return res.status(404).json({ error: 'Not found' })
    if (card.status !== 'delivered') return res.status(409).json({ error: 'Invalid state' })
    if (![card.claimed_by_account_id, card.delivered_by_account_id].includes(accountId)) {
      return res.status(403).json({ error: 'Not your card' })
    }

    // Amount in cents
    const currency = (card.currency || 'USD').toLowerCase()
    const amountNum = Number(card.amount)
    if (!amountNum || Number.isNaN(amountNum)) return res.status(400).json({ error: 'Card amount missing' })
    // Operator pays net of fees: amount - (2.9% + 0.30)
    const fee = amountNum * 0.029 + 0.30
    const netAmount = Math.max(0, amountNum - fee)
    const amountCents = Math.round(netAmount * 100)

    // Determine return URLs
    const origin = (() => { try { return new URL(req.headers.origin).origin } catch { return process.env.CLIENT_URL || 'http://localhost:5173' } })()
    const hostParam = String(req.query.host || req.headers['x-tenant-domain'] || '').trim()
    const successUrl = `${origin}/operator?card=${card.id}&session_id={CHECKOUT_SESSION_ID}` + (hostParam ? `&host=${encodeURIComponent(hostParam)}` : '')
    const cancelUrl  = `${origin}/operator?canceled=1&card=${card.id}` + (hostParam ? `&host=${encodeURIComponent(hostParam)}` : '')

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: `Pay to Insider — Card #${card.id}` },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        vccCardId: String(card.id),
        vccTenantId: String(tenantId),
        vccOperatorAccountId: String(accountId),
        purpose: 'vcc_operator_payment',
      },
      payment_intent_data: {
        metadata: {
          vccCardId: String(card.id),
          vccTenantId: String(tenantId),
          vccOperatorAccountId: String(accountId),
          purpose: 'vcc_operator_payment',
        },
      },
    })

    return res.json({ url: session.url })
  } catch (e) {
    console.error('createOperatorCheckout error', e)
    res.status(500).json({ error: 'Server error' })
  }
}

// Create a PaymentIntent for embedding Payment Element in operator panel
export async function createOperatorIntent(req, res) {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' })
    assertTenantScope(req)
    const tenantId = req.tenant.id
    const accountId = req.user?.accountId
    const id = Number(req.params.id)
    if (!accountId) return res.status(403).json({ error: 'Forbidden' })
    if (!id) return res.status(400).json({ error: 'Invalid id' })

    const card = await models.WcVCard.findByPk(id)
    if (!card || card.tenant_id !== tenantId) return res.status(404).json({ error: 'Not found' })
    if (card.status !== 'delivered') return res.status(409).json({ error: 'Invalid state' })
    if (![card.claimed_by_account_id, card.delivered_by_account_id].includes(accountId)) {
      return res.status(403).json({ error: 'Not your card' })
    }

    const currency = (card.currency || 'USD').toLowerCase()
    const amountNum = Number(card.amount)
    if (!amountNum || Number.isNaN(amountNum)) return res.status(400).json({ error: 'Card amount missing' })
    const fee = amountNum * 0.029 + 0.30
    const netAmount = Math.max(0, amountNum - fee)
    const amountCents = Math.round(netAmount * 100)

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        vccCardId: String(card.id),
        vccTenantId: String(tenantId),
        vccOperatorAccountId: String(accountId),
        purpose: 'vcc_operator_payment',
      },
    })

    return res.json({ clientSecret: intent.client_secret })
  } catch (e) {
    console.error('createOperatorIntent error', e)
    res.status(500).json({ error: 'Server error' })
  }
}

// Verify a Stripe Checkout session after redirect and auto-approve the card
export async function verifyOperatorCheckout(req, res) {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' })
    assertTenantScope(req)
    const tenantId = req.tenant.id
    const accountId = req.user?.accountId
    const sessionId = String(req.query.session_id || '').trim()
    if (!accountId) return res.status(403).json({ error: 'Forbidden' })
    if (!sessionId) return res.status(400).json({ error: 'Missing session_id' })

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent.latest_charge.balance_transaction']
    })
    if (!session || session.mode !== 'payment') {
      return res.status(400).json({ error: 'Invalid session' })
    }
    if (session.payment_status !== 'paid') {
      return res.status(409).json({ error: 'Payment not settled', status: session.payment_status })
    }

    const meta = session.metadata || {}
    const cardId = Number(meta.vccCardId)
    if (!cardId) return res.status(400).json({ error: 'Missing card metadata' })

    const card = await models.WcVCard.findByPk(cardId)
    if (!card || card.tenant_id !== tenantId) return res.status(404).json({ error: 'Card not found' })
    if (![card.claimed_by_account_id, card.delivered_by_account_id].includes(accountId)) {
      return res.status(403).json({ error: 'Not your card' })
    }

    // Idempotent: if already approved, return ok
    if (card.status === 'approved') {
      return res.json({ ok: true, alreadyApproved: true })
    }

    // Persist payment metadata (confirmed) and auto-approve
    const prevMeta = (card.metadata && typeof card.metadata === 'object') ? card.metadata : {}
    const pi = session.payment_intent
    // Optional: compute Stripe fee if expanded
    let stripeFeeAmount = null
    try {
      const charge = typeof pi === 'object' ? pi.latest_charge : null
      const bt = charge?.balance_transaction
      if (bt && typeof bt.fee === 'number') stripeFeeAmount = bt.fee / 100
    } catch {}

    const payment = {
      ...(prevMeta.payment || {}),
      confirmed: true,
      method: 'stripe_checkout',
      reference: typeof pi === 'string' ? pi : pi?.id || session.id,
      amount: (typeof session.amount_total === 'number' ? session.amount_total / 100 : (prevMeta.payment?.amount ?? card.amount ?? null)),
      currency: (session.currency ? String(session.currency).toUpperCase() : (prevMeta.payment?.currency ?? card.currency ?? null)),
      stripe_session_id: session.id,
      stripe_fee_amount: stripeFeeAmount,
      noted_by: accountId,
      origin: 'operator',
    }

    const newMeta = { ...prevMeta, payment }
    await card.update({
      metadata: newMeta,
      status: 'approved',
      approved_at: new Date(),
      approved_by_account_id: null,
    })

    return res.json({ ok: true })
  } catch (e) {
    console.error('verifyOperatorCheckout error', e)
    return res.status(500).json({ error: 'Server error' })
  }
}
