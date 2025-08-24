// src/models/HotelAddOn.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const HotelAddOn = sequelize.define(
    "HotelAddOn",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // Dejo tipos pero sin references; las FKs las agrega la asociación
      hotel_id: { type: DataTypes.INTEGER, allowNull: false },
      add_on_id: { type: DataTypes.INTEGER, allowNull: false },

      /* Overrides por hotel */
      active: { type: DataTypes.BOOLEAN, defaultValue: true },
      price: { type: DataTypes.DECIMAL(10, 2) },
      default_qty: { type: DataTypes.INTEGER },
      name: { type: DataTypes.STRING(120) },
      description: { type: DataTypes.TEXT },
      icon: { type: DataTypes.STRING(60) },
      subtitle: { type: DataTypes.STRING(150) },
      footnote: { type: DataTypes.TEXT },

      // 👇 JSONB en PG, JSON en MySQL/MariaDB
      meta: { type: JSON_TYPE },
    },
    {
      tableName: "hotel_add_on",
      freezeTableName: true,
      underscored: true,
      engine: "InnoDB",
      indexes: [{ unique: true, fields: ["hotel_id", "add_on_id"] }],
    }
  );

  HotelAddOn.associate = (models) => {
    HotelAddOn.belongsTo(models.Hotel, { foreignKey: "hotel_id", onDelete: "CASCADE", onUpdate: "CASCADE" });
    HotelAddOn.belongsTo(models.AddOn, { foreignKey: "add_on_id", onDelete: "CASCADE", onUpdate: "CASCADE" });

    HotelAddOn.hasMany(models.HotelAddOnOption, { foreignKey: "hotel_add_on_id" });

    HotelAddOn.belongsToMany(models.Staff, {
      through: models.HotelStaffAddOn,
      as: "assignedStaff",
      foreignKey: "hotel_add_on_id",
      otherKey: "staff_id",
    });
  };

  return HotelAddOn;
};
