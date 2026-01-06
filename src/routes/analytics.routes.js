
import { Router } from 'express';
import { trackEvent } from '../controllers/analytics.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Allow unauthenticated tracking (e.g. app open before login), 
// but if token is present, controller handles it.
// We might use "optionalAuth" middleware if available, but for now 
// we rely on the controller checking req.user if populated by a global middleware,
// or just accepting the request. 
// Standard approach: Public endpoint, backend tries to parse token if header exists.

router.post('/track', trackEvent);

export default router;
