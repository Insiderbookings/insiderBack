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
        WcTenant.hasMany(models.WcAccount, { foreignKey: "tenant_id" });
        WcTenant.hasOne(models.WcSiteConfig, { foreignKey: "tenant_id" });
    };

    return WcTenant;
};
