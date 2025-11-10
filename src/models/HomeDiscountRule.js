// src/models/HomeDiscountRule.js
import { DataTypes } from "sequelize";

export const HOME_DISCOUNT_RULE_TYPES = ["EARLY_BIRD", "LAST_MINUTE", "LONG_STAY", "CUSTOM"];

export default (sequelize) => {
  const HomeDiscountRule = sequelize.define(
    "HomeDiscountRule",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      rule_type: {
        type: DataTypes.ENUM(...HOME_DISCOUNT_RULE_TYPES),
        allowNull: false,
      },
      percentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
      min_nights: { type: DataTypes.INTEGER },
      max_nights: { type: DataTypes.INTEGER },
      lead_days: { type: DataTypes.INTEGER },
      active: { type: DataTypes.BOOLEAN, defaultValue: true },
      metadata: { type: DataTypes.JSON },
    },
    {
      tableName: "home_discount_rule",
      underscored: true,
      freezeTableName: true,
    }
  );

  HomeDiscountRule.associate = (models) => {
    HomeDiscountRule.belongsTo(models.Home, { foreignKey: "home_id" });
  };

  return HomeDiscountRule;
};
