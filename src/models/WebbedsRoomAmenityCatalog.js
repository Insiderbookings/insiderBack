import { DataTypes } from "sequelize"

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql"
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB

  const WebbedsRoomAmenityCatalog = sequelize.define(
    "WebbedsRoomAmenityCatalog",
    {
      code: { type: DataTypes.BIGINT, primaryKey: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      runno: { type: DataTypes.INTEGER },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "webbeds_room_amenity_catalog",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    },
  )

  return WebbedsRoomAmenityCatalog
}

