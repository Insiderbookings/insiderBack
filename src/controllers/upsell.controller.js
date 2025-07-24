// src/controllers/upsellCode.controller.js
import models from "../models/index.js";

/* ──────────────────────────── 1. Staff genera un código ──────────────────────────── */
export const generateUpsellCode = async (req, res) => {
  try {
    const staffId          = req.user.id;                // viene del middleware auth
    const { roomNumber, addOnId, price, optionId, qty } = req.body;

    // Validaciones mínimas
    if (!roomNumber || !addOnId || price == null) {
      return res.status(400).json({
        error: "roomNumber, addOnId y price son obligatorios"
      });
    }

    // Verificar que el add-on exista
    const addOn = await models.AddOn.findByPk(addOnId);
    if (!addOn) {
      return res.status(404).json({ error: "Add‑On not found" });
    }

    // Si viene optionId, verificar que exista esa opción
    if (optionId != null) {
      const addOnOption = await models.AddOnOption.findOne({
        where: { id: optionId, add_on_id: addOnId }
      });
      if (!addOnOption) {
        return res.status(404).json({ error: "Add‑On Option not found" });
      }
    }

    // Generar código único de 4 dígitos
    let code;
    do {
      code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (
      await models.UpsellCode.findOne({ where: { code } })
    );

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // Crear el registro, pasando price y, si aplican, optionId y qty
    const record = await models.UpsellCode.create({
      room_number         : roomNumber,
      add_on_id           : addOnId,
      staff_id            : staffId,
      code,
      expires_at          : expiresAt,
      status              : "pending",

      // NUEVOS CAMPOS
      price,
      add_on_option_id    : optionId ?? null,
      qty                  : qty ?? null
    });

    return res.json({
      code      : record.code,
      expiresAt : record.expires_at,
    });
  }
  catch (err) {
    console.error("generateUpsellCode:", err);
    return res.status(500).json({
      error: "Server error generating code"
    });
  }
};
/* ──────────────────────────── 2. Cliente valida el código ──────────────────────────── */
export const validateUpsellCode = async (req, res) => {
  try {
    // 1) ahora esperamos también bookingId en el body
    const { code, addOnId, bookingId } = req.body;
    console.log(req.body, "validateUpsellCode payload");

    if (
      !code ||
      code.length !== 4 ||
      !addOnId ||
      !bookingId
    ) {
      return res
        .status(400)
        .json({ error: "Code (4 dígitos), addOnId y bookingId son obligatorios" });
    }

    // 2) buscamos el UpsellCode pendiente
    const record = await models.UpsellCode.findOne({
      where: { code, add_on_id: addOnId, status: "pending" },
      include: [
        {
          association: "addOn",
          attributes: ["id", "name", "description", "price"],
        },
        {
          association: "selectedOption",
          // corregimos aquí: la columna en add_on_option es "name", no "label"
          attributes: ["id", "name", "price"],
        },
      ],
    });

    if (!record) {
      return res.status(404).json({ error: "Código inválido o ya usado" });
    }
    if (record.expires_at && record.expires_at < new Date()) {
      return res.status(410).json({ error: "Código expirado" });
    }

    // 3) marcamos el código como usado
    record.status = "used";
    await record.save();

    // 4) creamos la fila en outsidebooking_add_on
    const pivot = await models.OutsideBookingAddOn.create({
      outsidebooking_id: bookingId,
      add_on_id: record.add_on_id,
      add_on_option_id: record.add_on_option_id,
      qty: record.qty ?? 1,
      unitPrice: record.price,
      status: "ready",
      paymentStatus: "paid",
      // opcional: room_id si lo quieres pasar aquí
      // room_id: <id_de_habitación>,
    });

    return res.json({
      code,
      roomNumber: record.room_number,
      addOn: record.addOn,
      selectedOption: record.selectedOption || null,
      total: record.price,
      addOnId: record.addOn.id,
      bookingAddOnId: pivot.id,
    });
  } catch (err) {
    console.error("validateUpsellCode:", err);
    return res.status(500).json({ error: "Error en servidor" });
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

export const getMyUpsellCodes = async (req, res) => {
  try {
    const staffId = req.user.id;                // ← viene del middleware auth

    const codes = await models.UpsellCode.findAll({
      where: { staff_id: staffId },
      include: [
        {
          model     : models.AddOn,
          as: 'addOn',
          attributes: ["id", "name", "description", "price"],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    /* Formateo opcional: aplanar datos para el front  */
    const result = codes.map(c => ({
      id          : c.id,
      room_number : c.room_number,
      code        : c.code,
      status      : c.status,
      expires_at  : c.expires_at,
      created_at  : c.created_at,
      used_at     : c.status === "used" ? c.updated_at : null,
      addOnId     : c.AddOn.id,
      addOnName   : c.AddOn.name,
      addOnPrice  : c.AddOn.price,
      addOnDesc   : c.AddOn.description,
    }));

    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};
