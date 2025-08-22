import Sequelize from "sequelize";
const { where: sqWhere, col } = Sequelize;      // ← sin Op

import models from "../models/index.js";

/* ──────────────────────────────────────────── */
/*  POST /api/hotels/:hotelId/rooms            */
/* ──────────────────────────────────────────── */
export const createRoom = async (req, res) => {
  try {
    const room = await models.Room.create(req.body);
    res.status(201).json(room);
  } catch (err) {
    console.error("createRoom:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

/* ──────────────────────────────────────────── */
/*  GET /api/hotels/:hotelId/rooms             */
/*     ?guests=2                               */
/* ──────────────────────────────────────────── */
export const getRoomsByHotel = async (req, res) => {
  try {
    const hotelId = Number(req.params.hotelId);
    const guests  = parseInt(req.query.guests, 10);

    // Base: siempre filtramos por hotel_id
    const conditions = { hotel_id: hotelId };

    // Si guests es un número, añadimos capacity >= guests
    if (!isNaN(guests)) {
      conditions.capacity = sqWhere(col("capacity"), ">=", guests);
    }

    const rooms = await models.Room.findAll({ where: conditions });

    console.log(rooms, "en back rooms")
    res.json(rooms);
  } catch (err) {
    console.error("getRoomsByHotel:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};
