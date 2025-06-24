// src/models/AddOn.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const AddOn = sequelize.define("AddOn", {
    id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    /* ——— texto base ——— */
    name:        { type: DataTypes.STRING(120), allowNull: false },
    slug:        { type: DataTypes.STRING(120), allowNull: false, unique: true },
    description: DataTypes.TEXT,

    /* ——— UI / meta ——— */
    icon:        { type: DataTypes.STRING(60) },     // ej. "ShieldCheck"
    subtitle:    DataTypes.STRING(150),
    footnote:    DataTypes.TEXT,

    /* ——— lógica de negocio ——— */
    /**  tipo: choice (sí/no), quantity (con qty), options (radio)  */
    type:        { type: DataTypes.ENUM("choice", "quantity", "options"),
                   allowNull: false, defaultValue: "choice" },

    /** precio base (cuando type !== "options") */
    price:       { type: DataTypes.DECIMAL(10, 2), allowNull: false },

    /** qty sugerida para type === "quantity" */
    defaultQty:  { type: DataTypes.INTEGER, allowNull: true },

    /* campo libre p/ guardar cualquier JSON extra */
    meta:        DataTypes.JSONB,
  }, {
      tableName      : "add_on",   //  ←  EXACTO como existe en PostgreSQL
      freezeTableName: true,       //  ←  evita que Sequelize pluralice
      underscored    : true,       //  ←  created_at / updated_at
    },)

  /* ——— Asociaciones ——— */
  AddOn.associate = (models) => {
    AddOn.hasMany(models.AddOnOption, { foreignKey: "add_on_id" })

    AddOn.belongsToMany(models.Booking, {
      through   : models.BookingAddOn,
      foreignKey: "add_on_id",
      otherKey  : "booking_id",
    })
    AddOn.belongsToMany(models.OutsideBooking, {
      through   : models.OutsideBookingAddOn,
      foreignKey: "add_on_id",
      otherKey  : "outsidebooking_id",
    })
  }

  return AddOn
}
