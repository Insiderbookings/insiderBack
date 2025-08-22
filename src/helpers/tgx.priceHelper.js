// src/controllers/tgx.helpers.js
export const MARKUP_RULES = {
  guest:       { pct: 0.15, flatCents: 0 }, // 15%
  influencer:  { pct: 0.10, flatCents: 0 }, // 10%
  staff:       { pct: 0.00, flatCents: 0 }, // 0%
}

export function getUserRole(req) {
  // Usa lo que ya tengas (JWT/session). Fallback a header para pruebas.
  return (req.user?.role || req.headers["x-user-role"] || "guest").toLowerCase()
}

const toCents = (n) => Math.round(Number(n) * 100)
const fromCents = (c) => (c / 100)

export function applyRoleMarkup(amount, role) {
  const cents = toCents(amount)
  const rule  = MARKUP_RULES[role] || MARKUP_RULES.guest
  const withPct  = Math.round(cents * (1 + (rule.pct || 0)))
  const withFlat = withPct + (rule.flatCents || 0)
  return fromCents(withFlat)
}
