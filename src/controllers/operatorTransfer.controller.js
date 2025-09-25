import models from "../models/index.js";
import { Op } from "sequelize";
import Stripe from "stripe";

const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: "2022-11-15" }) : null;

const TRANSFER_STATUS = {
  PENDING: "pending",
  CLAIMED: "claimed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

function assertTenantScope(req) {
  if (!req.tenant?.id) {
    const err = new Error("Tenant not resolved");
    err.status = 400;
    throw err;
  }
}

function sanitizeTransfer(model) {
  if (!model) return null;
  const json = typeof model.toJSON === "function" ? model.toJSON() : model;
  return {
    id: json.id,
    tenant_id: json.tenant_id,
    operator_account_id: json.operator_account_id,
    assigned_account_id: json.assigned_account_id,
    status: json.status,
    amount: json.amount,
    currency: json.currency,
    booking_code: json.booking_code,
    guest_name: json.guest_name,
    reference: json.reference,
    notes: json.notes,
    paid_at: json.paid_at,
    claimed_at: json.claimed_at,
    completed_at: json.completed_at,
    metadata: json.metadata || {},
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
    deletedAt: json.deletedAt,
  };
}

function requireStripe() {
  if (!stripe) {
    const err = new Error("Stripe not configured");
    err.status = 500;
    throw err;
  }
}

export async function getOperatorTransferHistory(req, res) {
  try {
    assertTenantScope(req)
    const tenantId = req.tenant.id
    const accountId = req.user?.accountId
    if (!accountId) return res.status(403).json({ error: 'Forbidden' })

    const { status, limit } = req.query
    const where = {
      tenant_id: tenantId,
      [Op.or]: [
        { operator_account_id: accountId },
        { assigned_account_id: accountId },
      ],
    }

    if (status) {
      const list = String(status)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      if (list.length > 1) where.status = { [Op.in]: list }
      else where.status = list[0]
    }

    const lim = Math.min(Math.max(Number(limit) || 200, 1), 500)

    const items = await models.WcOperatorTransfer.findAll({
      where,
      order: [['updatedAt', 'DESC']],
      limit: lim,
      // No hay campos sensibles en este modelo, así que no excluimos nada
      // attributes: { ... }
    })

    return res.json({ items })
  } catch (e) {
    console.error('getOperatorTransferHistory error', e)
    return res.status(e.status || 500).json({ error: e.message || 'Server error' })
  }
}

export async function listOperatorTransfers(req, res) {
  try {
    assertTenantScope(req);
    const tenantId = req.tenant.id;
    const accountId = req.user?.accountId;
    if (!accountId) return res.status(403).json({ error: "Forbidden" });

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 50;

    const items = await models.WcOperatorTransfer.findAll({
      where: {
        tenant_id: tenantId,
        operator_account_id: accountId,
        status: { [Op.in]: [TRANSFER_STATUS.COMPLETED] },
      },
      order: [
        ["completed_at", "DESC"],
        ["id", "DESC"],
      ],
      limit,
    });

    return res.json({ items: items.map(sanitizeTransfer) });
  } catch (e) {
    console.error("listOperatorTransfers error", e);
    return res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}

export async function getOperatorTransferStats(req, res) {
  try {
    assertTenantScope(req);
    const tenantId = req.tenant.id;
    const accountId = req.user?.accountId;
    if (!accountId) return res.status(403).json({ error: "Forbidden" });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [pendingQueue, assigned, completedToday, totalCompleted] = await Promise.all([
      models.WcOperatorTransfer.count({ where: { tenant_id: tenantId, status: TRANSFER_STATUS.PENDING } }),
      models.WcOperatorTransfer.count({ where: { tenant_id: tenantId, status: TRANSFER_STATUS.CLAIMED, assigned_account_id: accountId } }),
      models.WcOperatorTransfer.count({
        where: {
          tenant_id: tenantId,
          status: TRANSFER_STATUS.COMPLETED,
          operator_account_id: accountId,
          completed_at: { [Op.gte]: startOfDay },
        },
      }),
      models.WcOperatorTransfer.count({
        where: {
          tenant_id: tenantId,
          status: TRANSFER_STATUS.COMPLETED,
          operator_account_id: accountId,
        },
      }),
    ]);

    return res.json({
      pendingQueue,
      assigned,
      completedToday,
      totalCompleted,
    });
  } catch (e) {
    console.error("getOperatorTransferStats error", e);
    return res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}

export async function claimOperatorTransfer(req, res) {
  try {
    assertTenantScope(req);
    const tenantId = req.tenant.id;
    const accountId = req.user?.accountId;
    if (!accountId) return res.status(403).json({ error: "Forbidden" });

    const sequelize = models.WcOperatorTransfer.sequelize;
    const trx = await sequelize.transaction();
    try {
      const existing = await models.WcOperatorTransfer.findOne({
        where: {
          tenant_id: tenantId,
          status: TRANSFER_STATUS.CLAIMED,
          assigned_account_id: accountId,
        },
        order: [["claimed_at", "ASC"]],
        transaction: trx,
        lock: trx.LOCK.UPDATE,
      });

      if (existing) {
        await trx.commit();
        return res.json({ item: sanitizeTransfer(existing), alreadyAssigned: true });
      }

      const next = await models.WcOperatorTransfer.findOne({
        where: { tenant_id: tenantId, status: TRANSFER_STATUS.PENDING },
        order: [["createdAt", "ASC"]],
        transaction: trx,
        lock: trx.LOCK.UPDATE,
        skipLocked: true,
      });

      if (!next) {
        await trx.rollback();
        return res.status(404).json({ error: "No pending transfers" });
      }

      await next.update(
        {
          status: TRANSFER_STATUS.CLAIMED,
          assigned_account_id: accountId,
          claimed_at: new Date(),
        },
        { transaction: trx }
      );

      await trx.commit();
      return res.json({ item: sanitizeTransfer(next) });
    } catch (err) {
      await trx.rollback();
      throw err;
    }
  } catch (e) {
    console.error("claimOperatorTransfer error", e);
    return res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}

export async function getActiveOperatorTransfer(req, res) {
  try {
    assertTenantScope(req);
    const tenantId = req.tenant.id;
    const accountId = req.user?.accountId;
    if (!accountId) return res.status(403).json({ error: "Forbidden" });

    const active = await models.WcOperatorTransfer.findOne({
      where: {
        tenant_id: tenantId,
        status: TRANSFER_STATUS.CLAIMED,
        assigned_account_id: accountId,
      },
      order: [["claimed_at", "ASC"]],
    });

    if (!active) return res.status(404).json({ error: "No active transfer" });

    return res.json({ item: sanitizeTransfer(active) });
  } catch (e) {
    console.error("getActiveOperatorTransfer error", e);
    return res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}

export async function createOperatorTransferIntent(req, res) {
  try {
    requireStripe();
    assertTenantScope(req);
    const tenantId = req.tenant.id;
    const accountId = req.user?.accountId;
    const id = Number(req.params.id);
    if (!accountId) return res.status(403).json({ error: "Forbidden" });
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const transfer = await models.WcOperatorTransfer.findByPk(id);
    if (!transfer || transfer.tenant_id !== tenantId) return res.status(404).json({ error: "Not found" });
    if (transfer.status !== TRANSFER_STATUS.CLAIMED) return res.status(409).json({ error: "Invalid state" });
    if (transfer.assigned_account_id !== accountId) return res.status(403).json({ error: "Not your transfer" });

    const amountNum = Number(transfer.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const currency = String(transfer.currency || "USD").toLowerCase();
    const amountCents = Math.round(amountNum * 100);

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        transferId: String(transfer.id),
        tenantId: String(tenantId),
        operatorAccountId: String(accountId),
        purpose: "operator_transfer",
      },
    });

    const baseMeta = transfer.metadata && typeof transfer.metadata === "object" ? transfer.metadata : {};
    const nextMeta = { ...baseMeta, latestPaymentIntentId: intent.id };
    await transfer.update({ metadata: nextMeta }, { silent: true });

    return res.json({ clientSecret: intent.client_secret, paymentIntentId: intent.id });
  } catch (e) {
    console.error("createOperatorTransferIntent error", e);
    return res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}

export async function completeOperatorTransfer(req, res) {
  try {
    assertTenantScope(req);
    const tenantId = req.tenant.id;
    const accountId = req.user?.accountId;
    const id = Number(req.params.id);
    if (!accountId) return res.status(403).json({ error: "Forbidden" });
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const transfer = await models.WcOperatorTransfer.findByPk(id);
    if (!transfer || transfer.tenant_id !== tenantId) return res.status(404).json({ error: "Not found" });
    if (transfer.status !== TRANSFER_STATUS.CLAIMED) return res.status(409).json({ error: "Transfer not claimed" });
    if (transfer.assigned_account_id !== accountId) return res.status(403).json({ error: "Not your transfer" });

    const body = req.body || {};
    const amountNum = Number(body.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }

    const currency = (body.currency ? String(body.currency) : transfer.currency || "USD").slice(0, 3).toUpperCase();
    const bookingCode = String(body.bookingCode || body.booking_code || "").trim();
    const guestName = String(body.guestName || body.guest_name || "").trim();
    const reference = String(body.reference || "").trim();
    const notes = body.notes != null ? String(body.notes).trim() : null;
    const paidAtRaw = body.paidAt || body.paid_at;
    const paymentIntentId = body.paymentIntentId ? String(body.paymentIntentId).trim() : null;

    if (!bookingCode) return res.status(400).json({ error: "bookingCode is required" });
    if (!guestName) return res.status(400).json({ error: "guestName is required" });

    let paymentIntent = null;
    if (paymentIntentId) {
      try {
        requireStripe();
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      } catch (err) {
        console.error("completeOperatorTransfer retrieve PI error", err);
        return res.status(400).json({ error: "Unable to verify payment intent" });
      }
      if (!paymentIntent || paymentIntent.status !== "succeeded") {
        return res.status(409).json({ error: "Payment not settled" });
      }
      const amountFromPi = Number(paymentIntent.amount_received ?? paymentIntent.amount) / 100;
      if (Number.isFinite(amountFromPi) && Math.round(amountFromPi * 100) !== Math.round(amountNum * 100)) {
        return res.status(409).json({ error: "Payment amount mismatch" });
      }
    }

    let paidAt = new Date();
    if (paidAtRaw) {
      const parsed = new Date(paidAtRaw);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "paidAt must be a valid date" });
      }
      paidAt = parsed;
    } else if (paymentIntent?.created) {
      paidAt = new Date(paymentIntent.created * 1000);
    }

    const baseMeta = transfer.metadata && typeof transfer.metadata === "object" ? transfer.metadata : {};
    const paymentMeta = {
      ...(baseMeta.payment || {}),
      confirmed: true,
      method: paymentIntent?.payment_method_types?.[0] || "stripe_card",
      paymentIntentId: paymentIntent?.id || paymentIntentId || null,
      amount: amountNum,
      currency,
      completedBy: accountId,
      completedAt: new Date().toISOString(),
    };

    const nextMeta = { ...baseMeta, payment: paymentMeta };

    await transfer.update({
      status: TRANSFER_STATUS.COMPLETED,
      operator_account_id: accountId,
      amount: amountNum,
      currency,
      booking_code: bookingCode,
      guest_name: guestName,
      reference: reference || paymentMeta.paymentIntentId || transfer.reference,
      notes,
      paid_at: paidAt,
      completed_at: new Date(),
      metadata: nextMeta,
    });

    return res.json({ item: sanitizeTransfer(transfer) });
  } catch (e) {
    console.error("completeOperatorTransfer error", e);
    return res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}

export async function createOperatorTransfer(req, res) {
  try {
    assertTenantScope(req);
    const tenantId = req.tenant.id;
    const accountId = req.user?.accountId;
    if (!accountId) return res.status(403).json({ error: "Forbidden" });

    const body = req.body || {};
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }

    const currency = (body.currency ? String(body.currency) : "USD").slice(0, 3).toUpperCase();
    const bookingCode = String(body.bookingCode || body.booking_code || "").trim();
    const guestName = String(body.guestName || body.guest_name || "").trim();
    const reference = String(body.reference || "").trim();
    const notes = body.notes != null ? String(body.notes).trim() : null;
    const paidAtRaw = body.paidAt || body.paid_at;

    if (!bookingCode) return res.status(400).json({ error: "bookingCode is required" });
    if (!guestName) return res.status(400).json({ error: "guestName is required" });

    let paidAt = new Date();
    if (paidAtRaw) {
      const parsed = new Date(paidAtRaw);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "paidAt must be a valid date" });
      }
      paidAt = parsed;
    }

    const created = await models.WcOperatorTransfer.create({
      tenant_id: tenantId,
      operator_account_id: accountId,
      assigned_account_id: accountId,
      status: TRANSFER_STATUS.COMPLETED,
      amount,
      currency,
      booking_code: bookingCode,
      guest_name: guestName,
      reference,
      notes,
      paid_at: paidAt,
      claimed_at: paidAt,
      completed_at: paidAt,
      metadata: { manualEntry: true },
    });

    return res.status(201).json({ item: sanitizeTransfer(created) });
  } catch (e) {
    console.error("createOperatorTransfer error", e);
    return res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}

