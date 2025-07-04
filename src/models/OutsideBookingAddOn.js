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

    qty          : { type: DataTypes.INTEGER,      defaultValue: 1 },
    unitPrice    : { type: DataTypes.DECIMAL(10,2), allowNull   : false },

    /* —— Nueva columna —— */
    status       : {
      type        : DataTypes.ENUM("pending","confirmed","cancelled","ready"),
      defaultValue: "pending",
    },
    room_id      : {
      type       : DataTypes.INTEGER,
      allowNull  : true,
      references : { model: "Room", key: "id" },
      onDelete   : "SET NULL",
    },
    paymentStatus: {
      type        : DataTypes.ENUM("unpaid","paid","refunded"),
      defaultValue: "unpaid",
    },
  }, {
    tableName   : "outsidebooking_add_on",
    underscored : true,
  })

  OutsideBookingAddOn.associate = (models) => {
    // allow pivot.findOne({ include: OutsideBooking })
    OutsideBookingAddOn.belongsTo(models.OutsideBooking, {
      foreignKey: "outsidebooking_id",
      as        : "booking"
    })
    OutsideBookingAddOn.belongsTo(models.AddOn, {
      foreignKey: "add_on_id",
      as        : "addOn"
    })
    OutsideBookingAddOn.belongsTo(models.AddOnOption, {
      foreignKey: "add_on_option_id",
      as        : "option"
    })
    OutsideBookingAddOn.belongsTo(models.Room, {
      foreignKey: "room_id",
      as        : "room"
    })
  }

  return OutsideBookingAddOn
}
