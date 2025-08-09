// src/models/HotelStaffAddOn.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HotelStaffAddOn = sequelize.define(
    "HotelStaffAddOn",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      hotel_add_on_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "hotel_add_on", key: "id" },
        onDelete   : "CASCADE",
      },
      staff_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "staff", key: "id" },
        onDelete   : "CASCADE",
      },
    },
    {
      tableName      : "hotel_staff_addon",
      freezeTableName: true,
      underscored    : true,
      paranoid       : true,
      indexes        : [{ unique: true, fields: ["hotel_add_on_id", "staff_id"] }],
    }
  );

  HotelStaffAddOn.associate = (models) => {
    HotelStaffAddOn.belongsTo(models.HotelAddOn, { foreignKey: "hotel_add_on_id", as: "hotelAddOn" });
    HotelStaffAddOn.belongsTo(models.Staff,      { foreignKey: "staff_id",        as: "staff"      });
  };

  return HotelStaffAddOn;
};