export async function adminListTransfers(req, res) {
  try {
    const tenantId = req.query.tenantId ? Number(req.query.tenantId) : null;
    const status = req.query.status ? String(req.query.status).toLowerCase() : null;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 100;

    const where = {};
    if (tenantId) where.tenant_id = tenantId;
    if (status && Object.values(TRANSFER_STATUS).includes(status)) {
      where.status = status;
    }

    const items = await models.WcOperatorTransfer.findAll({
      where,
      order: [
        ["status", "ASC"],
        ["createdAt", "DESC"],
      ],
      limit,
    });

    return res.json({ items: items.map(sanitizeTransfer) });
  } catch (e) {
    console.error("adminListTransfers error", e);
    return res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}

export async function adminCreateTransfer(req, res) {
  try {
    const body = req.body || {};
    const tenantId = Number(body.tenantId || body.tenant_id);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    const tenant = await models.WcTenant.findByPk(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }

    const currency = (body.currency ? String(body.currency) : "USD").slice(0, 3).toUpperCase();
    const bookingCode = String(body.bookingCode || body.distributorCode || body.booking_code || "").trim();
    const guestName = String(body.guestName || body.distributorName || body.guest_name || "").trim();
    const notes = body.notes != null ? String(body.notes).trim() : null;

    if (!bookingCode) return res.status(400).json({ error: "bookingCode is required" });
    if (!guestName) return res.status(400).json({ error: "guestName is required" });

    const baseMeta = {};
    if (body.distributorName) baseMeta.distributorName = String(body.distributorName).trim();
    if (body.distributorCode) baseMeta.distributorCode = String(body.distributorCode).trim();
    if (req.user?.id) baseMeta.createdByUserId = req.user.id;

    const created = await models.WcOperatorTransfer.create({
      tenant_id: tenantId,
      status: TRANSFER_STATUS.PENDING,
      amount,
      currency,
      booking_code: bookingCode,
      guest_name: guestName,
      reference: null,
      notes,
      metadata: baseMeta,
    });

    return res.status(201).json({ item: sanitizeTransfer(created) });
  } catch (e) {
    console.error("adminCreateTransfer error", e);
    return res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}

export async function adminCancelTransfer(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const transfer = await models.WcOperatorTransfer.findByPk(id);
    if (!transfer) return res.status(404).json({ error: "Transfer not found" });
    if (![TRANSFER_STATUS.PENDING, TRANSFER_STATUS.CLAIMED].includes(transfer.status)) {
      return res.status(409).json({ error: "Only pending or claimed transfers can be cancelled" });
    }

    const meta = transfer.metadata && typeof transfer.metadata === "object" ? transfer.metadata : {};
    const nextMeta = {
      ...meta,
      cancelledByUserId: req.user?.id || null,
      cancelledAt: new Date().toISOString(),
    };

    await transfer.update({
      status: TRANSFER_STATUS.CANCELLED,
      assigned_account_id: null,
      operator_account_id: null,
      claimed_at: null,
      completed_at: null,
      paid_at: null,
      metadata: nextMeta,
    });

    return res.json({ item: sanitizeTransfer(transfer) });
  } catch (e) {
    console.error("adminCancelTransfer error", e);
    return res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}
