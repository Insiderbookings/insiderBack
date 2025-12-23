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

      /* ───────── Referido por influencer ───────── */
      referred_by_influencer_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      referred_by_code: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      referred_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      /* Discount code onboarding */
      last_login_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      discount_code_prompted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      discount_code_reminder_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      discount_code_locked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      discount_code_entered_at: {
        type: DataTypes.DATE,
        allowNull: true,
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

      // When admin pre-approves a role change and requires user info
      role_pending_info: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
      // DOTW/WebBeds: códigos internos de país (nacionalidad y residencia)
      country_code: {
        type: DataTypes.STRING(10),
        allowNull: true,
        comment: "Passenger nationality (DOTW internal country code)",
      },
      residence_country_code: {
        type: DataTypes.STRING(10),
        allowNull: true,
        comment: "Passenger country of residence (DOTW internal country code)",
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
    User.hasMany(models.UserContract, {
      foreignKey: "user_id",
      as: "contractAcceptances",
      onDelete: "CASCADE",
    });
    if (models.HostProfile) {
      User.hasOne(models.HostProfile, {
        foreignKey: "user_id",
        as: "hostProfile",
        onDelete: "CASCADE",
      });
    }
    if (models.GuestProfile) {
      User.hasOne(models.GuestProfile, {
        foreignKey: "user_id",
        as: "guestProfile",
        onDelete: "CASCADE",
      });
    }
    if (models.HostBadge) {
      User.hasMany(models.HostBadge, {
        foreignKey: "user_id",
        as: "badges",
        onDelete: "CASCADE",
      });
    }
    if (models.HomeFavorite) {
      User.hasMany(models.HomeFavorite, {
        foreignKey: "user_id",
        as: "homeFavorites",
        onDelete: "CASCADE",
      });
    }
    if (models.PayoutAccount) {
      User.hasOne(models.PayoutAccount, {
        foreignKey: "user_id",
        as: "payoutAccount",
        onDelete: "CASCADE",
      });
    }
  };

  const ensureHostProfile = async (user, transaction) => {
    const HOST_ROLE = 6;
    if (user.role !== HOST_ROLE) return;
    const HostProfile = sequelize.models.HostProfile;
    if (!HostProfile) return;

    const profile = await HostProfile.findOne({
      where: { user_id: user.id },
      transaction,
    });
    if (!profile) {
      await HostProfile.create(
        {
          user_id: user.id,
          kyc_status: "PENDING",
          payout_status: "INCOMPLETE",
        },
        { transaction },
      );
    }
  };

  User.addHook("afterCreate", async (user, options) => {
    await ensureHostProfile(user, options?.transaction);
  });

  User.addHook("afterUpdate", async (user, options) => {
    if (user.changed("role")) {
      await ensureHostProfile(user, options?.transaction);
    }
  });

  return User;
};
