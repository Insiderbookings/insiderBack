// src/models/HostProfile.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HostProfile = sequelize.define(
    "HostProfile",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        unique: true,
      },
      kyc_status: {
        type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED"),
        defaultValue: "PENDING",
      },
      payout_status: {
        type: DataTypes.ENUM("INCOMPLETE", "READY", "ON_HOLD"),
        defaultValue: "INCOMPLETE",
      },
      bank_routing_number: { type: DataTypes.STRING(100) },
      bank_account_number: { type: DataTypes.STRING(100) },
      bank_account_holder: { type: DataTypes.STRING(150) },
      biography: { type: DataTypes.TEXT },
      languages: { type: DataTypes.JSON },
      phone_number: { type: DataTypes.STRING(40) },
      support_email: { type: DataTypes.STRING(120) },
      timezone: { type: DataTypes.STRING(60) },
      metadata: { type: DataTypes.JSON },
    },
    {
      tableName: "host_profile",
      underscored: true,
      freezeTableName: true,
    }
  );

  HostProfile.associate = (models) => {
    HostProfile.belongsTo(models.User, { foreignKey: "user_id" });
    HostProfile.hasMany(models.Home, { foreignKey: "host_id", as: "homes" });
  };

  return HostProfile;
};
