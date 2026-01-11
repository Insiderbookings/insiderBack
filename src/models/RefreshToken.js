// src/models/RefreshToken.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const RefreshToken = sequelize.define(
    "RefreshToken",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      token_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      device_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      last_used_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      revoked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      replaced_by: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
    },
    {
      tableName: "refresh_token",
      freezeTableName: true,
      underscored: true,
      paranoid: false,
      indexes: [
        { name: "idx_refresh_token_user", fields: ["user_id"] },
        { name: "idx_refresh_token_device", fields: ["device_id"] },
        { name: "uq_refresh_token_token_id", fields: ["token_id"], unique: true },
      ],
    },
  );

  RefreshToken.associate = (models) => {
    RefreshToken.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
  };

  return RefreshToken;
};
