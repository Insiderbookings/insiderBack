import { DataTypes } from "sequelize";

export default (sequelize) => {
  const FxRateChangeLog = sequelize.define(
    "FxRateChangeLog",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      batchId: {
        type: DataTypes.STRING(64),
        field: "batch_id",
        allowNull: false,
      },
      source: {
        type: DataTypes.STRING(80),
        allowNull: false,
        defaultValue: "unknown",
      },
      triggeredBy: {
        type: DataTypes.INTEGER,
        field: "triggered_by",
        allowNull: true,
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
      provider: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "apilayer",
      },
      oldRate: {
        type: DataTypes.DECIMAL(20, 10),
        field: "old_rate",
        allowNull: false,
      },
      newRate: {
        type: DataTypes.DECIMAL(20, 10),
        field: "new_rate",
        allowNull: false,
      },
      changedAt: {
        type: DataTypes.DATE,
        field: "changed_at",
        allowNull: false,
      },
    },
    {
      tableName: "fx_rate_change_logs",
      freezeTableName: true,
      underscored: true,
    }
  );

  return FxRateChangeLog;
};

