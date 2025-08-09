// src/models/User.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const User = sequelize.define(
    "User",
    {
      id: {
        type         : DataTypes.INTEGER,
        primaryKey   : true,
        autoIncrement: true,
      },

      /* ───────── Datos básicos ───────── */
      name: {
        type     : DataTypes.STRING(100),
        allowNull: false,
      },
      email: {
        type     : DataTypes.STRING(150),
        allowNull: false,
        unique   : true,
        validate : { isEmail: true },
      },
      password_hash: {                 // snake_case por underscored
        type     : DataTypes.STRING,
        allowNull: false,
      },
      phone: DataTypes.STRING(20),

      /* ───────── Estado / rol ───────── */
      is_active: {
        type        : DataTypes.BOOLEAN,
        defaultValue: true,
      },
      role: {
        type        : DataTypes.INTEGER,
        allowNull   : false,
        defaultValue: 0,
      },
    },
    {
      tableName      : "user",         // ← nombre exacto de la tabla
      freezeTableName: true,           // evita pluralización
      underscored    : true,           // created_at, password_hash, etc.
      paranoid       : true,           // deleted_at para borrado “soft”
    }
  );

  /* ─────────── Asociaciones ─────────── */
  User.associate = (models) => {
    User.hasMany(models.Message, { foreignKey: "user_id", as: "messages" });
    User.hasMany(models.Booking, { foreignKey: "user_id" });
    // OutsideMeta ya referencia user_id como staff_user_id ⇒ OK
  };

  return User;
};
