import { DataTypes } from "sequelize"

export default (sequelize) => {
  const WebbedsRateBasis = sequelize.define(
    "WebbedsRateBasis",
    {
      code: { type: DataTypes.BIGINT, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      runno: { type: DataTypes.INTEGER },
    },
    {
      tableName: "webbeds_rate_basis",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    },
  )

  return WebbedsRateBasis
}

