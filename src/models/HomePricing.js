// src/models/HomePricing.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomePricing = sequelize.define(
    "HomePricing",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "USD" },
      base_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      weekend_price: { type: DataTypes.DECIMAL(10, 2) },
      minimum_stay: { type: DataTypes.INTEGER, defaultValue: 1 },
      maximum_stay: { type: DataTypes.INTEGER },
      cleaning_fee: { type: DataTypes.DECIMAL(10, 2) },
      security_deposit: { type: DataTypes.DECIMAL(10, 2) },
      extra_guest_fee: { type: DataTypes.DECIMAL(10, 2) },
      extra_guest_threshold: { type: DataTypes.INTEGER },
      tax_rate: { type: DataTypes.DECIMAL(5, 2) },
      pricing_strategy: { type: DataTypes.JSON },
    },
    {
      tableName: "home_pricing",
      underscored: true,
      freezeTableName: true,
    }
  );

  HomePricing.associate = (models) => {
    HomePricing.belongsTo(models.Home, { foreignKey: "home_id" });
  };

  return HomePricing;
};
