// src/models/HomeTagLink.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeTagLink = sequelize.define(
    "HomeTagLink",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      tag_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home_tag", key: "id" },
        onDelete: "CASCADE",
      },
    },
    {
      tableName: "home_tag_link",
      underscored: true,
      freezeTableName: true,
    }
  );

  HomeTagLink.associate = (models) => {
    HomeTagLink.belongsTo(models.Home, { foreignKey: "home_id" });
    HomeTagLink.belongsTo(models.HomeTag, { foreignKey: "tag_id", as: "tag" });
  };

  return HomeTagLink;
};
