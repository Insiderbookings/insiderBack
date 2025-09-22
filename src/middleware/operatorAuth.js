// middleware/operatorAuth.js
// Authorize regular Insider users with role === 5 (Vault Operator)
// Also aliases req.user.accountId to req.user.id so existing controllers can reuse it.

export function authorizeOperator(req, res, next) {
  const role = Number(req.user?.role)
  if (!req.user || role !== 5) {
    return res.status(403).json({ error: 'Operator role required' })
  }
  // Back-compat with controllers that expect accountId
  if (!req.user.accountId) req.user.accountId = req.user.id
  next()
}

