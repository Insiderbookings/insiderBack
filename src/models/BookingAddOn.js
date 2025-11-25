// src/models/BookingAddOn.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const BookingAddOn = sequelize.define(
    "BookingAddOn",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      stay_id: { type: DataTypes.INTEGER, allowNull: false },
      booking_id: {
        type: DataTypes.VIRTUAL,
        set(value) {
          if (value != null) this.setDataValue("stay_id", value);
        },
        get() {
          return this.getDataValue("stay_id");
        },
      },
      add_on_id: { type: DataTypes.INTEGER, allowNull: false },
      add_on_option_id: { type: DataTypes.INTEGER, allowNull: true },
      room_id: { type: DataTypes.INTEGER, allowNull: true },

      quantity: { type: DataTypes.INTEGER, defaultValue: 1 },
      unit_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },

      status: {
        type: DataTypes.ENUM("pending", "confirmed", "cancelled", "ready"),
        defaultValue: "pending",
      },
      payment_status: {
        type: DataTypes.ENUM("unpaid", "paid", "refunded"),
        defaultValue: "unpaid",
      },

      meta: { type: JSON_TYPE },
    },
    {
      tableName: "booking_add_on",
      underscored: true,
      freezeTableName: true,
      engine: "InnoDB",
      indexes: [
        { unique: true, fields: ["stay_id", "add_on_id"] },
        { fields: ["room_id"] },
        { fields: ["add_on_option_id"] },
      ],
    }
  );

  BookingAddOn.associate = (models) => {
    BookingAddOn.belongsTo(models.Stay, {
      foreignKey: "stay_id",
      as: "stay",
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    BookingAddOn.belongsTo(models.AddOn, { foreignKey: "add_on_id", as: "addOn", onDelete: "CASCADE", onUpdate: "CASCADE" });
    BookingAddOn.belongsTo(models.AddOnOption, { foreignKey: "add_on_option_id", as: "option", onDelete: "SET NULL", onUpdate: "CASCADE" });
    BookingAddOn.belongsTo(models.Room, { foreignKey: "room_id", as: "room", onDelete: "SET NULL", onUpdate: "CASCADE" });
  };

  return BookingAddOn;
};
