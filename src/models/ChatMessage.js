import { DataTypes } from "sequelize";

const SENDER_ROLES = ["GUEST", "HOST", "STAFF", "SYSTEM"];
const MESSAGE_TYPES = ["TEXT", "SYSTEM", "PROMPT"];

export default (sequelize) => {
  const dialect = sequelize.getDialect();
  const JSON_TYPE =
    ["postgres", "postgresql"].includes(dialect) && DataTypes.JSONB
      ? DataTypes.JSONB
      : DataTypes.JSON;

  const ChatMessage = sequelize.define(
    "ChatMessage",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      chat_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "chat_thread", key: "id" },
        onDelete: "CASCADE",
      },
      sender_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
      },
      sender_role: {
        type: DataTypes.ENUM(...SENDER_ROLES),
        allowNull: false,
        defaultValue: "GUEST",
      },
      type: {
        type: DataTypes.ENUM(...MESSAGE_TYPES),
        allowNull: false,
        defaultValue: "TEXT",
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      metadata: { type: JSON_TYPE },
      delivered_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "chat_message",
      underscored: true,
      freezeTableName: true,
      indexes: [
        { fields: ["chat_id"] },
        { fields: ["sender_id"] },
        { fields: ["created_at"] },
      ],
    }
  );

  ChatMessage.associate = (models) => {
    ChatMessage.belongsTo(models.ChatThread, {
      foreignKey: "chat_id",
      as: "thread",
    });
    ChatMessage.belongsTo(models.User, {
      foreignKey: "sender_id",
      as: "sender",
    });
  };

  ChatMessage.SENDER_ROLES = SENDER_ROLES;
  ChatMessage.MESSAGE_TYPES = MESSAGE_TYPES;

  return ChatMessage;
};

