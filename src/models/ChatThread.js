import { DataTypes } from "sequelize";

export default (sequelize) => {
  const dialect = sequelize.getDialect();
  const JSON_TYPE =
    ["postgres", "postgresql"].includes(dialect) && DataTypes.JSONB
      ? DataTypes.JSONB
      : DataTypes.JSON;

  const ChatThread = sequelize.define(
    "ChatThread",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "home", key: "id" },
      },
      reserve_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "booking", key: "id" },
      },
      guest_user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
      },
      host_user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
      },
      home_snapshot_name: { type: DataTypes.STRING(180) },
      home_snapshot_image: { type: DataTypes.STRING(500) },
      check_in: { type: DataTypes.DATEONLY, allowNull: true },
      check_out: { type: DataTypes.DATEONLY, allowNull: true },
      status: {
        type: DataTypes.ENUM("OPEN", "CLOSED"),
        defaultValue: "OPEN",
      },
      last_message_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      meta: { type: JSON_TYPE },
    },
    {
      tableName: "chat_thread",
      underscored: true,
      freezeTableName: true,
      indexes: [
        { fields: ["guest_user_id"] },
        { fields: ["host_user_id"] },
        { fields: ["reserve_id"] },
        { fields: ["status"] },
      ],
    }
  );

  ChatThread.associate = (models) => {
    ChatThread.belongsTo(models.Home, { foreignKey: "home_id", as: "home" });
    ChatThread.belongsTo(models.Booking, {
      foreignKey: "reserve_id",
      as: "booking",
    });
    ChatThread.belongsTo(models.User, {
      foreignKey: "guest_user_id",
      as: "guest",
    });
    ChatThread.belongsTo(models.User, {
      foreignKey: "host_user_id",
      as: "host",
    });
    ChatThread.hasMany(models.ChatMessage, {
      foreignKey: "chat_id",
      as: "messages",
    });
    ChatThread.hasMany(models.ChatParticipant, {
      foreignKey: "chat_id",
      as: "participants",
    });
  };

  return ChatThread;
};

