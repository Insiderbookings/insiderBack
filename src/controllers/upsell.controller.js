// src/controllers/upsellCode.controller.js
import models from "../models/index.js"

/* ──────────────────────────── 1. Staff genera un código ──────────────────────────── */
export const generateUpsellCode = async (req, res) => {
  try {
    const staffId = req.user.id
    const { roomNumber, addOnId, price, optionId, qty } = req.body

    if (!roomNumber || !addOnId || price == null) {
      return res.status(400).json({ error: "roomNumber, addOnId y price son obligatorios" })
    }

    const addOn = await models.AddOn.findByPk(addOnId)
    if (!addOn) return res.status(404).json({ error: "Add-On not found" })

    if (optionId != null) {
      const addOnOption = await models.AddOnOption.findOne({
        where: { id: optionId, add_on_id: addOnId }
      })
      if (!addOnOption) return res.status(404).json({ error: "Add-On Option not found" })
    }

    let code
    do {
      code = Math.floor(1000 + Math.random() * 9000).toString()
    } while (await models.UpsellCode.findOne({ where: { code } }))

    const expiresAt = new Date(Date.now() + 86_400_000) // 24 h

    const record = await models.UpsellCode.create({
      room_number      : roomNumber,
      add_on_id        : addOnId,
      staff_id         : staffId,
      code,
      expires_at       : expiresAt,
      status           : "PENDING",
      price,
      add_on_option_id : optionId ?? null,
      qty              : qty ?? null
    })

    return res.json({
      code,
      expiresAt: record.expires_at
    })
  } catch (err) {
    console.error("generateUpsellCode:", err)
    return res.status(500).json({ error: "Server error generating code" })
  }
}

/* ──────────────────────────── 2. Cliente valida el código ──────────────────────────── */
export const validateUpsellCode = async (req, res) => {
  try {
    const { code, addOnId, bookingId } = req.body

    if (!code || code.length !== 4 || !addOnId || !bookingId) {
      return res.status(400).json({ error: "Code (4 dígitos), addOnId y bookingId son obligatorios" })
    }

    const record = await models.UpsellCode.findOne({
      where: { code, add_on_id: addOnId, status: "PENDING" },
      include: [
        { association: "addOn",           attributes: ["id", "name", "description", "price"] },
        { association: "selectedOption",  attributes: ["id", "name", "price"] }
      ]
    })

    if (!record) return res.status(404).json({ error: "Código inválido o ya usado" })
    if (record.expires_at && record.expires_at < new Date())
      return res.status(410).json({ error: "Código expirado" })

    record.status = "USED"
    await record.save()

    const pivot = await models.BookingAddOn.create({
      booking_id        : bookingId,
      add_on_id         : record.add_on_id,
      add_on_option_id  : record.add_on_option_id,
      qty               : record.qty ?? 1,
      unit_price        : record.price,
      status            : "READY",
      payment_status    : "PAID"
    })

    return res.json({
      code,
      roomNumber     : record.room_number,
      addOn          : record.addOn,
      selectedOption : record.selectedOption || null,
      total          : record.price,
      addOnId        : record.addOn.id,
      bookingAddOnId : pivot.id
    })
  } catch (err) {
    console.error("validateUpsellCode:", err)
    return res.status(500).json({ error: "Error en servidor" })
  }
}

export const getUpsellCode = async (req, res) => {
  try {
    const { id } = req.params

    const record = await models.UpsellCode.findByPk(id, {
      include: {
        model     : models.AddOn,
        attributes: ["id", "name", "description", "price"]
      }
    })

    if (!record) return res.status(404).json({ error: "Upsell code not found" })

    res.json({
      upsellCodeId: record.id,
      code        : record.code,
      roomNumber  : record.room_number,
      status      : record.status === "PENDING" ? "PAID" : record.status,
      addOn       : record.AddOn,
      total       : record.AddOn.price
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error retrieving upsell info" })
  }
}

export const getMyUpsellCodes = async (req, res) => {
  try {
    const staffId = req.user.id

    const codes = await models.UpsellCode.findAll({
      where: { staff_id: staffId },
      include: [
        { model: models.AddOn, as: "addOn", attributes: ["id", "name", "description", "price"] }
      ],
      order: [["created_at", "DESC"]]
    })

    const result = codes.map(c => ({
      id          : c.id,
      room_number : c.room_number,
      code        : c.code,
      status      : c.status,
      expires_at  : c.expires_at,
      created_at  : c.created_at,
      used_at     : c.status === "USED" ? c.updated_at : null,
      addOnId     : c.AddOn.id,
      addOnName   : c.AddOn.name,
      addOnPrice  : c.AddOn.price,
      addOnDesc   : c.AddOn.description
    }))

    return res.json(result)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Server error" })
  }
}
