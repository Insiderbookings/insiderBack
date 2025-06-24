// ─────────────────────────────────────────────────────────────
// src/models/discountCode.js
// 100 % COMPLETO — TODAS LAS LÍNEAS
// ─────────────────────────────────────────────────────────────
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const DiscountCode = sequelize.define("DiscountCode", {
    id: {
      type         : DataTypes.INTEGER,
      primaryKey   : true,
      autoIncrement: true,
    },
    code: {
      type     : DataTypes.STRING(4),
      allowNull: false,
      unique   : true,
      validate : { len: [4, 4], isNumeric: true },
    },
    /*  ❱❱  Porcentaje libre (1-100)  */
    percentage: {
      type     : DataTypes.INTEGER,
      allowNull: false,
      validate : { isInt: true, min: 1, max: 100 },
    },
    /*  ❱❱  Precio especial (10-200 000)  */
    specialDiscountPrice: {
      type     : DataTypes.INTEGER,
      allowNull: true,
      validate : { isInt: true, min: 10, max: 200000 },
    },
    /*  ❱❱  Indica si es el código por defecto del staff/hotel  */
    default: {
      type        : DataTypes.BOOLEAN,
      allowNull   : false,
      defaultValue: true,
    },
    staff_id: {
      type       : DataTypes.INTEGER,
      allowNull  : false,
      references : { model: "Staff", key: "id" },
    },
    hotel_id: {
      type       : DataTypes.INTEGER,
      allowNull  : false,
      references : { model: "Hotel", key: "id" },
    },
    startsAt : DataTypes.DATE,
    endsAt   : DataTypes.DATE,
    maxUses  : DataTypes.INTEGER,
    timesUsed: {
      type        : DataTypes.INTEGER,
      defaultValue: 0,
    },
  });

  DiscountCode.associate = (models) => {
    DiscountCode.belongsTo(models.Staff, { as: "staff", foreignKey: "staff_id" });
    DiscountCode.belongsTo(models.Hotel, { foreignKey: "hotel_id" });
    DiscountCode.hasMany(models.Booking, { foreignKey: "discount_code_id" });
  };

  return DiscountCode;
};
