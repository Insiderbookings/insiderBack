import { DataTypes } from "sequelize"

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql"
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB

  const WebbedsCurrency = sequelize.define(
    "WebbedsCurrency",
    {
      code: { type: DataTypes.INTEGER, primaryKey: true },
      shortcut: { type: DataTypes.STRING(10) },
      name: { type: DataTypes.STRING(120), allowNull: false },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "webbeds_currency",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    },
  )

  return WebbedsCurrency
}

