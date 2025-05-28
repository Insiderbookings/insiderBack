import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Hotel = sequelize.define(
    "Hotel",
    {
      id: {
        type         : DataTypes.INTEGER,
        primaryKey   : true,
        autoIncrement: true,
      },

      /* ---------- Datos básicos ---------- */
      name       : { type: DataTypes.STRING(120), allowNull: false },
      location   : DataTypes.STRING(120),
      description: DataTypes.TEXT,
      image      : DataTypes.STRING(255),      // imagen de portada
      phone      : DataTypes.STRING(20),

      /* ---------- Rating & precio ---------- */
      starRating : { type: DataTypes.INTEGER, validate: { min: 1, max: 5 } },
      rating     : { type: DataTypes.DECIMAL(2, 1), defaultValue: 0 },
      price      : DataTypes.DECIMAL(10, 2),
      category   : DataTypes.STRING(60),

      /* ---------- Amenities y geo ---------- */
      amenities: { type: DataTypes.JSONB, defaultValue: {} },
      lat      : DataTypes.DECIMAL(9, 6),
      lng      : DataTypes.DECIMAL(9, 6),

      /* ---------- Dirección ---------- */
      address: DataTypes.STRING(255),
      city   : DataTypes.STRING(100),
      country: DataTypes.STRING(100),
    },
    {
      tableName      : "Hotel",
      freezeTableName: true, // evita pluralización
      underscored    : true, // created_at / updated_at
    }
  );

  /* --------- Asociaciones --------- */
  Hotel.associate = (models) => {
    Hotel.hasMany(models.Room,         { foreignKey: "hotel_id" });
    Hotel.hasMany(models.Booking,      { foreignKey: "hotel_id" });
    Hotel.hasMany(models.DiscountCode, { foreignKey: "hotel_id" });

    /* Staff vía tabla intermedia */
    Hotel.belongsToMany(models.Staff, {
      through     : models.HotelStaff,
      as          : "staff",
      foreignKey  : "hotel_id",
    });

    /* Galería de imágenes */
    Hotel.hasMany(models.HotelImage, {
      as         : "images",
      foreignKey : "hotel_id",
      onDelete   : "CASCADE",
    });
  };

  return Hotel;
};
