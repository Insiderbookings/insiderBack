
import models, { sequelize } from './src/models/index.js';

async function checkEvents() {
    try {
        console.log("Checking Analytics Events...");
        // Count by type
        const counts = await models.AnalyticsEvent.findAll({
            attributes: ['event_type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
            group: ['event_type']
        });

        console.table(counts.map(c => c.toJSON()));

        // Show last 10 events
        const rows = await models.AnalyticsEvent.findAll({
            limit: 10,
            order: [['createdAt', 'DESC']],
            raw: true
        });

        console.log("Last 10 Events:");
        console.table(rows);

    } catch (error) {
        console.error("Error:", error);
    } finally {
        await sequelize.close();
    }
}

checkEvents();
