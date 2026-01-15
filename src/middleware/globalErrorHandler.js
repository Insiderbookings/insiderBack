import models from "../models/index.js";
import transporter from "../services/transporter.js";

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
    try {
        res.locals.errorLogged = true; // Mark as logged for statusLogger
        await ErrorLog.create({
            level: 'error',
            statusCode,
            method,
            path,
            message,
            stack,
            userId,
            ip
        });
    } catch (logError) {
        console.error("Failed to write to ErrorLog:", logError);
    }

    // 3. Check for Alerts
    // Fire and forget - don't block response
    (async () => {
        try {
            const config = await ErrorConfig.findOne();
            if (config && config.enableEmailAlerts) {
                const shouldAlert = config.alertOnStatusCodes.includes(statusCode);

                if (shouldAlert) {
                    const emails = Array.isArray(config.alertEmails)
                        ? config.alertEmails
                        : (typeof config.alertEmails === 'string' ? config.alertEmails.split(',') : []);

                    if (emails.length > 0) {
                        const mailOptions = {
                            from: `"Insider Error Alert" <${process.env.SMTP_USER}>`,
                            to: emails.join(", "),
                            subject: `[ALERT] ${statusCode} Error on ${method} ${path}`,
                            html: `
                                <h3>System Error Detected</h3>
                                <p><strong>Status:</strong> ${statusCode}</p>
                                <p><strong>Message:</strong> ${message}</p>
                                <p><strong>Path:</strong> ${method} ${path}</p>
                                <p><strong>User:</strong> ${userId || 'Anonymous'}</p>
                                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                                <br>
                                <pre style="background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto;">${stack}</pre>
                            `,
                        };
                        await transporter.sendMail(mailOptions);
                    }
                }
            }
        } catch (alertError) {
            console.error("Failed to send error alert email:", alertError);
        }
    })();

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
