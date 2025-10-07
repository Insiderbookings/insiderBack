// src/models/HomeTag.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeTag = sequelize.define(
    "HomeTag",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tag_key: { type: DataTypes.STRING(60), allowNull: false, unique: true },
      label: { type: DataTypes.STRING(120), allowNull: false },
      category: { type: DataTypes.STRING(60) },
      description: { type: DataTypes.STRING(255) },
    },
    {
      tableName: "home_tag",
      underscored: true,
      freezeTableName: true,
    }
  );

  HomeTag.associate = (models) => {
    HomeTag.hasMany(models.HomeTagLink, { foreignKey: "tag_id" });
  };

  return HomeTag;
};
