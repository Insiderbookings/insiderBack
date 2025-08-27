// routes/tenants.webconstructor.routes.js
import { Router } from 'express'
import { resolveTenant } from '../middleware/resolveTenant.js'
import { authenticate } from '../middleware/auth.js'
import { authorizeWc, authorizeWcPermission } from '../middleware/webconstructorAuth.js'
import {
    wcLogin, wcMe,
    getSiteConfigPrivate, updateSiteConfigPrivate, getSiteConfigPublic, getHotelPublic, listTemplates
} from '../controllers/webconstructor.controller.js'
import { uploadImagesToS3Fields } from '../middleware/s3UploadFields.js'

const router = Router()

/* ===========================
 *  AUTH
 * =========================== */
router.post(
    '/webconstructor/login',
    resolveTenant,
    wcLogin
)

router.get(
    '/webconstructor/me',
    resolveTenant,
    authenticate,
    authorizeWc,
    wcMe
)

/* ===========================
 *  TEMPLATES (catálogo admin)
 * =========================== */
router.get(
    '/webconstructor/templates',
    resolveTenant,
    authenticate,
    authorizeWc,
    authorizeWcPermission('SITE_CONFIG'),
    listTemplates
)

/* ===========================
 *  SITE CONFIG (admin)
 * =========================== */
router.get(
    '/webconstructor/site-config',
    resolveTenant,
    authenticate,
    authorizeWc,
    authorizeWcPermission('SITE_CONFIG'),
    getSiteConfigPrivate
)

router.put(
    '/webconstructor/site-config',
    resolveTenant,
    authenticate,
    authorizeWc,
    authorizeWcPermission('SITE_CONFIG'),
    uploadImagesToS3Fields({ logo: 'logoUrl', favicon: 'faviconUrl' }),
    updateSiteConfigPrivate
)

/* ===========================
 *  SITE CONFIG (público)
 * =========================== */
router.get(
    '/webconstructor/site/config',
    resolveTenant,
    getSiteConfigPublic
)

router.get(
    '/webconstructor/hotel',
    resolveTenant,
    getHotelPublic
)

export default router
