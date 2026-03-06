import { DataTypes } from "sequelize";

export default (sequelize) => {
  const FxRate = sequelize.define(
    "FxRate",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      baseCurrency: {
        type: DataTypes.STRING(3),
        field: "base_currency",
        allowNull: false,
      },
      quoteCurrency: {
        type: DataTypes.STRING(3),
        field: "quote_currency",
        allowNull: false,
      },
      rate: {
        type: DataTypes.DECIMAL(20, 10),
        allowNull: false,
      },
      provider: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "apilayer",
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      rateDate: {
        type: DataTypes.DATEONLY,
        field: "rate_date",
        allowNull: true,
      },
      fetchedAt: {
        type: DataTypes.DATE,
        field: "fetched_at",
        allowNull: false,
      },
      expiresAt: {
        type: DataTypes.DATE,
        field: "expires_at",
        allowNull: true,
      },
    },
    {
      tableName: "fx_rates",
      freezeTableName: true,
      underscored: true,
    }
  );

  return FxRate;
};
