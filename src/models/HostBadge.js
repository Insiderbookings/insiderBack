// src/models/HostBadge.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const HostBadge = sequelize.define(
    "HostBadge",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      badge_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "badge", key: "id" },
        onDelete: "CASCADE",
      },
      status: {
        type: DataTypes.ENUM("ACTIVE", "PENDING", "REVOKED"),
        allowNull: false,
        defaultValue: "ACTIVE",
      },
      awarded_at: { type: DataTypes.DATE },
      revoked_at: { type: DataTypes.DATE },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "host_badge",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
      indexes: [
        {
          unique: true,
          fields: ["user_id", "badge_id"],
          name: "uq_host_badge_user_badge",
        },
        { fields: ["status"], name: "idx_host_badge_status" },
      ],
    },
  );

  HostBadge.associate = (models) => {
    HostBadge.belongsTo(models.User, { foreignKey: "user_id", as: "host" });
    HostBadge.belongsTo(models.Badge, { foreignKey: "badge_id", as: "badge" });
  };

  return HostBadge;
};

