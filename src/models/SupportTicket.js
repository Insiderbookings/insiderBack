import { DataTypes } from "sequelize";

export default (sequelize) => {
    const SupportTicket = sequelize.define(
        "SupportTicket",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: "user", key: "id" },
            },
            chat_thread_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: "chat_thread", key: "id" },
            },
            subject: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            category: {
                type: DataTypes.ENUM("GENERAL", "BILLING", "TECHNICAL", "BOOKING", "OTHER"),
                defaultValue: "GENERAL",
            },
            priority: {
                type: DataTypes.ENUM("LOW", "MEDIUM", "HIGH", "CRITICAL"),
                defaultValue: "MEDIUM",
            },
            status: {
                type: DataTypes.ENUM("OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"),
                defaultValue: "OPEN",
            },
            assigned_to: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: "Admin ID assigned to this ticket",
                references: { model: "user", key: "id" },
            },
            last_message_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
            },
        },
        {
            tableName: "support_ticket",
            underscored: true,
            freezeTableName: true,
            indexes: [
                { fields: ["user_id"] },
                { fields: ["status"] },
                { fields: ["assigned_to"] },
            ],
        }
    );

    SupportTicket.associate = (models) => {
        SupportTicket.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
        SupportTicket.belongsTo(models.User, { foreignKey: "assigned_to", as: "assignee" });
        SupportTicket.hasMany(models.SupportMessage, {
            foreignKey: "ticket_id",
            as: "messages",
            onDelete: "CASCADE",
        });
    };

    return SupportTicket;
};
