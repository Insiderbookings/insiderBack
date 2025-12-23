// src/models/HomeBedType.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeBedType = sequelize.define(
    "HomeBedType",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      bed_type_key: { type: DataTypes.STRING(60), allowNull: false },
      label: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.STRING(255) },
      icon: { type: DataTypes.STRING(120) },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      metadata: { type: DataTypes.JSON },
    },
    {
      tableName: "home_bed_type",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
    }
  );

  HomeBedType.associate = (models) => {
    HomeBedType.hasMany(models.HomeBedTypeLink, { foreignKey: "bed_type_id" });
  };

  return HomeBedType;
};
