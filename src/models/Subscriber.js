// src/models/Subscriber.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const Subscriber = sequelize.define(
    "Subscriber",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      email: { type: DataTypes.STRING(150), allowNull: false, unique: true, validate: { isEmail: true } },
      name: { type: DataTypes.STRING(120), allowNull: true },
      source: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "newsletter" },
      user_id: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      tableName: "subscriber",
      freezeTableName: true,
      underscored: true,
      paranoid: false,
      indexes: [ { unique: true, fields: ["email"] } ],
    }
  )

  Subscriber.associate = (models) => {
    Subscriber.belongsTo(models.User, { foreignKey: "user_id", as: "user" })
  }

  return Subscriber
}

