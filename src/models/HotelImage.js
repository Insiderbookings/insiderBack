// src/models/HotelImage.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HotelImage = sequelize.define(
    "HotelImage",
    {
      id: {
        type         : DataTypes.INTEGER,
        primaryKey   : true,
        autoIncrement: true,
      },
      hotel_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "hotel", key: "id" },
        onDelete   : "CASCADE",
      },
      url       : { type: DataTypes.STRING(500), allowNull: false },
      caption   : DataTypes.STRING(255),
      is_primary: { type: DataTypes.BOOLEAN, defaultValue: false },
      order     : DataTypes.INTEGER,
    },
    {
      tableName      : "hotel_image",   // ← snake_case singular
      freezeTableName: true,
      underscored    : true,
      paranoid       : true,
    }
  );

  HotelImage.associate = (models) => {
    HotelImage.belongsTo(models.Hotel, { foreignKey: "hotel_id" });
  };

  return HotelImage;
};
