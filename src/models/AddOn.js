// src/models/AddOn.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const AddOn = sequelize.define(
    "AddOn",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      name: { type: DataTypes.STRING(120), allowNull: false },
      slug: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      description: DataTypes.TEXT,

      icon: DataTypes.STRING(60),
      subtitle: DataTypes.STRING(150),
      footnote: DataTypes.TEXT,

      type: {
        type: DataTypes.ENUM("choice", "quantity", "options"),
        allowNull: false,
        defaultValue: "choice",
      },

      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },

      // con underscored: true esto será `default_qty` en la DB
      defaultQty: DataTypes.INTEGER,

      // 👇 JSONB en PG, JSON en MySQL/MariaDB (sin defaultValue)
      meta: { type: JSON_TYPE },
    },
    {
      tableName: "add_on",
      freezeTableName: true,
      underscored: true,
      engine: "InnoDB",
      indexes: [{ fields: ["slug"], unique: true }],
    }
  );

  AddOn.associate = (models) => {
    AddOn.hasMany(models.AddOnOption, { foreignKey: "add_on_id" });
    AddOn.hasMany(models.HotelAddOn, { foreignKey: "add_on_id" });

    AddOn.belongsToMany(models.Booking, {
      through: models.BookingAddOn,
      foreignKey: "add_on_id",
      otherKey: "booking_id",
    });

    AddOn.belongsToMany(models.Hotel, {
      through: models.HotelAddOn,
      as: "hotels",
      foreignKey: "add_on_id",
      otherKey: "hotel_id",
    });
  };

  return AddOn;
};
