// src/models/HomeBadge.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const HomeBadge = sequelize.define(
    "HomeBadge",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
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
      score: { type: DataTypes.DECIMAL(6, 4) },
      awarded_at: { type: DataTypes.DATE },
      revoked_at: { type: DataTypes.DATE },
      expires_at: { type: DataTypes.DATE },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "home_badge",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
      indexes: [
        {
          unique: true,
          fields: ["home_id", "badge_id"],
          name: "uq_home_badge_home_badge",
        },
        { fields: ["status"], name: "idx_home_badge_status" },
      ],
    },
  );

  HomeBadge.associate = (models) => {
    HomeBadge.belongsTo(models.Home, { foreignKey: "home_id", as: "home" });
    HomeBadge.belongsTo(models.Badge, { foreignKey: "badge_id", as: "badge" });
  };

  return HomeBadge;
};

