import { DataTypes } from "sequelize"

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql"
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB

  const WebbedsAmenityCatalog = sequelize.define(
    "WebbedsAmenityCatalog",
    {
      code: { type: DataTypes.BIGINT, primaryKey: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      type: { type: DataTypes.STRING(40), defaultValue: "hotel" },
      runno: { type: DataTypes.INTEGER },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "webbeds_amenity_catalog",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [{ fields: ["type"] }],
    },
  )

  return WebbedsAmenityCatalog
}

