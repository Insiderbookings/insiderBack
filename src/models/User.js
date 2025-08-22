// src/models/User.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const User = sequelize.define(
    "User",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      /* ───────── Datos básicos ───────── */
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(150),
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      // Para cuentas sociales puede ser NULL
      password_hash: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phone: DataTypes.STRING(20),

      /* ───────── Código opcional de usuario ───────── */
      user_code: {
        type: DataTypes.STRING(100),
        allowNull: true,
        // unique: true, // descomenta si querés forzar unicidad
      },

      /* ───────── Estado / rol ───────── */
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      role: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      /* ───────── Soporte Social Login ───────── */
      // 'google', 'apple', 'local' (para local puede quedar null)
      auth_provider: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      // Identificador único del proveedor (p.ej. "sub" de Google)
      provider_sub: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      email_verified: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      avatar_url: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "user",
      freezeTableName: true,
      underscored: true, // created_at, password_hash, etc.
      paranoid: true,    // deleted_at (soft delete)
      indexes: [
        // evita duplicar la misma cuenta social
        {
          name: "user_provider_sub_unique",
          unique: true,
          fields: ["auth_provider", "provider_sub"],
        },
      ],
    }
  );

  /* ─────────── Asociaciones ─────────── */
  User.associate = (models) => {
    User.hasMany(models.Message, { foreignKey: "user_id", as: "messages" });
    User.hasMany(models.Booking, { foreignKey: "user_id" });
  };

  return User;
};
