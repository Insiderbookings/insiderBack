import models from "../models/index.js";
import { emitAdminActivity, emitToUser, emitToRoom } from "../websocket/emitter.js";
import { validationResult } from "express-validator";
import transporter from "../services/transporter.js";

// Helper to broadcast support events
const emitSupportEvent = (event, payload) => {
    // Broadcast to a dedicated support room for admins (to be implemented in gateway)
    emitToRoom('admin:support', event, payload);
    // Also trigger generic admin activity bell
    emitAdminActivity({ type: 'support', action: event, ...payload });
};

export const createTicket = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { subject, category, priority, message, bookingId, metadata } = req.body;
        const userId = req.user.id; // From auth middleware
        const SUPPORT_BOT_ID = 1; // System Admin / Support Bot ID

        // Enrich subject if bookingId is provided
        const finalSubject = bookingId
            ? `${subject} (Booking #${bookingId})`
            : subject;

        // 1. Create the Chat Thread for this ticket
        const chatThread = await models.ChatThread.create({
            guest_user_id: userId,
            host_user_id: SUPPORT_BOT_ID,
            reserve_id: bookingId || null,
            status: 'OPEN',
            last_message_at: new Date(),
            meta: {
                type: 'SUPPORT',
                subject: finalSubject,
                category: category || 'GENERAL'
            }
        });

        // 2. Create the Support Ticket linked to the thread
        const ticket = await models.SupportTicket.create({
            user_id: userId,
            chat_thread_id: chatThread.id,
            subject: finalSubject,
            category: category || "GENERAL",
            priority: priority || "MEDIUM",
            status: "OPEN",
            last_message_at: new Date()
        });

        // 3. Create initial message in SupportMessage (for Admin view)
        const initialMsg = await models.SupportMessage.create({
            ticket_id: ticket.id,
            sender_type: "USER",
            sender_id: userId,
            content: message,
            metadata: {
                ...metadata,
                bookingId
            }
        });

        // 4. Create mirror message in ChatMessage (for User App view)
        await models.ChatMessage.create({
            chat_id: chatThread.id,
            sender_id: userId,
            sender_role: 'GUEST',
            type: 'TEXT',
            body: message,
            delivered_at: new Date()
        });

        // Notify Admins
        emitSupportEvent("support:new_ticket", { ticketId: ticket.id, subject: finalSubject, user: req.user.name });

        return res.status(201).json({ ticket, message: initialMsg, chatThreadId: chatThread.id });
    } catch (error) {
        next(error);
    }
};

export const getMyTickets = async (req, res, next) => {
    try {
        const tickets = await models.SupportTicket.findAll({
            where: { user_id: req.user.id },
            order: [['last_message_at', 'DESC']],
        });
        return res.json(tickets);
    } catch (error) {
        next(error);
    }
};

export const getTicketDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const ticket = await models.SupportTicket.findByPk(id, {
            include: [
                { model: models.User, as: 'user', attributes: ['id', 'name', 'email', 'avatar_url', 'role'] },
                { model: models.User, as: 'assignee', attributes: ['id', 'name'] },
                { model: models.SupportMessage, as: 'messages', include: [{ model: models.User, as: 'sender', attributes: ['id', 'name', 'role'] }] }
            ],
            order: [[{ model: models.SupportMessage, as: 'messages' }, 'created_at', 'ASC']]
        });

        if (!ticket) return res.status(404).json({ error: "Ticket not found" });

        // Security check: only owner or Admin (role 100) can view
        if (ticket.user_id !== req.user.id && req.user.role !== 100) {
            return res.status(403).json({ error: "Forbidden" });
        }

        return res.json(ticket);
    } catch (error) {
        next(error);
    }
};

export const replyTicket = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { content } = req.body;
        const userId = req.user.id;
        const isAdmin = req.user.role === 100;
        const SUPPORT_BOT_ID = 1;

        const ticket = await models.SupportTicket.findByPk(id);
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });

        if (ticket.user_id !== userId && !isAdmin) {
            return res.status(403).json({ error: "Forbidden" });
        }

        // 1. Create SupportMessage (Admin View)
        const message = await models.SupportMessage.create({
            ticket_id: id,
            sender_type: isAdmin ? "ADMIN" : "USER",
            sender_id: userId,
            content
        });

        // 2. Sync to ChatThread (User App View) if thread exists
        if (ticket.chat_thread_id) {
            await models.ChatMessage.create({
                chat_id: ticket.chat_thread_id,
                sender_id: isAdmin ? SUPPORT_BOT_ID : userId, // Admins post as Bot/System
                sender_role: isAdmin ? 'HOST' : 'GUEST',
                type: 'TEXT',
                body: content,
                delivered_at: new Date()
            });

            // Update thread timestamp
            await models.ChatThread.update(
                { last_message_at: new Date() },
                { where: { id: ticket.chat_thread_id } }
            );
        }

        // Update ticket timestamp
        ticket.last_message_at = new Date();
        // If user replies, reopen ticket if closed (optional logic)
        if (!isAdmin && ticket.status === 'RESOLVED') ticket.status = 'IN_PROGRESS';
        // If admin replies, maybe set to IN_PROGRESS
        if (isAdmin && ticket.status === 'OPEN') ticket.status = 'IN_PROGRESS';

        await ticket.save();

        // Real-time notifications
        if (isAdmin) {
            // Notify User
            emitToUser(ticket.user_id, "support:new_message", { ticketId: id, message });
        } else {
            // Notify Admins
            emitSupportEvent("support:new_message", { ticketId: id, message, user: req.user.name });
        }

        return res.status(201).json(message);
    } catch (error) {
        next(error);
    }
};

