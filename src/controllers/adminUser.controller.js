import models from "../models/index.js";
import { sendMail } from "../helpers/mailer.js";

export const adminUpdateUserStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;
        const user = await models.User.findByPk(id);
        if (!user) return res.status(404).json({ error: "User not found" });

        await user.update({ is_active: isActive });
        return res.json({ success: true, user: { id: user.id, is_active: user.is_active } });
    } catch (err) {
        return next(err);
    }
};

export const adminGetUserListings = async (req, res, next) => {
    try {
        const { id } = req.params;
        const homes = await models.Home.findAll({
            where: { host_id: id },
            attributes: ['id', 'title', 'status', 'is_visible', 'auto_close_at'],
            order: [['created_at', 'DESC']]
        });
        return res.json({ listings: homes });
    } catch (err) {
        return next(err);
    }
};

export const adminSendUserAction = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { type, message, subject } = req.body; // type: 'warning' | 'notification'
        const user = await models.User.findByPk(id);
        if (!user) return res.status(404).json({ error: "User not found" });

        const emailSubject = subject || (type === 'warning' ? "Security Warning - Insider" : "Important Notification - Insider");
        const html = `
            <div style="font-family: sans-serif; padding: 20px; color: #111;">
                <h2>${emailSubject}</h2>
                <p>Hello ${user.name || 'User'},</p>
                <div style="background: ${type === 'warning' ? '#fee2e2' : '#f0f9ff'}; border-left: 4px solid ${type === 'warning' ? '#ef4444' : '#0ea5e9'}; padding: 15px; margin: 20px 0;">
                    ${message}
                </div>
                <p>If you have any questions, please contact support.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 12px; color: #666;">Insider Administrative Team</p>
            </div>
        `;

        await sendMail({
            to: user.email,
            subject: emailSubject,
            html,
            text: message
        });

        return res.json({ success: true, message: "Action sent successfully" });
    } catch (err) {
        return next(err);
    }
};
