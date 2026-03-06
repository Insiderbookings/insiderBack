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

  if (await tableExists("review_reminder_log")) return;

  const JSON_TYPE = isMySQL ? Sequelize.JSON : Sequelize.JSONB;

  await queryInterface.createTable("review_reminder_log", {
    id: {
      type: Sequelize.BIGINT,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    booking_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: "booking", key: "id" },
      onDelete: "CASCADE",
    },
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: "user", key: "id" },
      onDelete: "CASCADE",
    },
    reminder_key: {
      type: Sequelize.STRING(80),
      allowNull: false,
    },
    channel: {
      type: Sequelize.STRING(24),
      allowNull: false,
      defaultValue: "PUSH",
    },
    inventory_type: {
      type: Sequelize.STRING(32),
      allowNull: true,
    },
    inventory_id: {
      type: Sequelize.STRING(120),
      allowNull: true,
    },
    status: {
      type: Sequelize.ENUM("PENDING", "SENT"),
      allowNull: false,
      defaultValue: "PENDING",
    },
    sent_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },
    payload: {
      type: JSON_TYPE,
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

  await queryInterface.addIndex("review_reminder_log", ["booking_id", "user_id", "reminder_key", "channel"], {
    name: "review_reminder_log_unique_delivery",
    unique: true,
  });
  await queryInterface.addIndex("review_reminder_log", ["status"], {
    name: "idx_review_reminder_log_status",
  });
  await queryInterface.addIndex("review_reminder_log", ["sent_at"], {
    name: "idx_review_reminder_log_sent_at",
  });
}

async function down(queryInterface) {
  try {
    await queryInterface.removeIndex("review_reminder_log", "review_reminder_log_unique_delivery");
  } catch (_) {
    // ignore
  }
  try {
    await queryInterface.removeIndex("review_reminder_log", "idx_review_reminder_log_status");
  } catch (_) {
    // ignore
  }
  try {
    await queryInterface.removeIndex("review_reminder_log", "idx_review_reminder_log_sent_at");
  } catch (_) {
    // ignore
  }

  try {
    await queryInterface.dropTable("review_reminder_log");
  } catch (_) {
    // ignore
  }

  const dialect = queryInterface.sequelize.getDialect();
  if (dialect === "postgres") {
    try {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_review_reminder_log_status";');
    } catch (_) {
      // ignore
    }
  }
}

module.exports = { up, down };
