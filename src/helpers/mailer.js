// src/lib/mailer.js
import nodemailer from "nodemailer"

function asBool(v, def = false) {
  if (v == null) return def
  const s = String(v).trim().toLowerCase()
  return ["1","true","yes","y","on"].includes(s)
}

export function createTransport() {
  const host   = process.env.SMTP_HOST
  const port   = Number(process.env.SMTP_PORT || 587)
  const user   = process.env.SMTP_USER
  const pass   = process.env.SMTP_PASS
  const secure = asBool(process.env.SMTP_SECURE, port === 465)

  if (!host || !user || !pass) {
    throw new Error("SMTP config missing: SMTP_HOST/USER/PASS are required")
  }

  return nodemailer.createTransport({
    host,
    port,
    secure, // true for 465, false for other ports
    pool: true,
    auth: { user, pass },
  })
}

export async function sendMail({ to, subject, text, html, from, attachments, cc, bcc }) {
  const debug = asBool(process.env.MAIL_DEBUG)
  const transporter = createTransport()
  if (debug) {
    console.info(`[mail] sending to ${Array.isArray(to) ? to.join(', ') : to || '(no recipient)'}`)
  }
  const info = await transporter.sendMail({
    from: from || process.env.MAIL_FROM || "no-reply@insiderbookings.com",
    to,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    subject,
    text,
    html,
    // Passthrough de adjuntos (Buffer, path o stream)
    ...(attachments ? { attachments } : {}),
  })
  if (debug) {
    console.info('[mail] response', { accepted: info.accepted, rejected: info.rejected, response: info.response })
  }
  return info
}
