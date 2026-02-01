import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import models from '../models/index.js'
import cache from '../services/cache.js'

/* --- helpers internos --- */
/* --- helpers internos --- */
function toDTO(cfg) {
    if (!cfg) return null
    const c = typeof cfg.toJSON === 'function' ? cfg.toJSON() : cfg
    const get = (camel, snake, fallback = '') => c?.[camel] ?? c?.[snake] ?? fallback

    return {
        // apariencia
        primaryColor: get('primaryColor', 'primary_color', '#2563eb'),
        secondaryColor: get('secondaryColor', 'secondary_color', '#111827'),
        logoUrl: get('logoUrl', 'logo_url', ''),
        faviconUrl: get('faviconUrl', 'favicon_url', ''),
        fontFamily: get('fontFamily', 'font_family', 'Inter, sans-serif'),
        templateKey: get('templateKey', 'template_key', 'classic'),
        stars: get('stars', 'stars', 0),

        // redes (el público las recibe en snake_case como acordamos)
        facebook_url: get('facebookUrl', 'facebook_url', ''),
        instagram_url: get('instagramUrl', 'instagram_url', ''),
        tiktok_url: get('tiktokUrl', 'tiktok_url', ''),
        youtube_url: get('youtubeUrl', 'youtube_url', ''),
        x_url: get('xUrl', 'x_url', ''),
        linkedin_url: get('linkedinUrl', 'linkedin_url', ''),

        // deep customization for templates (snake_case for public)
        template_settings: get('templateSettings', 'template_settings', {}),
    }
}


const accountDTO = (acc) => ({
    id: acc.id,
    email: acc.email,
    displayName: acc.display_name,
    isActive: !!acc.is_active,
    roles: acc.roles || [],
    permissions: acc.permissions || [],
    createdAt: acc.createdAt,
    updatedAt: acc.updatedAt,
})

/* --- LOGIN / ME --- */
export async function wcLogin(req, res) {
    try {
        const { email, password } = req.body || {}
        if (!email || !password) return res.status(400).json({ error: 'Email & password required' })

        const tenantId = req.tenant.id
        // Find account by email and ensure it is linked to the current tenant
        const acc = await models.WcAccount.findOne({
            where: { email },
            include: [{
                model: models.WcTenant,
                required: false,
                through: { attributes: [] },
                attributes: ['id'],
            }]
        })
        if (!acc || !acc.is_active) return res.status(401).json({ error: 'Invalid credentials' })
        // Check membership via M:N or via legacy tenant_id
        const m2mTenantIds = Array.isArray(acc.WcTenants) ? acc.WcTenants.map(t => t.id) : []
        const legacyOk = acc.tenant_id === tenantId
        const linked = legacyOk || m2mTenantIds.includes(tenantId)
        if (!linked) return res.status(403).json({ error: 'Account not linked to tenant' })

        const ok = await bcrypt.compare(password, acc.password_hash)
        if (!ok) return res.status(401).json({ error: 'Invalid credentials' })

        const payload = {
            type: 'webconstructor',
            tenantId,
            accountId: acc.id,
            permissions: acc.permissions || []
        }
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' })
        res.json({ token })
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'Server error' })
    }
}

export async function wcMe(req, res) {
    try {
        const acc = await models.WcAccount.findByPk(req.user.accountId, {
            attributes: ['id', 'email', 'display_name', 'permissions', 'is_active']
        })
        if (!acc) return res.status(404).json({ error: 'Not found' })
        res.json({
            accountId: acc.id,
            email: acc.email,
            displayName: acc.display_name,
            permissions: acc.permissions || []
        })
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'Server error' })
    }
}

/* --- SITE CONFIG --- */
export async function getSiteConfigPrivate(req, res) {
    try {
        const cfg = await models.WcSiteConfig.findOne({ where: { tenantId: req.tenant.id } })
        res.json(cfg || {}) // ya viene en camelCase
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }) }
}

export async function updateSiteConfigPrivate(req, res) {
    try {
        const body = req.body || {}
        // si necesitás validar templateKey:
        if (body.templateKey) {
            const tpl = await models.WcTemplate.findOne({ where: { key: body.templateKey, is_active: true } })
            if (!tpl) return res.status(400).json({ error: 'Invalid templateKey' })
        }

        const [cfg, created] = await models.WcSiteConfig.findOrCreate({
            where: { tenantId: req.tenant.id },
            defaults: { tenantId: req.tenant.id, ...body }
        })
        if (!created) await cfg.update(body)
        res.json(cfg)
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }) }
}

export async function getSiteConfigPublic(req, res) {
    try {
        const cfg = await models.WcSiteConfig.findOne({ where: { tenantId: req.tenant.id } })
        return res.json(toDTO(cfg))
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'Server error' })
    }
}

export async function listTemplates(_req, res) {
    try {
        const items = await models.WcTemplate.findAll({
            where: { is_active: true },
            attributes: ['key', 'name', 'description', 'version', 'preview_image', 'demo_url']
        })
        res.json(items)
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'Server error' })
    }
}
