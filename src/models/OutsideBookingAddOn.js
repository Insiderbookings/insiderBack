/* eslint-disable prettier/prettier */
// src/models/OutsideBookingAddOn.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const OutsideBookingAddOn = sequelize.define("OutsideBookingAddOn", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    /* ——— FK a OutsideBooking ——— */
    outsidebooking_id: {
      type       : DataTypes.INTEGER,
      allowNull  : false,
      references : { model: "OutsideBooking", key: "id" },
      onDelete   : "CASCADE",
    },

    /* ——— FK a AddOn ——— */
    add_on_id: {
      type       : DataTypes.INTEGER,
      allowNull  : false,
      references : { model: "AddOn", key: "id" },
      onDelete   : "CASCADE",
    },

    /* ——— Variante elegida (opcional) ——— */
    add_on_option_id: {
      type       : DataTypes.INTEGER,
      allowNull  : true,
      references : { model: "add_on_option", key: "id" },
      onDelete   : "SET NULL",
    },

    qty       : { type: DataTypes.INTEGER,      defaultValue: 1 },
    unitPrice : { type: DataTypes.DECIMAL(10,2), allowNull   : false },

    /* —— Nueva columna —— */
    status : {
      type        : DataTypes.ENUM("pending","confirmed","cancelled"),
      defaultValue: "pending",
    },

    paymentStatus: {
      type        : DataTypes.ENUM("unpaid","paid","refunded"),
      defaultValue: "unpaid",
    },
  }, {
    tableName: "outsidebooking_add_on",
    underscored: true,
  })

  return OutsideBookingAddOn
}
