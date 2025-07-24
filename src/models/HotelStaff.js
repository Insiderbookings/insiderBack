// src/models/HotelStaff.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HotelStaff = sequelize.define(
    "HotelStaff",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "hotel",   // nombre de tu tabla de hoteles
          key  : "id",
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },

      staff_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "staff",   // ¡usa minúscula!
          key  : "id",
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },

      staff_code: {
        type: DataTypes.STRING(4),
        allowNull: false,
      },

      is_primary: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName      : "hotel_staff",
      freezeTableName: true,
      underscored    : true,
      paranoid       : true,
      indexes        : [
        { unique: true, fields: ["hotel_id", "staff_id"] },
      ],
    }
  );

  HotelStaff.associate = (models) => {
    HotelStaff.belongsTo(models.Hotel, { foreignKey: "hotel_id", as: "hotel" });
    HotelStaff.belongsTo(models.Staff, { foreignKey: "staff_id", as: "staff" });
  };

  return HotelStaff;
};
