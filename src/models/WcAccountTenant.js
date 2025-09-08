import { DataTypes } from "sequelize";

export default (sequelize) => {
  const WcAccountTenant = sequelize.define(
    "WcAccountTenant",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      account_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "wc_account", key: "id" },
        onDelete: "CASCADE",
      },

      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "wc_tenant", key: "id" },
        onDelete: "CASCADE",
      },

      // Optional: per-membership status/roles in the future
      meta: {
        type: sequelize.getDialect() === "mysql" ? DataTypes.JSON : DataTypes.JSONB,
        allowNull: true,
        defaultValue: {},
      },
    },
    {
      tableName: "wc_account_tenant",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { unique: true, fields: ["account_id", "tenant_id"] },
        { fields: ["tenant_id"] },
        { fields: ["account_id"] },
      ],
    }
  );

  return WcAccountTenant;
};

