// src/models/Booking.js        ← 100 % COMPLETO, SIN LÍNEAS OMITIDAS
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const OutsideBooking = sequelize.define("OutsideBooking", {
    id: {
      type         : DataTypes.INTEGER,
      primaryKey   : true,
      autoIncrement: true,
    },
    user_id: {
      type       : DataTypes.INTEGER,
      allowNull  : true,              // huésped invitado = null
      references : { model: "User", key: "id" },
    },
    bookingConfirmation: {
      type    : DataTypes.STRING(60),
      allowNull: false,
      unique   : true,
    },
    hotel_id: {
      type      : DataTypes.INTEGER,
      allowNull : true,
      references: { model: "Hotel", key: "id" },
    },
    room_number: {
      type      : DataTypes.INTEGER,
      allowNull : false,
    },
    room_type: {
      type      : DataTypes.STRING,
      allowNull : false,
    },
    /* ---------------- Fechas y ocupación ---------------- */
    checkIn : { type: DataTypes.DATEONLY, allowNull: false },
    checkOut: { type: DataTypes.DATEONLY, allowNull: false },

    /* ---------------- Datos huésped --------------------- */
    guestName :      { type: DataTypes.STRING(120), allowNull: false },
    guestLastName:   { type: DataTypes.STRING(120), allowNull: false },
    guestEmail: {
      type      : DataTypes.STRING(150),
      allowNull : false,
      validate  : { isEmail: true },
    },
    guestPhone:      DataTypes.STRING(50),

    /* ---------------- Pago y estatus -------------------- */
    status: {
      type        : DataTypes.ENUM("pending", "confirmed", "cancelled"),
      defaultValue: "confirmed",
    },
    paymentStatus: {
      type        : DataTypes.ENUM("unpaid", "paid", "refunded"),
      defaultValue: "paid",
    },
    payment_id: {
      type     : DataTypes.STRING(100),  // id de PaymentIntent (pi_...) ó Session
      allowNull: true,
    },

    /* ************ NUEVO ATRIBUTO **************** */
    outside: {
      type        : DataTypes.BOOLEAN,
      allowNull   : false,
      defaultValue: true,
    },
  });

  /* ---------------- Asociaciones ---------------- */
  OutsideBooking.associate = (models) => {
    OutsideBooking.belongsTo(models.User,  { foreignKey: "user_id" });
    OutsideBooking.belongsTo(models.Hotel, { foreignKey: "hotel_id" });
    OutsideBooking.belongsToMany(models.AddOn, {
      through   : models.OutsideBookingAddOn,
      foreignKey: "outsidebooking_id",
      otherKey  : "add_on_id",
    });
  };

  return OutsideBooking;
};
