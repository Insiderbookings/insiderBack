// src/models/HomeBedTypeLink.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeBedTypeLink = sequelize.define(
    "HomeBedTypeLink",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      bed_type_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home_bed_type", key: "id" },
        onDelete: "CASCADE",
      },
      count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    },
    {
      tableName: "home_bed_type_link",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
    }
  );

  HomeBedTypeLink.associate = (models) => {
    HomeBedTypeLink.belongsTo(models.Home, { foreignKey: "home_id" });
    HomeBedTypeLink.belongsTo(models.HomeBedType, { foreignKey: "bed_type_id", as: "bedType" });
  };

  return HomeBedTypeLink;
};
