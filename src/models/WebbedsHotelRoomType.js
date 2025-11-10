// src/models/WebbedsHotelRoomType.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql"
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB

  const WebbedsHotelRoomType = sequelize.define(
    "WebbedsHotelRoomType",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      hotel_id: { type: DataTypes.BIGINT, allowNull: false },
      roomtype_code: { type: DataTypes.STRING(60), allowNull: false },
      name: { type: DataTypes.STRING(255) },
      twin: { type: DataTypes.STRING(10) },
      room_info: { type: JSON_TYPE },
      room_capacity: { type: JSON_TYPE },
      raw_payload: { type: JSON_TYPE },
    },
    {
      tableName: "webbeds_hotel_room_type",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { fields: ["hotel_id"] },
        { fields: ["roomtype_code"] },
      ],
    },
  )

  WebbedsHotelRoomType.associate = (models) => {
    if (models.WebbedsHotel) {
      WebbedsHotelRoomType.belongsTo(models.WebbedsHotel, {
        foreignKey: "hotel_id",
        targetKey: "hotel_id",
        as: "hotel",
      })
    }
  }

  return WebbedsHotelRoomType
}
