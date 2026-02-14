import models from "../models/index.js";
import { emitAdminActivity, emitToUser, emitToRoom } from "../websocket/emitter.js";
import { validationResult } from "express-validator";
import { Op } from "sequelize";
import transporter from "../services/transporter.js";
import { postMessage } from "../services/chat.service.js";
import { processBookingCancellation, processRefund } from "../services/booking.service.js";

// Helper to broadcast support events
const emitSupportEvent = (event, payload) => {
    // Broadcast to a dedicated support room for admins (to be implemented in gateway)
    emitToRoom('admin:support', event, payload);
    // Also trigger generic admin activity bell
    emitAdminActivity({ type: 'support', action: event, ...payload });
};

const getSupportBotId = () => {
    const raw = process.env.HOTEL_SUPPORT_USER_ID;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const normalizeRole = (value) => Number(value || 0);
const isAdminUser = (user) => normalizeRole(user?.role) === 100;
const isStaffOrAdmin = (user) => {
    const role = normalizeRole(user?.role);
    return role === 100 || role === 1;
};
const normalizeAction = (value) => String(value || "").trim().toUpperCase();
const normalizeAmount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};
const normalizeCancellationPolicy = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return null;
    if (raw.includes("non") || raw.includes("no reembolsable")) return "NON_REFUNDABLE";
    if (raw.includes("strict") || raw.includes("estrict")) return "STRICT";
    if (raw.includes("firm") || raw.includes("firme")) return "FIRM";
    if (raw.includes("moder")) return "MODERATE";
    if (raw.includes("flex")) return "FLEXIBLE";
    const upper = raw.toUpperCase();
    if (["NON_REFUNDABLE", "STRICT", "FIRM", "MODERATE", "FLEXIBLE"].includes(upper)) return upper;
    return null;
};
const toUtcDate = (value) => {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const d = new Date(`${text}T00:00:00Z`);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
};
const extractRuleCharge = (rule) => {
    const direct = rule?.charge ?? rule?.amount ?? rule?.fee ?? null;
    if (direct == null) return null;
    if (typeof direct === "number") return Number.isFinite(direct) ? direct : null;
    const cleaned = String(direct).replace(/[^0-9.-]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
};
const extractCancellationRules = (booking) => {
    const pricing = booking?.pricing_snapshot || {};
    const confirmation = pricing?.confirmationSnapshot ?? pricing?.confirmation_snapshot ?? null;
    const candidates = [
        confirmation?.policies?.cancellationRules,
        pricing?.flowSnapshot?.cancellationRules,
        pricing?.cancellationRules,
    ];
    const source = candidates.find((list) => Array.isArray(list) && list.length) || [];
    return Array.isArray(source) ? source : [];
};
const computeRuleBasedRefund = ({ booking, totalAmount, rules }) => {
    if (!Array.isArray(rules) || !rules.length) {
        return {
            refundableAmount: null,
            refundPercent: null,
            penaltyAmount: null,
            note: "Cancellation rules unavailable. Verify supplier policy before execution.",
        };
    }
    const now = Date.now();
    const normalized = rules
        .map((rule, index) => {
            const charge = extractRuleCharge(rule);
            if (!Number.isFinite(charge)) return null;
            const fromDate = toUtcDate(rule?.from);
            const toDate = toUtcDate(rule?.to);
            return { index, charge, fromDate, toDate };
        })
        .filter(Boolean);

    if (!normalized.length) {
        return {
            refundableAmount: null,
            refundPercent: null,
            penaltyAmount: null,
            note: "Cancellation rules have no numeric charges. Verify supplier policy before execution.",
        };
    }

    const active = normalized
        .filter((item) => {
            const fromTime = item.fromDate ? item.fromDate.getTime() : Number.NEGATIVE_INFINITY;
            const toTime = item.toDate ? item.toDate.getTime() : Number.POSITIVE_INFINITY;
            return now >= fromTime && now < toTime;
        })
        .sort((a, b) => {
            const aFrom = a.fromDate ? a.fromDate.getTime() : Number.NEGATIVE_INFINITY;
            const bFrom = b.fromDate ? b.fromDate.getTime() : Number.NEGATIVE_INFINITY;
            return bFrom - aFrom || b.index - a.index;
        })[0] || null;

    const chosen = active || normalized[0];
    const penalty = Math.max(0, normalizeAmount(chosen.charge));
    const refundable = Math.max(0, totalAmount - penalty);
    const percent = totalAmount > 0 ? Math.round((refundable / totalAmount) * 10000) / 100 : 0;
    return {
        refundableAmount: refundable,
        refundPercent: percent,
        penaltyAmount: penalty,
        note: active
            ? "Estimated using active cancellation rule."
            : "Estimated using available cancellation rules.",
    };
};
const computeHomePolicyRefund = (booking, totalAmount) => {
    const policyRaw =
        booking?.meta?.cancellationPolicy ??
        booking?.meta?.cancellation_policy ??
        booking?.pricing_snapshot?.cancellationPolicy ??
        booking?.pricing_snapshot?.cancellation_policy ??
        null;
    const policy = normalizeCancellationPolicy(policyRaw) || "FLEXIBLE";
    const checkIn = toUtcDate(booking?.check_in);
    if (!checkIn) {
        return {
            policyCode: policy,
            refundableAmount: null,
            refundPercent: null,
            penaltyAmount: null,
            note: "Missing check-in date. Verify policy before execution.",
        };
    }

    const now = Date.now();
    const hoursUntilCheckIn = (checkIn.getTime() - now) / 36e5;
    const daysUntilCheckIn = hoursUntilCheckIn / 24;
    const bookedAt = booking?.booked_at ? new Date(booking.booked_at) : booking?.createdAt ? new Date(booking.createdAt) : null;
    const hoursSinceBooking =
        bookedAt && !Number.isNaN(bookedAt.getTime()) ? (now - bookedAt.getTime()) / 36e5 : null;

    let refundPercent = 0;
    if (policy === "NON_REFUNDABLE") refundPercent = 0;
    else if (policy === "FLEXIBLE") refundPercent = hoursUntilCheckIn >= 24 ? 100 : 0;
    else if (policy === "MODERATE") refundPercent = daysUntilCheckIn >= 5 ? 100 : 0;
    else if (policy === "FIRM") refundPercent = daysUntilCheckIn >= 30 ? 100 : daysUntilCheckIn >= 7 ? 50 : 0;
    else if (policy === "STRICT") {
        const within48h = hoursSinceBooking != null ? hoursSinceBooking <= 48 : false;
        refundPercent = within48h && daysUntilCheckIn >= 14 ? 100 : daysUntilCheckIn >= 7 ? 50 : 0;
    }

    const refundable = Math.max(0, (totalAmount * refundPercent) / 100);
    const penalty = Math.max(0, totalAmount - refundable);
    return {
        policyCode: policy,
        refundableAmount: Math.round((refundable + Number.EPSILON) * 100) / 100,
        refundPercent,
        penaltyAmount: Math.round((penalty + Number.EPSILON) * 100) / 100,
        note: "Estimated using home cancellation policy.",
    };
};
const parseSupportApprovers = () => {
    const raw = String(process.env.SUPPORT_FINANCE_APPROVER_IDS || "").trim();
    if (!raw) return null;
    const ids = raw
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0);
    return ids.length ? new Set(ids) : null;
};
const canExecuteFinancialAction = (user) => {
    if (!isAdminUser(user)) return false;
    const whitelist = parseSupportApprovers();
    if (!whitelist) return true;
    return whitelist.has(Number(user?.id));
};
const createAuditMessage = async ({
    ticketId,
    actor,
    action,
    reason = null,
    before = null,
    after = null,
    extra = null,
}) => {
    if (!ticketId || !action) return null;
    const message = await models.SupportMessage.create({
        ticket_id: ticketId,
        sender_type: "SYSTEM",
        sender_id: null,
        content: `[AUDIT] ${action}`,
        metadata: {
            type: "AUDIT",
            audit: {
                action,
                actorId: Number(actor?.id) || null,
                actorName: actor?.name || null,
                reason: reason || null,
                before: before || null,
                after: after || null,
                extra: extra || null,
                createdAt: new Date().toISOString(),
            },
        },
    });
    return message;
};
const isHomeInventory = (booking) =>
    String(booking?.inventory_type || "").toUpperCase() === "HOME" ||
    String(booking?.source || "").toUpperCase() === "HOME";
