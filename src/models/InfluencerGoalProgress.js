// src/models/InfluencerGoalProgress.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const InfluencerGoalProgress = sequelize.define(
    "InfluencerGoalProgress",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      influencer_user_id: { type: DataTypes.INTEGER, allowNull: false },
      goal_id: { type: DataTypes.INTEGER, allowNull: false },
      progress_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      reward_granted_at: { type: DataTypes.DATE, allowNull: true },
      reward_commission_id: { type: DataTypes.INTEGER, allowNull: true },
      last_event_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "influencer_goal_progress",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
      indexes: [
        { fields: ["goal_id", "influencer_user_id"], unique: true, name: "uq_inf_goal_progress_goal_influencer" },
        { fields: ["influencer_user_id"], name: "idx_inf_goal_progress_influencer" },
      ],
    }
  )

  InfluencerGoalProgress.associate = (models) => {
    InfluencerGoalProgress.belongsTo(models.InfluencerGoal, {
      foreignKey: "goal_id",
      as: "goal",
    })
    InfluencerGoalProgress.belongsTo(models.User, {
      foreignKey: "influencer_user_id",
      as: "influencer",
    })
    if (models.InfluencerEventCommission) {
      InfluencerGoalProgress.belongsTo(models.InfluencerEventCommission, {
        foreignKey: "reward_commission_id",
        as: "rewardCommission",
      })
    }
  }

  return InfluencerGoalProgress
}
