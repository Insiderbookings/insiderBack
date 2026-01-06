
import { DataTypes } from "sequelize";

export default (sequelize) => {
    const AnalyticsEvent = sequelize.define(
        "AnalyticsEvent",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

            event_type: {
                type: DataTypes.STRING(50),
                allowNull: false,
                // Examples: 'app_open', 'search', 'view_results', 'checkout_start', 'view_item'
            },

            user_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: "user", key: "id" },
                onDelete: "SET NULL",
            },

            session_id: { type: DataTypes.STRING(100), allowNull: true },

            metadata: {
                type: DataTypes.JSON, // For search params, item IDs, etc.
                allowNull: true
            },

            url: { type: DataTypes.STRING(255), allowNull: true },

            ip_address: { type: DataTypes.STRING(45), allowNull: true },
        },
        {
            tableName: "analytics_event",
            underscored: true,
            updatedAt: false, // Only care about creation time
            indexes: [
                { fields: ["event_type"] },
                { fields: ["created_at"] },
                { fields: ["user_id"] },
            ],
        }
    );

    AnalyticsEvent.associate = (models) => {
        AnalyticsEvent.belongsTo(models.User, { foreignKey: "user_id" });
    };

    return AnalyticsEvent;
};
