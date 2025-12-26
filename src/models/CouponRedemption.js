// src/models/CouponRedemption.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const dialect = sequelize.getDialect()
  const isMySQL = ["mysql", "mariadb"].includes(dialect)
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB
  const STATUS_ENUM =
    dialect === "postgres" || dialect === "postgresql"
      ? DataTypes.ENUM("pending", "redeemed", "reversed")
      : DataTypes.STRING(20)

  const CouponRedemption = sequelize.define(
    "CouponRedemption",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      coupon_wallet_id: { type: DataTypes.INTEGER, allowNull: false },
      influencer_user_id: { type: DataTypes.INTEGER, allowNull: false },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      stay_id: { type: DataTypes.INTEGER, allowNull: false },
      status: { type: STATUS_ENUM, allowNull: false, defaultValue: "pending" },
      discount_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "USD" },
      reserved_at: { type: DataTypes.DATE, allowNull: true },
      redeemed_at: { type: DataTypes.DATE, allowNull: true },
      reversed_at: { type: DataTypes.DATE, allowNull: true },
      metadata: { type: JSON_TYPE, allowNull: true },
    },
    {
      tableName: "coupon_redemption",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
      indexes: [
        { fields: ["stay_id"], unique: true, name: "uq_coupon_redemption_stay" },
        { fields: ["influencer_user_id"], name: "idx_coupon_redemption_influencer" },
        { fields: ["coupon_wallet_id"], name: "idx_coupon_redemption_wallet" },
        { fields: ["status"], name: "idx_coupon_redemption_status" },
      ],
    }
  )

  CouponRedemption.associate = (models) => {
    CouponRedemption.belongsTo(models.CouponWallet, { foreignKey: "coupon_wallet_id", as: "wallet" })
    CouponRedemption.belongsTo(models.User, { foreignKey: "influencer_user_id", as: "influencer" })
    CouponRedemption.belongsTo(models.User, { foreignKey: "user_id", as: "user" })
    CouponRedemption.belongsTo(models.Stay, { foreignKey: "stay_id", as: "stay" })
  }

  return CouponRedemption
}
