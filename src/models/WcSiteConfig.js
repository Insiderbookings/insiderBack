import { DataTypes } from "sequelize";

export default (sequelize) => {
    const jsonType =
        sequelize.getDialect() === "mysql" ? DataTypes.JSON : DataTypes.JSONB;

    const WcSiteConfig = sequelize.define(
        "WcSiteConfig",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                unique: true, // 1:1 con tenant
                references: { model: "wc_tenant", key: "id" },
                onDelete: "CASCADE",
            },

            primary_color: { type: DataTypes.STRING(20), allowNull: true },
            secondary_color: { type: DataTypes.STRING(20), allowNull: true },
            logo_url: { type: DataTypes.STRING(255), allowNull: true },
            favicon_url: { type: DataTypes.STRING(255), allowNull: true },
            font_family: { type: DataTypes.STRING(120), allowNull: true },
            template_key: { type: DataTypes.STRING(64), allowNull: true },
            /* Campo flexible para futuros flags/ajustes de plantilla */
            extra: { type: jsonType, allowNull: false, defaultValue: {} },
        },
        {
            tableName: "wc_site_config",
            freezeTableName: true,
            underscored: true,
            paranoid: true,
            indexes: [{ unique: true, fields: ["tenant_id"] }],
        }
    );

    WcSiteConfig.associate = (models) => {
        WcSiteConfig.belongsTo(models.WcTenant, { foreignKey: "tenant_id" });
    };

    return WcSiteConfig;
};
