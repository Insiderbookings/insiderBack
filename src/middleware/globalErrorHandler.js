import models from "../models/index.js";
import transporter from "../services/transporter.js";
import { getIO } from "../websocket/emitter.js";

const { ErrorLog, ErrorConfig } = models;

const globalErrorHandler = async (err, req, res, next) => {
    // 1. Log to console (standard)
    console.error("Global Error Handler caught:", err);

    const statusCode = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const stack = err.stack;
    const method = req.method;
    const path = req.originalUrl;
    const ip = req.ip;
    const userId = req.user ? req.user.id : null;

    // 2. Persist to Database
    let newLog = null;
    try {
        res.locals.errorLogged = true; // Mark as logged for statusLogger
        newLog = await ErrorLog.create({
            level: 'error',
            statusCode,
            method,
            path,
            message,
            stack,
            userId,
            ip
        });

        // Emit Socket Event
        const io = getIO();
        if (io && newLog) {
            io.emit("admin:error_log", newLog.toJSON());
        }

    } catch (logError) {
        console.error("Failed to write to ErrorLog:", logError);
    }

    // 3. Check for Alerts
    // Fire and forget - don't block response
    (async () => {
        try {
            const config = await ErrorConfig.findOne();
            if (config && config.enableEmailAlerts) {
                // Collect recipients
                const recipients = new Set();

                // 1. Legacy/Global Config
                if (config.alertEmails && config.alertOnStatusCodes.includes(statusCode)) {
                    const globalEmails = Array.isArray(config.alertEmails)
                        ? config.alertEmails
                        : (typeof config.alertEmails === 'string' ? config.alertEmails.split(',') : []);
                    globalEmails.forEach(e => recipients.add(e.trim()));
                }

                // 2. Advanced Rules
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
                            <h3>Error Detected</h3>
                            <p><strong>Status:</strong> ${statusCode}</p>
                            <p><strong>Message:</strong> ${message}</p>
                            <p><strong>User:</strong> ${userId || 'Anonymous'}</p>
                            <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                            <pre style="background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto;">
${stack}
                            </pre>
                        `,
                    };
                    await transporter.sendMail(mailOptions);
                }
            }
        } catch (alertError) {
            console.error("Failed to send error alert email:", alertError);
        }
    })();

    // 3.5 Emit Socket Event
    try {
        const io = getIO();
        if (io) {
            io.emit("admin:error_log", {
                id: null, // We might not have the ID if we didn't await creation, but let's try to grab it if we did
                // Actually, creation was awaited above. We need the ID.
                // Let's refactor slightly to get the created log.
            });
        }
    } catch (err) { }

    // WAIT. I need to get the created log object to emit it.
    // I will refactor the creation block to store the log constant.

    // 4. Send Response to Client
    if (res.headersSent) {
        return next(err);
    }

    res.status(statusCode).json({
        error: true,
        message: statusCode === 500 ? "Internal Server Error" : message,
        // Only show stack in development if needed, for now keep it clean
    });
};

export default globalErrorHandler;
