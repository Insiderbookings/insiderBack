
import models, { sequelize } from './src/models/index.js';

(async () => {
    try {
        await sequelize.authenticate();

        // Get most recent booking
        const recent = await models.Stay.findOne({ order: [['id', 'DESC']] });

        if (recent) {
            console.log('Recent Booking JSON:', JSON.stringify(recent.toJSON(), null, 2));
        } else {
            console.log('No bookings found.');
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
})();
