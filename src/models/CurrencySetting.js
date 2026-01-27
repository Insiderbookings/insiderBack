import { DataTypes } from "sequelize";

export default (sequelize) => {
  const CurrencySetting = sequelize.define(
    "CurrencySetting",
    {
      code: {
        type: DataTypes.STRING(8),
        primaryKey: true,
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      symbol: {
        type: DataTypes.STRING(12),
        allowNull: true,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        field: "sort_order",
        allowNull: false,
        defaultValue: 0,
      },
      updatedBy: {
        type: DataTypes.INTEGER,
        field: "updated_by",
        allowNull: true,
      },
    },
    {
      tableName: "currency_settings",
      freezeTableName: true,
      underscored: true,
    }
  );

  return CurrencySetting;
};
