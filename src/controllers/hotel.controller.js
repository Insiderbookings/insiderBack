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

    if (location) where.location = { [Op.iLike]: `%${location}%` }
    if (category) where.category = category
    if (rating) where.rating = { [Op.gte]: Number(rating) }

    const hotels = await models.Hotel.findAll({
      where,
      include: [
        {
          model: models.Room,
          // si quieres, puedes limitar atributos:
          // attributes: ["id", "name", "price", "capacity", "beds", "image", "available"]
        }
      ],
    })

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

export const getHotelImages = async (req, res) => {
  try {
    const hotelId = req.params.id;

    console.log(hotelId)

    const images = await models.HotelImage.findAll({
      where: { hotel_id: hotelId },
      order: [
        ["order", "ASC"],         // primero por el campo `order`
        ["is_primary", "DESC"]    // luego las primarias adelante
      ],
    });

    console.log(images, "imagenes")

    return res.json(images);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};



export const getHotelsWithRooms = async (req, res) => {
  try {
    const hotels = await models.Hotel.findAll({include: [{
                model      : models.Room
              }]})
    res.json(hotels)
    console.log("hotelswithrooms", hotels)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Server error" })
  }
}