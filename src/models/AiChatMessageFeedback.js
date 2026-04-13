import { DataTypes } from "sequelize";

const FEEDBACK_VALUES = ["up", "down"];
const FEEDBACK_REASONS = [
  "didnt_understand",
  "bad_results",
  "too_generic",
  "incorrect_info",
  "other",
];

export default (sequelize) => {
  const dialect = sequelize.getDialect();
  const JSON_TYPE =
    ["postgres", "postgresql"].includes(dialect) && DataTypes.JSONB
      ? DataTypes.JSONB
      : DataTypes.JSON;

  const AiChatMessageFeedback = sequelize.define(
    "AiChatMessageFeedback",
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
      message_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "ai_chat_message", key: "id" },
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      value: {
        type: DataTypes.ENUM(...FEEDBACK_VALUES),
        allowNull: false,
      },
      reason: {
        type: DataTypes.ENUM(...FEEDBACK_REASONS),
        allowNull: true,
      },
      metadata: {
        type: JSON_TYPE,
        allowNull: true,
      },
      deleted_at: { type: DataTypes.DATE },
    },
    {
      tableName: "ai_chat_message_feedback",
      underscored: true,
      freezeTableName: true,
      paranoid: true,
      deletedAt: "deleted_at",
      indexes: [
        { fields: ["session_id"] },
        { fields: ["message_id"] },
        { unique: true, fields: ["user_id", "message_id"] },
      ],
    },
  );

  AiChatMessageFeedback.associate = (models) => {
    AiChatMessageFeedback.belongsTo(models.AiChatSession, {
      foreignKey: "session_id",
      as: "session",
    });
    AiChatMessageFeedback.belongsTo(models.AiChatMessage, {
      foreignKey: "message_id",
      as: "message",
    });
    AiChatMessageFeedback.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
  };

  AiChatMessageFeedback.FEEDBACK_VALUES = FEEDBACK_VALUES;
  AiChatMessageFeedback.FEEDBACK_REASONS = FEEDBACK_REASONS;

  return AiChatMessageFeedback;
};
