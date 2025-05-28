import models from "../models/index.js";

export const getMyCommissions = async (req, res) => {
  try {
    const commissions = await models.Commission.findAll({ where: { staff_id: req.user.id } });
    res.json(commissions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};
