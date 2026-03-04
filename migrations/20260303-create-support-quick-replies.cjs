async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const isMySQL = dialect.startsWith("mysql");

  const tableExists = async (table) => {
    const [results] = await queryInterface.sequelize.query(
      isMySQL
        ? `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${table}'`
        : `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}'`
    );
    const row = Array.isArray(results) ? results[0] : results;
    const count = Number(row?.count ?? 0);
    return Number.isFinite(count) && count > 0;
  };

  if (await tableExists("support_quick_reply")) return;

  await queryInterface.createTable("support_quick_reply", {
    id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
    title: { type: Sequelize.STRING(140), allowNull: false },
    category: { type: Sequelize.STRING(50), allowNull: false, defaultValue: "GENERAL" },
    language: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "es" },
    content: { type: Sequelize.TEXT, allowNull: false },
    variables: { type: Sequelize.JSON, allowNull: true },
    tags: { type: Sequelize.JSON, allowNull: true },
    is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    usage_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    last_used_at: { type: Sequelize.DATE, allowNull: true },
    created_by: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "user", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    updated_by: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "user", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
  });

  await queryInterface.addIndex("support_quick_reply", ["category"], { name: "idx_support_quick_reply_category" });
  await queryInterface.addIndex("support_quick_reply", ["language"], { name: "idx_support_quick_reply_language" });
  await queryInterface.addIndex("support_quick_reply", ["is_active"], { name: "idx_support_quick_reply_active" });
}

async function down(queryInterface) {
  try {
    await queryInterface.dropTable("support_quick_reply");
  } catch (_) {
    // ignore
  }
}

module.exports = { up, down };
