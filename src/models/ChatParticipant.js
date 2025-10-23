import { DataTypes } from "sequelize";

const ROLES = ["GUEST", "HOST", "STAFF", "SYSTEM"];

export default (sequelize) => {
  const ChatParticipant = sequelize.define(
    "ChatParticipant",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      chat_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "chat_thread", key: "id" },
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      role: {
        type: DataTypes.ENUM(...ROLES),
        allowNull: false,
        defaultValue: "GUEST",
      },
      last_read_at: { type: DataTypes.DATE, allowNull: true },
      is_muted: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    {
      tableName: "chat_participant",
      underscored: true,
      freezeTableName: true,
      indexes: [
        { unique: true, fields: ["chat_id", "user_id"] },
        { fields: ["user_id"] },
        { fields: ["role"] },
      ],
    }
  );

  ChatParticipant.associate = (models) => {
    ChatParticipant.belongsTo(models.ChatThread, {
      foreignKey: "chat_id",
      as: "thread",
    });
    ChatParticipant.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
  };

  ChatParticipant.ROLES = ROLES;

  return ChatParticipant;
};

