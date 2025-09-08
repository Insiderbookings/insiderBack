// src/models/InfluencerCommission.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const InfluencerCommission = sequelize.define(
    "InfluencerCommission",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      influencer_user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      booking_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true, // una comisin por booking
        references: { model: "booking", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      discount_code_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "discount_code", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },

      commission_base: {
        type: DataTypes.ENUM("markup", "gross"),
        allowNull: false,
        defaultValue: "markup",
      },

      commission_rate_pct: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 20.0 },
      commission_amount:   { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      commission_currency: { type: DataTypes.STRING(3), allowNull: false },

      status: {
        type: DataTypes.ENUM("hold", "eligible", "paid", "reversed"),
        allowNull: false,
        defaultValue: "hold",
      },

      hold_until:     { type: DataTypes.DATE, allowNull: true },
      payout_batch_id:{ type: DataTypes.STRING(40), allowNull: true },
      paid_at:        { type: DataTypes.DATE, allowNull: true },
      reversal_reason:{ type: DataTypes.STRING(120), allowNull: true },
    },
    {
      tableName: "influencer_commission",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    }
  )

  InfluencerCommission.associate = (models) => {
    InfluencerCommission.belongsTo(models.User,         { foreignKey: "influencer_user_id", as: "influencer" })
    InfluencerCommission.belongsTo(models.Booking,      { foreignKey: "booking_id",         as: "booking" })
    InfluencerCommission.belongsTo(models.DiscountCode, { foreignKey: "discount_code_id",   as: "discountCode" })
  }

  return InfluencerCommission
}

