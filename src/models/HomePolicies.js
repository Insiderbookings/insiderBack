// src/models/HomePolicies.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomePolicies = sequelize.define(
    "HomePolicies",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      checkin_from: { type: DataTypes.TIME },
      checkin_to: { type: DataTypes.TIME },
      checkout_time: { type: DataTypes.TIME },
      quiet_hours_start: { type: DataTypes.TIME },
      quiet_hours_end: { type: DataTypes.TIME },
      smoking_allowed: { type: DataTypes.BOOLEAN, defaultValue: false },
      pets_allowed: { type: DataTypes.BOOLEAN, defaultValue: false },
      events_allowed: { type: DataTypes.BOOLEAN, defaultValue: false },
      additional_rules: { type: DataTypes.TEXT },
      house_manual: { type: DataTypes.TEXT },
    },
    {
      tableName: "home_policies",
      underscored: true,
      freezeTableName: true,
    }
  );

  HomePolicies.associate = (models) => {
    HomePolicies.belongsTo(models.Home, { foreignKey: "home_id" });
  };

  return HomePolicies;
};
