// src/models/Room.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Room = sequelize.define(
    "Room",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      hotel_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "hotel", key: "id" },
        onDelete   : "CASCADE",
      },

      /* ─────────── Campos que espera el front ─────────── */
      room_number : { type: DataTypes.INTEGER, allowNull: false },
      name        : DataTypes.STRING(120),
      description : DataTypes.TEXT,
      image       : DataTypes.STRING(255),

      price       : { type: DataTypes.DECIMAL(10,2), allowNull: false },
      capacity    : { type: DataTypes.INTEGER,        allowNull: false },
      beds        : DataTypes.STRING(50),
      amenities   : { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
      available   : { type: DataTypes.INTEGER, defaultValue: 0 },
      suite       : { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    {
      tableName      : "room",      // ← clave: snake_case singular
      freezeTableName: true,
      underscored    : true,
      paranoid       : true,
      indexes        : [
        // cada número de habitación único dentro de un hotel
        { unique: true, fields: ["hotel_id", "room_number"] },
      ],
    }
  );

  Room.associate = (models) => {
    Room.belongsTo(models.Hotel,   { foreignKey: "hotel_id" });
    Room.hasMany  (models.Booking, { foreignKey: "room_id" });
    Room.hasMany  (models.BookingAddOn, { foreignKey: "room_id" });
  };

  return Room;
};
