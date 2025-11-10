// src/models/WebbedsHotelAmenity.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const WebbedsHotelAmenity = sequelize.define(
    "WebbedsHotelAmenity",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      hotel_id: { type: DataTypes.BIGINT, allowNull: false },
      category: { type: DataTypes.STRING(40), allowNull: false }, // amenitie | leisure | business
      language_id: { type: DataTypes.STRING(10) },
      language_name: { type: DataTypes.STRING(50) },
      item_id: { type: DataTypes.STRING(40) },
      item_name: { type: DataTypes.STRING(255) },
      catalog_code: { type: DataTypes.BIGINT },
    },
    {
      tableName: "webbeds_hotel_amenity",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { fields: ["hotel_id"] },
        { fields: ["category"] },
        { fields: ["catalog_code"] },
      ],
    },
  )

  WebbedsHotelAmenity.associate = (models) => {
    if (models.WebbedsHotel) {
      WebbedsHotelAmenity.belongsTo(models.WebbedsHotel, {
        foreignKey: "hotel_id",
        targetKey: "hotel_id",
        as: "hotel",
      })
    }
    if (models.WebbedsAmenityCatalog) {
      WebbedsHotelAmenity.belongsTo(models.WebbedsAmenityCatalog, {
        foreignKey: "catalog_code",
        targetKey: "code",
        as: "catalog",
      })
    }
  }

  return WebbedsHotelAmenity
}
