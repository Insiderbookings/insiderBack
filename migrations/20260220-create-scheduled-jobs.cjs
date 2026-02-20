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

  if (await tableExists("scheduled_jobs")) return;

  await queryInterface.createTable("scheduled_jobs", {
    name: {
      type: Sequelize.STRING(120),
      allowNull: false,
      primaryKey: true,
    },
    enabled: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    cron_expression: {
      type: Sequelize.STRING(120),
      allowNull: true,
    },
    timezone: {
      type: Sequelize.STRING(80),
      allowNull: true,
    },
    last_run_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },
    last_status: {
      type: Sequelize.STRING(32),
      allowNull: true,
    },
    last_error: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
    next_run_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },
    updated_by: {
      type: Sequelize.INTEGER,
      allowNull: true,
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
}

async function down(queryInterface) {
  try {
    await queryInterface.dropTable("scheduled_jobs");
  } catch (_) {
    // ignore
  }
}

module.exports = { up, down };
