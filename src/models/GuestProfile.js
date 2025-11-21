// src/models/GuestProfile.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const dialect = sequelize.getDialect()
  const isMySQLFamily = ["mysql", "mariadb"].includes(dialect)
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB

  const GuestProfile = sequelize.define(
    "GuestProfile",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      bio: { type: DataTypes.TEXT },
      occupation: { type: DataTypes.STRING(140) },
      least_useful_skill: { type: DataTypes.STRING(140) },
      pets: { type: DataTypes.STRING(140) },
      birth_decade: { type: DataTypes.STRING(20) },
      home_base: { type: JSON_TYPE },
      interests: { type: JSON_TYPE },
      show_visited: { type: DataTypes.BOOLEAN, defaultValue: true },
      identity_verified: { type: DataTypes.BOOLEAN, defaultValue: false },
      avatar_url: { type: DataTypes.TEXT },
      metadata: { type: JSON_TYPE },
    },
    {
      tableName: "guest_profile",
      underscored: true,
      freezeTableName: true,
      paranoid: true,
    },
  )

  GuestProfile.associate = (models) => {
    GuestProfile.belongsTo(models.User, { foreignKey: "user_id", as: "user" })
  }

  return GuestProfile
}
