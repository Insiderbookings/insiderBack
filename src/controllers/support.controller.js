import models, { sequelize } from "../models/index.js";
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
const SUPPORT_AGENT_ROLES = new Set([1, 7, 8, 100]);
const SUPPORT_MANAGER_ROLES = new Set([8, 100]);
const SUPPORT_ASSIGNABLE_ROLES = new Set([1, 7, 8, 100]);
const QUICK_REPLY_DEFAULT_CATEGORY = "GENERAL";
const QUICK_REPLY_DEFAULT_LANGUAGE = "es";
const QUICK_REPLY_MAX_LIMIT = 200;
const isAdminUser = (user) => normalizeRole(user?.role) === 100;
const isSupportAgent = (user) => SUPPORT_AGENT_ROLES.has(normalizeRole(user?.role));
const isSupportManager = (user) => SUPPORT_MANAGER_ROLES.has(normalizeRole(user?.role));
const isAssignableSupportRole = (role) => SUPPORT_ASSIGNABLE_ROLES.has(normalizeRole(role));
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
const canManageQuickReplies = (user) => isSupportManager(user);
const normalizeQuickReplyCategory = (value) => {
    const text = String(value || QUICK_REPLY_DEFAULT_CATEGORY).trim().toUpperCase();
    return text || QUICK_REPLY_DEFAULT_CATEGORY;
};
const normalizeQuickReplyLanguage = (value) => {
    const text = String(value || QUICK_REPLY_DEFAULT_LANGUAGE).trim().toLowerCase();
    return text || QUICK_REPLY_DEFAULT_LANGUAGE;
};
const normalizeStringList = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || "").trim())
            .filter(Boolean);
    }
    return String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
};
const extractTemplateVariables = (text) => {
    const source = String(text || "");
    const variables = source.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
    const normalized = variables.map((item) => item.replace(/[{}]/g, "").trim()).filter(Boolean);
    return Array.from(new Set(normalized));
};
const normalizeQuickReplyPayload = (body = {}) => {
    const title = String(body?.title || "").trim();
    const content = String(body?.content || "").trim();
    const category = normalizeQuickReplyCategory(body?.category);
    const language = normalizeQuickReplyLanguage(body?.language);
    const tags = normalizeStringList(body?.tags);
    const variablesFromContent = extractTemplateVariables(content);
    const explicitVariables = normalizeStringList(body?.variables);
    const variables = Array.from(new Set([...variablesFromContent, ...explicitVariables]));
    return {
        title,
        content,
        category,
        language,
        tags,
        variables,
        is_active: body?.is_active == null ? true : Boolean(body.is_active),
    };
};
const normalizeAssigneeIdList = (value) => {
    if (value == null || value === "") return [];
    const raw = Array.isArray(value) ? value : [value];
    const parsed = raw.map((item) => Number(item));
    if (parsed.some((item) => !Number.isFinite(item) || item <= 0)) return null;
    return Array.from(new Set(parsed.map((item) => Math.trunc(item))));
};
const loadAssignableUsersByIds = async (ids = []) => {
    const safeIds = Array.isArray(ids) ? ids : [];
    if (!safeIds.length) return [];
    const users = await models.User.findAll({
        where: { id: { [Op.in]: safeIds } },
        attributes: ["id", "role", "name", "email"],
    });
    if (users.length !== safeIds.length) return null;
    const usersById = new Map(users.map((user) => [Number(user.id), user]));
    const ordered = safeIds.map((id) => usersById.get(Number(id))).filter(Boolean);
    if (ordered.length !== safeIds.length) return null;
    const invalidUser = ordered.find((user) => !isAssignableSupportRole(user.role));
    if (invalidUser) return false;
    return ordered;
};
const syncTicketAssignees = async ({ ticketId, assigneeIds = [], actorId = null, transaction = null }) => {
    if (!models.SupportTicketAssignee) return;
    await models.SupportTicketAssignee.destroy({
        where: { ticket_id: ticketId },
        transaction,
    });
    if (!assigneeIds.length) return;
    await models.SupportTicketAssignee.bulkCreate(
        assigneeIds.map((userId) => ({
            ticket_id: ticketId,
            user_id: userId,
            assigned_by: actorId || null,
            assigned_at: new Date(),
        })),
        { transaction }
    );
};
const normalizeTicketAssigneesPayload = (ticketLike) => {
    const payload = ticketLike;
    const primaryId = Number(payload?.assigned_to || 0);
    const seen = new Set();
    const merged = [];
    const candidates = [
        ...(Array.isArray(payload?.assignees) ? payload.assignees : []),
        payload?.assignee || null,
    ].filter(Boolean);
    candidates.forEach((candidate) => {
        const id = Number(candidate?.id || 0);
        if (!id || seen.has(id)) return;
        seen.add(id);
        merged.push(candidate);
    });
    merged.sort((a, b) => {
        const aId = Number(a?.id || 0);
        const bId = Number(b?.id || 0);
        if (aId === primaryId && bId !== primaryId) return -1;
        if (bId === primaryId && aId !== primaryId) return 1;
        const aName = String(a?.name || "").toLowerCase();
        const bName = String(b?.name || "").toLowerCase();
        return aName.localeCompare(bName);
    });
    payload.assignees = merged;
    payload.assigned_to_ids = merged.map((item) => Number(item?.id || 0)).filter((id) => id > 0);
    if (!payload.assigned_to && payload.assigned_to_ids.length) {
        payload.assigned_to = payload.assigned_to_ids[0];
    }
    return payload;
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
const isInternalSupportMessage = (message) => {
    const metadata = message?.metadata && typeof message.metadata === "object" ? message.metadata : {};
    return Boolean(metadata.internal) || String(metadata.type || "").toUpperCase() === "INTERNAL_NOTE";
};
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
        const trimmedMessage = typeof message === "string" ? message.trim() : "";
        const hasInitialMessage = Boolean(trimmedMessage);

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
        const result = await sequelize.transaction(async (transaction) => {
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
                    {
                        meta: nextMeta,
                        ...(hasInitialMessage ? { last_message_at: now } : {}),
                    },
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
                    ...(hasInitialMessage ? { last_message_at: now } : {}),
                };
                if (hasInitialMessage && ticket.status === "RESOLVED") {
                    updates.status = "IN_PROGRESS";
                }
                await ticket.update(updates, { transaction });
            }

            let initialMsg = null;
            if (hasInitialMessage) {
                initialMsg = await models.SupportMessage.create({
                    ticket_id: ticket.id,
                    sender_type: "USER",
                    sender_id: userId,
                    content: trimmedMessage,
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
                    body: trimmedMessage,
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
            }

            return { chatThread, ticket, initialMsg, ticketCreated };
        });

        if (result.ticketCreated) {
            emitSupportEvent("support:new_ticket", { ticketId: result.ticket.id, subject: finalSubject, user: req.user.name });
        }
        if (result.initialMsg) {
            emitSupportEvent("support:new_message", { ticketId: result.ticket.id, message: result.initialMsg, user: req.user.name });
        }

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
                { model: models.User, as: 'assignee', attributes: ['id', 'name', 'email', 'role'] },
                {
                    model: models.User,
                    as: 'assignees',
                    attributes: ['id', 'name', 'email', 'role'],
                    through: { attributes: [] },
                    required: false,
                },
                {
                    model: models.SupportMessage,
                    as: 'messages',
                    separate: true,
                    order: [['created_at', 'ASC']],
                    include: [{ model: models.User, as: 'sender', attributes: ['id', 'name', 'role'] }],
                }
            ],
        });

        if (!ticket) return res.status(404).json({ error: "Ticket not found" });

        // Security check: owner, staff or admin can view
        if (ticket.user_id !== req.user.id && !isSupportAgent(req.user)) {
            return res.status(403).json({ error: "Forbidden" });
        }

        const isStaffViewer = isSupportAgent(req.user);
        const payload = normalizeTicketAssigneesPayload(ticket.toJSON());
        if (!isStaffViewer) {
            payload.messages = Array.isArray(payload.messages)
                ? payload.messages.filter((message) => !isInternalSupportMessage(message))
                : [];
        }
        payload.sla = buildSlaSummary({ ticket: payload, messages: payload.messages });
        payload.permissions = {
            canExecuteFinancialActions: canExecuteFinancialAction(req.user),
            canAssign: isSupportManager(req.user),
            canWriteInternalNotes: isStaffViewer,
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
        const isAgent = isSupportAgent(req.user);
        const SUPPORT_BOT_ID = getSupportBotId();
        const isInternal = Boolean(internal);
        const rawQuickReplyId =
            metadata && typeof metadata === "object"
                ? metadata.quickReplyId ?? metadata.templateId ?? null
                : null;
        const quickReplyId = Number(rawQuickReplyId);
        const hasQuickReplyId = Number.isFinite(quickReplyId) && quickReplyId > 0;

        if (!String(content || "").trim()) {
            return res.status(400).json({ error: "Content is required" });
        }
        if (isInternal && !isAgent) {
            return res.status(403).json({ error: "Only support agents can post internal notes" });
        }

        const ticket = await models.SupportTicket.findByPk(id);
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });

        if (ticket.user_id !== userId && !isAgent) {
            return res.status(403).json({ error: "Forbidden" });
        }
        const previousStatus = String(ticket.status || "").toUpperCase();

        // 1. Create SupportMessage (Admin View)
        const message = await models.SupportMessage.create({
            ticket_id: id,
            sender_type: isAgent ? "ADMIN" : "USER",
            sender_id: userId,
            content: String(content).trim(),
            metadata: {
                ...(metadata && typeof metadata === "object" ? metadata : {}),
                internal: isInternal,
                type: isInternal ? "INTERNAL_NOTE" : undefined,
            }
        });

        if (hasQuickReplyId) {
            const quickReply = await models.SupportQuickReply.findByPk(quickReplyId);
            if (quickReply) {
                await quickReply.increment("usage_count", { by: 1 });
                await quickReply.update({
                    last_used_at: new Date(),
                    updated_by: Number(userId) || quickReply.updated_by || null,
                });
            }
        }

        // 2. Sync to ChatThread (User App View) if thread exists
        if (ticket.chat_thread_id && !isInternal) {
            await postMessage({
                chatId: ticket.chat_thread_id,
                senderId: isAgent ? SUPPORT_BOT_ID : userId, // Agents post as Support Bot/System
                senderRole: isAgent ? "HOST" : "GUEST",
                body: String(content).trim(),
                type: "TEXT",
                metadata: {
                    source: "support",
                    ...(isAgent ? { senderName: "BookingGPT Support Team" } : {}),
                },
            });
        }

        // Update ticket timestamp
        ticket.last_message_at = new Date();
        // If user replies, reopen ticket if closed (optional logic)
        if (!isAgent && ticket.status === 'RESOLVED') ticket.status = 'IN_PROGRESS';
        // If support agent replies, set to IN_PROGRESS
        if (isAgent && ticket.status === 'OPEN') ticket.status = 'IN_PROGRESS';

        await ticket.save();
        const currentStatus = String(ticket.status || "").toUpperCase();

        // Real-time notifications
        if (isAgent) {
            // Notify User only for external replies
            if (!isInternal) {
                emitToUser(ticket.user_id, "support:new_message", { ticketId: id, message });
            }
            if (previousStatus !== currentStatus) {
                emitToUser(ticket.user_id, "support:status_change", {
                    ticketId: ticket.id,
                    chatThreadId: ticket.chat_thread_id,
                    status: ticket.status,
                    internal: isInternal,
                    source: "support_reply",
                });
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
        if (!isSupportAgent(req.user)) return res.status(403).json({ error: "Support access required" });

        const { id } = req.params;
        const { status, priority, assigned_to, assigned_to_ids } = req.body;
        const hasAssignedToPayload = Object.prototype.hasOwnProperty.call(req.body || {}, "assigned_to");
        const hasAssigneeListPayload = Object.prototype.hasOwnProperty.call(req.body || {}, "assigned_to_ids");
        const hasAssignmentPayload = hasAssignedToPayload || hasAssigneeListPayload;

        const ticket = await models.SupportTicket.findByPk(id);
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });
        if (hasAssignmentPayload && !isSupportManager(req.user)) {
            return res.status(403).json({ error: "Only support manager can assign tickets" });
        }

        const existingAssigneeRows = models.SupportTicketAssignee
            ? await models.SupportTicketAssignee.findAll({
                where: { ticket_id: ticket.id },
                attributes: ["user_id"],
            })
            : [];
        const existingAssigneeIds = Array.from(
            new Set(
                existingAssigneeRows
                    .map((row) => Number(row.user_id))
                    .filter((value) => Number.isFinite(value) && value > 0)
            )
        );
        const beforeAssigneeIds = Array.from(
            new Set(
                [
                    ...existingAssigneeIds,
                    Number(ticket.assigned_to || 0),
                ].filter((value) => Number.isFinite(value) && value > 0)
            )
        );

        const before = {
            status: ticket.status,
            priority: ticket.priority,
            assigned_to: ticket.assigned_to,
            assigned_to_ids: beforeAssigneeIds,
        };

        let nextAssigneeIds = [...beforeAssigneeIds];
        let nextPrimaryAssigneeId = before.assigned_to ? Number(before.assigned_to) : null;
        if (hasAssigneeListPayload) {
            const normalizedIds = normalizeAssigneeIdList(assigned_to_ids);
            if (normalizedIds == null) {
                return res.status(400).json({ error: "Invalid assignee ids list" });
            }
            const users = await loadAssignableUsersByIds(normalizedIds);
            if (users === null) return res.status(404).json({ error: "One or more assignees not found" });
            if (users === false) return res.status(400).json({ error: "All assignees must be support users" });

            nextAssigneeIds = normalizedIds;
            const requestedPrimary = Number(req.body?.primary_assignee_id ?? req.body?.assigned_to ?? 0);
            if (!nextAssigneeIds.length) {
                nextPrimaryAssigneeId = null;
            } else if (Number.isFinite(requestedPrimary) && nextAssigneeIds.includes(requestedPrimary)) {
                nextPrimaryAssigneeId = requestedPrimary;
            } else {
                nextPrimaryAssigneeId = nextAssigneeIds[0];
            }
        } else if (hasAssignedToPayload) {
            if (assigned_to == null || assigned_to === "") {
                nextAssigneeIds = [];
                nextPrimaryAssigneeId = null;
            } else {
                const assigneeId = Number(assigned_to);
                if (!Number.isFinite(assigneeId) || assigneeId <= 0) {
                    return res.status(400).json({ error: "Invalid assignee id" });
                }
                const users = await loadAssignableUsersByIds([assigneeId]);
                if (users === null) return res.status(404).json({ error: "Assignee not found" });
                if (users === false) return res.status(400).json({ error: "Assignee must be a support user" });
                nextAssigneeIds = Array.from(new Set([assigneeId, ...beforeAssigneeIds]));
                nextPrimaryAssigneeId = assigneeId;
            }
        }

        await sequelize.transaction(async (transaction) => {
            if (status) ticket.status = status;
            if (priority) ticket.priority = priority;
            if (hasAssignmentPayload) {
                ticket.assigned_to = nextPrimaryAssigneeId;
                await syncTicketAssignees({
                    ticketId: ticket.id,
                    assigneeIds: nextAssigneeIds,
                    actorId: Number(req.user.id) || null,
                    transaction,
                });
            }
            await ticket.save({ transaction });
        });

        const refreshedTicket = await models.SupportTicket.findByPk(ticket.id, {
            include: [
                { model: models.User, as: "user", attributes: ["id", "name", "email", "avatar_url", "role"] },
                { model: models.User, as: "assignee", attributes: ["id", "name", "email", "role"] },
                {
                    model: models.User,
                    as: "assignees",
                    attributes: ["id", "name", "email", "role"],
                    through: { attributes: [] },
                    required: false,
                },
            ],
        });
        const updatedPayload = normalizeTicketAssigneesPayload(
            refreshedTicket ? refreshedTicket.toJSON() : ticket.toJSON()
        );
        const afterAssigneeIds = Array.from(
            new Set(
                (Array.isArray(updatedPayload.assigned_to_ids) ? updatedPayload.assigned_to_ids : [])
                    .map((value) => Number(value))
                    .filter((value) => Number.isFinite(value) && value > 0)
            )
        );
        const normalizedBeforeIds = [...beforeAssigneeIds].sort((a, b) => a - b);
        const normalizedAfterIds = [...afterAssigneeIds].sort((a, b) => a - b);
        const assigneesChanged =
            normalizedBeforeIds.length !== normalizedAfterIds.length ||
            normalizedBeforeIds.some((idValue, index) => idValue !== normalizedAfterIds[index]);

        if (
            before.status !== updatedPayload.status ||
            before.priority !== updatedPayload.priority ||
            Number(before.assigned_to || 0) !== Number(updatedPayload.assigned_to || 0) ||
            assigneesChanged
        ) {
            const auditMessage = await createAuditMessage({
                ticketId: updatedPayload.id || ticket.id,
                actor: req.user,
                action: "TICKET_UPDATED",
                reason: null,
                before,
                after: {
                    status: updatedPayload.status,
                    priority: updatedPayload.priority,
                    assigned_to: updatedPayload.assigned_to,
                    assigned_to_ids: normalizedAfterIds,
                },
            });
            if (auditMessage) {
                emitSupportEvent("support:new_message", {
                    ticketId: updatedPayload.id || ticket.id,
                    message: auditMessage,
                    user: req.user.name,
                });
            }
        }

        // Notify user of status change
        emitToUser(ticket.user_id, "support:status_change", {
            ticketId: id,
            status: updatedPayload.status,
            priority: updatedPayload.priority,
        });
        emitSupportEvent("support:ticket_updated", {
            ticketId: id,
            updates: {
                status: updatedPayload.status,
                priority: updatedPayload.priority,
                assigned_to: updatedPayload.assigned_to,
                assignees: updatedPayload.assignees || [],
                assigned_to_ids: updatedPayload.assigned_to_ids || [],
            },
        });

        return res.json(updatedPayload);
    } catch (error) {
        next(error);
    }
};

