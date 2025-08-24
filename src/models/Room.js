// src/models/Room.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Room = sequelize.define(
    "Room",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "hotel", key: "id" },
        onDelete: "CASCADE",
      },

      /* ─────────── Campos que espera el front ─────────── */
      room_number: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(120) },
      description: { type: DataTypes.TEXT },
      image: { type: DataTypes.STRING(255) },

      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      capacity: { type: DataTypes.INTEGER, allowNull: false },
      beds: { type: DataTypes.STRING(50) },

      // ✅ Portable: se guarda como string JSON en TEXT
      amenities: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "[]",                 // por compatibilidad con MariaDB/MySQL
        get() {
          const raw = this.getDataValue("amenities");
          try { return JSON.parse(raw || "[]"); } catch { return []; }
        },
        set(val) {
          this.setDataValue("amenities", JSON.stringify(val || []));
        },
      },

      available: { type: DataTypes.INTEGER, defaultValue: 0 }, // si es booleano, usa BOOLEAN
      suite: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    {
      tableName: "room",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { unique: true, fields: ["hotel_id", "room_number"] },
      ],
    }
  );

  Room.associate = (models) => {
    Room.belongsTo(models.Hotel, { foreignKey: "hotel_id" });
    Room.hasMany(models.Booking, { foreignKey: "room_id" });
    Room.hasMany(models.BookingAddOn, { foreignKey: "room_id" });
  };

  return Room;
};
