import { DataTypes } from "sequelize"

export default (sequelize) => {
  const WebbedsHotelClassification = sequelize.define(
    "WebbedsHotelClassification",
    {
      code: { type: DataTypes.BIGINT, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      runno: { type: DataTypes.INTEGER },
    },
    {
      tableName: "webbeds_hotel_classification",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    },
  )

  return WebbedsHotelClassification
}