const buildSlaSummary = ({ ticket, messages = [], now = new Date() }) => {
    const firstResponseMinutes = Number(process.env.SUPPORT_SLA_FIRST_RESPONSE_MINUTES || 30);
    const resolutionMinutes = Number(process.env.SUPPORT_SLA_RESOLUTION_MINUTES || 1440);
    const createdAt = ticket?.createdAt ? new Date(ticket.createdAt) : ticket?.created_at ? new Date(ticket.created_at) : null;
    const createdMs = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : null;
    const nowMs = now.getTime();
    const firstAdmin = (Array.isArray(messages) ? messages : [])
        .filter((m) => String(m?.sender_type || "").toUpperCase() === "ADMIN")
        .sort((a, b) => new Date(a?.createdAt || a?.created_at || 0).getTime() - new Date(b?.createdAt || b?.created_at || 0).getTime())[0] || null;
    const firstAdminAt = firstAdmin?.createdAt || firstAdmin?.created_at || null;
    const firstAdminMs = firstAdminAt ? new Date(firstAdminAt).getTime() : null;
    const responseDueMs = createdMs != null ? createdMs + firstResponseMinutes * 60 * 1000 : null;
    const resolutionDueMs = createdMs != null ? createdMs + resolutionMinutes * 60 * 1000 : null;
    const status = String(ticket?.status || "").toUpperCase();
    return {
        ageMinutes: createdMs != null ? Math.max(0, Math.round((nowMs - createdMs) / 60000)) : null,
        firstResponseAt: firstAdminAt,
        firstResponseDueAt: responseDueMs != null ? new Date(responseDueMs).toISOString() : null,
        firstResponseBreached: Boolean(responseDueMs != null && firstAdminMs == null && nowMs > responseDueMs),
        resolutionDueAt: resolutionDueMs != null ? new Date(resolutionDueMs).toISOString() : null,
        resolutionBreached: Boolean(
            resolutionDueMs != null &&
            !["RESOLVED", "CLOSED"].includes(status) &&
            nowMs > resolutionDueMs
        ),
    };
};

