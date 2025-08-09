// src/models/BookingAddOn.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const BookingAddOn = sequelize.define(
    "BookingAddOn",
    {
      /* ───────── Clave primaria ───────── */
      id: {
        type         : DataTypes.INTEGER,
        primaryKey   : true,
        autoIncrement: true,
      },

      /* ───────── FKs ───────── */
      booking_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "booking", key: "id" },
        onDelete   : "CASCADE",
      },
      add_on_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "add_on", key: "id" },
        onDelete   : "CASCADE",
      },
      add_on_option_id: {
        type       : DataTypes.INTEGER,
        allowNull  : true,                       // solo si el add-on usa opciones
        references : { model: "add_on_option", key: "id" },
        onDelete   : "SET NULL",
      },

      /* ───────── Datos de la solicitud ───────── */
      quantity:    { type: DataTypes.INTEGER,      defaultValue: 1 },
      unit_price:  { type: DataTypes.DECIMAL(10,2), allowNull: false },

      status: {
        type        : DataTypes.ENUM("pending","confirmed","cancelled","ready"),
        defaultValue: "pending",
      },
      payment_status: {
        type        : DataTypes.ENUM("unpaid","paid","refunded"),
        defaultValue: "unpaid",
      },

      /* Habitación asociada (opcional) */
      room_id: {
        type       : DataTypes.INTEGER,
        allowNull  : true,
        references : { model: "room", key: "id" },
        onDelete   : "SET NULL",
      },

      /* Campo libre para extensiones futuras */
      meta: DataTypes.JSONB,
    },
    {
      tableName      : "booking_add_on",
      underscored    : true,
      freezeTableName: true,
    }
  );

  /* ───────── Asociaciones ───────── */
  BookingAddOn.associate = (models) => {
    BookingAddOn.belongsTo(models.Booking,      { foreignKey: "booking_id",      as: "booking" });
    BookingAddOn.belongsTo(models.AddOn,        { foreignKey: "add_on_id",       as: "addOn"   });
    BookingAddOn.belongsTo(models.AddOnOption,  { foreignKey: "add_on_option_id",as: "option"  });
    BookingAddOn.belongsTo(models.Room,         { foreignKey: "room_id",         as: "room"    });
  };

  return BookingAddOn;
};
