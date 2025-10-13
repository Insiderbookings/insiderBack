import { DataTypes } from "sequelize";

export default (sequelize) => {
    const WcTenant = sequelize.define(
        "WcTenant",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            name: { type: DataTypes.STRING(120), allowNull: false },
            public_domain: {
                type: DataTypes.STRING(255),
                allowNull: false,
                unique: true,
                validate: { is: /^[a-z0-9.-]+\.[a-z]{2,}$/i },
            },
            panel_domain: {
                type: DataTypes.STRING(255),
                allowNull: false,
                unique: true,
                validate: { is: /^[a-z0-9.-]+\.[a-z]{2,}$/i },
            },
            hotel_id: { type: DataTypes.INTEGER, allowNull: true },
            hotel_access: { type: DataTypes.INTEGER, allowNull: true },
        },
        {
            tableName: "wc_tenant",
            freezeTableName: true,
            underscored: true,
            paranoid: true,
            indexes: [
                { unique: true, fields: ["public_domain"] },
                { unique: true, fields: ["panel_domain"] },
            ],
        }
    );

    WcTenant.associate = (models) => {
        // Many-to-many with accounts via junction table
        if (models.WcAccountTenant && models.WcAccount) {
            WcTenant.belongsToMany(models.WcAccount, {
                through: models.WcAccountTenant,
                foreignKey: "tenant_id",
                otherKey: "account_id",
            });
        }
        // Keep 1:N legacy association for backward compatibility (do not use for new code)
        if (models.WcAccount) {
            WcTenant.hasMany(models.WcAccount, { foreignKey: "tenant_id", as: "legacyAccounts" });
        }
        if (models.WcTenantPlatform) {
            WcTenant.hasMany(models.WcTenantPlatform, { foreignKey: "tenant_id", as: "platformStatuses" });
        }
        WcTenant.hasOne(models.WcSiteConfig, { foreignKey: "tenant_id" });
    };

    return WcTenant;
};
