import { DataTypes } from "sequelize";

export default (sequelize) => {
    const jsonType =
        sequelize.getDialect() === "mysql" ? DataTypes.JSON : DataTypes.JSONB;

    const WcAccount = sequelize.define(
        "WcAccount",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

            // Deprecated: legacy single-tenant link kept nullable for backward compatibility
            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: "wc_tenant", key: "id" },
                onDelete: "SET NULL",
                comment: "Deprecated. Use many-to-many via wc_account_tenant",
            },

            email: {
                type: DataTypes.STRING(160),
                allowNull: false,
                validate: { isEmail: true },
            },

            display_name: { type: DataTypes.STRING(120), allowNull: true },

            password_hash: {
                type: DataTypes.STRING(200),
                allowNull: false, // la auth del panel es local
            },

            is_active: { type: DataTypes.BOOLEAN, defaultValue: true },

            /* Roles/permisos específicos de este constructor */
            roles: { type: jsonType, allowNull: false, defaultValue: [] },
            permissions: { type: jsonType, allowNull: false, defaultValue: [] },
        },
        {
            tableName: "wc_account",
            freezeTableName: true,
            underscored: true,
            paranoid: true,
            indexes: [
                // evita duplicar email por tenant (multi-tenant real)
                {
                    name: "wc_account_email_tenant_unique",
                    unique: true,
                    fields: ["tenant_id", "email"],
                },
                // Optional global email index to speed lookups
                { name: "wc_account_email_idx", fields: ["email"] },
            ],
        }
    );

    WcAccount.associate = (models) => {
        // Many-to-many with tenants via junction table
        if (models.WcAccountTenant && models.WcTenant) {
            WcAccount.belongsToMany(models.WcTenant, {
                through: models.WcAccountTenant,
                foreignKey: "account_id",
                otherKey: "tenant_id",
            });
        }
        // Legacy single link (kept to not break old data access paths)
        if (models.WcTenant) {
            WcAccount.belongsTo(models.WcTenant, { foreignKey: "tenant_id", as: "legacyTenant" });
        }
    };

    return WcAccount;
};