export const createTicket = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { subject, category, priority, message, bookingId, metadata } = req.body;
        const userId = req.user.id; // From auth middleware
        const SUPPORT_BOT_ID = getSupportBotId();

        if (bookingId) {
            const booking = await models.Booking.findByPk(bookingId, { attributes: ["id", "user_id"] });
            if (!booking || Number(booking.user_id) !== Number(userId)) {
                return res.status(403).json({ error: "Booking does not belong to current user" });
            }
        }

        // Enrich subject if bookingId is provided
        const finalSubject = bookingId
            ? `${subject} (Booking #${bookingId})`
            : subject;

        const now = new Date();
        const result = await models.sequelize.transaction(async (transaction) => {
            let chatThread = null;
            let ticket = null;
            let ticketCreated = false;

            const baseThreadWhere = {
                guest_user_id: userId,
                host_user_id: SUPPORT_BOT_ID,
                reserve_id: bookingId || null,
                status: "OPEN",
            };
            const existingThreads = await models.ChatThread.findAll({
                where: baseThreadWhere,
                order: [["last_message_at", "DESC"], ["id", "DESC"]],
                transaction,
            });
            chatThread = existingThreads.find((thread) => String(thread?.meta?.type || "").toUpperCase() === "SUPPORT") || null;

            if (!chatThread) {
                chatThread = await models.ChatThread.create({
                    guest_user_id: userId,
                    host_user_id: SUPPORT_BOT_ID,
                    reserve_id: bookingId || null,
                    status: 'OPEN',
                    last_message_at: now,
                    meta: {
                        type: 'SUPPORT',
                        subject: finalSubject,
                        category: category || 'GENERAL'
                    }
                }, { transaction });
            } else {
                const nextMeta = {
                    ...(chatThread.meta || {}),
                    type: "SUPPORT",
                    subject: finalSubject,
                    category: category || "GENERAL",
                };
                await chatThread.update(
                    { meta: nextMeta, last_message_at: now },
                    { transaction }
                );
            }

            await models.ChatParticipant.bulkCreate(
                [
                    { chat_id: chatThread.id, user_id: userId, role: "GUEST" },
                    { chat_id: chatThread.id, user_id: SUPPORT_BOT_ID, role: "HOST" }
                ],
                { ignoreDuplicates: true, transaction }
            );

            ticket = await models.SupportTicket.findOne({
                where: {
                    user_id: userId,
                    chat_thread_id: chatThread.id,
                    status: { [Op.in]: ["OPEN", "IN_PROGRESS", "RESOLVED"] },
                },
                order: [["last_message_at", "DESC"], ["id", "DESC"]],
                transaction,
            });

            if (!ticket) {
                ticket = await models.SupportTicket.create({
                    user_id: userId,
                    chat_thread_id: chatThread.id,
                    subject: finalSubject,
                    category: category || "GENERAL",
                    priority: priority || "MEDIUM",
                    status: "OPEN",
                    last_message_at: now
                }, { transaction });
                ticketCreated = true;
            } else {
                const updates = {
                    subject: finalSubject,
                    category: category || ticket.category || "GENERAL",
                    priority: priority || ticket.priority || "MEDIUM",
                    last_message_at: now,
                };
                if (ticket.status === "RESOLVED") {
                    updates.status = "IN_PROGRESS";
                }
                await ticket.update(updates, { transaction });
            }

            const initialMsg = await models.SupportMessage.create({
                ticket_id: ticket.id,
                sender_type: "USER",
                sender_id: userId,
                content: message,
                metadata: {
                    ...(metadata || {}),
                    bookingId: bookingId || null,
                }
            }, { transaction });

            await models.ChatMessage.create({
                chat_id: chatThread.id,
                sender_id: userId,
                sender_role: 'GUEST',
                type: 'TEXT',
                body: message,
                metadata: {
                    ...(metadata || {}),
                    bookingId: bookingId || null,
                    source: "support",
                },
                delivered_at: now
            }, { transaction });

            await models.ChatThread.update(
                { last_message_at: now },
                { where: { id: chatThread.id }, transaction }
            );
            await models.SupportTicket.update(
                { last_message_at: now },
                { where: { id: ticket.id }, transaction }
            );

            return { chatThread, ticket, initialMsg, ticketCreated };
        });

        if (result.ticketCreated) {
            emitSupportEvent("support:new_ticket", { ticketId: result.ticket.id, subject: finalSubject, user: req.user.name });
        }
        emitSupportEvent("support:new_message", { ticketId: result.ticket.id, message: result.initialMsg, user: req.user.name });

        return res.status(201).json({
            ticket: result.ticket,
            message: result.initialMsg,
            chatThreadId: result.chatThread.id,
            reusedThread: !result.ticketCreated,
        });
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

        const payload = ticket.toJSON();
        payload.sla = buildSlaSummary({ ticket: payload, messages: payload.messages });
        payload.permissions = {
            canExecuteFinancialActions: canExecuteFinancialAction(req.user),
            canAssign: isStaffOrAdmin(req.user),
            canWriteInternalNotes: isAdminUser(req.user),
        };

        return res.json(payload);
    } catch (error) {
        next(error);
    }
};

