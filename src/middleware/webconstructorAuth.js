// Requiere que el payload tenga: { type: "webconstructor", tenantId, accountId, permissions: [] }
export function authorizeWc(req, res, next) {
    if (req.user?.type !== 'webconstructor') {
        return res.status(403).json({ error: 'Webconstructor token required' })
    }
    // req.tenant lo setea un middleware previo (resolveTenant) usando X-Tenant-Domain o ?host
    if (!req.tenant || req.user.tenantId !== req.tenant.id) {
        return res.status(403).json({ error: 'Invalid tenant scope' })
    }
    next()
}

// Permiso fino opcional (para /site-config, /accounts, etc.)
export function authorizeWcPermission(perm) {
    return (req, res, next) => {
        const perms = req.user?.permissions || []
        if (!perms.includes(perm)) {
            return res.status(403).json({ error: 'Forbidden' })
        }
        next()
    }
}
