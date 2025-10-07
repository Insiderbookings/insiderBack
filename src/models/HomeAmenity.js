// src/models/HomeAmenity.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeAmenity = sequelize.define(
    "HomeAmenity",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      group_key: { type: DataTypes.STRING(60), allowNull: false },
      amenity_key: { type: DataTypes.STRING(60), allowNull: false },
      label: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.STRING(255) },
      icon: { type: DataTypes.STRING(120) },
      metadata: { type: DataTypes.JSON },
    },
    {
      tableName: "home_amenity",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
    }
  );

  HomeAmenity.associate = (models) => {
    HomeAmenity.hasMany(models.HomeAmenityLink, { foreignKey: "amenity_id" });
  };

  return HomeAmenity;
};
