// src/models/HotelAddOnOption.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HotelAddOnOption = sequelize.define(
    "HotelAddOnOption",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      hotel_add_on_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "hotel_add_on", key: "id" },
        onDelete   : "CASCADE",
      },
      add_on_option_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "add_on_option", key: "id" },
        onDelete   : "CASCADE",
      },

      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    },
    {
      tableName      : "hotel_add_on_option",
      freezeTableName: true,
      underscored    : true,
      indexes        : [{ unique: true, fields: ["hotel_add_on_id", "add_on_option_id"] }],
    }
  );

  HotelAddOnOption.associate = (models) => {
    HotelAddOnOption.belongsTo(models.HotelAddOn,  { foreignKey: "hotel_add_on_id" });
    HotelAddOnOption.belongsTo(models.AddOnOption, { foreignKey: "add_on_option_id" });
  };

  return HotelAddOnOption;
};
