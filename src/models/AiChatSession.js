import { DataTypes } from "sequelize";

export default (sequelize) => {
  const dialect = sequelize.getDialect();
  const JSON_TYPE =
    ["postgres", "postgresql"].includes(dialect) && DataTypes.JSONB ? DataTypes.JSONB : DataTypes.JSON;

  const AiChatSession = sequelize.define(
    "AiChatSession",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      title: {
        type: DataTypes.STRING(180),
        allowNull: false,
        defaultValue: "New chat",
      },
      last_message_preview: { type: DataTypes.STRING(255) },
      last_message_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      message_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      metadata: { type: JSON_TYPE },
      deleted_at: { type: DataTypes.DATE },
    },
    {
      tableName: "ai_chat_session",
      underscored: true,
      freezeTableName: true,
      paranoid: true,
      deletedAt: "deleted_at",
      indexes: [
        { fields: ["user_id"] },
        { fields: ["last_message_at"] },
      ],
    }
  );

  AiChatSession.associate = (models) => {
    AiChatSession.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
    AiChatSession.hasMany(models.AiChatMessage, {
      foreignKey: "session_id",
      as: "messages",
    });
  };

  return AiChatSession;
};
