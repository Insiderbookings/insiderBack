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

  if (!host) {
    throw new Error("SMTP config missing: host is required")
  }
  if ((user && !pass) || (!user && pass)) {
    throw new Error("SMTP config incomplete: user and pass must both be provided")
  }

  const transportOptions = {
    host,
    port,
    secure,
    pool: overrides.pool ?? true,
    maxConnections:
      overrides.maxConnections ??
      (process.env.SMTP_MAX_CONNECTIONS ? Number(process.env.SMTP_MAX_CONNECTIONS) : 5),
    maxMessages:
      overrides.maxMessages ??
      (process.env.SMTP_MAX_MESSAGES ? Number(process.env.SMTP_MAX_MESSAGES) : 100),
    requireTLS: overrides.requireTLS ?? true,
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: overrides.rejectUnauthorized ?? true,
      ...(overrides.tls || {}),
    },
  }

  if (user && pass) {
    transportOptions.auth = { user, pass }
  }

  return nodemailer.createTransport(transportOptions)
}

export async function sendMail({
  to,
  subject,
  text,
  html,
  from,
  attachments,
  cc,
  bcc,
  replyTo,
  smtp,
  headers,
} = {}) {
  const debug = asBool(process.env.MAIL_DEBUG)
  const transporter = createTransport(smtp || {})
  if (debug) {
    console.info(
      `[mail] sending to ${Array.isArray(to) ? to.join(', ') : to || '(no recipient)'}${smtp ? ' (custom SMTP)' : ''}`
    )
  }
  const fromAddr = from || process.env.MAIL_FROM || "no-reply@insiderbookings.com"
  const headerBag = {
    ...(headers || {}),
  }
  if (!headerBag["List-Unsubscribe"]) {
    headerBag["List-Unsubscribe"] =
      "<mailto:unsubscribe@insiderbookings.com>, <https://insiderbookings.com/unsubscribe>"
  }
  if (!headerBag["List-Unsubscribe-Post"]) {
    headerBag["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
  }

  const info = await transporter.sendMail({
    from: fromAddr,
    to,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(replyTo ? { replyTo } : {}),
    subject,
    text,
    html,
    ...(attachments ? { attachments } : {}),
    ...(Object.keys(headerBag).length ? { headers: headerBag } : {}),
  })
  if (debug) {
    console.info('[mail] response', { accepted: info.accepted, rejected: info.rejected, response: info.response })
  }
  return info
}

