
import models, { sequelize } from './src/models/index.js';

async function injectData() {
    try {
        console.log("Injecting fake analytics data...");

        const now = new Date();

        // Inject 5 Search events
        for (let i = 0; i < 5; i++) {
            await models.AnalyticsEvent.create({
                event_type: 'search',
                metadata: { destination: 'Miami', source: 'injection_script' },
                url: 'http://localhost/fake',
                ip_address: '127.0.0.1',
                createdAt: now
            });
        }
        console.log("-> 5 Search events added.");

        // Inject 3 View Results
        for (let i = 0; i < 3; i++) {
            await models.AnalyticsEvent.create({
                event_type: 'view_results',
                createdAt: now
            });
        }
        console.log("-> 3 View Results events added.");

        // Inject 1 Checkout Start
        await models.AnalyticsEvent.create({
            event_type: 'checkout_start',
            createdAt: now
        });
        console.log("-> 1 Checkout Start event added.");

    } catch (error) {
        console.error("Error:", error);
    } finally {
        await sequelize.close();
    }
}

injectData();
