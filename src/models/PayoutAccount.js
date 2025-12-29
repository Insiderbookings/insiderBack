// src/models/PayoutAccount.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;
  const PayoutAccount = sequelize.define(
    "PayoutAccount",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: "user", key: "id" },
      },
      provider: {
        type: DataTypes.ENUM("BANK", "STRIPE", "PAYPAL", "PAYONEER"),
        allowNull: false,
        defaultValue: "BANK",
      },
      status: {
        type: DataTypes.ENUM("INCOMPLETE", "PENDING", "READY", "VERIFIED"),
        allowNull: false,
        defaultValue: "INCOMPLETE",
      },
      holder_name: { type: DataTypes.STRING(150) },
      bank_name: { type: DataTypes.STRING(150) },
      country: { type: DataTypes.STRING(2) },
      currency: { type: DataTypes.STRING(3) },
      routing_last4: { type: DataTypes.STRING(10) },
      account_last4: { type: DataTypes.STRING(10) },
      external_account_id: { type: DataTypes.STRING(120) },
      external_customer_id: { type: DataTypes.STRING(120) },
      wallet_email: { type: DataTypes.STRING(150) },
      brand: { type: DataTypes.STRING(60) },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "payout_account",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
    }
  );

  PayoutAccount.associate = (models) => {
    PayoutAccount.belongsTo(models.User, { foreignKey: "user_id" });
  };

  return PayoutAccount;
};
