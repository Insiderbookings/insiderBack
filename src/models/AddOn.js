// src/models/AddOn.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const AddOn = sequelize.define(
    "AddOn",
    {
      /* ───────────── Clave primaria ───────────── */
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      /* ──────────── Texto base ──────────── */
      name       : { type: DataTypes.STRING(120), allowNull: false },
      slug       : { type: DataTypes.STRING(120), allowNull: false, unique: true },
      description: DataTypes.TEXT,

      /* ───────────── UI / meta ───────────── */
      icon    : DataTypes.STRING(60),     // ej. "ShieldCheck"
      subtitle: DataTypes.STRING(150),
      footnote: DataTypes.TEXT,

      /* ──────── Lógica de negocio ──────── */
      /** tipo: choice (sí/no) · quantity (con qty) · options (radio) */
      type: {
        type        : DataTypes.ENUM("choice", "quantity", "options"),
        allowNull   : false,
        defaultValue: "choice",
      },

      /** precio base (cuando type !== "options") */
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },

      /** qty sugerida para type === "quantity" */
      defaultQty: DataTypes.INTEGER,

      /* Campo libre para JSON extra */
      meta: DataTypes.JSONB,
    },
    {
      tableName      : "add_on",   // EXACTO como existe en PostgreSQL
      freezeTableName: true,       // evita pluralización
      underscored    : true,       // created_at / updated_at
    },
  )

  /* ─────────────── Asociaciones ─────────────── */
  AddOn.associate = (models) => {
    /* Opciones del add-on (catálogo maestro) */
    AddOn.hasMany(models.AddOnOption, { foreignKey: "add_on_id" })

    /* Relación 1-N con el pivote HotelAddOn (override p/hotel) */
    AddOn.hasMany(models.HotelAddOn,  { foreignKey: "add_on_id" })

    /* Booking interno */
    AddOn.belongsToMany(models.Booking, {
      through    : models.BookingAddOn,
      foreignKey : "add_on_id",
      otherKey   : "booking_id",
    })

    /* Booking externo */
    AddOn.belongsToMany(models.OutsideBooking, {
      through    : models.OutsideBookingAddOn,
      foreignKey : "add_on_id",
      otherKey   : "outsidebooking_id",
    })

    /* Many-to-many con Hotel (acceso por alias "hotels") */
    AddOn.belongsToMany(models.Hotel, {
      through    : models.HotelAddOn,
      as         : "hotels",
      foreignKey : "add_on_id",
      otherKey   : "hotel_id",
    })
  }

  return AddOn
}
