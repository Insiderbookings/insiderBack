// middleware/resolveTenant.js
import models from '../models/index.js' // ajustá el path

export async function resolveTenant(req, res, next) {
    try {
        const host = (req.headers['x-tenant-domain'] || req.query.host || '').toLowerCase()
        if (!host) return res.status(400).json({ error: 'Missing host' })

        // Primero panel_domain; si no, public_domain
        let t = await models.WcTenant.findOne({ where: { panel_domain: host } })
        if (!t) t = await models.WcTenant.findOne({ where: { public_domain: host } })
        if (!t) return res.status(404).json({ error: 'Tenant not found' })

        req.tenant = { id: t.id, name: t.name, publicDomain: t.public_domain, panelDomain: t.panel_domain, externalHotelID: t.hotel_id, externalHotelAccess: t.hotel_access }
        next()
    } catch (e) {
        console.error(e)
        res.status(500).json({ error: 'Server error' })
    }
}
