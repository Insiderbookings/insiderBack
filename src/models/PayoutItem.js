// src/models/PayoutItem.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;
  const PayoutItem = sequelize.define(
    "PayoutItem",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      payout_batch_id: { type: DataTypes.INTEGER, allowNull: true },
      stay_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "USD" },
      status: {
        type: DataTypes.ENUM("PENDING", "QUEUED", "PROCESSING", "PAID", "FAILED", "ON_HOLD"),
        allowNull: false,
        defaultValue: "PENDING",
      },
      scheduled_for: { type: DataTypes.DATEONLY },
      paid_at: { type: DataTypes.DATE },
      failure_reason: { type: DataTypes.TEXT },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "payout_item",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
    }
  );

  PayoutItem.associate = (models) => {
    PayoutItem.belongsTo(models.PayoutBatch, { foreignKey: "payout_batch_id", as: "batch" });
    PayoutItem.belongsTo(models.Stay, { foreignKey: "stay_id", as: "stay" });
    PayoutItem.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
  };

  return PayoutItem;
};
