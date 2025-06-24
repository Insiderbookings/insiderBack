// src/models/OutsideBookingAddOn.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const OutsideBookingAddOn = sequelize.define("OutsideBookingAddOn", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    outsidebooking_id: {
      type      : DataTypes.INTEGER,
      allowNull : false,
      references: { model: "OutsideBooking", key: "id" },
      onDelete  : "CASCADE",
    },

    add_on_id: {
      type      : DataTypes.INTEGER,
      allowNull : false,
      references: { model: "AddOn", key: "id" },      // ← OK (tabla AddOns)
      onDelete  : "CASCADE",
    },

    /** variante elegida (puede ser null) */
    add_on_option_id: {
      type      : DataTypes.INTEGER,
      allowNull : true,
      references: { model: "add_on_option", key: "id" }, // ← mismo nombre que tableName
      onDelete  : "SET NULL",
    },

    qty       : { type: DataTypes.INTEGER, defaultValue: 1 },
    unitPrice : { type: DataTypes.DECIMAL(10,2), allowNull: false },
    paymentStatus: {
      type        : DataTypes.ENUM("unpaid","paid","refunded"),
      defaultValue: "unpaid",
    },
  }, {
    tableName: "outsidebooking_add_on",
  })

  return OutsideBookingAddOn
}
