// src/helpers/mailer.js
import nodemailer from "nodemailer"

function asBool(v, def = false) {
  if (v == null) return def
  const s = String(v).trim().toLowerCase()
  return ["1", "true", "yes", "y", "on"].includes(s)
}

export function createTransport(overrides = {}) {
  const host = overrides.host ?? process.env.SMTP_HOST
  const port = Number(overrides.port ?? process.env.SMTP_PORT ?? 587)
  const user = overrides.user ?? process.env.SMTP_USER
  const pass = overrides.pass ?? process.env.SMTP_PASS
  const secure =
    overrides.secure ??
    (overrides.port != null
      ? Number(overrides.port) === 465
      : asBool(process.env.SMTP_SECURE, port === 465))

  if (!host || !user || !pass) {
    throw new Error("SMTP config missing: host/user/pass are required")
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    pool: overrides.pool ?? true,
    auth: { user, pass },
  })
}

export async function sendMail({ to, subject, text, html, from, attachments, cc, bcc, replyTo, smtp } = {}) {
  const debug = asBool(process.env.MAIL_DEBUG)
  const transporter = createTransport(smtp || {})
  if (debug) {
    console.info(
      `[mail] sending to ${Array.isArray(to) ? to.join(', ') : to || '(no recipient)'}${smtp ? ' (custom SMTP)' : ''}`
    )
  }
  const info = await transporter.sendMail({
    from: from || process.env.MAIL_FROM || "no-reply@insiderbookings.com",
    to,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(replyTo ? { replyTo } : {}),
    subject,
    text,
    html,
    ...(attachments ? { attachments } : {}),
  })
  if (debug) {
    console.info('[mail] response', { accepted: info.accepted, rejected: info.rejected, response: info.response })
  }
  return info
}

