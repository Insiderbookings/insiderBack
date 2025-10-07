// src/models/HomeAddress.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeAddress = sequelize.define(
    "HomeAddress",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      country: { type: DataTypes.STRING(100) },
      state: { type: DataTypes.STRING(100) },
      city: { type: DataTypes.STRING(120) },
      zip_code: { type: DataTypes.STRING(20) },
      address_line1: { type: DataTypes.STRING(255) },
      address_line2: { type: DataTypes.STRING(255) },
      latitude: { type: DataTypes.DECIMAL(10, 8) },
      longitude: { type: DataTypes.DECIMAL(11, 8) },
      share_exact_location: { type: DataTypes.BOOLEAN, defaultValue: false },
      map_zoom: { type: DataTypes.INTEGER, defaultValue: 15 },
    },
    {
      tableName: "home_address",
      underscored: true,
      freezeTableName: true,
    }
  );

  HomeAddress.associate = (models) => {
    HomeAddress.belongsTo(models.Home, { foreignKey: "home_id" });
  };

  return HomeAddress;
};
