import models from '../models/index.js'

export async function listMyTenants(req, res) {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const links = await models.WcUserTenant.findAll({
      where: { user_id: userId },
      order: [["created_at","DESC"]],
    }).catch(() => [])

    const ids = [...new Set(links.map(l => l?.tenant_id).filter(Boolean))]
    const rows = ids.length ? await models.WcTenant.findAll({ where: { id: ids } }) : []
    const tenants = rows.map(t => ({ id: t.id, name: t.name, public_domain: t.public_domain, panel_domain: t.panel_domain }))
    return res.json({ tenants })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Server error' })
  }
}
