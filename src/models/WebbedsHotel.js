// src/models/WebbedsHotel.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql"
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB

  const WebbedsHotel = sequelize.define(
    "WebbedsHotel",
    {
      hotel_id: { type: DataTypes.BIGINT, primaryKey: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      city_code: { type: DataTypes.BIGINT, allowNull: false },
      city_name: { type: DataTypes.STRING(150), allowNull: false },
      country_code: { type: DataTypes.INTEGER, allowNull: false },
      country_name: { type: DataTypes.STRING(150), allowNull: false },
      region_name: { type: DataTypes.STRING(120) },
      region_code: { type: DataTypes.STRING(60) },
      address: { type: DataTypes.STRING(255) },
      zip_code: { type: DataTypes.STRING(60) },
      location1: { type: DataTypes.STRING(150) },
      location2: { type: DataTypes.STRING(150) },
      location3: { type: DataTypes.STRING(150) },
      built_year: { type: DataTypes.STRING(10) },
      renovation_year: { type: DataTypes.STRING(10) },
      floors: { type: DataTypes.STRING(10) },
      no_of_rooms: { type: DataTypes.STRING(10) },
      rating: { type: DataTypes.STRING(30) },
      priority: { type: DataTypes.INTEGER },
      preferred: { type: DataTypes.BOOLEAN },
      exclusive: { type: DataTypes.BOOLEAN },
      direct: { type: DataTypes.BOOLEAN },
      fire_safety: { type: DataTypes.BOOLEAN },
      chain: { type: DataTypes.STRING(120) },
      chain_code: { type: DataTypes.BIGINT },
      classification_code: { type: DataTypes.BIGINT },
      hotel_phone: { type: DataTypes.STRING(60) },
      hotel_check_in: { type: DataTypes.STRING(40) },
      hotel_check_out: { type: DataTypes.STRING(40) },
      min_age: { type: DataTypes.STRING(10) },
      last_updated: { type: DataTypes.BIGINT },
      lat: { type: DataTypes.DECIMAL(11, 8) },
      lng: { type: DataTypes.DECIMAL(11, 8) },
      full_address: { type: JSON_TYPE },
      descriptions: { type: JSON_TYPE },
      amenities: { type: JSON_TYPE },
      leisure: { type: JSON_TYPE },
      business: { type: JSON_TYPE },
      transportation: { type: JSON_TYPE },
      geo_locations: { type: JSON_TYPE },
      images: { type: JSON_TYPE },
      room_static: { type: JSON_TYPE },
      raw_payload: { type: JSON_TYPE },
    },
    {
      tableName: "webbeds_hotel",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    },
  )

  WebbedsHotel.associate = (models) => {
    if (models.WebbedsCity) {
      WebbedsHotel.belongsTo(models.WebbedsCity, {
        as: "city",
        foreignKey: "city_code",
        targetKey: "code",
      })
    }
    if (models.WebbedsCountry) {
      WebbedsHotel.belongsTo(models.WebbedsCountry, {
        as: "country",
        foreignKey: "country_code",
        targetKey: "code",
      })
    }
    if (models.WebbedsHotelChain) {
      WebbedsHotel.belongsTo(models.WebbedsHotelChain, {
        as: "chainCatalog",
        foreignKey: "chain_code",
        targetKey: "code",
      })
    }
    if (models.WebbedsHotelClassification) {
      WebbedsHotel.belongsTo(models.WebbedsHotelClassification, {
        as: "classification",
        foreignKey: "classification_code",
        targetKey: "code",
      })
    }
    if (models.HotelFavorite) {
      WebbedsHotel.hasMany(models.HotelFavorite, {
        foreignKey: "hotel_id",
        sourceKey: "hotel_id",
        as: "favorites",
      })
    }
    if (models.HotelRecentView) {
      WebbedsHotel.hasMany(models.HotelRecentView, {
        foreignKey: "hotel_id",
        sourceKey: "hotel_id",
        as: "recentViews",
      })
    }
  }

  return WebbedsHotel
}
