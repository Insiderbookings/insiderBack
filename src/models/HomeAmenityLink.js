// src/models/HomeAmenityLink.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeAmenityLink = sequelize.define(
    "HomeAmenityLink",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      amenity_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home_amenity", key: "id" },
        onDelete: "CASCADE",
      },
      value: { type: DataTypes.JSON },
    },
    {
      tableName: "home_amenity_link",
      underscored: true,
      freezeTableName: true,
    }
  );

  HomeAmenityLink.associate = (models) => {
    HomeAmenityLink.belongsTo(models.Home, { foreignKey: "home_id" });
    HomeAmenityLink.belongsTo(models.HomeAmenity, { foreignKey: "amenity_id", as: "amenity" });
  };

  return HomeAmenityLink;
};
