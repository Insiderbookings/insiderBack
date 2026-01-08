// src/models/StayHotel.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const StayHotel = sequelize.define(
    "StayHotel",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      stay_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "booking", key: "id" },
        onDelete: "CASCADE",
      },
      hotel_id: { type: DataTypes.INTEGER, allowNull: true },
      webbeds_hotel_id: { type: DataTypes.BIGINT, allowNull: true },
      room_id: { type: DataTypes.INTEGER, allowNull: true },
      tgx_option_id: { type: DataTypes.STRING(120), allowNull: true },
      board_code: { type: DataTypes.STRING(40), allowNull: true },
      cancellation_policy: { type: DataTypes.TEXT },
      rate_plan_name: { type: DataTypes.STRING(120) },
      room_name: { type: DataTypes.STRING(120) },
      room_snapshot: { type: DataTypes.JSON },
    },
    {
      tableName: "stay_hotel",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
    }
  );

  StayHotel.associate = (models) => {
    StayHotel.belongsTo(models.Stay, { foreignKey: "stay_id" });
    if (models.Hotel) {
      StayHotel.belongsTo(models.Hotel, { foreignKey: "hotel_id", as: "hotel" });
    }
    if (models.WebbedsHotel) {
      StayHotel.belongsTo(models.WebbedsHotel, { foreignKey: "webbeds_hotel_id", as: "webbedsHotel" });
    }
    if (models.Room) {
      StayHotel.belongsTo(models.Room, { foreignKey: "room_id", as: "room" });
    }
  };

  return StayHotel;
};
