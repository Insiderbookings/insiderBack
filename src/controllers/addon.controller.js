// src/controllers/addon.controller.js
import models from "../models/index.js"
import { Op } from "sequelize"


/* ---------- slug → icon ---------- */
const iconFromSlug = (slug) => {
  const root = slug.split("-")[0]
  switch (root) {
    case "incidentals": return "ShieldCheck"
    case "late":        return "Clock"
    case "early":       return "Sun"
    case "room":        return "BedDouble"
    case "breakfast":   return "Utensils"
    case "welcome":     return "Gift"
    case "valet":       return "Car"
    case "airport":     return "Bus"
    case "laundry":     return "Shirt"
    case "beach":       return "Umbrella"
    case "miami":       return "TreePalm"
    default:            return "Gift"
  }
}

/* ---------- GET /api/addons ---------- */
/*  ?withOptions=true   para incluir AddOnOptions                       */
/*  ?q=pala             búsqueda por nombre (opcional)                  */
export const getAddOns = async (req, res) => {
  try {
    const { withOptions, q } = req.query

    const where = q ? { name: { [Op.iLike]: `%${q.trim()}%` } } : {}

    const addons = await models.AddOn.findAll({
      where,
      order      : [["id", "ASC"]],
      attributes : [
        "id",
        "slug",
        "name",
        "description",
        "price",
        "type",          // <- almacenado en la DB
        "default_qty",   // <- sugerido para quantity
        "icon",
        "subtitle",
        "footnote",
      ],
      include: withOptions === "true"
        ? [{
            model      : models.AddOnOption,
            as         : "AddOnOptions",
            attributes : ["id", "name", "price"],
            order      : [["price", "ASC"]],
          }]
        : [],
    })

    /* ---------- formato de salida ---------- */
    const payload = addons.map(a => {
      const opts   = a.AddOnOptions ?? []
      let   type   = a.type                              // choice | quantity | options

      // Si en la DB está marcado como 'choice' pero tiene variantes, forzamos 'options'
      if (opts.length && type !== "options") type = "options"

      return {
        id          : a.id,
        slug        : a.slug,
        title       : a.name,
        description : a.description,
        price       : Number(a.price),
        iconName    : a.icon || iconFromSlug(a.slug),
        subtitle    : a.subtitle,
        footnote    : a.footnote,
        type,                                           // ← devuelto al FE
        defaultQty  : type === "quantity" ? a.default_qty ?? 1 : null,
        options     : opts.map(o => ({
          id    : o.id,
          label : `${o.name} – $${Number(o.price).toFixed(2)}`,
          price : Number(o.price),
        })),
      }
    })

    return res.json(payload)
  } catch (err) {
    console.error("Error fetching add-ons:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ---------- helper ---------- */
const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")


export const saveOutsideAddOns = async (req, res) => {
  const outsideId = Number(req.params.id)
  const { addons } = req.body

  if (!outsideId || !Array.isArray(addons))
    return res.status(400).json({ error: "Invalid payload" })

  const booking = await models.OutsideBooking.findByPk(outsideId)
  if (!booking)
    return res.status(404).json({ error: "Outside-booking not found" })

  // arrancamos la transacción usando sequelize que ya está enganchado a los modelos
  const t = await models.OutsideBookingAddOn.sequelize.transaction()
  try {
    await models.OutsideBookingAddOn.destroy({
      where: { outsidebooking_id: outsideId },
      transaction: t,
    })

    for (const item of addons) {
      const addOn = await models.AddOn.findOne({
        where: { slug: item.id },
        transaction: t,
      })
      if (!addOn) continue

      let optionId = null
      let unitPrice = Number(addOn.price)
      let qty = item.qty ?? 1

      if (item.optionId) {
        const opt = await models.AddOnOption.findByPk(item.optionId, { transaction: t })
        if (opt) {
          optionId = opt.id
          unitPrice = Number(opt.price)
        }
      }

      await models.OutsideBookingAddOn.create({
        outsidebooking_id: outsideId,
        add_on_id: addOn.id,
        add_on_option_id: optionId,
        qty,
        unitPrice,
        paymentStatus: "unpaid",
      }, { transaction: t })
    }

    await t.commit()
    return res.status(201).json({ ok: true, count: addons.length })
  } catch (err) {
    await t.rollback()
    console.error("Save OutsideBookingAddOns:", err)
    return res.status(500).json({ error: "Server error" })
  }
}