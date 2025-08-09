// src/models/Hotel.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Hotel = sequelize.define(
    "Hotel",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      /* ─────────── Datos básicos ─────────── */
      name       : { type: DataTypes.STRING(120), allowNull: false },
      location   : DataTypes.STRING(120),
      description: DataTypes.TEXT,
      image      : DataTypes.STRING(255),
      phone      : DataTypes.STRING(20),

      /* ─────────── Rating & precio ─────────── */
      star_rating: { type: DataTypes.INTEGER, validate: { min: 1, max: 5 } },
      rating     : { type: DataTypes.DECIMAL(2, 1), defaultValue: 0 },
      price      : DataTypes.DECIMAL(10, 2),
      category   : DataTypes.STRING(60),

      /* ─────────── Amenidades & geo ─────────── */
      amenities: { type: DataTypes.JSONB, defaultValue: {} },
      lat      : DataTypes.DECIMAL(9, 6),
      lng      : DataTypes.DECIMAL(9, 6),

      /* ─────────── Dirección ─────────── */
      address: DataTypes.STRING(255),
      city   : DataTypes.STRING(100),
      country: DataTypes.STRING(100),
    },
    {
      tableName      : "hotel",   // ← snake_case singular
      freezeTableName: true,      // evita pluralización automática
      underscored    : true,      // created_at / updated_at
      paranoid       : true,      // deleted_at (soft-delete)
    },
  );

  /* ─────────── Asociaciones ─────────── */
  Hotel.associate = (models) => {
    /* Habitaciones */
    Hotel.hasMany(models.Room,         { foreignKey: "hotel_id" });

    /* Bookings */
    Hotel.hasMany(models.Booking,      { foreignKey: "hotel_id" });

    /* Discount codes generados para este hotel */
    Hotel.hasMany(models.DiscountCode, { foreignKey: "hotel_id" });

    /* Staff ↔ Hotel (pivote) */
    Hotel.belongsToMany(models.Staff, {
      through    : models.HotelStaff,
      as         : "staff",
      foreignKey : "hotel_id",
      otherKey   : "staff_id",
    });

    /* Galería de imágenes */
    Hotel.hasMany(models.HotelImage, {
      as         : "images",
      foreignKey : "hotel_id",
      onDelete   : "CASCADE",
    });

    /* Pivote Hotel ↔ AddOn */
    Hotel.belongsToMany(models.AddOn, {
      through    : models.HotelAddOn,
      as         : "addons",
      foreignKey : "hotel_id",
      otherKey   : "add_on_id",
    });
  };

  return Hotel;
};
