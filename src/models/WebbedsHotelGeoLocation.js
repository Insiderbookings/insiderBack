// src/models/WebbedsHotelGeoLocation.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const WebbedsHotelGeoLocation = sequelize.define(
    "WebbedsHotelGeoLocation",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      hotel_id: { type: DataTypes.BIGINT, allowNull: false },
      geo_id: { type: DataTypes.STRING(60) },
      name: { type: DataTypes.STRING(255) },
      type: { type: DataTypes.STRING(120) },
      distance: { type: DataTypes.DECIMAL(12, 3) },
      distance_unit: { type: DataTypes.STRING(10) },
    },
    {
      tableName: "webbeds_hotel_geolocation",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    },
  )

  WebbedsHotelGeoLocation.associate = (models) => {
    if (models.WebbedsHotel) {
      WebbedsHotelGeoLocation.belongsTo(models.WebbedsHotel, {
        foreignKey: "hotel_id",
        targetKey: "hotel_id",
        as: "hotel",
      })
    }
  }

  return WebbedsHotelGeoLocation
}
