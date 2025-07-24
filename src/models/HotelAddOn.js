// src/models/HotelAddOn.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const HotelAddOn = sequelize.define("HotelAddOn", {
    id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id:    { type: DataTypes.INTEGER, allowNull: false,
                   references: { model: "Hotel", key: "id" }, onDelete: "CASCADE" },
    add_on_id:   { type: DataTypes.INTEGER, allowNull: false,
                   references: { model: "add_on", key: "id" }, onDelete: "CASCADE" },

    /* ——— Overrides ——— */
    active:      { type: DataTypes.BOOLEAN, defaultValue: true },
    price:       { type: DataTypes.DECIMAL(10, 2) },      // null → usa AddOn.price
    defaultQty:  DataTypes.INTEGER,                       // idem
    name:        DataTypes.STRING(120),
    description: DataTypes.TEXT,
    icon:        DataTypes.STRING(60),
    subtitle:    DataTypes.STRING(150),
    footnote:    DataTypes.TEXT,
    meta:        DataTypes.JSONB,
  }, {
    tableName      : "hotel_add_on",
    underscored    : true,
    freezeTableName: true,
    indexes        : [{ unique: true, fields: ["hotel_id", "add_on_id"] }],
  })

  HotelAddOn.associate = (models) => {
    HotelAddOn.belongsTo(models.Hotel, { foreignKey: "hotel_id" })
    HotelAddOn.belongsTo(models.AddOn,  { foreignKey: "add_on_id" })

    /* Para opciones con precio distinto por hotel */
    HotelAddOn.hasMany(models.HotelAddOnOption, { foreignKey: "hotel_add_on_id" })
    HotelAddOn.belongsToMany(models.Staff, {
  through    : models.HotelStaffAddOn,
  as         : "assignedStaff",
  foreignKey : "hotel_add_on_id",
  otherKey   : "staff_id",
})
  }

  return HotelAddOn
}
