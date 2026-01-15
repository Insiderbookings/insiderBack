import models from '../models/index.js';
const { ItineraryDay, ItineraryItem, Booking } = models;

const getItinerary = async (req, res) => {
    try {
        const { bookingId } = req.params;

        // Validate booking ownership/access here if needed in future middleware
        // For now assuming auth middleware handles basic user validation

        const days = await ItineraryDay.findAll({
            where: { booking_id: bookingId },
            include: [
                {
                    model: ItineraryItem,
                    as: 'items',
                }
            ],
            order: [
                ['date', 'ASC'],
                [{ model: ItineraryItem, as: 'items' }, 'time', 'ASC']
            ]
        });

        res.status(200).json(days);
    } catch (error) {
        console.error('Error fetching itinerary:', error);
        res.status(500).json({ message: 'Error fetching itinerary', error: error.message });
    }
};

const addItem = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { date, title, time, activity, description, icon, location, type } = req.body;
        const userId = req.user?.id; // Assuming auth middleware populates req.user

        // 1. Find or Create the Day
        let [day, created] = await ItineraryDay.findOrCreate({
            where: { booking_id: bookingId, date },
            defaults: { title: title || 'Day Plan' }
        });

        // 2. Add the Item
        const item = await ItineraryItem.create({
            itinerary_day_id: day.id,
            time,
            activity,
            description,
            icon,
            location,
            type: type || 'MANUAL',
            created_by: userId
        });

        res.status(201).json(item);
    } catch (error) {
        console.error('Error adding itinerary item:', error);
        res.status(500).json({ message: 'Error adding item', error: error.message });
    }
};

const updateItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const updates = req.body; // time, activity, description, etc.

        const item = await ItineraryItem.findByPk(itemId);
        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }

        await item.update(updates);
        res.status(200).json(item);
    } catch (error) {
        console.error('Error updating itinerary item:', error);
        res.status(500).json({ message: 'Error updating item', error: error.message });
    }
};

const deleteItem = async (req, res) => {
    try {
        const { itemId } = req.params;

        const item = await ItineraryItem.findByPk(itemId);
        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }

        await item.destroy();
        res.status(200).json({ message: 'Item deleted successfully' });
    } catch (error) {
        console.error('Error deleting itinerary item:', error);
        res.status(500).json({ message: 'Error deleting item', error: error.message });
    }
};

export default {
    getItinerary,
    addItem,
    updateItem,
    deleteItem
};
