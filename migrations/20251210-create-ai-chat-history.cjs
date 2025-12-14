// Migration: create tables to persist AI assistant chat sessions and messages

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const JSON_TYPE = ["mysql", "mariadb"].includes(dialect) ? Sequelize.JSON : Sequelize.JSONB;

  await queryInterface.createTable("ai_chat_session", {
    id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: "user", key: "id" },
      onDelete: "CASCADE",
    },
    title: { type: Sequelize.STRING(180), allowNull: false, defaultValue: "New chat" },
    last_message_preview: { type: Sequelize.STRING(255), allowNull: true },
    last_message_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    message_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    metadata: { type: JSON_TYPE, allowNull: true },
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    deleted_at: { type: Sequelize.DATE, allowNull: true },
  });

  await queryInterface.createTable("ai_chat_message", {
    id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
    session_id: {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: "ai_chat_session", key: "id" },
      onDelete: "CASCADE",
    },
    role: {
      type: Sequelize.ENUM("assistant", "user", "system"),
      allowNull: false,
      defaultValue: "user",
    },
    content: { type: Sequelize.TEXT, allowNull: false },
    plan_snapshot: { type: JSON_TYPE, allowNull: true },
    inventory_snapshot: { type: JSON_TYPE, allowNull: true },
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    deleted_at: { type: Sequelize.DATE, allowNull: true },
  });

  await queryInterface.addIndex("ai_chat_session", ["user_id"], { name: "idx_ai_chat_session_user" });
  await queryInterface.addIndex("ai_chat_session", ["last_message_at"], {
    name: "idx_ai_chat_session_last_message",
  });
  await queryInterface.addIndex("ai_chat_message", ["session_id"], {
    name: "idx_ai_chat_message_session",
  });
  await queryInterface.addIndex("ai_chat_message", ["created_at"], {
    name: "idx_ai_chat_message_created_at",
  });
}

async function down(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect();
  await queryInterface.removeIndex("ai_chat_message", "idx_ai_chat_message_created_at").catch(() => {});
  await queryInterface.removeIndex("ai_chat_message", "idx_ai_chat_message_session").catch(() => {});
  await queryInterface.removeIndex("ai_chat_session", "idx_ai_chat_session_last_message").catch(() => {});
  await queryInterface.removeIndex("ai_chat_session", "idx_ai_chat_session_user").catch(() => {});
  await queryInterface.dropTable("ai_chat_message");
  await queryInterface.dropTable("ai_chat_session");
  if (dialect === "postgres" || dialect === "postgresql") {
    await queryInterface.sequelize
      .query('DROP TYPE IF EXISTS "enum_ai_chat_message_role";')
      .catch(() => {});
  }
}

module.exports = { up, down };
