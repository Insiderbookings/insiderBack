// src/models/HomeSecurity.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeSecurity = sequelize.define(
    "HomeSecurity",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      has_security_camera: { type: DataTypes.BOOLEAN, defaultValue: false },
      security_camera_details: { type: DataTypes.TEXT },
      has_monitoring_device: { type: DataTypes.BOOLEAN, defaultValue: false },
      monitoring_details: { type: DataTypes.TEXT },
      has_weapons: { type: DataTypes.BOOLEAN, defaultValue: false },
      weapon_details: { type: DataTypes.TEXT },
      additional_disclosures: { type: DataTypes.TEXT },
    },
    {
      tableName: "home_security",
      underscored: true,
      freezeTableName: true,
    }
  );

  HomeSecurity.associate = (models) => {
    HomeSecurity.belongsTo(models.Home, { foreignKey: "home_id" });
  };

  return HomeSecurity;
};
