import { DataTypes } from "sequelize"

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql"
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB

  const WebbedsSyncLog = sequelize.define(
    "WebbedsSyncLog",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      scope: {
        type: DataTypes.ENUM("country", "city"),
        allowNull: false,
        defaultValue: "city",
      },
      country_code: { type: DataTypes.INTEGER },
      city_code: { type: DataTypes.BIGINT },
      last_full_sync: { type: DataTypes.DATE },
      last_new_sync: { type: DataTypes.DATE },
      last_incremental_sync: { type: DataTypes.DATE },
      last_result_count: { type: DataTypes.INTEGER },
      last_error: { type: DataTypes.TEXT },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "webbeds_sync_log",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { fields: ["scope", "country_code"] },
        { fields: ["scope", "city_code"] },
      ],
    },
  )

  return WebbedsSyncLog
}
