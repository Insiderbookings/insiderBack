import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { check } from "express-validator";
import {
    createTicket,
    getMyTickets,
    getTicketDetails,
    replyTicket,
    updateTicketStatus,
    getAllTickets,
    getSupportAssignees,
    previewTicketAction,
    executeTicketAction,
    reportIssue,
    getQuickReplies,
    createQuickReply,
    updateQuickReply,
    removeQuickReply,
    markQuickReplyUsed
} from "../controllers/support.controller.js";

const router = Router();

// Public issue report (no auth)
router.post(
    "/report-issue",
    [
        check('details', 'Details are required').not().isEmpty()
    ],
    reportIssue
);

// User routes
router.post(
    "/tickets",
    authenticate,
    [
        check('subject', 'Subject is required').not().isEmpty(),
        check('message', 'Message is required').not().isEmpty()
    ],
    createTicket
);
router.get("/tickets/me", authenticate, getMyTickets);
router.get("/tickets/:id", authenticate, getTicketDetails);
router.post("/tickets/:id/reply", authenticate, replyTicket);

// Admin routes (additional RBAC logic inside controller, but good to have dedicated endpoints too)
router.get("/admin/tickets", authenticate, getAllTickets); // Admin list
router.get("/admin/assignees", authenticate, getSupportAssignees);
router.put("/admin/tickets/:id", authenticate, updateTicketStatus); // Update status/priority
router.post("/admin/tickets/:id/action-preview", authenticate, previewTicketAction); // Preview action impact
router.post("/admin/tickets/:id/action", authenticate, executeTicketAction); // Admin actions (refund/cancel)
router.get("/admin/quick-replies", authenticate, getQuickReplies);
router.post(
    "/admin/quick-replies",
    authenticate,
    [
        check('title', 'Title is required').not().isEmpty(),
        check('content', 'Content is required').not().isEmpty()
    ],
    createQuickReply
);
router.put("/admin/quick-replies/:id", authenticate, updateQuickReply);
router.delete("/admin/quick-replies/:id", authenticate, removeQuickReply);
router.post("/admin/quick-replies/:id/use", authenticate, markQuickReplyUsed);

export default router;