export const previewTicketAction = async (req, res, next) => {
    try {
        if (!isSupportAgent(req.user)) return res.status(403).json({ error: "Support access required" });
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
        if (!isSupportAgent(req.user)) return res.status(403).json({ error: "Support access required" });

        const { status, priority, userId, assignedTo } = req.query;
        const where = {};

        if (status) where.status = status;
        if (priority) where.priority = priority;
        if (userId) where.user_id = userId;

        const tickets = await models.SupportTicket.findAll({
            where,
            include: [
                { model: models.User, as: 'user', attributes: ['id', 'name', 'email'] },
                { model: models.User, as: 'assignee', attributes: ['id', 'name', 'email', 'role'] },
                {
                    model: models.User,
                    as: 'assignees',
                    attributes: ['id', 'name', 'email', 'role'],
                    through: { attributes: [] },
                    required: false,
                },
            ],
            order: [['last_message_at', 'DESC']],
            limit: 200
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
            const json = normalizeTicketAssigneesPayload(ticket.toJSON());
            json.sla = buildSlaSummary({
                ticket: json,
                messages: messagesByTicket[Number(ticket.id)] || [],
            });
            return json;
        });
        let filtered = payload;
        const assignedToFilter = String(assignedTo || "").toLowerCase();
        if (assignedToFilter === "me") {
            filtered = payload.filter((ticket) =>
                Array.isArray(ticket.assigned_to_ids) &&
                ticket.assigned_to_ids.includes(Number(req.user.id))
            );
        } else if (assignedToFilter === "unassigned") {
            filtered = payload.filter((ticket) => !Array.isArray(ticket.assigned_to_ids) || !ticket.assigned_to_ids.length);
        } else if (assignedTo) {
            const targetId = Number(assignedTo);
            filtered = Number.isFinite(targetId) && targetId > 0
                ? payload.filter((ticket) =>
                    Array.isArray(ticket.assigned_to_ids) && ticket.assigned_to_ids.includes(targetId)
                )
                : payload;
        }

        return res.json(filtered.slice(0, 50));
    } catch (error) {
        next(error);
    }
};

