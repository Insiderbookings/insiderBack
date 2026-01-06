
import models, { sequelize } from './src/models/index.js';

(async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connected.');

        const count = await models.Stay.count();
        const recent = await models.Stay.findOne({ order: [['created_at', 'DESC']] });

        console.log(`Total Bookings (Stay model -> 'booking' table): ${count}`);
        if (recent) {
            console.log(`Most recent booking ID: ${recent.id}`);
            console.log(`Created At: ${recent.created_at}`);
        } else {
            console.log('No bookings found in the database.');
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
})();
