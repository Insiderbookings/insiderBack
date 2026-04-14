async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const isMySQL = dialect.startsWith("mysql");
  const JSON_TYPE = isMySQL ? Sequelize.JSON : Sequelize.JSONB;

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

  if (!(await tableExists("partner_metric_event"))) {
    await queryInterface.createTable("partner_metric_event", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      claim_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "partner_hotel_claim", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      hotel_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: "webbeds_hotel", key: "hotel_id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      session_id: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      dedupe_key: {
        type: Sequelize.STRING(191),
        allowNull: true,
      },
      event_type: {
        type: Sequelize.STRING(32),
        allowNull: false,
      },
      surface: {
        type: Sequelize.STRING(32),
        allowNull: false,
      },
      placement: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      source_channel: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "in_app",
      },
      page_path: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      referrer: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("partner_metric_event", ["claim_id"], {
      name: "idx_partner_metric_event_claim",
    });
    await queryInterface.addIndex("partner_metric_event", ["hotel_id", "created_at"], {
      name: "idx_partner_metric_event_hotel_created",
    });
    await queryInterface.addIndex("partner_metric_event", ["surface", "event_type"], {
      name: "idx_partner_metric_event_surface_type",
    });
    await queryInterface.addIndex("partner_metric_event", ["dedupe_key"], {
      name: "uq_partner_metric_event_dedupe",
      unique: true,
    });
  }

  if (!(await tableExists("partner_metric_adjustment"))) {
    await queryInterface.createTable("partner_metric_adjustment", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      claim_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "partner_hotel_claim", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      hotel_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: "webbeds_hotel", key: "hotel_id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      entered_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      metric_type: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "bookinggpt_reach",
      },
      source: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "social_manual",
      },
      period_start: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      period_end: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      value: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      note: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
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

    await queryInterface.addIndex("partner_metric_adjustment", ["hotel_id", "period_start", "period_end"], {
      name: "idx_partner_metric_adjustment_hotel_period",
    });
    await queryInterface.addIndex("partner_metric_adjustment", ["claim_id"], {
      name: "idx_partner_metric_adjustment_claim",
    });
    await queryInterface.addIndex("partner_metric_adjustment", ["metric_type"], {
      name: "idx_partner_metric_adjustment_metric_type",
    });
  }
}

async function down(queryInterface) {
  try {
    await queryInterface.dropTable("partner_metric_adjustment");
  } catch (_) {
    // ignore
  }
  try {
    await queryInterface.dropTable("partner_metric_event");
  } catch (_) {
    // ignore
  }
}

module.exports = { up, down };
