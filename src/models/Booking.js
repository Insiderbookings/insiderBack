// src/models/Booking.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Booking = sequelize.define(
    "Booking",
    {
      id: {
        type         : DataTypes.INTEGER,
        primaryKey   : true,
        autoIncrement: true,
      },
      user_id: {
        type       : DataTypes.INTEGER,
        allowNull  : true,               // huésped invitado = null
        references : { model: "User", key: "id" },
      },
      hotel_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "Hotel", key: "id" },
      },
      room_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "Room", key: "id" },
      },
      discount_code_id: {
        type       : DataTypes.INTEGER,
        allowNull  : true,
        references : { model: "DiscountCode", key: "id" },
      },

      /* ─── Fechas y ocupación ─── */
      checkIn  : { type: DataTypes.DATEONLY, allowNull: false },
      checkOut : { type: DataTypes.DATEONLY, allowNull: false },
      adults   : { type: DataTypes.INTEGER,  allowNull: false },
      children : { type: DataTypes.INTEGER,  defaultValue: 0 },

      /* ─── Datos huésped ─── */
      guestName : { type: DataTypes.STRING(120), allowNull: false },
      guestEmail: {
        type   : DataTypes.STRING(150),
        allowNull: false,
        validate : { isEmail: true },
      },
      guestPhone: DataTypes.STRING(50),

      /* ─── Pago y estatus ─── */
      total        : { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      status       : {
        type        : DataTypes.ENUM("pending", "confirmed", "cancelled"),
        defaultValue: "pending",
      },
      paymentStatus: {
        type        : DataTypes.ENUM("unpaid", "paid", "refunded"),
        defaultValue: "unpaid",
      },
      payment_id   : {
        type     : DataTypes.STRING(100), // PaymentIntent (pi_...) ó Session
        allowNull: true,
      },

      /* ─── NUEVO ─── */
      /** Marca si esta reserva proviene de un OTAs / sistema externo */
      outside: {
        type        : DataTypes.BOOLEAN,
        allowNull   : false,
        defaultValue: false,
      },
    },
    {
      tableName      : "booking",
      underscored    : true,
      freezeTableName: true,
    }
  );

  /* ─── Asociaciones ─── */
  Booking.associate = (models) => {
    Booking.belongsTo(models.User,         { foreignKey: "user_id" });
    Booking.belongsTo(models.Hotel,        { foreignKey: "hotel_id" });
    Booking.belongsTo(models.Room,         { foreignKey: "room_id" });
    Booking.belongsTo(models.DiscountCode, { foreignKey: "discount_code_id" });

    Booking.belongsToMany(models.AddOn, {
      through   : models.BookingAddOn,
      foreignKey: "booking_id",
      otherKey  : "add_on_id",
    });

    Booking.hasOne(models.Commission, { foreignKey: "booking_id" });
  };

  return Booking;
};
