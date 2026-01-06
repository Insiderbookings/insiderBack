import { DataTypes } from "sequelize";

export default (sequelize) => {
    const SupportMessage = sequelize.define(
        "SupportMessage",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            ticket_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: "support_ticket", key: "id" },
            },
            sender_type: {
                type: DataTypes.ENUM("USER", "ADMIN", "SYSTEM"),
                allowNull: false,
            },
            sender_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: "User ID if sender is USER or ADMIN. Null if SYSTEM.",
            },
            content: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            read_at: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            metadata: {
                type: DataTypes.JSON, // For attachments or extra data
                allowNull: true,
            },
        },
        {
            tableName: "support_message",
            underscored: true,
            freezeTableName: true,
            indexes: [
                { fields: ["ticket_id"] },
            ],
        }
    );

    SupportMessage.associate = (models) => {
        SupportMessage.belongsTo(models.SupportTicket, { foreignKey: "ticket_id", as: "ticket" });
        SupportMessage.belongsTo(models.User, { foreignKey: "sender_id", as: "sender" }); // Only works if sender is a User (Admin is also a user with role 100)
    };

    return SupportMessage;
};
