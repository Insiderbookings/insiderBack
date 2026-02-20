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

  if (await tableExists("scheduled_job_runs")) return;

  await queryInterface.createTable("scheduled_job_runs", {
    id: {
      type: Sequelize.BIGINT,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    job_name: {
      type: Sequelize.STRING(120),
      allowNull: false,
    },
    source: {
      type: Sequelize.STRING(80),
      allowNull: false,
      defaultValue: "manual",
    },
    status: {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: "RUNNING",
    },
    started_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    },
    finished_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },
    triggered_by: {
      type: Sequelize.INTEGER,
      allowNull: true,
    },
    error_message: {
      type: Sequelize.TEXT,
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

  await queryInterface.addIndex("scheduled_job_runs", ["job_name", "started_at"], {
    name: "idx_scheduled_job_runs_job_name_started_at",
  });
}

async function down(queryInterface) {
  try {
    await queryInterface.removeIndex("scheduled_job_runs", "idx_scheduled_job_runs_job_name_started_at");
  } catch (_) {
    // ignore
  }
  try {
    await queryInterface.dropTable("scheduled_job_runs");
  } catch (_) {
    // ignore
  }
}

module.exports = { up, down };

