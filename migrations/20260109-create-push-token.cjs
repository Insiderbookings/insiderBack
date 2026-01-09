// Create push_token table for Expo push notifications.

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();

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

  if (await tableExists("push_token")) return;

  await queryInterface.createTable("push_token", {
    id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: "user", key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    token: { type: Sequelize.STRING(200), allowNull: false, unique: true },
    platform: { type: Sequelize.STRING(20), allowNull: true },
    device_id: { type: Sequelize.STRING(120), allowNull: true },
    last_seen_at: { type: Sequelize.DATE, allowNull: true },
    created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
  });

  await queryInterface.addIndex("push_token", ["user_id"], { name: "idx_push_token_user_id" });
  await queryInterface.addIndex("push_token", ["token"], {
    name: "uq_push_token_token",
    unique: true,
  });
}

async function down() {
  throw new Error("Down migration not implemented. Restore from backup if needed.");
}

module.exports = { up, down };
