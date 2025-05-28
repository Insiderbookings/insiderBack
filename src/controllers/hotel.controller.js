import models from "../models/index.js";

export const createHotel = async (req, res) => {
  try {
    const hotel = await models.Hotel.create(req.body);
    res.status(201).json(hotel);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

export const getHotels = async (req, res) => {
  try {
    const { location, category, rating } = req.query
    const where = {}

    if (location)  where.location  = { [Op.iLike]: `%${location}%` }
    if (category)  where.category  = category
    if (rating)    where.rating    = { [Op.gte]: Number(rating) }

    const hotels = await models.Hotel.findAll({ where })
    res.json(hotels)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Server error" })
  }
}

export const getHotelById = async (req, res) => {
  try {
    const hotel = await models.Hotel.findByPk(req.params.id);
    if (!hotel) return res.status(404).json({ error: "Not found" });
    res.json(hotel);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};
