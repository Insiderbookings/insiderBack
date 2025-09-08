export function getMarkup(role, _price) {
  const r = Number(role)

  if (r === 0) {
    const p = Number(_price)
    // Public guest pricing (Model 1):
    // < $100  -> +50%
    // $100-300 -> +40%
    // > $300  -> +30%
    if (!Number.isFinite(p)) return 0.5
    if (p < 100) return 0.5
    if (p <= 300) return 0.4
    return 0.3
  }

  const ROLE_MARKUP = {
    1: 0.2, // staff
    2: 0.1, // influencer
    3: 0.1, // corporate
    4: 0.05, // agency
    5: 0.0, // vault operator (net rates only)
    100: 0, // admin
  }
  return ROLE_MARKUP[r] ?? 0
}
