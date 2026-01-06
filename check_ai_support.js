
import models, { sequelize } from './src/models/index.js';

(async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connected.');

        // Check AI Data
        const chatCount = await models.AiChatSession.count();
        const chatRecent = await models.AiChatSession.findOne({ order: [['createdAt', 'DESC']] });

        // Check Support Data
        const ticketCount = await models.SupportTicket.count();
        const ticketRecent = await models.SupportTicket.findOne({ order: [['createdAt', 'DESC']] });

        console.log('--- DIAGNOSTIC RESULTS ---');
        console.log(`Total AI Chat Sessions: ${chatCount}`);
        if (chatRecent) console.log(`Last Chat: ${chatRecent.createdAt}`);

        console.log(`Total Support Tickets: ${ticketCount}`);
        if (ticketRecent) console.log(`Last Ticket: ${ticketRecent.createdAt}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
})();
