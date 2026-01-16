import models from "../models/index.js";
import transporter from "../services/transporter.js";
import { Op } from "sequelize";

const { ErrorLog, ErrorConfig } = models;

const ITEMS_PER_PAGE = 50;

export const getErrorLogs = async (req, res) => {
    try {
        const { page = 1, level, status, startDate, endDate, search } = req.query;
        const offset = (page - 1) * ITEMS_PER_PAGE;

        const where = {};
        if (level) where.level = level;
        if (status) where.statusCode = status;
        if (startDate && endDate) {
            where.createdAt = {
                [Op.between]: [new Date(startDate), new Date(endDate)],
            };
        }
        if (search) {
            where.message = {
                [Op.like]: `%${search}%`,
            };
        }

        const { count, rows } = await ErrorLog.findAndCountAll({
            where,
            limit: ITEMS_PER_PAGE,
            offset,
            order: [["createdAt", "DESC"]],
            include: ["user"], // Assuming 'user' association exists
        });

        res.json({
            logs: rows,
            totalPages: Math.ceil(count / ITEMS_PER_PAGE),
            currentPage: Number(page),
            totalItems: count,
        });
    } catch (error) {
        console.error("Error fetching logs:", error);
        res.status(500).json({ error: "Failed to fetch logs" });
    }
};

export const getErrorConfig = async (req, res) => {
    try {
        let config = await ErrorConfig.findOne();
        if (!config) {
            config = await ErrorConfig.create({});
        }
        res.json(config);
    } catch (error) {
        console.error("Error fetching config:", error);
        res.status(500).json({ error: "Failed to fetch config" });
    }
};

export const updateErrorConfig = async (req, res) => {
    try {
        const { enableEmailAlerts, alertEmails, alertOnStatusCodes } = req.body;
        let config = await ErrorConfig.findOne();
        if (!config) {
            config = await ErrorConfig.create({});
        }

        config.enableEmailAlerts = enableEmailAlerts;
        config.alertEmails = alertEmails; // Setter handles array/string conversion if logic is in model
        config.alertOnStatusCodes = alertOnStatusCodes;
        if (req.body.notificationRules) {
            config.notificationRules = req.body.notificationRules;
        }

        await config.save();
        res.json(config);
    } catch (error) {
        console.error("Error updating config:", error);
        res.status(500).json({ error: "Failed to update config" });
    }
};

export const testAlert = async (req, res) => {
    try {
        const config = await ErrorConfig.findOne();
        if (!config || !config.enableEmailAlerts || !config.alertEmails) {
            return res.status(400).json({ error: "Email alerts are not configured or enabled." });
        }

        const emails = Array.isArray(config.alertEmails)
            ? config.alertEmails
            : (typeof config.alertEmails === 'string' ? config.alertEmails.split(',') : []);

        if (emails.length === 0) {
            return res.status(400).json({ error: "No alert emails configured." });
        }

        const mailOptions = {
            from: `"Insider Error Alert" <${process.env.SMTP_USER}>`,
            to: emails.join(", "),
            subject: `[TEST] Insider System Alert`,
            html: `
        <h3>This is a test alert from the Insider System.</h3>
        <p>If you received this, the email alerting system is configured correctly.</p>
        <p>Time: ${new Date().toLocaleString()}</p>
      `,
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: "Test alert sent successfully" });
    } catch (error) {
        console.error("Error sending test alert:", error);
        res.status(500).json({ error: "Failed to send test alert", details: error.message });
    }
};
