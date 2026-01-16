import models from "../models/index.js";
import transporter from "../services/transporter.js";
import { getIO } from "../websocket/emitter.js";

const { ErrorLog, ErrorConfig } = models;

const statusLogger = (req, res, next) => {
    const start = Date.now();

    // Hook into response finish
    res.on('finish', async () => {
        // If already logged by globalErrorHandler, skip to avoid duplicates
        if (res.locals.errorLogged) return;

        const statusCode = res.statusCode;

        // Only care about errors
        if (statusCode >= 400) {
            try {
                // Construct message
                const msg = res.statusMessage || `HTTP Error ${statusCode}`;

                // Get user context if available
                const userId = req.user ? req.user.id : null;

                // Log to DB
                const newLog = await ErrorLog.create({
                    level: statusCode >= 500 ? 'error' : 'warn',
                    statusCode,
                    method: req.method,
                    path: req.originalUrl,
                    message: msg,
                    stack: null, // No stack trace for handled responses
                    userId,
                    ip: req.ip
                });

                // Emit Socket Event
                const io = getIO();
                if (io && newLog) {
                    io.emit("admin:error_log", newLog.toJSON());
                }

                // Check Alerts
                const config = await ErrorConfig.findOne();
                if (config && config.enableEmailAlerts) {
                    const recipients = new Set();

                    // 1. Global
                    if (config.alertOnStatusCodes.includes(statusCode)) {
                        const emails = Array.isArray(config.alertEmails)
                            ? config.alertEmails
                            : (typeof config.alertEmails === 'string' ? config.alertEmails.split(',') : []);
                        emails.forEach(e => recipients.add(e.trim()));
                    }

                    // 2. Rules
                    if (Array.isArray(config.notificationRules)) {
                        config.notificationRules.forEach(rule => {
                            if (rule.statusCodes && rule.statusCodes.includes(statusCode)) {
                                if (Array.isArray(rule.emails)) {
                                    rule.emails.forEach(e => recipients.add(e.trim()));
                                }
                            }
                        });
                    }

                    if (recipients.size > 0) {
                        const toAddress = Array.from(recipients).join(", ");
                        const mailOptions = {
                            from: `"Insider Error Alert" <${process.env.SMTP_USER}>`,
                            to: toAddress,
                            subject: `[ALERT] ${statusCode} on ${req.method} ${req.originalUrl}`,
                            html: `
                                <h3>HTTP Error Detected</h3>
                                <p><strong>Status:</strong> ${statusCode}</p>
                                <p><strong>Message:</strong> ${msg}</p>
                                <p><strong>Path:</strong> ${req.method} ${req.originalUrl}</p>
                                <p><strong>User:</strong> ${userId || 'Anonymous'}</p>
                                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                                <p><em>This error was handled gracefully by the application.</em></p>
                            `,
                        };
                        // Fire and forget
                        transporter.sendMail(mailOptions).catch(err => console.error("Alert Email Failed:", err));
                    }
                }
            } catch (err) {
                console.error("Status Logger Failed:", err);
            }
        }
    });

    next();
};

export default statusLogger;
