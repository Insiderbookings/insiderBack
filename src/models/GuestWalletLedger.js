import { DataTypes } from "sequelize";

export default (sequelize) => {
  const JSON_TYPE = ["mysql", "mariadb"].includes(sequelize.getDialect())
    ? DataTypes.JSON
    : DataTypes.JSONB;

  const GuestWalletLedger = sequelize.define(
    "GuestWalletLedger",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      account_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "guest_wallet_account", key: "id" },
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
      },
      stay_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "booking", key: "id" },
      },
      hold_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "guest_wallet_hold", key: "id" },
      },
      linked_entry_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "guest_wallet_ledger", key: "id" },
      },
      type: {
        type: DataTypes.ENUM(
          "EARN_PENDING",
          "EARN_RELEASE",
          "EARN_REVERSE",
          "USE_HOLD",
          "USE_CAPTURE",
          "USE_RELEASE",
          "USE_REFUND",
          "ADJUSTMENT"
        ),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("PENDING", "POSTED", "VOIDED"),
        allowNull: false,
        defaultValue: "POSTED",
      },
      amount_minor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: "USD",
      },
      reference_key: {
        type: DataTypes.STRING(160),
        allowNull: false,
      },
      effective_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      release_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
        allowNull: true,
      },
    },
    {
      tableName: "guest_wallet_ledger",
      underscored: true,
      freezeTableName: true,
      indexes: [
        { name: "uq_guest_wallet_ledger_reference", unique: true, fields: ["reference_key"] },
        { name: "idx_guest_wallet_ledger_user_effective", fields: ["user_id", "effective_at"] },
        { name: "idx_guest_wallet_ledger_stay", fields: ["stay_id"] },
        { name: "idx_guest_wallet_ledger_type_status", fields: ["type", "status"] },
        { name: "idx_guest_wallet_ledger_linked_entry", fields: ["linked_entry_id"] },
      ],
    }
  );

  GuestWalletLedger.associate = (models) => {
    GuestWalletLedger.belongsTo(models.GuestWalletAccount, {
      foreignKey: "account_id",
      as: "account",
      onDelete: "CASCADE",
    });
    GuestWalletLedger.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
      onDelete: "CASCADE",
    });
    if (models.Booking) {
      GuestWalletLedger.belongsTo(models.Booking, {
        foreignKey: "stay_id",
        as: "stay",
        onDelete: "SET NULL",
      });
    }
    if (models.GuestWalletHold) {
      GuestWalletLedger.belongsTo(models.GuestWalletHold, {
        foreignKey: "hold_id",
        as: "hold",
        onDelete: "SET NULL",
      });
    }
    GuestWalletLedger.belongsTo(models.GuestWalletLedger, {
      foreignKey: "linked_entry_id",
      as: "linkedEntry",
      onDelete: "SET NULL",
    });
  };

  return GuestWalletLedger;
};
