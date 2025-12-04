// src/models/PayoutBatch.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;
  const PayoutBatch = sequelize.define(
    "PayoutBatch",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "USD" },
      total_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      status: {
        type: DataTypes.ENUM("PENDING", "PROCESSING", "PAID", "FAILED"),
        allowNull: false,
        defaultValue: "PENDING",
      },
      provider_batch_id: { type: DataTypes.STRING(120) },
      processed_at: { type: DataTypes.DATE },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "payout_batch",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
    }
  );

  PayoutBatch.associate = (models) => {
    PayoutBatch.hasMany(models.PayoutItem, { foreignKey: "payout_batch_id", as: "items" });
  };

  return PayoutBatch;
};
