// src/models/Badge.js
import { DataTypes } from "sequelize";

const BADGE_SCOPES = ["HOME", "HOST", "PLATFORM"];

export default (sequelize) => {
  const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const Badge = sequelize.define(
    "Badge",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      slug: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      scope: {
        type: DataTypes.ENUM(...BADGE_SCOPES),
        allowNull: false,
        defaultValue: "HOME",
      },
      title: { type: DataTypes.STRING(160), allowNull: false },
      subtitle: { type: DataTypes.STRING(160) },
      description: { type: DataTypes.TEXT },
      icon: { type: DataTypes.STRING(80) },
      criteria: { type: JSON_TYPE },
      priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: "badge",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
    },
  );

  Badge.BADGE_SCOPES = BADGE_SCOPES;

  Badge.associate = (models) => {
    if (models.HomeBadge) {
      Badge.hasMany(models.HomeBadge, {
        foreignKey: "badge_id",
        as: "homeAssignments",
        onDelete: "CASCADE",
      });
    }
    if (models.HostBadge) {
      Badge.hasMany(models.HostBadge, {
        foreignKey: "badge_id",
        as: "hostAssignments",
        onDelete: "CASCADE",
      });
    }
  };

  return Badge;
};
