// src/models/InfluencerEventCommission.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const dialect = sequelize.getDialect()
  const ENUM_EVENT = dialect === "postgres" || dialect === "postgresql"
    ? DataTypes.ENUM("signup", "booking")
    : DataTypes.STRING(20)
  const ENUM_STATUS = dialect === "postgres" || dialect === "postgresql"
    ? DataTypes.ENUM("hold", "eligible", "paid", "reversed")
    : DataTypes.STRING(20)

  const InfluencerEventCommission = sequelize.define(
    "InfluencerEventCommission",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      influencer_user_id: { type: DataTypes.INTEGER, allowNull: false },
      event_type: { type: ENUM_EVENT, allowNull: false },

      signup_user_id: { type: DataTypes.INTEGER, allowNull: true },
      stay_id: { type: DataTypes.INTEGER, allowNull: true },

      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "USD" },

      status: { type: ENUM_STATUS, allowNull: false, defaultValue: "eligible" },

      hold_until: { type: DataTypes.DATE, allowNull: true },
      payout_batch_id: { type: DataTypes.STRING(40), allowNull: true },
      paid_at: { type: DataTypes.DATE, allowNull: true },
      reversal_reason: { type: DataTypes.STRING(160), allowNull: true },
    },
    {
      tableName: "influencer_event_commission",
      underscored: true,
      freezeTableName: true,
      paranoid: true,
      indexes: [
        { fields: ["influencer_user_id"], name: "idx_inf_evt_comm_influencer" },
        { fields: ["event_type"], name: "idx_inf_evt_comm_event_type" },
      ],
    }
  )

  InfluencerEventCommission.associate = (models) => {
    InfluencerEventCommission.belongsTo(models.User, { foreignKey: "influencer_user_id", as: "influencer" })
    InfluencerEventCommission.belongsTo(models.User, { foreignKey: "signup_user_id", as: "signupUser" })
    InfluencerEventCommission.belongsTo(models.Stay, { foreignKey: "stay_id", as: "stay" })
  }

  return InfluencerEventCommission
}