export const replyTicket = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { content, internal = false, metadata = null } = req.body || {};
        const userId = req.user.id;
        const isAdmin = req.user.role === 100;
        const SUPPORT_BOT_ID = getSupportBotId();
        const isInternal = Boolean(internal);

        if (!String(content || "").trim()) {
            return res.status(400).json({ error: "Content is required" });
        }
        if (isInternal && !isAdmin) {
            return res.status(403).json({ error: "Only admins can post internal notes" });
        }

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
            content: String(content).trim(),
            metadata: {
                ...(metadata && typeof metadata === "object" ? metadata : {}),
                internal: isInternal,
                type: isInternal ? "INTERNAL_NOTE" : undefined,
            }
        });

        // 2. Sync to ChatThread (User App View) if thread exists
        if (ticket.chat_thread_id && !isInternal) {
            await postMessage({
                chatId: ticket.chat_thread_id,
                senderId: isAdmin ? SUPPORT_BOT_ID : userId, // Admins post as Bot/System
                senderRole: isAdmin ? "HOST" : "GUEST",
                body: String(content).trim(),
                type: "TEXT",
                metadata: {
                    source: "support",
                    ...(isAdmin ? { senderName: "BookingGPT Support Team" } : {}),
                },
            });
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
            // Notify User only for external replies
            if (!isInternal) {
                emitToUser(ticket.user_id, "support:new_message", { ticketId: id, message });
            }
            emitSupportEvent("support:new_message", { ticketId: id, message, user: req.user.name });
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
        if (!isStaffOrAdmin(req.user)) return res.status(403).json({ error: "Staff or admin access required" });

        const { id } = req.params;
        const { status, priority, assigned_to } = req.body;

        const ticket = await models.SupportTicket.findByPk(id);
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });

        const before = {
            status: ticket.status,
            priority: ticket.priority,
            assigned_to: ticket.assigned_to,
        };

        if (status) ticket.status = status;
        if (priority) ticket.priority = priority;
        if (Object.prototype.hasOwnProperty.call(req.body, "assigned_to")) {
            if (assigned_to == null || assigned_to === "") {
                ticket.assigned_to = null;
            } else {
                const assigneeId = Number(assigned_to);
                if (!Number.isFinite(assigneeId) || assigneeId <= 0) {
                    return res.status(400).json({ error: "Invalid assignee id" });
                }
                const assignee = await models.User.findByPk(assigneeId, {
                    attributes: ["id", "role", "name", "email"],
                });
                if (!assignee) return res.status(404).json({ error: "Assignee not found" });
                const assigneeRole = normalizeRole(assignee.role);
                if (![1, 100].includes(assigneeRole)) {
                    return res.status(400).json({ error: "Assignee must be staff/admin" });
                }
                ticket.assigned_to = assignee.id;
            }
        }

        await ticket.save();

        if (
            before.status !== ticket.status ||
            before.priority !== ticket.priority ||
            Number(before.assigned_to || 0) !== Number(ticket.assigned_to || 0)
        ) {
            const auditMessage = await createAuditMessage({
                ticketId: ticket.id,
                actor: req.user,
                action: "TICKET_UPDATED",
                reason: null,
                before,
                after: {
                    status: ticket.status,
                    priority: ticket.priority,
                    assigned_to: ticket.assigned_to,
                },
            });
            if (auditMessage) {
                emitSupportEvent("support:new_message", {
                    ticketId: ticket.id,
                    message: auditMessage,
                    user: req.user.name,
                });
            }
        }

        // Notify user of status change
        emitToUser(ticket.user_id, "support:status_change", { ticketId: id, status, priority });
        emitSupportEvent("support:ticket_updated", {
            ticketId: id,
            updates: {
                status: ticket.status,
                priority: ticket.priority,
                assigned_to: ticket.assigned_to,
            },
        });

        return res.json(ticket);
    } catch (error) {
        next(error);
    }
};

