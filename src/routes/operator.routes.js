import { Router } from 'express'
import { resolveTenant } from '../middleware/resolveTenant.js'
import { authenticate } from '../middleware/auth.js'
import { authorizeOperator } from '../middleware/operatorAuth.js'
import {
  getQueueCount,
  claimNext,
  markDelivered,
  getActiveForOperator,
  revealCard,
  getHistoryForOperator,
  markPaidByOperator,
  createOperatorCheckout,
  createOperatorIntent,
  verifyOperatorCheckout,
} from '../controllers/vcc.controller.js'
import { listMyTenants } from '../controllers/operator.controller.js'
import { getSiteConfigPublic, getHotelPublic, getSiteConfigPrivate, updateSiteConfigPrivate, listTemplates } from '../controllers/webconstructor.controller.js'
import { uploadImagesToS3Fields } from '../middleware/s3UploadFields.js'
import {
  listOperatorTransfers,
  createOperatorTransfer,
  getOperatorTransferStats,
  claimOperatorTransfer,
  getActiveOperatorTransfer,
  createOperatorTransferIntent,
  verifyOperatorTransferCheckout,
  completeOperatorTransfer,
  getOperatorTransferHistory
} from '../controllers/operatorTransfer.controller.js'

// Operator-facing VCC routes, using Insider auth + role (no WcAccount)
// Tenant is resolved via X-Tenant-Domain header or ?host=domain (same as WC panel)

const router = Router()

router.get('/vcc/queue/count', resolveTenant, authenticate, authorizeOperator, getQueueCount)
router.post('/vcc/queue/claim', resolveTenant, authenticate, authorizeOperator, claimNext)
router.post('/vcc/:id/deliver', resolveTenant, authenticate, authorizeOperator, markDelivered)
router.get('/vcc/active', resolveTenant, authenticate, authorizeOperator, getActiveForOperator)
router.get('/vcc/:id/reveal', resolveTenant, authenticate, authorizeOperator, revealCard)
router.get('/vcc/history', resolveTenant, authenticate, authorizeOperator, getHistoryForOperator)
router.post('/vcc/:id/mark-paid', resolveTenant, authenticate, authorizeOperator, markPaidByOperator)
router.post('/vcc/:id/create-checkout', resolveTenant, authenticate, authorizeOperator, createOperatorCheckout)
router.post('/vcc/:id/create-intent', resolveTenant, authenticate, authorizeOperator, createOperatorIntent)
router.get('/vcc/checkout/verify', resolveTenant, authenticate, authorizeOperator, verifyOperatorCheckout)

router.get('/transfers/stats', resolveTenant, authenticate, authorizeOperator, getOperatorTransferStats)
router.post('/transfers/claim', resolveTenant, authenticate, authorizeOperator, claimOperatorTransfer)
router.get('/transfers/active', resolveTenant, authenticate, authorizeOperator, getActiveOperatorTransfer)
router.post('/transfers/:id/create-intent', resolveTenant, authenticate, authorizeOperator, createOperatorTransferIntent)
router.get('/transfers/:id/checkout/verify', resolveTenant, authenticate, authorizeOperator, verifyOperatorTransferCheckout)
router.post('/transfers/:id/complete', resolveTenant, authenticate, authorizeOperator, completeOperatorTransfer)
router.get('/transfers', resolveTenant, authenticate, authorizeOperator, listOperatorTransfers)
router.post('/transfers', resolveTenant, authenticate, authorizeOperator, createOperatorTransfer)
router.get(
  '/transfers/history',
  resolveTenant,
  authenticate,
  authorizeOperator,
  getOperatorTransferHistory
)

router.get('/tenants', authenticate, authorizeOperator, listMyTenants)

// Read-only site info for operator panel
router.get('/site-config', resolveTenant, authenticate, authorizeOperator, getSiteConfigPublic)
router.get('/hotel', resolveTenant, authenticate, authorizeOperator, getHotelPublic)
// Editable site-config for operators (reuses WC controller)
router.get('/site-config/private', resolveTenant, authenticate, authorizeOperator, getSiteConfigPrivate)
router.put('/site-config', resolveTenant, authenticate, authorizeOperator, uploadImagesToS3Fields({ logo: 'logoUrl', favicon: 'faviconUrl' }), updateSiteConfigPrivate)
router.get('/templates', resolveTenant, authenticate, authorizeOperator, listTemplates)

export default router

