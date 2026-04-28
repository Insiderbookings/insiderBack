const DEFAULT_MAIL_FROM_NAME = "Insider Bookings"
const DEFAULT_MAIL_FROM_EMAIL = "no-reply@insiderbookings.com"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

function sanitizeEmail(value) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || !EMAIL_RE.test(trimmed)) return null
  return trimmed
}

function sanitizeName(value) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeMailbox(input) {
  if (!input) return null

  if (typeof input === "object") {
    const email = sanitizeEmail(input.address ?? input.email)
    const name = sanitizeName(input.name)
    return email ? { name, email } : null
  }

  if (typeof input !== "string") return null

  const trimmed = input.trim()
  if (!trimmed) return null

  const formatted = trimmed.match(/^(?:"?([^"]+?)"?\s*)?<\s*([^<>]+)\s*>$/)
  if (formatted) {
    const email = sanitizeEmail(formatted[2])
    if (!email) return null
    return {
      name: sanitizeName(formatted[1]),
      email,
    }
  }

  const email = sanitizeEmail(trimmed)
  return email ? { name: null, email } : null
}

function formatMailbox(name, email) {
  return name ? `${name} <${email}>` : email
}

export function getDefaultMailFromName() {
  const legacy = normalizeMailbox(process.env.MAIL_FROM)
  return firstNonEmpty(process.env.MAIL_FROM_NAME, legacy?.name, DEFAULT_MAIL_FROM_NAME)
}

export function getDefaultMailFromEmail() {
  const legacy = normalizeMailbox(process.env.MAIL_FROM)
  return (
    sanitizeEmail(process.env.MAIL_FROM_EMAIL) ||
    legacy?.email ||
    sanitizeEmail(process.env.SMTP_USER) ||
    DEFAULT_MAIL_FROM_EMAIL
  )
}

export function resolveMailFrom(value = null, options = {}) {
  const fallbackName = firstNonEmpty(options.fallbackName, getDefaultMailFromName())
  const fallbackEmail = sanitizeEmail(options.fallbackEmail) || getDefaultMailFromEmail()
  const mailbox = normalizeMailbox(value)

  if (mailbox?.email) {
    return formatMailbox(mailbox.name || fallbackName, mailbox.email)
  }

  return formatMailbox(fallbackName, fallbackEmail)
}
