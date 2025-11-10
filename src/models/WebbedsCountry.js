// src/models/WebbedsCountry.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const WebbedsCountry = sequelize.define(
    "WebbedsCountry",
    {
      code: { type: DataTypes.INTEGER, primaryKey: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
    },
    {
      tableName: "webbeds_country",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    },
  )

  WebbedsCountry.associate = (models) => {
    if (models.WebbedsCity) {
      WebbedsCountry.hasMany(models.WebbedsCity, {
        as: "cities",
        foreignKey: "country_code",
        sourceKey: "code",
      })
    }
    if (models.WebbedsHotel) {
      WebbedsCountry.hasMany(models.WebbedsHotel, {
        as: "hotels",
        foreignKey: "country_code",
        sourceKey: "code",
      })
    }
  }

  return WebbedsCountry
}
