// src/controllers/subscriber.controller.js
import models from "../models/index.js"
import { sendMail } from "../helpers/mailer.js"

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase()
}

export async function createSubscription(req, res, next) {
  try {
    const email = normalizeEmail(req.body?.email)
    const name = (req.body?.name || "").trim() || null
    const source = (req.body?.source || "newsletter").trim() || "newsletter"

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email" })
    }

    const user = await models.User.findOne({ where: { email }, attributes: ["id", "name", "email"] })

    const [rec, created] = await models.Subscriber.findOrCreate({
      where: { email },
      defaults: { email, name: name || user?.name || null, source, user_id: user?.id || null },
    })

    if (!created) {
      await rec.update({ name: name || rec.name || user?.name || null, user_id: rec.user_id || user?.id || null, source: rec.source || source })
    }

    return res.status(created ? 201 : 200).json({ subscriber: rec, created })
  } catch (err) { return next(err) }
}

export async function adminListSubscribers(req, res, next) {
  try {
    const users = await models.User.findAll({ attributes: ["id", "name", "email", "created_at", "is_active"], limit: 5000 })
    const subs = await models.Subscriber.findAll({ include: [{ model: models.User, as: "user", attributes: ["id", "name", "email"] }], limit: 5000 })

    const byEmail = new Map()
    for (const u of users) {
      const email = normalizeEmail(u.email)
      if (!email) continue
      byEmail.set(email, {
        email,
        name: u.name || null,
        source: "user",
        user_id: u.id,
        active: !!u.is_active,
        created_at: u.created_at,
      })
    }
    for (const s of subs) {
      const email = normalizeEmail(s.email)
      if (!email) continue
      if (!byEmail.has(email)) {
        byEmail.set(email, {
          email,
          name: s.name || s?.user?.name || null,
          source: s.source || "subscriber",
          user_id: s.user_id || s?.user?.id || null,
          active: true,
          created_at: s.created_at,
        })
      }
    }

    const list = Array.from(byEmail.values()).sort((a, b) => (a.email > b.email ? 1 : -1))
    return res.json({ items: list, total: list.length })
  } catch (err) { return next(err) }
}

export async function adminBroadcastEmail(req, res, next) {
  try {
    const { subject, html, text } = req.body || {}
    if (!subject || !(html || text)) {
      return res.status(400).json({ error: "Missing subject or content" })
    }

    const users = await models.User.findAll({ attributes: ["email"], where: { is_active: true }, raw: true })
    const subs = await models.Subscriber.findAll({ attributes: ["email"], raw: true })
    const emails = Array.from(new Set([
      ...users.map((u) => normalizeEmail(u.email)),
      ...subs.map((s) => normalizeEmail(s.email)),
    ].filter(Boolean)))

    if (emails.length === 0) return res.json({ sent: 0, batches: 0 })

    // Send in BCC batches to avoid huge headers / privacy leaks
    const batchSize = Number(process.env.BROADCAST_BATCH_SIZE || 50)
    let sent = 0
    let batches = 0
    for (let i = 0; i < emails.length; i += batchSize) {
      const slice = emails.slice(i, i + batchSize)
      try {
        await sendMail({ to: process.env.MAIL_FROM || "no-reply@insiderbookings.com", subject, html, text, bcc: slice })
        sent += slice.length
        batches += 1
      } catch (e) {
        // Continue with next batch; report failure
        console.warn("Broadcast batch failed:", e?.message || e)
      }
    }

    return res.json({ sent, batches, totalRecipients: emails.length })
  } catch (err) { return next(err) }
}

