// src/models/CouponWallet.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const CouponWallet = sequelize.define(
    "CouponWallet",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      influencer_user_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      total_granted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_used: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: "coupon_wallet",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
      indexes: [{ fields: ["influencer_user_id"], unique: true, name: "uq_coupon_wallet_influencer" }],
    }
  )

  CouponWallet.associate = (models) => {
    CouponWallet.belongsTo(models.User, { foreignKey: "influencer_user_id", as: "influencer" })
    CouponWallet.hasMany(models.CouponRedemption, { foreignKey: "coupon_wallet_id", as: "redemptions" })
  }

  return CouponWallet
}
