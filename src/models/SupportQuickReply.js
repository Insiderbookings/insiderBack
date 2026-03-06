import { DataTypes } from "sequelize";

export default (sequelize) => {
    const SupportQuickReply = sequelize.define(
        "SupportQuickReply",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            title: {
                type: DataTypes.STRING(140),
                allowNull: false,
            },
            category: {
                type: DataTypes.STRING(50),
                allowNull: false,
                defaultValue: "GENERAL",
            },
            language: {
                type: DataTypes.STRING(8),
                allowNull: false,
                defaultValue: "es",
            },
            content: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            variables: {
                type: DataTypes.JSON,
                allowNull: true,
            },
            tags: {
                type: DataTypes.JSON,
                allowNull: true,
            },
            is_active: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },
            usage_count: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            last_used_at: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            created_by: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: "user", key: "id" },
            },
            updated_by: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: "user", key: "id" },
            },
        },
        {
            tableName: "support_quick_reply",
            underscored: true,
            freezeTableName: true,
            indexes: [
                { fields: ["category"] },
                { fields: ["language"] },
                { fields: ["is_active"] },
            ],
        }
    );

    SupportQuickReply.associate = (models) => {
        SupportQuickReply.belongsTo(models.User, { foreignKey: "created_by", as: "creator" });
        SupportQuickReply.belongsTo(models.User, { foreignKey: "updated_by", as: "updater" });
    };

    return SupportQuickReply;
};
