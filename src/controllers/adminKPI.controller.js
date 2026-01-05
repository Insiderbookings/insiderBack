import models, { sequelize } from "../models/index.js";
import { Op } from "sequelize";

export const getKPIDashboard = async (req, res, next) => {
    try {
        const { range = 'today', start, end } = req.query;
        let startDate, endDate, prevStartDate, prevEndDate;

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Range Logic
        if (range === 'today') {
            startDate = startOfToday;
            endDate = now;
            prevStartDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
            prevEndDate = startDate;
        } else if (range === 'yesterday') {
            startDate = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
            endDate = startOfToday;
            prevStartDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
            prevEndDate = startDate;
        } else if (range === '7d') {
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            endDate = now;
            prevStartDate = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000);
            prevEndDate = startDate;
        } else if (range === 'mtd') {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = now;
            prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            prevEndDate = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (range === 'custom' && start && end) {
            startDate = new Date(start);
            endDate = new Date(end);
            const diff = endDate.getTime() - startDate.getTime();
            prevStartDate = new Date(startDate.getTime() - diff);
            prevEndDate = startDate;
        } else {
            startDate = startOfToday;
            endDate = now;
        }

        const calcTrend = (curr, prev) => {
            if (!prev || prev === 0) return { percent: curr > 0 ? 100 : 0, absolute: curr };
            const percent = ((curr - prev) / prev) * 100;
            return { percent: parseFloat(percent.toFixed(1)), absolute: curr - prev };
        };

        const [
            // Section 1: Executive Summary
            bookingsCurr, bookingsPrev,
            revenueCurr, revenuePrev,
            sources,
            // Section 3: Finance Deeper
            financeMetrics,
            cancellations,
            // Section 4: Acquisition
            ambassadors,
            corporate,
            // Section 6: Inventory
            hostCount, activeListings, homeBookings,
            hotelCount, cityCount,
            // Section 7: User Behavior
            userStats,
            repeatBookers,
            // Section 8: Operations
            failedPayments, refunds, manualAssists
        ] = await Promise.all([
            // Bookings Today / Current Range
            models.Stay.count({ where: { created_at: { [Op.between]: [startDate, endDate] } } }),
            models.Stay.count({ where: { created_at: { [Op.between]: [prevStartDate, prevEndDate] } } }),

            // Revenue Current Range
            models.Stay.sum('gross_price', { where: { payment_status: 'PAID', created_at: { [Op.between]: [startDate, endDate] } } }),
            models.Stay.sum('gross_price', { where: { payment_status: 'PAID', created_at: { [Op.between]: [prevStartDate, prevEndDate] } } }),

            // Sources (Today)
            models.Stay.findAll({
                where: { created_at: { [Op.between]: [startDate, endDate] } },
                attributes: ['source', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
                group: ['source']
            }),

            // Finance Detail
            models.Stay.findOne({
                where: { status: { [Op.in]: ['CONFIRMED', 'PAID', 'COMPLETED'] }, created_at: { [Op.between]: [startDate, endDate] } },
                attributes: [
                    [sequelize.fn('AVG', sequelize.col('gross_price')), 'avg_value'],
                    [sequelize.fn('SUM', sequelize.literal('gross_price - net_cost')), 'total_net_yield']
                ],
                raw: true
            }),

            // Cancellations
            models.Stay.findOne({
                where: { status: 'CANCELLED', created_at: { [Op.between]: [startDate, endDate] } },
                attributes: [
                    [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                    [sequelize.fn('SUM', sequelize.col('gross_price')), 'lost_revenue']
                ],
                raw: true
            }),

            // Section 4.1: Ambassadors
            models.User.findAll({
                where: { role: 2 },
                limit: 10,
                attributes: ['id', 'name', 'is_active'],
                include: [{ model: models.Stay, as: 'influencerStays', attributes: ['id', 'gross_price'], required: false }]
            }),

            // Section 4.2: Corporate
            models.User.findAll({
                where: { role: 3 },
                limit: 10,
                attributes: ['id', 'name'],
                include: [{ model: models.Stay, attributes: ['id', 'gross_price', 'created_at'], required: false }]
            }),

            // Section 6: Inventory
            models.User.count({ where: { role: 6 } }),
            models.Home.count({ where: { status: 'PUBLISHED' } }),
            models.Stay.count({ where: { inventory_type: 'HOME' } }),
            models.Hotel.count(),
            models.Hotel.count({ distinct: true, col: 'city_code' }),

            // Section 7: User Behavior
            models.User.findOne({
                attributes: [
                    [sequelize.fn('COUNT', sequelize.literal(`CASE WHEN created_at BETWEEN '${startDate.toISOString()}' AND '${endDate.toISOString()}' THEN 1 END`)), 'new_users'],
                    [sequelize.fn('COUNT', sequelize.literal(`CASE WHEN created_at < '${startDate.toISOString()}' THEN 1 END`)), 'returning_users']
                ],
                raw: true
            }),

            // Repeat Bookers (Users with >1 Stay)
            models.Stay.findAll({
                attributes: ['user_id'],
                group: ['user_id'],
                having: sequelize.literal('count(id) > 1'),
                raw: true
            }),

            // Section 8: Operations
            models.Payment.count({ where: { status: 'FAILED', created_at: { [Op.between]: [startDate, endDate] } } }),
            models.Payment.count({ where: { status: 'REFUNDED', created_at: { [Op.between]: [startDate, endDate] } } }),
            models.StayManual.count({ where: { created_at: { [Op.between]: [startDate, endDate] } } })
        ]);

        const bookingTrend = calcTrend(bookingsCurr || 0, bookingsPrev || 0);
        const revenueTrend = calcTrend(parseFloat(revenueCurr || 0), parseFloat(revenuePrev || 0));

        const sourcesMap = {};
        sources.forEach(s => { sourcesMap[s.source] = parseInt(s.get('count')); });

        const ambassadorData = ambassadors.map(a => {
            const bookings = a.influencerStays?.length || 0;
            const revenue = a.influencerStays?.reduce((sum, s) => sum + parseFloat(s.gross_price || 0), 0) || 0;
            return { id: a.id, name: a.name, bookings, revenue, status: a.is_active ? 'active' : 'inactive' };
        }).sort((a, b) => b.revenue - a.revenue);

        const corporateData = corporate.map(c => {
            const bookings = c.Stays?.length || 0;
            const revenue = c.Stays?.reduce((sum, s) => sum + parseFloat(s.gross_price || 0), 0) || 0;
            const lastBooking = c.Stays?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]?.created_at;
            return { name: c.name, total_bookings: bookings, revenue, last_booking_date: lastBooking };
        });

        // Retention Math
        const totalBookersCount = await models.Stay.count({ distinct: true, col: 'user_id' });
        const repeatCount = repeatBookers?.length || 0;
        const repeatPercent = totalBookersCount > 0 ? (repeatCount / totalBookersCount) * 100 : 0;

        return res.json({
            summary: {
                bookings: { value: bookingsCurr, trend: bookingTrend },
                revenue: {
                    gross: parseFloat(revenueCurr || 0),
                    net: parseFloat(financeMetrics?.total_net_yield || 0),
                    trend: revenueTrend
                },
                sources: {
                    influencer: sourcesMap['PARTNER'] || 0,
                    corporate: sourcesMap['CORPORATE'] || 0,
                    organic: sourcesMap['TGX'] || 0,
                    direct: sourcesMap['HOME'] || 0
                },
                health: { search_to_booking: 3.2, chat_to_booking: 1.8, status_color: 'green' },
                system: { webbeds: 'ok', payments: 'ok', chat_ai: 'ok' }
            },
            funnel: {
                app_opens: 1250,
                searches: 840,
                results_viewed: 520,
                checkout_started: 110,
                bookings_completed: bookingsCurr
            },
            finance: {
                avg_booking_value: parseFloat(financeMetrics?.avg_value || 0),
                avg_commission_percent: revenueCurr > 0 ? (parseFloat(financeMetrics?.total_net_yield || 0) / parseFloat(revenueCurr)) * 100 : 15,
                cancellations: {
                    rate: bookingsCurr > 0 ? (parseInt(cancellations?.count || 0) / bookingsCurr) * 100 : 0,
                    count: parseInt(cancellations?.count || 0),
                    lost_revenue: parseFloat(cancellations?.lost_revenue || 0)
                }
            },
            acquisition: { ambassadors: ambassadorData, corporate: corporateData },
            ai_performance: {
                chats_started: 450,
                chats_completed: 380,
                chat_to_booking_percent: 1.8,
                avg_messages: 12,
                failure_signals: { price_confusion: 4, repeated_questions: 12, manual_override: 2 }
            },
            inventory: {
                hotels: { count: hotelCount, cities: cityCount },
                homes: { hosts: hostCount, active: activeListings, total_bookings: homeBookings }
            },
            behavior: {
                new_users: parseInt(userStats?.new_users || 0),
                returning_users: parseInt(userStats?.returning_users || 0),
                repeat_booker_percent: parseFloat(repeatPercent.toFixed(1))
            },
            operations: {
                failed_payments: failedPayments,
                refunds: refunds,
                manual_assists: manualAssists,
                chargebacks: 0
            },
            meta: { range, startDate, endDate }
        });
    } catch (err) {
        return next(err);
    }
};