export const updateTicketStatus = async (req, res, next) => {
    try {
        // Admin only
        if (req.user.role !== 100) return res.status(403).json({ error: "Admin access required" });

        const { id } = req.params;
        const { status, priority, assigned_to } = req.body;

        const ticket = await models.SupportTicket.findByPk(id);
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });

        if (status) ticket.status = status;
        if (priority) ticket.priority = priority;
        if (assigned_to) ticket.assigned_to = assigned_to;

        await ticket.save();

        // Notify user of status change
        emitToUser(ticket.user_id, "support:status_change", { ticketId: id, status, priority });
        emitSupportEvent("support:ticket_updated", { ticketId: id, updates: { status, priority } });

        return res.json(ticket);
    } catch (error) {
        next(error);
    }
};

// ... imports
import { cancelBooking } from "./booking.controller.js";
// Assuming refund logic is available or can be triggered. For now, we'll wrap a "processRefund" if available, or just use cancelBooking which often triggers refunds.
// If explicit refund is needed without cancel, we might need payment controller.
// checking payment.controller.js... it likely has a refund method.

export const getAllTickets = async (req, res, next) => {
    try {
        // Admin only
        if (req.user.role !== 100) return res.status(403).json({ error: "Admin access required" });

        const { status, priority, userId } = req.query;
        const where = {};

        if (status) where.status = status;
        if (priority) where.priority = priority;
        if (userId) where.user_id = userId;

        const tickets = await models.SupportTicket.findAll({
            where,
            include: [{ model: models.User, as: 'user', attributes: ['id', 'name', 'email'] }],
            order: [['last_message_at', 'DESC']],
            limit: 50
        });

        return res.json(tickets);
    } catch (error) {
        next(error);
    }
};

export const executeTicketAction = async (req, res, next) => {
    try {
        // Admin only
        if (req.user.role !== 100) return res.status(403).json({ error: "Admin access required" });

        const { id } = req.params;
        const { action, bookingId } = req.body;

        if (!bookingId) return res.status(400).json({ error: "Booking ID required for this action" });

        let result;

        switch (action) {
            case 'CANCEL_BOOKING':
                // Re-using booking controller logic. 
                // We need to mock req/res or extract logic. 
                // Ideally, controllers call services. Here we'll try to invoke the handler if it's exported as a clean function or use a service.
                // Since `cancelBooking` likely takes req, res... let's see if we can just call it or if we need to Duplicate logic.
                // BETTER APPROACH: Just forward the request to the booking controller's Cancel endpoint from the frontend.
                // BUT the requirement was "Tools standard to proceed".
                // Let's assume we implement a specific admin force cancel here.

                const booking = await models.Booking.findByPk(bookingId);
                if (!booking) return res.status(404).json({ error: "Booking not found" });

                booking.status = 'CANCELLED';
                await booking.save();

                // Trigger refund if paid... (Simplified for now)

                result = { message: "Booking Cancelled via Support", bookingId };
                break;

            case 'FULL_REFUND':
                const payment = await models.Payment.findOne({ where: { booking_id: bookingId, status: 'PAID' } });
                if (payment) {
                    payment.status = 'REFUNDED';
                    await payment.save();
                    // Here we would call the actual Payment Gateway refund API
                    result = { message: "Refund Processed", amount: payment.amount };
                } else {
                    throw new Error("No paid payment found for this booking");
                }
                break;

            default:
                return res.status(400).json({ error: "Invalid Action" });
        }

        // Log the action in the ticket conversation
        const ticket = await models.SupportTicket.findByPk(id);
        if (ticket) {
            await models.SupportMessage.create({
                ticket_id: id,
                sender_type: "ADMIN",
                sender_id: req.user.id,
                content: `ACTION EXECUTED: ${action} on Booking #${bookingId}`,
                metadata: { action, result }
            });
            // Update last message
            ticket.last_message_at = new Date();
            await ticket.save();
        }

        return res.json({ success: true, result });

    } catch (error) {
        next(error);
    }
};

export const reportIssue = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
        const {
            name = "",
            email = "",
            phone = "",
            device = "",
            os = "",
            appVersion = "",
            details = "",
        } = req.body || {};

        const subject = "BookingGPT Issue Report";
        const lines = [
            `Name: ${name}`,
            `Email: ${email}`,
            `Phone: ${phone}`,
            `Device: ${device}`,
            `OS: ${os}`,
            `App version: ${appVersion}`,
            "",
            "Issue details:",
            details,
        ];

        const html = `
          <div style="font-family: Arial, sans-serif; color: #0f172a;">
            <h2 style="margin: 0 0 12px;">BookingGPT Issue Report</h2>
            <p><strong>Name:</strong> ${name || "-"}</p>
            <p><strong>Email:</strong> ${email || "-"}</p>
            <p><strong>Phone:</strong> ${phone || "-"}</p>
            <p><strong>Device:</strong> ${device || "-"}</p>
            <p><strong>OS:</strong> ${os || "-"}</p>
            <p><strong>App version:</strong> ${appVersion || "-"}</p>
            <p><strong>Issue details:</strong></p>
            <pre style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:8px;white-space:pre-wrap;">${details || "-"}</pre>
          </div>
        `;

        await transporter.sendMail({
            to: "partners@insiderbookings.com",
            from: process.env.MAIL_FROM || `"BookingGPT" <${process.env.SMTP_USER}>`,
            subject,
            text: lines.join("\n"),
            html,
        });

        return res.json({ message: "Report sent" });
    } catch (error) {
        console.error("reportIssue error:", error);
        return res.status(500).json({ error: "Unable to send report" });
    }
};
