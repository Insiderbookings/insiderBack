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

  if (await tableExists("fx_rate_change_logs")) return;

  await queryInterface.createTable("fx_rate_change_logs", {
    id: {
      type: Sequelize.BIGINT,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    batch_id: {
      type: Sequelize.STRING(64),
      allowNull: false,
    },
    source: {
      type: Sequelize.STRING(80),
      allowNull: false,
      defaultValue: "unknown",
    },
    triggered_by: {
      type: Sequelize.INTEGER,
      allowNull: true,
    },
    base_currency: {
      type: Sequelize.STRING(3),
      allowNull: false,
    },
    quote_currency: {
      type: Sequelize.STRING(3),
      allowNull: false,
    },
    provider: {
      type: Sequelize.STRING(40),
      allowNull: false,
      defaultValue: "apilayer",
    },
    old_rate: {
      type: Sequelize.DECIMAL(20, 10),
      allowNull: false,
    },
    new_rate: {
      type: Sequelize.DECIMAL(20, 10),
      allowNull: false,
    },
    changed_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    },
    created_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    },
    updated_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    },
  });

  await queryInterface.addIndex("fx_rate_change_logs", ["batch_id", "changed_at"], {
    name: "idx_fx_rate_change_logs_batch_changed_at",
  });
  await queryInterface.addIndex("fx_rate_change_logs", ["changed_at"], {
    name: "idx_fx_rate_change_logs_changed_at",
  });
}

async function down(queryInterface) {
  try {
    await queryInterface.removeIndex("fx_rate_change_logs", "idx_fx_rate_change_logs_changed_at");
  } catch (_) {}
  try {
    await queryInterface.removeIndex("fx_rate_change_logs", "idx_fx_rate_change_logs_batch_changed_at");
  } catch (_) {}
  try {
    await queryInterface.dropTable("fx_rate_change_logs");
  } catch (_) {}
}

module.exports = { up, down };

