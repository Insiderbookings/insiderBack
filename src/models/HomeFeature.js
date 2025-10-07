// src/models/HomeFeature.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeFeature = sequelize.define(
    "HomeFeature",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      feature_key: { type: DataTypes.STRING(80), allowNull: false },
      value_int: { type: DataTypes.INTEGER },
      value_decimal: { type: DataTypes.DECIMAL(10, 2) },
      value_text: { type: DataTypes.STRING(255) },
      metadata: { type: DataTypes.JSON },
    },
    {
      tableName: "home_feature",
      underscored: true,
      freezeTableName: true,
    }
  );

  HomeFeature.associate = (models) => {
    HomeFeature.belongsTo(models.Home, { foreignKey: "home_id" });
  };

  return HomeFeature;
};
