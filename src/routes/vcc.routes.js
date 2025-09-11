import { Router } from 'express'
import { getQueueCount, claimNext, markDelivered, getActiveForOperator, revealCard, getHistoryForOperator, markPaidByOperator } from '../controllers/vcc.controller.js'
import { resolveTenant } from '../middleware/resolveTenant.js'
import { authenticate } from '../middleware/auth.js'
import { authorizeWc, authorizeWcPermission } from '../middleware/webconstructorAuth.js'
const router = Router()

// Operator scope (Webconstructor Panel) â€“ per-tenant
router.get('/webconstructor/vcc/queue/count', resolveTenant, authenticate, authorizeWc, getQueueCount)
router.post('/webconstructor/vcc/queue/claim', resolveTenant, authenticate, authorizeWc, claimNext)
router.post('/webconstructor/vcc/:id/deliver', resolveTenant, authenticate, authorizeWc, markDelivered)
router.get('/webconstructor/vcc/active', resolveTenant, authenticate, authorizeWc, getActiveForOperator)
router.get('/webconstructor/vcc/:id/reveal', resolveTenant, authenticate, authorizeWc, revealCard)
router.get('/webconstructor/vcc/history', resolveTenant, authenticate, authorizeWc, getHistoryForOperator)
router.post('/webconstructor/vcc/:id/mark-paid', resolveTenant, authenticate, authorizeWc, markPaidByOperator)

export default router

