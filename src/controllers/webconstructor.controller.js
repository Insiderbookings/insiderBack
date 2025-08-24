import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import models from '../models/index.js'
import { fetchHotels } from "../services/tgx.hotelList.service.js"
import cache from '../services/cache.js'

/* --- helpers internos --- */
function toDTO(cfg) {
    if (!cfg) return null
    return {
        primaryColor: cfg.primary_color || '#2563eb',
        secondaryColor: cfg.secondary_color || '#111827',
        logoUrl: cfg.logo_url || '',
        faviconUrl: cfg.favicon_url || '',
        fontFamily: cfg.font_family || 'Inter, sans-serif',
        templateKey: cfg.template_key || 'classic',
        extra: cfg.extra || {}
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
        const acc = await models.WcAccount.findOne({ where: { tenant_id: tenantId, email } })
        if (!acc || !acc.is_active) return res.status(401).json({ error: 'Invalid credentials' })

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
        const cfg = await models.WcSiteConfig.findOne({ where: { tenant_id: req.tenant.id } })
        return res.json(toDTO(cfg) || toDTO({}))
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'Server error' })
    }
}

export async function updateSiteConfigPrivate(req, res) {
    try {
        const { primaryColor, secondaryColor, logoUrl, faviconUrl, fontFamily, templateKey, extra } = req.body || {}

        // validar plantilla si viene
        if (templateKey) {
            const tpl = await models.WcTemplate.findOne({ where: { key: templateKey, is_active: true } })
            if (!tpl) return res.status(400).json({ error: 'Invalid templateKey' })
        }

        const [cfg, created] = await models.WcSiteConfig.findOrCreate({
            where: { tenant_id: req.tenant.id },
            defaults: {
                tenant_id: req.tenant.id,
                primary_color: primaryColor,
                secondary_color: secondaryColor,
                logo_url: logoUrl,
                favicon_url: faviconUrl,
                font_family: fontFamily,
                template_key: templateKey || 'classic',
                extra: extra || {}
            }
        })
        if (!created) {
            cfg.primary_color = primaryColor ?? cfg.primary_color
            cfg.secondary_color = secondaryColor ?? cfg.secondary_color
            cfg.logo_url = logoUrl ?? cfg.logo_url
            cfg.favicon_url = faviconUrl ?? cfg.favicon_url
            cfg.font_family = fontFamily ?? cfg.font_family
            cfg.template_key = templateKey ?? cfg.template_key
            cfg.extra = extra ?? cfg.extra
            await cfg.save()
        }
        return res.json(toDTO(cfg))
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'Server error' })
    }
}

export async function getSiteConfigPublic(req, res) {
    try {
        const cfg = await models.WcSiteConfig.findOne({ where: { tenant_id: req.tenant.id } })
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

export async function listAccounts(req, res) {
    try {
        const rows = await models.WcAccount.findAll({
            where: { tenant_id: req.tenant.id },
            order: [['id', 'ASC']],
            attributes: ['id', 'email', 'display_name', 'is_active', 'roles', 'permissions', 'createdAt', 'updatedAt']
        })
        res.json(rows.map(accountDTO))
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'Server error' })
    }
}

export async function createAccount(req, res) {
    try {
        const { email, displayName, password, roles = [], permissions = [], isActive = true } = req.body || {}

        if (!email || !password) return res.status(400).json({ error: 'Email y password requeridos' })
        const exists = await models.WcAccount.findOne({ where: { tenant_id: req.tenant.id, email } })
        if (exists) return res.status(409).json({ error: 'Email ya existe en este tenant' })

        const password_hash = await bcrypt.hash(password, 10)
        const acc = await models.WcAccount.create({
            tenant_id: req.tenant.id,
            email,
            display_name: displayName || email.split('@')[0],
            password_hash,
            is_active: !!isActive,
            roles,
            permissions
        })
        res.status(201).json(accountDTO(acc))
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'Server error' })
    }
}

