// src/models/InfluencerGoalEvent.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const dialect = sequelize.getDialect()
  const isMySQL = ["mysql", "mariadb"].includes(dialect)
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB
  const EVENT_ENUM =
    dialect === "postgres" || dialect === "postgresql"
      ? DataTypes.ENUM("signup", "booking")
      : DataTypes.STRING(20)

  const InfluencerGoalEvent = sequelize.define(
    "InfluencerGoalEvent",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      event_type: { type: EVENT_ENUM, allowNull: false },
      influencer_user_id: { type: DataTypes.INTEGER, allowNull: false },
      signup_user_id: { type: DataTypes.INTEGER, allowNull: true },
      stay_id: { type: DataTypes.INTEGER, allowNull: true },
      occurred_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      metadata: { type: JSON_TYPE, allowNull: true },
    },
    {
      tableName: "influencer_goal_event",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
      indexes: [
        { fields: ["event_type", "signup_user_id", "influencer_user_id"], unique: true, name: "uq_inf_goal_evt_signup" },
        { fields: ["event_type", "stay_id", "influencer_user_id"], unique: true, name: "uq_inf_goal_evt_stay" },
        { fields: ["influencer_user_id"], name: "idx_inf_goal_evt_influencer" },
        { fields: ["event_type"], name: "idx_inf_goal_evt_type" },
      ],
    }
  )

  InfluencerGoalEvent.associate = (models) => {
    InfluencerGoalEvent.belongsTo(models.User, { foreignKey: "influencer_user_id", as: "influencer" })
    InfluencerGoalEvent.belongsTo(models.User, { foreignKey: "signup_user_id", as: "signupUser" })
    InfluencerGoalEvent.belongsTo(models.Stay, { foreignKey: "stay_id", as: "stay" })
  }

  return InfluencerGoalEvent
}