export const previewTicketAction = async (req, res, next) => {
    try {
        if (!isStaffOrAdmin(req.user)) return res.status(403).json({ error: "Staff or admin access required" });
        const { id } = req.params;
        const { action, bookingId } = req.body || {};
        const normalizedAction = normalizeAction(action);
        if (!["CANCEL_BOOKING", "FULL_REFUND"].includes(normalizedAction)) {
            return res.status(400).json({ error: "Invalid action" });
        }
        if (!bookingId) return res.status(400).json({ error: "Booking ID required for this action" });

        const ticket = await models.SupportTicket.findByPk(id);
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });

        const booking = await models.Booking.findByPk(bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found" });
        if (Number(ticket.user_id) !== Number(booking.user_id)) {
            return res.status(400).json({ error: "Booking is not linked to ticket owner" });
        }

        const totalAmount = normalizeAmount(booking.gross_price);
        const wasPaid = String(booking.payment_status || "").toUpperCase() === "PAID";
        const status = String(booking.status || "").toUpperCase();
        const canCancel = !["CANCELLED", "COMPLETED"].includes(status);
        const canRefund = wasPaid && !["REFUNDED"].includes(String(booking.payment_status || "").toUpperCase());

        let quote = {
            refundableAmount: wasPaid ? totalAmount : 0,
            refundPercent: wasPaid ? 100 : 0,
            penaltyAmount: 0,
            note: normalizedAction === "FULL_REFUND"
                ? "Full refund override preview."
                : "Default estimate.",
            estimated: true,
        };

        if (normalizedAction === "CANCEL_BOOKING" && wasPaid) {
            if (isHomeInventory(booking)) {
                quote = { ...computeHomePolicyRefund(booking, totalAmount), estimated: true };
            } else {
                quote = { ...computeRuleBasedRefund({ booking, totalAmount, rules: extractCancellationRules(booking) }), estimated: true };
            }
        }

        const actionAllowed =
            normalizedAction === "CANCEL_BOOKING"
                ? canCancel
                : canRefund;

        return res.json({
            ok: true,
            action: normalizedAction,
            actionAllowed,
            booking: {
                id: booking.id,
                status: booking.status,
                paymentStatus: booking.payment_status,
                total: totalAmount,
                currency: booking.currency || "USD",
                checkIn: booking.check_in || null,
                checkOut: booking.check_out || null,
            },
            impact: quote,
            permissions: {
                canExecuteFinancialActions: canExecuteFinancialAction(req.user),
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getAllTickets = async (req, res, next) => {
    try {
        if (!isStaffOrAdmin(req.user)) return res.status(403).json({ error: "Staff or admin access required" });

        const { status, priority, userId, assignedTo } = req.query;
        const where = {};

        if (status) where.status = status;
        if (priority) where.priority = priority;
        if (userId) where.user_id = userId;
        if (assignedTo === "me") where.assigned_to = req.user.id;
        else if (String(assignedTo || "").toLowerCase() === "unassigned") where.assigned_to = null;
        else if (assignedTo) where.assigned_to = Number(assignedTo);

        const tickets = await models.SupportTicket.findAll({
            where,
            include: [
                { model: models.User, as: 'user', attributes: ['id', 'name', 'email'] },
                { model: models.User, as: 'assignee', attributes: ['id', 'name', 'email', 'role'] },
            ],
            order: [['last_message_at', 'DESC']],
            limit: 50
        });

        const ticketIds = tickets.map((ticket) => ticket.id);
        const messages = ticketIds.length
            ? await models.SupportMessage.findAll({
                where: { ticket_id: { [Op.in]: ticketIds } },
                order: [["created_at", "ASC"]],
            })
            : [];

        const messagesByTicket = messages.reduce((acc, message) => {
            const key = Number(message.ticket_id);
            if (!acc[key]) acc[key] = [];
            acc[key].push(message);
            return acc;
        }, {});

        const payload = tickets.map((ticket) => {
            const json = ticket.toJSON();
            json.sla = buildSlaSummary({
                ticket: json,
                messages: messagesByTicket[Number(ticket.id)] || [],
            });
            return json;
        });

        return res.json(payload);
    } catch (error) {
        next(error);
    }
};

export const executeTicketAction = async (req, res, next) => {
    try {
        if (!isAdminUser(req.user)) return res.status(403).json({ error: "Admin access required" });
        if (!canExecuteFinancialAction(req.user)) {
            return res.status(403).json({ error: "You are not allowed to execute financial support actions" });
        }

        const { id } = req.params;
        const { action, bookingId, reason } = req.body || {};
        const normalizedAction = normalizeAction(action);
        const actionReason = String(reason || "").trim();

        if (!bookingId) return res.status(400).json({ error: "Booking ID required for this action" });
        if (!["CANCEL_BOOKING", "FULL_REFUND"].includes(normalizedAction)) {
            return res.status(400).json({ error: "Invalid Action" });
        }
        if (actionReason.length < 5) {
            return res.status(400).json({ error: "Reason is required (min 5 characters)" });
        }

        const ticket = await models.SupportTicket.findByPk(id);
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });
        const booking = await models.Booking.findByPk(bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found" });
        if (Number(ticket.user_id) !== Number(booking.user_id)) {
            return res.status(400).json({ error: "Booking is not linked to ticket owner" });
        }

        const before = {
            bookingStatus: booking.status,
            paymentStatus: booking.payment_status,
            grossPrice: booking.gross_price,
            currency: booking.currency,
            ticketStatus: ticket.status,
            ticketPriority: ticket.priority,
            ticketAssignee: ticket.assigned_to,
        };

        let result = null;
        if (normalizedAction === "CANCEL_BOOKING") {
            result = await processBookingCancellation({
                bookingId: Number(bookingId),
                userId: Number(req.user.id),
                reason: `support_action:${actionReason}`,
                refundOverride: false,
                bySupport: true,
            });
        } else if (normalizedAction === "FULL_REFUND") {
            const bookingStatus = String(booking.status || "").toUpperCase();
            if (bookingStatus === "CANCELLED") {
                result = await processRefund({
                    bookingId: Number(bookingId),
                    full: true,
                    reason: `support_full_refund:${actionReason}`,
                });
            } else {
                result = await processBookingCancellation({
                    bookingId: Number(bookingId),
                    userId: Number(req.user.id),
                    reason: `support_full_refund:${actionReason}`,
                    refundOverride: true,
                    bySupport: true,
                });
            }
        }

        const refreshedBooking = await models.Booking.findByPk(bookingId, {
            attributes: ["id", "status", "payment_status", "gross_price", "currency"],
        });
        const after = {
            bookingStatus: refreshedBooking?.status || booking.status,
            paymentStatus: refreshedBooking?.payment_status || booking.payment_status,
            grossPrice: refreshedBooking?.gross_price || booking.gross_price,
            currency: refreshedBooking?.currency || booking.currency,
            ticketStatus: ticket.status,
            ticketPriority: ticket.priority,
            ticketAssignee: ticket.assigned_to,
        };

        const auditMessage = await createAuditMessage({
            ticketId: ticket.id,
            actor: req.user,
            action: normalizedAction,
            reason: actionReason,
            before,
            after,
            extra: {
                bookingId: Number(bookingId),
                result,
            },
        });
        ticket.last_message_at = new Date();
        if (ticket.status === "OPEN") ticket.status = "IN_PROGRESS";
        await ticket.save();

        emitSupportEvent("support:ticket_updated", {
            ticketId: ticket.id,
            updates: {
                status: ticket.status,
                priority: ticket.priority,
                assigned_to: ticket.assigned_to,
            },
        });
        if (auditMessage) {
            emitSupportEvent("support:new_message", {
                ticketId: ticket.id,
                message: auditMessage,
                user: req.user.name,
            });
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