export async function updateAccount(req, res) {
    try {
        const id = Number(req.params.id)
        const { email, displayName, roles, permissions, isActive, password } = req.body || {}

        const acc = await models.WcAccount.findOne({ where: { id, tenant_id: req.tenant.id } })
        if (!acc) return res.status(404).json({ error: 'No encontrado' })

        // seguridad: no dejar desactivarse a sí mismo ni quitarse permisos sin querer
        if (acc.id === req.user.accountId) {
            if (typeof isActive === 'boolean' && isActive === false) return res.status(400).json({ error: 'No podés desactivarte a vos mismo' })
        }

        if (email) {
            const dup = await models.WcAccount.findOne({
                where: { tenant_id: req.tenant.id, email, id: { [Op.ne]: id } }
            })
            if (dup) return res.status(409).json({ error: 'Email ya usado por otro usuario' })
            acc.email = email
        }

        if (displayName !== undefined) acc.display_name = displayName
        if (Array.isArray(roles)) acc.roles = roles
        if (Array.isArray(permissions)) acc.permissions = permissions
        if (typeof isActive === 'boolean') {
            if (acc.id === req.user.accountId && isActive === false) {
                return res.status(400).json({ error: 'No podés desactivarte a vos mismo' })
            }
            acc.is_active = isActive
        }
        if (password) acc.password_hash = await bcrypt.hash(password, 10)

        await acc.save()
        res.json(accountDTO(acc))
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'Server error' })
    }
}

export async function toggleAccountStatus(req, res) {
    try {
        const id = Number(req.params.id)
        const acc = await models.WcAccount.findOne({ where: { id, tenant_id: req.tenant.id } })
        if (!acc) return res.status(404).json({ error: 'No encontrado' })
        if (acc.id === req.user.accountId) return res.status(400).json({ error: 'No podés desactivarte a vos mismo' })
        acc.is_active = !acc.is_active
        await acc.save()
        res.json(accountDTO(acc))
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'Server error' })
    }
}

export async function resetAccountPassword(req, res) {
    try {
        const id = Number(req.params.id)
        const { password } = req.body || {}
        if (!password) return res.status(400).json({ error: 'Nueva contraseña requerida' })
        const acc = await models.WcAccount.findOne({ where: { id, tenant_id: req.tenant.id } })
        if (!acc) return res.status(404).json({ error: 'No encontrado' })
        acc.password_hash = await bcrypt.hash(password, 10)
        await acc.save()
        res.json({ ok: true })
    } catch (e) {
        console.error(e); res.status(500).json({ error: 'Server error' })
    }
}

export async function getHotelPublic(req, res) {
    try {
        const access = Number(req.tenant.externalHotelAccess)
        const hotelCode = String(req.tenant.externalHotelID)

        if (!access || !hotelCode) {
            return res.status(400).json({ error: 'Missing tenant hotel access/id' })
        }

        const cacheKey = `hotelPublic:${access}:${hotelCode}`
        const cached = await cache.get(cacheKey)
        if (cached) return res.json(cached)

        const criteria = {
            access,                    // número
            hotelCodes: [hotelCode],   // string[]
            maxSize: 1
        }

        const page = await fetchHotels(criteria, "")
        const edge = page?.edges?.[0]
        const hotelData = edge?.node?.hotelData

        if (!edge || !hotelData) {
            return res.status(404).json({ error: 'Hotel not found' })
        }

        // Mapeo plano “público”
        const response = {
            id: hotelData.hotelCode,
            name: hotelData.hotelName,
            categoryCode: hotelData.categoryCode,
            chainCode: hotelData.chainCode,
            location: hotelData.location,
            descriptions: hotelData.descriptions,
            medias: hotelData.medias,
            amenities: hotelData.allAmenities,
            // Podés agregar created/updated por si te sirven
            createdAt: edge.node.createdAt,
            updatedAt: edge.node.updatedAt
        }

        await cache.set(cacheKey, response, 120)
        res.json(response)
    } catch (e) {
        // 🧰 extrae detalle útil si viene de graphql-request
        const detail = e?.response?.errors?.[0]?.message || e.message
        console.error('getHotelPublic error:', detail)
        res.status(500).json({ error: 'Server error' })
    }
}