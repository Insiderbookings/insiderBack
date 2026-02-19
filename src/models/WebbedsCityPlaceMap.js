import { DataTypes } from "sequelize"

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql"
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB

  const WebbedsCityPlaceMap = sequelize.define(
    "WebbedsCityPlaceMap",
    {
      place_id: { type: DataTypes.STRING(255), primaryKey: true },
      city_code: { type: DataTypes.BIGINT, allowNull: false },
      label: { type: DataTypes.STRING(255) },
      place_city: { type: DataTypes.STRING(180) },
      place_state: { type: DataTypes.STRING(150) },
      place_country: { type: DataTypes.STRING(150) },
      lat: { type: DataTypes.DECIMAL(11, 8) },
      lng: { type: DataTypes.DECIMAL(11, 8) },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "webbeds_city_place_map",
      freezeTableName: true,
      underscored: true,
      paranoid: false,
    },
  )

  WebbedsCityPlaceMap.associate = (models) => {
    if (models.WebbedsCity) {
      WebbedsCityPlaceMap.belongsTo(models.WebbedsCity, {
        as: "city",
        foreignKey: "city_code",
        targetKey: "code",
      })
    }
  }

  return WebbedsCityPlaceMap
}
