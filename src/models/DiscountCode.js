// src/models/DiscountCode.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const DiscountCode = sequelize.define(
    "DiscountCode",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      code: {
        type: DataTypes.STRING(16),
        allowNull: false,
        // Permite códigos alfanuméricos (influencers, staff, etc.)
        // y hasta 16 caracteres. Case-insensitive por la /i
        validate: { len: [1, 16], is: /^[A-Z0-9]+$/i },
      },

      percentage: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { isInt: true, min: 1, max: 100 },
      },

      special_discount_price: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { isInt: true, min: 10, max: 200000 },
      },

      default: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      /* ───────── FKs ───────── */

      // Opcional
      staff_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "staff", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },

      // Opcional: (ajusta el nombre si tu tabla real de usuarios es “users”)
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },

      // Enlaza el código con la booking donde se usó
      booking_id: {
        type: DataTypes.INTEGER,
        references: { model: 'booking', key: 'id' },
      },

      /* ───────── Lógica de uso ───────── */
      starts_at: DataTypes.DATE,
      ends_at: DataTypes.DATE,
      max_uses: DataTypes.INTEGER,
      times_used: { type: DataTypes.INTEGER, defaultValue: 0 },
    },
    {
      tableName: "discount_code", // usamos snake_case unificada
      freezeTableName: true,
      underscored: true,
      paranoid: true,

      // Requiere al menos uno de staff_id o user_id
      validate: {
        staffOrUser() {
          const hasStaff = !!this.staff_id;
          const hasUser = !!this.user_id;
          if (!hasStaff && !hasUser) {
            throw new Error("Either staff_id or user_id must be provided.");
          }
          // Si quieres que sean mutuamente excluyentes, usa:
          // if ((hasStaff ? 1 : 0) + (hasUser ? 1 : 0) !== 1) {
          //   throw new Error("Provide exactly one of staff_id or user_id.");
          // }
        },
      },
    }
  );

  /* ───────── Associations ───────── */
  DiscountCode.associate = (models) => {
    DiscountCode.belongsTo(models.Staff, {
      foreignKey: "staff_id",
      as: "staff",
    });
    DiscountCode.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
    DiscountCode.belongsTo(models.Booking, {
      foreignKey: "booking_id",
      as: "booking",
    });
  };

  return DiscountCode;
};
