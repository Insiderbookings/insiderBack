import { Router } from 'express'
import { resolveTenant } from '../middleware/resolveTenant.js'
import { authenticate } from '../middleware/auth.js'
import { authorizeWc } from '../middleware/webconstructorAuth.js'
import { getQueueCount, claimNext, markDelivered, getActiveForOperator, revealCard } from '../controllers/vcc.controller.js'

const router = Router()

// Operator scope (Webconstructor Panel) – per-tenant
router.get('/webconstructor/vcc/queue/count', resolveTenant, authenticate, authorizeWc, getQueueCount)
router.post('/webconstructor/vcc/queue/claim', resolveTenant, authenticate, authorizeWc, claimNext)
router.post('/webconstructor/vcc/:id/deliver', resolveTenant, authenticate, authorizeWc, markDelivered)
router.get('/webconstructor/vcc/active', resolveTenant, authenticate, authorizeWc, getActiveForOperator)
router.get('/webconstructor/vcc/:id/reveal', resolveTenant, authenticate, authorizeWc, revealCard)

export default router
