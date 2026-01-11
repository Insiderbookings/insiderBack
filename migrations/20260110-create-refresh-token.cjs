// Create refresh_token table for rotating refresh sessions.

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

  if (await tableExists("refresh_token")) return;

  await queryInterface.createTable("refresh_token", {
    id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: "user", key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    token_id: { type: Sequelize.STRING(64), allowNull: false, unique: true },
    device_id: { type: Sequelize.STRING(120), allowNull: true },
    expires_at: { type: Sequelize.DATE, allowNull: false },
    last_used_at: { type: Sequelize.DATE, allowNull: true },
    revoked_at: { type: Sequelize.DATE, allowNull: true },
    replaced_by: { type: Sequelize.STRING(64), allowNull: true },
    created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
  });

  await queryInterface.addIndex("refresh_token", ["user_id"], { name: "idx_refresh_token_user" });
  await queryInterface.addIndex("refresh_token", ["device_id"], { name: "idx_refresh_token_device" });
  await queryInterface.addIndex("refresh_token", ["token_id"], {
    name: "uq_refresh_token_token_id",
    unique: true,
  });
}

async function down() {
  throw new Error("Down migration not implemented. Restore from backup if needed.");
}

module.exports = { up, down };
