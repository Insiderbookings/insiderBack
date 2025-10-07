// src/models/HomeCalendar.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeCalendar = sequelize.define(
    "HomeCalendar",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      status: {
        type: DataTypes.ENUM("AVAILABLE", "BLOCKED", "RESERVED"),
        defaultValue: "AVAILABLE",
      },
      price_override: { type: DataTypes.DECIMAL(10, 2) },
      currency: { type: DataTypes.STRING(3) },
      note: { type: DataTypes.STRING(255) },
      source: {
        type: DataTypes.ENUM("MANUAL", "ICAL", "PLATFORM"),
        defaultValue: "MANUAL",
      },
    },
    {
      tableName: "home_calendar",
      underscored: true,
      freezeTableName: true,
      indexes: [
        { fields: ["home_id", "date"], unique: true },
      ],
    }
  );

  HomeCalendar.associate = (models) => {
    HomeCalendar.belongsTo(models.Home, { foreignKey: "home_id" });
  };

  return HomeCalendar;
};
