import { DataTypes } from "sequelize";

export default (sequelize) => {
  const GuestWalletAccount = sequelize.define(
    "GuestWalletAccount",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: "USD",
      },
      available_minor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      pending_minor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      locked_minor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      lifetime_earned_minor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      lifetime_spent_minor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      lifetime_reversed_minor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "guest_wallet_account",
      underscored: true,
      freezeTableName: true,
      indexes: [
        {
          name: "uq_guest_wallet_account_user",
          unique: true,
          fields: ["user_id"],
        },
      ],
    }
  );

  GuestWalletAccount.associate = (models) => {
    GuestWalletAccount.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
      onDelete: "CASCADE",
    });
    if (models.GuestWalletLedger) {
      GuestWalletAccount.hasMany(models.GuestWalletLedger, {
        foreignKey: "account_id",
        as: "ledgerEntries",
      });
    }
  };

  return GuestWalletAccount;
};
