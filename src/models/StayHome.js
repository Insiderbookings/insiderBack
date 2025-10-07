// src/models/StayHome.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const StayHome = sequelize.define(
    "StayHome",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      stay_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "booking", key: "id" },
        onDelete: "CASCADE",
      },
      home_id: { type: DataTypes.INTEGER, allowNull: true },
      home_unit_id: { type: DataTypes.INTEGER, allowNull: true },
      host_id: { type: DataTypes.INTEGER, allowNull: true },
      checkin_window_start: { type: DataTypes.TIME },
      checkin_window_end: { type: DataTypes.TIME },
      checkout_time: { type: DataTypes.TIME },
      cleaning_fee: { type: DataTypes.DECIMAL(10, 2) },
      security_deposit: { type: DataTypes.DECIMAL(10, 2) },
      access_instructions: { type: DataTypes.TEXT },
      house_rules_snapshot: { type: DataTypes.JSON },
      fees_snapshot: { type: DataTypes.JSON },
    },
    {
      tableName: "stay_home",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
    }
  );

  StayHome.associate = (models) => {
    StayHome.belongsTo(models.Stay, { foreignKey: "stay_id" });
  };

  return StayHome;
};
