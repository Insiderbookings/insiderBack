import { DataTypes } from "sequelize";

const ROLES = ["assistant", "user", "system"];

export default (sequelize) => {
  const dialect = sequelize.getDialect();
  const JSON_TYPE =
    ["postgres", "postgresql"].includes(dialect) && DataTypes.JSONB ? DataTypes.JSONB : DataTypes.JSON;

  const AiChatMessage = sequelize.define(
    "AiChatMessage",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      session_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "ai_chat_session", key: "id" },
        onDelete: "CASCADE",
      },
      role: {
        type: DataTypes.ENUM(...ROLES),
        allowNull: false,
        defaultValue: "user",
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      plan_snapshot: { type: JSON_TYPE },
      inventory_snapshot: { type: JSON_TYPE },
      deleted_at: { type: DataTypes.DATE },
    },
    {
      tableName: "ai_chat_message",
      underscored: true,
      freezeTableName: true,
      paranoid: true,
      deletedAt: "deleted_at",
      indexes: [
        { fields: ["session_id"] },
        { fields: ["created_at"] },
      ],
    }
  );

  AiChatMessage.associate = (models) => {
    AiChatMessage.belongsTo(models.AiChatSession, {
      foreignKey: "session_id",
      as: "session",
    });
  };

  AiChatMessage.ROLES = ROLES;

  return AiChatMessage;
};
