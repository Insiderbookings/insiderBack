async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const JSON_TYPE =
    ["mysql", "mariadb"].includes(dialect) ? Sequelize.JSON : Sequelize.JSONB;

  await queryInterface.createTable("ai_chat_message_feedback", {
    id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
    session_id: {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: "ai_chat_session", key: "id" },
      onDelete: "CASCADE",
    },
    message_id: {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: "ai_chat_message", key: "id" },
      onDelete: "CASCADE",
    },
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: "user", key: "id" },
      onDelete: "CASCADE",
    },
    value: {
      type: Sequelize.ENUM("up", "down"),
      allowNull: false,
    },
    reason: {
      type: Sequelize.ENUM(
        "didnt_understand",
        "bad_results",
        "too_generic",
        "incorrect_info",
        "other",
      ),
      allowNull: true,
    },
    metadata: { type: JSON_TYPE, allowNull: true },
    created_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    },
    updated_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    },
    deleted_at: { type: Sequelize.DATE, allowNull: true },
  });

  await queryInterface.addIndex("ai_chat_message_feedback", ["session_id"], {
    name: "idx_ai_chat_message_feedback_session",
  });
  await queryInterface.addIndex("ai_chat_message_feedback", ["message_id"], {
    name: "idx_ai_chat_message_feedback_message",
  });
  await queryInterface.addIndex(
    "ai_chat_message_feedback",
    ["user_id", "message_id"],
    {
      unique: true,
      name: "uniq_ai_chat_message_feedback_user_message",
    },
  );
}

async function down(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect();
  await queryInterface
    .removeIndex(
      "ai_chat_message_feedback",
      "uniq_ai_chat_message_feedback_user_message",
    )
    .catch(() => {});
  await queryInterface
    .removeIndex(
      "ai_chat_message_feedback",
      "idx_ai_chat_message_feedback_message",
    )
    .catch(() => {});
  await queryInterface
    .removeIndex(
      "ai_chat_message_feedback",
      "idx_ai_chat_message_feedback_session",
    )
    .catch(() => {});
  await queryInterface.dropTable("ai_chat_message_feedback");
  if (dialect === "postgres" || dialect === "postgresql") {
    await queryInterface.sequelize
      .query('DROP TYPE IF EXISTS "enum_ai_chat_message_feedback_value";')
      .catch(() => {});
    await queryInterface.sequelize
      .query('DROP TYPE IF EXISTS "enum_ai_chat_message_feedback_reason";')
      .catch(() => {});
  }
}

module.exports = { up, down };
