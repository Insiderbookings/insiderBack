// models/WcSiteConfig.js
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

            // Apariencia
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
            },

            // Redes (las 6 que estás usando en el panel)
            facebookUrl: { type: DataTypes.STRING(255), allowNull: true, field: "facebook_url", validate: { isUrl: true } },
            instagramUrl: { type: DataTypes.STRING(255), allowNull: true, field: "instagram_url", validate: { isUrl: true } },
            tiktokUrl: { type: DataTypes.STRING(255), allowNull: true, field: "tiktok_url", validate: { isUrl: true } },
            youtubeUrl: { type: DataTypes.STRING(255), allowNull: true, field: "youtube_url", validate: { isUrl: true } },
            xUrl: { type: DataTypes.STRING(255), allowNull: true, field: "x_url", validate: { isUrl: true } },
            linkedinUrl: { type: DataTypes.STRING(255), allowNull: true, field: "linkedin_url", validate: { isUrl: true } },
        },
        {
            tableName: "wc_site_config",
            freezeTableName: true,
            underscored: true,     // created_at, updated_at, deleted_at
            paranoid: true,
            indexes: [{ unique: true, fields: ["tenant_id"] }],
            hooks: {
                beforeValidate: (cfg) => {
                    const urlFromHandle = (value, platform) => {
                        if (!value) return value;
                        const v = String(value).trim();
                        if (/^https?:\/\//i.test(v)) return v;
                        const h = v.replace(/^@/, "");
                        const map = {
                            facebook: (x) => `https://www.facebook.com/${x}`,
                            instagram: (x) => `https://www.instagram.com/${x}`,
                            tiktok: (x) => `https://www.tiktok.com/@${x}`,
                            youtube: (x) => `https://www.youtube.com/${x}`, // channel/<id> o @handle
                            x: (x) => `https://x.com/${x}`,
                            linkedin: (x) => `https://www.linkedin.com/${x}`, // company/<slug> o in/<user>
                        };
                        return map[platform] ? map[platform](h) : v;
                    };

                    // normaliza @handle → URL
                    if (cfg.facebookUrl) cfg.facebookUrl = urlFromHandle(cfg.facebookUrl, "facebook");
                    if (cfg.instagramUrl) cfg.instagramUrl = urlFromHandle(cfg.instagramUrl, "instagram");
                    if (cfg.tiktokUrl) cfg.tiktokUrl = urlFromHandle(cfg.tiktokUrl, "tiktok");
                    if (cfg.youtubeUrl) cfg.youtubeUrl = urlFromHandle(cfg.youtubeUrl, "youtube");
                    if (cfg.xUrl) cfg.xUrl = urlFromHandle(cfg.xUrl, "x");
                    if (cfg.linkedinUrl) cfg.linkedinUrl = urlFromHandle(cfg.linkedinUrl, "linkedin");

                    // strings vacíos → null (evita fallos de isUrl)
                    [
                        "facebookUrl", "instagramUrl", "tiktokUrl", "youtubeUrl", "xUrl", "linkedinUrl",
                        "primaryColor", "secondaryColor", "logoUrl", "faviconUrl", "fontFamily", "templateKey"
                    ].forEach((k) => {
                        if (cfg[k] !== undefined && cfg[k] !== null && String(cfg[k]).trim() === "") {
                            cfg[k] = null;
                        }
                    });
                },
            },
        }
    );

    WcSiteConfig.associate = (models) => {
        WcSiteConfig.belongsTo(models.WcTenant, { foreignKey: "tenantId" });
    };

    return WcSiteConfig;
};
