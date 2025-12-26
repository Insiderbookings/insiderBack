// src/models/InfluencerGoal.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const dialect = sequelize.getDialect()
  const isMySQL = ["mysql", "mariadb"].includes(dialect)
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB
  const EVENT_ENUM =
    dialect === "postgres" || dialect === "postgresql"
      ? DataTypes.ENUM("signup", "booking")
      : DataTypes.STRING(20)
  const REWARD_ENUM =
    dialect === "postgres" || dialect === "postgresql"
      ? DataTypes.ENUM("coupon_grant", "cash")
      : DataTypes.STRING(20)

  const InfluencerGoal = sequelize.define(
    "InfluencerGoal",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      event_type: { type: EVENT_ENUM, allowNull: false },
      target_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      reward_type: { type: REWARD_ENUM, allowNull: false, defaultValue: "coupon_grant" },
      reward_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      reward_currency: { type: DataTypes.STRING(3), allowNull: true, defaultValue: "USD" },
      metadata: { type: JSON_TYPE },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: "influencer_goal",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
    }
  )

  InfluencerGoal.associate = (models) => {
    InfluencerGoal.hasMany(models.InfluencerGoalProgress, {
      foreignKey: "goal_id",
      as: "progress",
    })
  }

  return InfluencerGoal
}