export const getSupportAssignees = async (req, res, next) => {
    try {
        if (!isSupportAgent(req.user)) return res.status(403).json({ error: "Support access required" });

        const assignableRoles = Array.from(SUPPORT_ASSIGNABLE_ROLES.values());
        const users = await models.User.findAll({
            where: {
                role: { [Op.in]: assignableRoles },
                is_active: true,
            },
            attributes: ["id", "name", "email", "role"],
            order: [["role", "DESC"], ["name", "ASC"]],
        });

        return res.json(users);
    } catch (error) {
        next(error);
    }
};

export const getQuickReplies = async (req, res, next) => {
    try {
        if (!isSupportAgent(req.user)) return res.status(403).json({ error: "Support access required" });

        const { q, category, language, active = "true", limit = "100" } = req.query || {};
        const where = {};
        const dialect = sequelize.getDialect();
        const likeOperator = dialect.startsWith("postgres") ? Op.iLike : Op.like;

        if (category) where.category = normalizeQuickReplyCategory(category);
        if (language) where.language = normalizeQuickReplyLanguage(language);
        if (String(active).toLowerCase() !== "all") {
            where.is_active = String(active).toLowerCase() !== "false";
        }
        if (String(q || "").trim()) {
            const term = `%${String(q).trim()}%`;
            where[Op.or] = [
                { title: { [likeOperator]: term } },
                { content: { [likeOperator]: term } },
            ];
        }

        const parsedLimit = Number(limit);
        const safeLimit = Number.isFinite(parsedLimit)
            ? Math.min(Math.max(Math.trunc(parsedLimit), 1), QUICK_REPLY_MAX_LIMIT)
            : 100;

        const replies = await models.SupportQuickReply.findAll({
            where,
            include: [
                { model: models.User, as: "creator", attributes: ["id", "name"] },
                { model: models.User, as: "updater", attributes: ["id", "name"] },
            ],
            order: [["usage_count", "DESC"], ["updated_at", "DESC"], ["id", "DESC"]],
            limit: safeLimit,
        });

        return res.json(replies);
    } catch (error) {
        next(error);
    }
};

