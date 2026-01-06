import models from "../models/index.js";
import { emitAdminActivity, emitToUser, emitToRoom } from "../websocket/emitter.js";
import { validationResult } from "express-validator";

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

        const { subject, category, priority, message } = req.body;
        const userId = req.user.id; // From auth middleware

        const ticket = await models.SupportTicket.create({
            user_id: userId,
            subject,
            category,
            priority,
            status: "OPEN",
            last_message_at: new Date()
        });

        // Create initial message
        const initialMsg = await models.SupportMessage.create({
            ticket_id: ticket.id,
            sender_type: "USER",
            sender_id: userId,
            content: message
        });

        // Notify Admins
        emitSupportEvent("support:new_ticket", { ticketId: ticket.id, subject, user: req.user.name });

        return res.status(201).json({ ticket, message: initialMsg });
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

        const ticket = await models.SupportTicket.findByPk(id);
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });

        if (ticket.user_id !== userId && !isAdmin) {
            return res.status(403).json({ error: "Forbidden" });
        }

        const message = await models.SupportMessage.create({
            ticket_id: id,
            sender_type: isAdmin ? "ADMIN" : "USER",
            sender_id: userId,
            content
        });

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
