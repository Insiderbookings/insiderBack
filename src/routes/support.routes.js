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
    executeTicketAction
} from "../controllers/support.controller.js";

const router = Router();

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
router.put("/admin/tickets/:id", authenticate, updateTicketStatus); // Update status/priority
router.post("/admin/tickets/:id/action", authenticate, executeTicketAction); // Admin actions (refund/cancel)

export default router;
