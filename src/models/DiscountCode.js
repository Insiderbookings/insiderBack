// src/models/discountCode.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const DiscountCode = sequelize.define(
    "DiscountCode",               // nombre del modelo
    {
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
      percentage: {
        type     : DataTypes.INTEGER,
        allowNull: false,
        validate : { isInt: true, min: 1, max: 100 },
      },
      specialDiscountPrice: {
        type     : DataTypes.INTEGER,
        allowNull: true,
        validate : { isInt: true, min: 10, max: 200000 },
      },
      default: {
        type        : DataTypes.BOOLEAN,
        allowNull   : false,
        defaultValue: true,
      },
      staff_id: {
        type      : DataTypes.INTEGER,
        allowNull : false,
        references: {
          model: "staff",        // coincide con tu tabla real "Staff"
          key  : "id",
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      hotel_id: {
        type      : DataTypes.INTEGER,
        allowNull : false,
        references: {
          model: "Hotel",        // coincide con tu tabla real "Hotel"
          key  : "id",
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      startsAt : DataTypes.DATE,
      endsAt   : DataTypes.DATE,
      maxUses  : DataTypes.INTEGER,
      timesUsed: {
        type        : DataTypes.INTEGER,
        defaultValue: 0,
      },
    },
    {
      tableName      : "DiscountCode",  // fuerza a Sequelize a usar "DiscountCode"
      freezeTableName: true,
      underscored    : false,
      paranoid       : true,
    }
  );

  DiscountCode.associate = (models) => {
    DiscountCode.belongsTo(models.Staff, { as: "staff",   foreignKey: "staff_id" });
    DiscountCode.belongsTo(models.Hotel, {               foreignKey: "hotel_id" });
    DiscountCode.hasMany(models.Booking, { foreignKey: "discount_code_id" });
  };

  return DiscountCode;
};
