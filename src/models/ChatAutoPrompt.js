import { DataTypes } from "sequelize";

const SCOPES = ["GLOBAL", "HOME"];
const TRIGGERS = [
  "INITIAL",
  "MANUAL",
  "BOOKING_CREATED",
  "BOOKING_CONFIRMED",
  "BOOKING_PAID",
  "BOOKING_CANCELLED",
];

export default (sequelize) => {
  const ChatAutoPrompt = sequelize.define(
    "ChatAutoPrompt",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      host_user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      scope: {
        type: DataTypes.ENUM(...SCOPES),
        allowNull: false,
        defaultValue: "GLOBAL",
      },
      trigger: {
        type: DataTypes.ENUM(...TRIGGERS),
        allowNull: false,
        defaultValue: "INITIAL",
      },
      prompt_text: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: "chat_auto_prompt",
      underscored: true,
      freezeTableName: true,
      indexes: [
        { fields: ["host_user_id"] },
        { fields: ["home_id"] },
        { fields: ["scope"] },
        { fields: ["is_active"] },
      ],
    }
  );

  ChatAutoPrompt.associate = (models) => {
    ChatAutoPrompt.belongsTo(models.User, {
      foreignKey: "host_user_id",
      as: "host",
    });
    ChatAutoPrompt.belongsTo(models.Home, {
      foreignKey: "home_id",
      as: "home",
    });
  };

  ChatAutoPrompt.SCOPES = SCOPES;
  ChatAutoPrompt.TRIGGERS = TRIGGERS;

  return ChatAutoPrompt;
};

