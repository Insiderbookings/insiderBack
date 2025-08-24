// routes/tenants.webconstructor.routes.js
import { Router } from 'express'
import { resolveTenant } from '../middleware/resolveTenant.js'
import { authenticate } from '../middleware/auth.js'
import { authorizeWc, authorizeWcPermission } from '../middleware/webconstructorAuth.js'
import {
    wcLogin, wcMe,
    getSiteConfigPrivate, updateSiteConfigPrivate, getSiteConfigPublic, getHotelPublic, listTemplates,
    listAccounts, createAccount, updateAccount, toggleAccountStatus, resetAccountPassword
} from '../controllers/webconstructor.controller.js'

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

/* ===========================
 *  ACCOUNTS (ABM del panel)
 *  Permiso requerido: MANAGE_ACCOUNTS
 * =========================== */
router.get(
    '/webconstructor/accounts',
    resolveTenant,
    authenticate,
    authorizeWc,
    authorizeWcPermission('MANAGE_ACCOUNTS'),
    listAccounts
)

router.post(
    '/webconstructor/accounts',
    resolveTenant,
    authenticate,
    authorizeWc,
    authorizeWcPermission('MANAGE_ACCOUNTS'),
    createAccount
)

router.put(
    '/webconstructor/accounts/:id',
    resolveTenant,
    authenticate,
    authorizeWc,
    authorizeWcPermission('MANAGE_ACCOUNTS'),
    updateAccount
)

router.patch(
    '/webconstructor/accounts/:id/status',
    resolveTenant,
    authenticate,
    authorizeWc,
    authorizeWcPermission('MANAGE_ACCOUNTS'),
    toggleAccountStatus
)

router.post(
    '/webconstructor/accounts/:id/reset-password',
    resolveTenant,
    authenticate,
    authorizeWc,
    authorizeWcPermission('MANAGE_ACCOUNTS'),
    resetAccountPassword
)

export default router
