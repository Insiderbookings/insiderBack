// src/models/Hotel.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql";
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const Hotel = sequelize.define(
    "Hotel",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      /* ─────────── Datos básicos ─────────── */
      name: { type: DataTypes.STRING(120), allowNull: false },
      location: { type: DataTypes.STRING(120) },
      description: { type: DataTypes.TEXT },
      image: { type: DataTypes.STRING(255) },
      phone: { type: DataTypes.STRING(20) },

      /* ─────────── Rating & precio ─────────── */
      star_rating: { type: DataTypes.INTEGER, validate: { min: 1, max: 5 } },
      // 3,1 para permitir 0.0–9.9 sin redondeos raros
      rating: { type: DataTypes.DECIMAL(3, 1), allowNull: false, defaultValue: 0 },
      price: { type: DataTypes.DECIMAL(10, 2) },
      category: { type: DataTypes.STRING(60) },

      /* ─────────── Amenidades & geo ─────────── */
      // JSONB en PG, JSON en MySQL
      amenities: { type: JSON_TYPE, allowNull: false, defaultValue: {} },
      lat: { type: DataTypes.DECIMAL(9, 6) },
      lng: { type: DataTypes.DECIMAL(9, 6) },

      /* ─────────── Dirección ─────────── */
      address: { type: DataTypes.STRING(255) },
      city: { type: DataTypes.STRING(100) },
      country: { type: DataTypes.STRING(100) },
    },
    {
      tableName: "hotel",   // snake_case singular
      freezeTableName: true,
      underscored: true,      // created_at / updated_at
      paranoid: true,      // deleted_at
    }
  );

  /* ─────────── Asociaciones ─────────── */
  Hotel.associate = (models) => {
    Hotel.hasMany(models.Room, { foreignKey: "hotel_id" });
    Hotel.hasMany(models.Booking, { foreignKey: "hotel_id" });
    Hotel.hasMany(models.DiscountCode, { foreignKey: "hotel_id" });

    Hotel.belongsToMany(models.Staff, {
      through: models.HotelStaff, // o 'hotel_staff' si usás string
      as: "staff",
      foreignKey: "hotel_id",
      otherKey: "staff_id",
    });

    Hotel.hasMany(models.HotelImage, {
      as: "images",
      foreignKey: "hotel_id",
      onDelete: "CASCADE",
    });

    Hotel.belongsToMany(models.AddOn, {
      through: models.HotelAddOn, // o 'hotel_add_on'
      as: "addons",
      foreignKey: "hotel_id",
      otherKey: "add_on_id",
    });
  };

  return Hotel;
};
