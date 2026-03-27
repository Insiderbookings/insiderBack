async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const isMySQL = dialect.startsWith("mysql");

  const tableExists = async (table) => {
    const [results] = await queryInterface.sequelize.query(
      isMySQL
        ? `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${table}'`
        : `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}'`,
    );
    const row = Array.isArray(results) ? results[0] : results;
    const count = Number(row?.count ?? 0);
    return Number.isFinite(count) && count > 0;
  };

  if (await tableExists("booking_abandonment_reminder_log")) return;

  const JSON_TYPE = isMySQL ? Sequelize.JSON : Sequelize.JSONB;

  await queryInterface.createTable("booking_abandonment_reminder_log", {
    id: {
      type: Sequelize.BIGINT,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    flow_id: {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: "booking_flows", key: "id" },
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

  await queryInterface.addIndex(
    "booking_abandonment_reminder_log",
    ["flow_id", "user_id", "reminder_key", "channel"],
    {
      name: "booking_abandonment_reminder_unique_delivery",
      unique: true,
    },
  );
  await queryInterface.addIndex("booking_abandonment_reminder_log", ["status"], {
    name: "idx_booking_abandonment_reminder_status",
  });
  await queryInterface.addIndex("booking_abandonment_reminder_log", ["sent_at"], {
    name: "idx_booking_abandonment_reminder_sent_at",
  });
}

async function down(queryInterface) {
  try {
    await queryInterface.removeIndex(
      "booking_abandonment_reminder_log",
      "booking_abandonment_reminder_unique_delivery",
    );
  } catch (_) {
    // ignore
  }
  try {
    await queryInterface.removeIndex(
      "booking_abandonment_reminder_log",
      "idx_booking_abandonment_reminder_status",
    );
  } catch (_) {
    // ignore
  }
  try {
    await queryInterface.removeIndex(
      "booking_abandonment_reminder_log",
      "idx_booking_abandonment_reminder_sent_at",
    );
  } catch (_) {
    // ignore
  }

  try {
    await queryInterface.dropTable("booking_abandonment_reminder_log");
  } catch (_) {
    // ignore
  }

  if (queryInterface.sequelize.getDialect() === "postgres") {
    try {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_booking_abandonment_reminder_log_status";',
      );
    } catch (_) {
      // ignore
    }
  }
}

module.exports = { up, down };
