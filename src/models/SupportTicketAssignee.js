import { DataTypes } from "sequelize";

export default (sequelize) => {
    const SupportTicketAssignee = sequelize.define(
        "SupportTicketAssignee",
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
                onDelete: "CASCADE",
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: "user", key: "id" },
                onDelete: "CASCADE",
            },
            assigned_by: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: "user", key: "id" },
                onDelete: "SET NULL",
            },
            assigned_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
        },
        {
            tableName: "support_ticket_assignee",
            underscored: true,
            freezeTableName: true,
            indexes: [
                { unique: true, fields: ["ticket_id", "user_id"] },
                { fields: ["user_id"] },
            ],
        }
    );

    SupportTicketAssignee.associate = (models) => {
        SupportTicketAssignee.belongsTo(models.SupportTicket, {
            foreignKey: "ticket_id",
            as: "ticket",
        });
        SupportTicketAssignee.belongsTo(models.User, {
            foreignKey: "user_id",
            as: "assigneeUser",
        });
        SupportTicketAssignee.belongsTo(models.User, {
            foreignKey: "assigned_by",
            as: "assignedByUser",
        });
    };

    return SupportTicketAssignee;
};
