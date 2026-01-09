// src/models/PushToken.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const PushToken = sequelize.define(
    "PushToken",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      token: { type: DataTypes.STRING(200), allowNull: false, unique: true },
      platform: { type: DataTypes.STRING(20), allowNull: true },
      device_id: { type: DataTypes.STRING(120), allowNull: true },
      last_seen_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "push_token",
      freezeTableName: true,
      underscored: true,
      indexes: [
        { fields: ["user_id"] },
        { fields: ["token"], unique: true },
      ],
    }
  );

  PushToken.associate = (models) => {
    PushToken.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
  };

  return PushToken;
};
