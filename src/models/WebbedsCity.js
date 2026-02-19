// src/models/WebbedsCity.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql"
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB

  const WebbedsCity = sequelize.define(
    "WebbedsCity",
    {
      code: { type: DataTypes.BIGINT, primaryKey: true },
      name: { type: DataTypes.STRING(180), allowNull: false },
      country_code: { type: DataTypes.INTEGER, allowNull: false },
      country_name: { type: DataTypes.STRING(150), allowNull: false },
      state_name: { type: DataTypes.STRING(150) },
      state_code: { type: DataTypes.STRING(60) },
      region_name: { type: DataTypes.STRING(150) },
      region_code: { type: DataTypes.STRING(60) },
      lat: { type: DataTypes.DECIMAL(11, 8) },
      lng: { type: DataTypes.DECIMAL(11, 8) },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "webbeds_city",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    },
  )

  WebbedsCity.associate = (models) => {
    if (models.WebbedsCountry) {
      WebbedsCity.belongsTo(models.WebbedsCountry, {
        as: "country",
        foreignKey: "country_code",
        targetKey: "code",
      })
    }
    if (models.WebbedsHotel) {
      WebbedsCity.hasMany(models.WebbedsHotel, {
        as: "hotels",
        foreignKey: "city_code",
        sourceKey: "code",
      })
    }
    if (models.WebbedsCityPlaceMap) {
      WebbedsCity.hasMany(models.WebbedsCityPlaceMap, {
        as: "placeMappings",
        foreignKey: "city_code",
        sourceKey: "code",
      })
    }
  }

  return WebbedsCity
}
