import models from "../models/index.js";

export const adminUpdateListingStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, autoCloseAt } = req.body; // status: 'PUBLISHED', 'SUSPENDED', etc.
        const home = await models.Home.findByPk(id);
        if (!home) return res.status(404).json({ error: "Listing not found" });

        const updateData = {};
        if (status) updateData.status = status;
        if (autoCloseAt !== undefined) updateData.auto_close_at = autoCloseAt;

        await home.update(updateData);
        return res.json({ success: true, listing: home });
    } catch (err) {
        return next(err);
    }
};
