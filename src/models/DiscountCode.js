// src/models/DiscountCode.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const DiscountCode = sequelize.define(
    "DiscountCode",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      code: {
        type     : DataTypes.STRING(4),
        allowNull: false,
        unique   : true,
        validate : { len: [4, 4], isNumeric: true },
      },

      percentage: {
        type     : DataTypes.INTEGER,
        allowNull: false,
        validate : { isInt: true, min: 1, max: 100 },
      },

      special_discount_price: {
        type     : DataTypes.INTEGER,
        allowNull: true,
        validate : { isInt: true, min: 10, max: 200000 },
      },

      default: {
        type        : DataTypes.BOOLEAN,
        allowNull   : false,
        defaultValue: true,
      },

      /* ───────── FKs ───────── */
      staff_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "staff", key: "id" },
        onDelete   : "CASCADE",
        onUpdate   : "CASCADE",
      },
      hotel_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "hotel", key: "id" },
        onDelete   : "CASCADE",
        onUpdate   : "CASCADE",
      },

      /* ───────── Lógica de uso ───────── */
      starts_at : DataTypes.DATE,
      ends_at   : DataTypes.DATE,
      max_uses  : DataTypes.INTEGER,
      times_used: { type: DataTypes.INTEGER, defaultValue: 0 },
    },
    {
      tableName      : "discount_code",   // ← snake_case singular
      freezeTableName: true,
      underscored    : true,              // created_at, special_discount_price …
      paranoid       : true,
    }
  );

  /* ───────── Asociaciones ───────── */
  DiscountCode.associate = (models) => {
    DiscountCode.belongsTo(models.Staff, { foreignKey: "staff_id", as: "staff" });
    DiscountCode.belongsTo(models.Hotel, { foreignKey: "hotel_id" });
    DiscountCode.hasMany(models.Booking, { foreignKey: "discount_code_id" });
  };

  return DiscountCode;
};
