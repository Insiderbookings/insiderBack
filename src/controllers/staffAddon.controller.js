// src/controllers/staffAddon.controller.js
import { validationResult } from "express-validator"
import models   from "../models/index.js"

/* 1 ▸ staff del hotel */
export const listStaffByHotel = async (req, res) => {
  const { hotelId } = req.params
  try {
    const staff = await models.Staff.findAll({
      include: {
        model : models.HotelStaff,
        as    : "hotels",
        where : { hotel_id: hotelId },
        attributes: [],   // pivote no lo necesitamos en resultado
      },
      attributes: ["id", "name", "email", "staff_role_id"],
      order: [["name", "ASC"]],
    })
    return res.json(staff)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Could not fetch staff" })
  }
}

/* 2 ▸ staff asignado a un addon */
export const listAssignments = async (req, res) => {
  const { hotelAddOnId } = req.params
  try {
    const rows = await models.HotelStaffAddOn.findAll({
      where     : { hotel_add_on_id: hotelAddOnId },
      include   : [{ model: models.Staff, as: "staff", attributes: ["id", "name", "email"] }],
      order     : [[{ model: models.Staff, as: "staff" }, "name", "ASC"]],
      paranoid  : false,
    })
    return res.json(rows.map((r) => r.staff))
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Could not fetch assignment" })
  }
}

/* 3 ▸ sobrescribir asignación */
export const putAssignments = async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { hotelAddOnId } = req.params
  const { staffIds }      = req.body           // array de enteros

  try {
    /** 1. borrar asignaciones anteriores */
    await models.HotelStaffAddOn.destroy({ where: { hotel_add_on_id: hotelAddOnId } })

    /** 2. crear nuevas (si el array no está vacío) */
    if (staffIds.length) {
      const bulk = staffIds.map((sid) => ({ hotel_add_on_id: hotelAddOnId, staff_id: sid }))
      await models.HotelStaffAddOn.bulkCreate(bulk)
    }

    return res.json({ ok: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Could not update assignment" })
  }
}
