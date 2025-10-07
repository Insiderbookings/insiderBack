// src/models/HomeMedia.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeMedia = sequelize.define(
    "HomeMedia",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      type: {
        type: DataTypes.ENUM("IMAGE", "VIDEO"),
        defaultValue: "IMAGE",
      },
      url: { type: DataTypes.STRING(500), allowNull: false },
      order: { type: DataTypes.INTEGER, defaultValue: 0 },
      caption: { type: DataTypes.STRING(255) },
      is_cover: { type: DataTypes.BOOLEAN, defaultValue: false },
      metadata: { type: DataTypes.JSON },
    },
    {
      tableName: "home_media",
      underscored: true,
      freezeTableName: true,
    }
  );

  HomeMedia.associate = (models) => {
    HomeMedia.belongsTo(models.Home, { foreignKey: "home_id" });
  };

  return HomeMedia;
};
