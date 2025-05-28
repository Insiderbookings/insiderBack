// src/models/HotelStaff.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HotelStaff = sequelize.define(
    "HotelStaff",
    {
      id: {
        type        : DataTypes.INTEGER,
        primaryKey  : true,
        autoIncrement: true,
      },

      /* FK → hotels */
      hotel_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "Hotel", key: "id" }, // usa el nombre real de tu tabla
        onDelete   : "CASCADE",
      },

      /* FK → staff */
      staff_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "Staff", key: "id" }, // idem
        onDelete   : "CASCADE",
      },

      /* Código único para esa relación staff–hotel */
      staff_code: {
        type     : DataTypes.STRING(4),
        allowNull: false,
        validate : { len: [4, 4], isNumeric: true },
      },

      is_primary: {
        type        : DataTypes.BOOLEAN,
        defaultValue: false,
      },

      since: DataTypes.DATEONLY,
    },
    {
      tableName      : "hotel_staff", // nombre exacto de la tabla en tu BD
      freezeTableName: true,
      underscored    : true,          // created_at, updated_at
      paranoid       : true,          // deleted_at
    }
  );

  /* ─────────── Asociaciones ─────────── */
  HotelStaff.associate = (models) => {
    HotelStaff.belongsTo(models.Hotel, { as: "hotel", foreignKey: "hotel_id" });
    HotelStaff.belongsTo(models.Staff, { as: "staff", foreignKey: "staff_id" });
  };

  return HotelStaff;
};
  