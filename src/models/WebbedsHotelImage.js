// src/models/WebbedsHotelImage.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const WebbedsHotelImage = sequelize.define(
    "WebbedsHotelImage",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      hotel_id: { type: DataTypes.BIGINT, allowNull: false },
      category_id: { type: DataTypes.STRING(60) },
      category_name: { type: DataTypes.STRING(120) },
      alt: { type: DataTypes.STRING(255) },
      url: { type: DataTypes.TEXT },
      runno: { type: DataTypes.INTEGER },
      is_thumbnail: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    {
      tableName: "webbeds_hotel_image",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    },
  )

  WebbedsHotelImage.associate = (models) => {
    if (models.WebbedsHotel) {
      WebbedsHotelImage.belongsTo(models.WebbedsHotel, {
        foreignKey: "hotel_id",
        targetKey: "hotel_id",
        as: "hotel",
      })
    }
  }

  return WebbedsHotelImage
}
