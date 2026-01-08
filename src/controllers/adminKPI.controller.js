
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
        } else if (range === '30d') {
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            endDate = now;
            prevStartDate = new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000);
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
            prevStartDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
            prevEndDate = startDate;
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
            dailyRevenue, // For charts/totals
            // Section 4: Acquisition
            ambassadors,
            corporate,
            // Section 6: Inventory
            hostCount, activeListings, homeBookings,
            hotelCount, cityCount, homeMargin,
            // Section 7: User Behavior
            userStats,
            repeatBookers,
            totalBookers,
            // Section 8: Operations
            failedPayments, refunds, manualAssists,
            // Section 5: AI & Support
            aiChatsStarted,
            aiChatsCompleted,
            aiTotalMessages,
            aiSessionsWithResults,
            ticketCount,
            // Funnel
            fAll, fSearch, fResults, fCheckout,
            ambassadorClicks
        ] = await Promise.all([
            // Bookings Today / Current Range
            models.Stay.count({ where: { createdAt: { [Op.between]: [startDate, endDate] } } }),
            models.Stay.count({ where: { createdAt: { [Op.between]: [prevStartDate, prevEndDate] } } }),

            // Revenue Current Range
            models.Stay.sum('gross_price', { where: { payment_status: 'PAID', createdAt: { [Op.between]: [startDate, endDate] } } }),
            models.Stay.sum('gross_price', { where: { payment_status: 'PAID', createdAt: { [Op.between]: [prevStartDate, prevEndDate] } } }),

            // Sources (Today)
            models.Stay.findAll({
                where: { createdAt: { [Op.between]: [startDate, endDate] } },
                attributes: ['source', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
                group: ['source']
            }),

            // Finance Detail
            models.Stay.findOne({
                where: { payment_status: 'PAID', createdAt: { [Op.between]: [startDate, endDate] } },
                attributes: [
                    [sequelize.fn('AVG', sequelize.col('gross_price')), 'avg_value'],
                    [sequelize.fn('SUM', sequelize.literal('gross_price - net_cost')), 'total_net_yield']
                ],
                raw: true
            }),

            // Cancellations
            models.Stay.findOne({
                where: { status: 'CANCELLED', createdAt: { [Op.between]: [startDate, endDate] } },
                attributes: [
                    [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                    [sequelize.fn('SUM', sequelize.col('gross_price')), 'lost_revenue']
                ],
                raw: true
            }),

            // Daily Revenue (Last 7 days strictly for chart/trend)
            models.Stay.findAll({
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
            }),

            // Section 4.1: Ambassadors
            models.User.findAll({
                where: { role: 2 },
                limit: 10,
                attributes: ['id', 'name', 'is_active', 'user_code'],
                include: [{ model: models.Stay, as: 'influencerStays', attributes: ['id', 'gross_price'], required: false }]
            }),

            // Section 4.2: Corporate
            models.User.findAll({
                where: { role: 3 },
                limit: 10,
                attributes: ['id', 'name'],
                include: [{ model: models.Stay, attributes: ['id', 'gross_price', 'createdAt'], required: false }]
            }),

            // Section 6: Inventory
            models.User.count({ where: { role: 6 } }),
            models.Home.count({ where: { status: 'PUBLISHED' } }),
            models.Stay.count({ where: { inventory_type: 'HOME' } }),
            models.Hotel.count(),
            models.Hotel.count({ distinct: true, col: 'city' }),
            // Real Margin Calculation for Homes
            models.Stay.findOne({
                where: { inventory_type: 'HOME', payment_status: 'PAID', gross_price: { [Op.gt]: 0 } },
                attributes: [[sequelize.literal('AVG((gross_price - net_cost) / gross_price * 100)'), 'avg_margin']],
                raw: true
            }),

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
            models.Stay.count({ distinct: true, col: 'user_id' }), // Total bookers count

            // Section 8: Operations
            models.Payment.count({ where: { status: 'FAILED', createdAt: { [Op.between]: [startDate, endDate] } } }),
            models.Payment.count({ where: { status: 'REFUNDED', createdAt: { [Op.between]: [startDate, endDate] } } }),
            models.StayManual.count({ where: { createdAt: { [Op.between]: [startDate, endDate] } } }),

            // NEW: Real Intelligence Data (AI & Support)
            models.AiChatSession.count({ where: { createdAt: { [Op.between]: [startDate, endDate] } } }),
            models.AiChatSession.count({ where: { createdAt: { [Op.between]: [startDate, endDate] }, message_count: { [Op.gte]: 3 } } }),
            models.AiChatSession.sum('message_count', { where: { createdAt: { [Op.between]: [startDate, endDate] } } }),
            models.AiChatSession.count({
                where: {
                    createdAt: { [Op.between]: [startDate, endDate] },
                    [Op.and]: [
                        { metadata: { [Op.not]: null } },
                        sequelize.where(sequelize.json("metadata.lastInventorySnapshot"), { [Op.not]: null }),
                    ],
                },
            }),
            models.SupportTicket.count({ where: { createdAt: { [Op.between]: [startDate, endDate] } } }),

            // NEW: Funnel Real Data
            models.AnalyticsEvent.count({ where: { event_type: 'app_open', createdAt: { [Op.between]: [startDate, endDate] } } }),
            models.AnalyticsEvent.count({ where: { event_type: 'search', createdAt: { [Op.between]: [startDate, endDate] } } }),
            models.AnalyticsEvent.count({ where: { event_type: 'view_results', createdAt: { [Op.between]: [startDate, endDate] } } }),
            models.AnalyticsEvent.count({ where: { event_type: 'checkout_start', createdAt: { [Op.between]: [startDate, endDate] } } }),

            // Ambassador Clicks (Real)
            models.AnalyticsEvent.findAll({
                where: { event_type: 'referral_click', createdAt: { [Op.between]: [startDate, endDate] } },
                attributes: [
                    [sequelize.literal("metadata->>'$.code'"), 'code'],
                    [sequelize.fn('COUNT', sequelize.col('id')), 'count']
                ],
                group: [sequelize.literal("metadata->>'$.code'")],
                raw: true
            })
        ]);

        const bookingTrend = calcTrend(bookingsCurr || 0, bookingsPrev || 0);
        const revenueTrend = calcTrend(parseFloat(revenueCurr || 0), parseFloat(revenuePrev || 0));

        const sourcesMap = {};
        sources.forEach(s => { sourcesMap[s.source] = parseInt(s.get('count')); });

        // Map Clicks to Ambassadors
        const clicksMap = {};
        (ambassadorClicks || []).forEach((row) => {
            const code = row?.code ? String(row.code) : null;
            const count = parseInt(row?.count || 0, 10);
            if (!code) return;
            clicksMap[code] = count;
        });

        const ambassadorData = (ambassadors || []).map((amb) => {
            const stays = amb.influencerStays || [];
            const revenue = stays.reduce((sum, s) => sum + parseFloat(s.gross_price || 0), 0);
            const code = amb.user_code ? String(amb.user_code) : null;
            return {
                id: amb.id,
                name: amb.name,
                bookings: stays.length,
                revenue,
                status: amb.is_active ? 'active' : 'inactive',
                clicks: code ? (clicksMap[code] || 0) : 0
            };
        });

        const corporateData = corporate.map(c => {
            const bookings = c.Stays?.length || 0;
            const revenue = c.Stays?.reduce((sum, s) => sum + parseFloat(s.gross_price || 0), 0) || 0;
            const lastBooking = c.Stays?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]?.created_at;
            return {
                name: c.name,
                total_bookings: bookings,
                revenue,
                avg_booking_value: bookings > 0 ? revenue / bookings : 0,
                repeat_booking_rate: bookings > 1 ? '100%' : '0%', // Simplified
                last_booking_date: lastBooking
            };
        });

        // Retention Math
        const repeatCount = repeatBookers?.length || 0;
        const repeatPercent = totalBookers > 0 ? (repeatCount / totalBookers) * 100 : 0;

        // AI Math
        const chatsStarted = aiChatsStarted || 0;
        const chatsCompleted = aiChatsCompleted || 0;
        const totalMessages = aiTotalMessages || 0;
        const sessionsWithResults = aiSessionsWithResults || 0;
        const avgMsg = chatsStarted > 0 ? Math.round(totalMessages / chatsStarted) : 0;
        const dropOffs = Math.max(chatsStarted - chatsCompleted, 0);
        const noResults = Math.max(chatsStarted - sessionsWithResults, 0);

        // Alerts Logic
        const alerts = [];
        const conversionRate = fSearch > 0 ? (bookingsCurr / fSearch) * 100 : 0;

        if (conversionRate < 1 && fSearch > 10) {
            alerts.push({ type: 'CRITICAL', title: 'Conversion Drop', message: `Search-to-Booking conversion is critically low (${conversionRate.toFixed(1)}%). Check pricing or availability.` });
        }
        if (manualAssists > 3) {
            alerts.push({ type: 'WARNING', title: 'High Manual Assist', message: `Operations team is handling high volume of manual bookings (${manualAssists}).` });
        }
        if (failedPayments > 5) {
            alerts.push({ type: 'CRITICAL', title: 'Payment Gateway Issue', message: `Detected ${failedPayments} failed payments in the selected period.` });
        }
        if (ambassadorData.some(a => a.status === 'inactive' && a.revenue > 1000)) {
            alerts.push({ type: 'INFO', title: 'Inactive Top Ambassador', message: 'One of your top ambassadors has become inactive.' });
        }

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
                health: {
                    search_to_booking: conversionRate.toFixed(2),
                    chat_to_booking: chatsStarted > 0 ? ((bookingsCurr / chatsStarted) * 100).toFixed(1) : 0,
                    status_color: conversionRate > 2.5 ? 'green' : conversionRate > 1.5 ? 'yellow' : 'red'
                },
                system: { webbeds: 'ok', payments: failedPayments > 10 ? 'degraded' : 'ok', chat_ai: 'ok' }
            },
            funnel: {
                app_opens: fAll,
                searches: fSearch,
                results_viewed: fResults,
                checkout_started: fCheckout,
                bookings_completed: bookingsCurr
            },
            finance: {
                avg_booking_value: parseFloat(financeMetrics?.avg_value || 0),
                avg_commission_percent: revenueCurr > 0 ? (parseFloat(financeMetrics?.total_net_yield || 0) / parseFloat(revenueCurr)) * 100 : 15,
                daily_revenue: dailyRevenue,
                weekly_revenue: [], // Could aggregate dailyRevenue into weeks if needed
                monthly_revenue_mtd: parseFloat(revenueCurr || 0), // If range is MTD, else query separately. For now using current range total.
                cancellations: {
                    rate: bookingsCurr > 0 ? (parseInt(cancellations?.count || 0) / bookingsCurr) * 100 : 0,
                    count: parseInt(cancellations?.count || 0),
                    lost_revenue: parseFloat(cancellations?.lost_revenue || 0)
                }
            },
            acquisition: { ambassadors: ambassadorData, corporate: corporateData },
            ai_performance: {
                chats_started: chatsStarted,
                chats_completed: chatsCompleted,
                chat_to_booking_percent: chatsStarted > 0 ? ((bookingsCurr / chatsStarted) * 100).toFixed(1) : 0,
                avg_messages: avgMsg,
                failure_signals: { drop_offs: dropOffs, no_results: noResults, manual_override: manualAssists }
            },
            inventory: {
                hotels: { count: hotelCount, cities: cityCount },
                homes: {
                    hosts: hostCount,
                    active: activeListings,
                    total_bookings: homeBookings,
                    avg_margin: homeMargin ? parseFloat(parseFloat(homeMargin.avg_margin).toFixed(1)) : 0
                },
                supply_health: { availability_failures: 0, price_mismatch: 0 } // Placeholders
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
                tickets: ticketCount,
                chargebacks: 0
            },
            alerts: alerts,
            meta: { range, startDate, endDate }
        });
    } catch (err) {
        console.error("[KPI_DASHBOARD_ERROR]", err);
        return res.status(500).json({
            error: "KPI Dashboard Error",
            message: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
};
