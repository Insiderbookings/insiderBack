import express from 'express';
import itineraryController from '../controllers/itinerary.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/:bookingId', authenticate, itineraryController.getItinerary);
router.post('/:bookingId/item', authenticate, itineraryController.addItem);
router.put('/item/:itemId', authenticate, itineraryController.updateItem);
router.delete('/item/:itemId', authenticate, itineraryController.deleteItem);

export default router;
