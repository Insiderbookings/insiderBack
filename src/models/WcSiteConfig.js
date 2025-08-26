import { DataTypes } from "sequelize";

export default (sequelize) => {
    const jsonType = sequelize.getDialect() === "mysql" ? DataTypes.JSON : DataTypes.JSONB;

    const WcSiteConfig = sequelize.define(
        "WcSiteConfig",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

            tenantId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                unique: true, // 1:1 con tenant
                field: "tenant_id",
                references: { model: "wc_tenant", key: "id" },
                onDelete: "CASCADE",
            },

            primaryColor: { type: DataTypes.STRING(20), allowNull: true, field: "primary_color" },
            secondaryColor: { type: DataTypes.STRING(20), allowNull: true, field: "secondary_color" },
            logoUrl: { type: DataTypes.STRING(255), allowNull: true, field: "logo_url" },
            faviconUrl: { type: DataTypes.STRING(255), allowNull: true, field: "favicon_url" },
            fontFamily: { type: DataTypes.STRING(120), allowNull: true, field: "font_family" },
            templateKey: { type: DataTypes.STRING(64), allowNull: true, field: "template_key" },

            stars: {
                type: DataTypes.INTEGER,
                allowNull: true,
                field: "stars",
                validate: { min: 0, max: 5 },
                set(val) {
                    const n = Number.isFinite(Number(val)) ? Math.round(Number(val)) : null;
                    this.setDataValue("stars", n);
                },
            }
        },
        {
            tableName: "wc_site_config",
            freezeTableName: true,
            underscored: true,      // mantiene created_at, updated_at, deleted_at
            paranoid: true,
            indexes: [{ unique: true, fields: ["tenant_id"] }],
        }
    );

    WcSiteConfig.associate = (models) => {
        WcSiteConfig.belongsTo(models.WcTenant, { foreignKey: "tenantId" });
    };

    return WcSiteConfig;
};
