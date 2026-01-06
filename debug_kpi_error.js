import models, { sequelize } from './src/models/index.js';
import { Op } from 'sequelize';

const runDebug = async () => {
    try {
        console.log("Authenticating DB...");
        await sequelize.authenticate();
        console.log("DB Connected.");

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startDate = startOfToday;
        const endDate = now;

        console.log("Running Complex Queries...");

        // 1. Finance Detail
        console.log("--- TEST 1: Finance Detail ---");
        try {
            await models.Stay.findOne({
                where: { payment_status: 'PAID', createdAt: { [Op.between]: [startDate, endDate] } },
                attributes: [
                    [sequelize.fn('AVG', sequelize.col('gross_price')), 'avg_value'],
                    [sequelize.fn('SUM', sequelize.literal('gross_price - net_cost')), 'total_net_yield']
                ],
                raw: true
            });
            console.log("PASS: Finance Detail");
        } catch (e) { console.error("FAIL: Finance Detail", e); }

        // 2. Daily Revenue (FIXED for Postgres)
        console.log("--- TEST 2: Daily Revenue (FIXED) ---");
        try {
            await models.Stay.findAll({
                where: {
                    payment_status: 'PAID',
                    createdAt: { [Op.gte]: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }
                },
                attributes: [
                    [sequelize.fn('DATE_TRUNC', 'day', sequelize.col('created_at')), 'date'],
                    [sequelize.fn('SUM', sequelize.col('gross_price')), 'daily_gross']
                ],
                group: [sequelize.fn('DATE_TRUNC', 'day', sequelize.col('created_at'))],
                order: [[sequelize.fn('DATE_TRUNC', 'day', sequelize.col('created_at')), 'ASC']],
                raw: true
            });
            console.log("PASS: Daily Revenue (FIXED)");
        } catch (e) { console.error("FAIL: Daily Revenue", e); }

        // 3. User Behavior
        console.log("--- TEST 3: User Behavior ---");
        try {
            await models.User.findOne({
                attributes: [
                    [sequelize.fn('COUNT', sequelize.literal(`CASE WHEN created_at BETWEEN '${startDate.toISOString()}' AND '${endDate.toISOString()}' THEN 1 END`)), 'new_users'],
                    [sequelize.fn('COUNT', sequelize.literal(`CASE WHEN created_at < '${startDate.toISOString()}' THEN 1 END`)), 'returning_users']
                ],
                raw: true
            });
            console.log("PASS: User Behavior");
        } catch (e) { console.error("FAIL: User Behavior", e); }

        // 4. Repeat Bookers
        console.log("--- TEST 4: Repeat Bookers ---");
        try {
            await models.Stay.findAll({
                attributes: ['user_id'],
                group: ['user_id'],
                having: sequelize.literal('count(id) > 1'),
                raw: true
            });
            console.log("PASS: Repeat Bookers");
        } catch (e) { console.error("FAIL: Repeat Bookers", e); }

        console.log("Done.");
        process.exit(0);
    } catch (error) {
        console.error("FATAL SCRIPT ERROR:", error);
        process.exit(1);
    }
};

runDebug();
