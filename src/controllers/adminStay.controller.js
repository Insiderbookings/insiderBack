import models from "../models/index.js";

export const adminListStays = async (req, res, next) => {
    try {
        const stays = await models.Stay.findAll({
            limit: 100,
            order: [['created_at', 'DESC']],
            include: [
                {
                    model: models.StayHotel,
                    as: 'hotelStay',
                    include: [{ model: models.Hotel, as: 'hotel', attributes: ['name'] }]
                }
            ]
        });
        return res.json({ stays });
    } catch (err) {
        return next(err);
    }
};

export const adminGetStayDetail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const stay = await models.Stay.findByPk(id, {
            include: [
                {
                    model: models.StayHotel,
                    as: 'hotelStay',
                    include: [{ model: models.Hotel, as: 'hotel' }]
                },
                { model: models.Payment, as: 'payments' }
            ]
        });
        if (!stay) return res.status(404).json({ error: "Stay not found" });
        return res.json({ stay });
    } catch (err) {
        return next(err);
    }
};