export const createQuickReply = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        if (!canManageQuickReplies(req.user)) {
            return res.status(403).json({ error: "Only support lead can manage quick replies" });
        }

        const payload = normalizeQuickReplyPayload(req.body);
        if (!payload.title) return res.status(400).json({ error: "Title is required" });
        if (!payload.content) return res.status(400).json({ error: "Content is required" });

        const created = await models.SupportQuickReply.create({
            ...payload,
            created_by: Number(req.user.id) || null,
            updated_by: Number(req.user.id) || null,
        });
        const hydrated = await models.SupportQuickReply.findByPk(created.id, {
            include: [
                { model: models.User, as: "creator", attributes: ["id", "name"] },
                { model: models.User, as: "updater", attributes: ["id", "name"] },
            ],
        });

        return res.status(201).json(hydrated || created);
    } catch (error) {
        next(error);
    }
};

export const updateQuickReply = async (req, res, next) => {
    try {
        if (!canManageQuickReplies(req.user)) {
            return res.status(403).json({ error: "Only support lead can manage quick replies" });
        }

        const { id } = req.params;
        const quickReply = await models.SupportQuickReply.findByPk(id);
        if (!quickReply) return res.status(404).json({ error: "Quick reply not found" });

        const merged = {
            title: req.body?.title ?? quickReply.title,
            content: req.body?.content ?? quickReply.content,
            category: req.body?.category ?? quickReply.category,
            language: req.body?.language ?? quickReply.language,
            tags: req.body?.tags ?? quickReply.tags,
            variables: req.body?.variables ?? quickReply.variables,
            is_active: Object.prototype.hasOwnProperty.call(req.body || {}, "is_active")
                ? req.body.is_active
                : quickReply.is_active,
        };
        const payload = normalizeQuickReplyPayload(merged);
        if (!payload.title) return res.status(400).json({ error: "Title is required" });
        if (!payload.content) return res.status(400).json({ error: "Content is required" });

        await quickReply.update({
            ...payload,
            updated_by: Number(req.user.id) || null,
        });
        const hydrated = await models.SupportQuickReply.findByPk(quickReply.id, {
            include: [
                { model: models.User, as: "creator", attributes: ["id", "name"] },
                { model: models.User, as: "updater", attributes: ["id", "name"] },
            ],
        });

        return res.json(hydrated || quickReply);
    } catch (error) {
        next(error);
    }
};

export const removeQuickReply = async (req, res, next) => {
    try {
        if (!canManageQuickReplies(req.user)) {
            return res.status(403).json({ error: "Only support lead can manage quick replies" });
        }

        const { id } = req.params;
        const quickReply = await models.SupportQuickReply.findByPk(id);
        if (!quickReply) return res.status(404).json({ error: "Quick reply not found" });

        await quickReply.update({
            is_active: false,
            updated_by: Number(req.user.id) || null,
        });

        return res.json({ success: true, id: Number(id), is_active: false });
    } catch (error) {
        next(error);
    }
};

export const markQuickReplyUsed = async (req, res, next) => {
    try {
        if (!isSupportAgent(req.user)) return res.status(403).json({ error: "Support access required" });

        const { id } = req.params;
        const quickReply = await models.SupportQuickReply.findByPk(id);
        if (!quickReply || !quickReply.is_active) {
            return res.status(404).json({ error: "Quick reply not found" });
        }

        await quickReply.increment("usage_count", { by: 1 });
        await quickReply.update({
            last_used_at: new Date(),
            updated_by: Number(req.user.id) || quickReply.updated_by || null,
        });

        return res.json({ success: true, id: Number(id) });
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
