// src/controllers/upsellCode.controller.js
import models from "../models/index.js";

/* ──────────────────────────── 1. Staff genera un código ──────────────────────────── */
export const generateUpsellCode = async (req, res) => {
  try {
    const staffId          = req.user.id;              // ← viene del middleware auth
    const { roomNumber, addOnId } = req.body;

    if (!roomNumber || !addOnId)
      return res.status(400).json({ error: "roomNumber and addOnId are required" });

    /* Verificar que el add-on exista */
    const addOn = await models.AddOn.findByPk(addOnId);
    if (!addOn) return res.status(404).json({ error: "Add-On not found" });

    /* Generar código único de 4 dígitos */
    let code;
    do {
      code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (await models.UpsellCode.findOne({ where: { code } }));

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h

    const record = await models.UpsellCode.create({
      room_number: roomNumber,
      add_on_id : addOnId,
      staff_id  : staffId,
      code,
      expires_at: expiresAt,
      status    : "pending",
    });

    res.json({
      code      : record.code,
      expiresAt : record.expires_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating code" });
  }
};

/* ──────────────────────────── 2. Cliente valida el código ──────────────────────────── */
export const validateUpsellCode = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || code.length !== 4)
      return res.status(400).json({ error: "Code must be 4 digits" });

    /* Buscar código pendiente */
    const record = await models.UpsellCode.findOne({
      where: { code, status: "pending" },
      include: {
        model     : models.AddOn,
        attributes: ["id", "name", "description", "price"],
      },
    });

    if (!record)
      return res.status(404).json({ error: "Invalid or already used code" });

    /* Verificar expiración */
    if (record.expires_at && record.expires_at < new Date())
      return res.status(410).json({ error: "Code expired" });

    /* Marcar como usado (opcional, para que no se reutilice) */
    record.status = "pending";
    await record.save();

    /* Responder con info para el checkout */
    res.json({
      roomNumber : record.room_number,
      addOn      : record.AddOn,
      total      : record.AddOn.price,
      addOnId: record.id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error validating code" });
  }
};

export const getUpsellCode = async (req, res) => {
  try {
    const { id } = req.params;

    /* Buscar por PK e incluir Add-On */
    const record = await models.UpsellCode.findByPk(id, {
      include: {
        model     : models.AddOn,
        attributes: ["id", "name", "description", "price"],
      },
    });

    if (!record)
      return res.status(404).json({ error: "Upsell code not found" });

    /* Construir respuesta: mostrar como “paid” aunque siga pending */
    res.json({
      upsellCodeId: record.id,
      code        : record.code,
      roomNumber  : record.room_number,
      status      : record.status === "pending" ? "paid" : record.status,
      addOn       : record.AddOn,
      total       : record.AddOn.price,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error retrieving upsell info" });
  }
};
