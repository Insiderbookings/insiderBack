import { DataTypes } from "sequelize";

export default (sequelize) => {
  const GuestWalletHold = sequelize.define(
    "GuestWalletHold",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
      },
      stay_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "booking", key: "id" },
      },
      payment_scope_key: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      payment_intent_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: "USD",
      },
      amount_minor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      refunded_minor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      public_total_minor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      minimum_selling_minor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      status: {
        type: DataTypes.ENUM(
          "HELD",
          "CAPTURED",
          "RELEASED",
          "PARTIALLY_REFUNDED",
          "REFUNDED"
        ),
        allowNull: false,
        defaultValue: "HELD",
      },
      captured_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      released_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      meta: {
        type: ["mysql", "mariadb"].includes(sequelize.getDialect())
          ? DataTypes.JSON
          : DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: "guest_wallet_hold",
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: "idx_guest_wallet_hold_scope", fields: ["user_id", "stay_id", "payment_scope_key"] },
        { name: "idx_guest_wallet_hold_pi", fields: ["payment_intent_id"] },
        { name: "idx_guest_wallet_hold_status", fields: ["status"] },
      ],
    }
  );

  GuestWalletHold.associate = (models) => {
    GuestWalletHold.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
      onDelete: "CASCADE",
    });
    GuestWalletHold.belongsTo(models.Booking, {
      foreignKey: "stay_id",
      as: "stay",
      onDelete: "CASCADE",
    });
    if (models.GuestWalletLedger) {
      GuestWalletHold.hasMany(models.GuestWalletLedger, {
        foreignKey: "hold_id",
        as: "ledgerEntries",
      });
    }
  };

  return GuestWalletHold;
};
