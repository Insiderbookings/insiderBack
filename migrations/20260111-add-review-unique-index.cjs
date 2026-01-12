// Add unique index to prevent duplicate reviews per stay/author/type.

async function up(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect();
  const INDEX_NAME = "review_unique_stay_author_type";

  const tableExists = async (table) => {
    const [results] = await queryInterface.sequelize.query(
      dialect.startsWith("mysql")
        ? `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${table}'`
        : `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}'`
    );
    const row = Array.isArray(results) ? results[0] : results;
    const count = Number(row?.count ?? 0);
    return Number.isFinite(count) && count > 0;
  };

  if (!(await tableExists("review"))) return;

  const indexExists = async () => {
    if (dialect.startsWith("mysql")) {
      const rows = await queryInterface.sequelize.query(
        `SHOW INDEX FROM \`review\` WHERE Key_name = '${INDEX_NAME}'`
      );
      return Array.isArray(rows?.[0]) && rows[0].length > 0;
    }
    const rows = await queryInterface.sequelize.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'review' AND indexname = '${INDEX_NAME}'`
    );
    return Array.isArray(rows?.[0]) && rows[0].length > 0;
  };

  if (await indexExists()) return;

  await queryInterface.addIndex("review", ["stay_id", "author_id", "author_type"], {
    name: INDEX_NAME,
    unique: true,
  });
}

async function down() {
  throw new Error("Down migration not implemented. Restore from backup if needed.");
}

module.exports = { up, down };
