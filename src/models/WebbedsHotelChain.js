import { DataTypes } from "sequelize"

export default (sequelize) => {
  const WebbedsHotelChain = sequelize.define(
    "WebbedsHotelChain",
    {
      code: { type: DataTypes.BIGINT, primaryKey: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      runno: { type: DataTypes.INTEGER },
    },
    {
      tableName: "webbeds_hotel_chain",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    },
  )

  return WebbedsHotelChain
}

