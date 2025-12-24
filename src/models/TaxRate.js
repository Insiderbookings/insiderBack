// src/models/TaxRate.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const TaxRate = sequelize.define(
    "TaxRate",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      country_code: { type: DataTypes.STRING(8), allowNull: false },
      state_code: { type: DataTypes.STRING(40), allowNull: true },
      rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      label: { type: DataTypes.STRING(120), allowNull: true },
    },
    {
      tableName: "tax_rate",
      underscored: true,
      freezeTableName: true,
    }
  );

  return TaxRate;
};
