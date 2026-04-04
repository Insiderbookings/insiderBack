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

  if (!(await tableExists("partner_hotel_claim"))) {
    await queryInterface.createTable("partner_hotel_claim", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
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
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      claim_status: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: "TRIAL_ACTIVE",
      },
      onboarding_step: {
        type: Sequelize.STRING(40),
        allowNull: true,
      },
      contact_name: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      contact_email: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      contact_phone: {
        type: Sequelize.STRING(40),
        allowNull: true,
      },
      claimed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      trial_started_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      trial_ends_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      current_plan_code: {
        type: Sequelize.STRING(32),
        allowNull: true,
      },
      pending_plan_code: {
        type: Sequelize.STRING(32),
        allowNull: true,
      },
      billing_method: {
        type: Sequelize.STRING(32),
        allowNull: true,
      },
      stripe_customer_id: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      stripe_subscription_id: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      stripe_checkout_session_id: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      stripe_price_id: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      stripe_invoice_id: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      subscription_status: {
        type: Sequelize.STRING(40),
        allowNull: true,
      },
      subscription_started_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      next_billing_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      cancelled_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      invoice_requested_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      invoice_paid_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_badge_activated_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      badge_removed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      billing_details: {
        type: JSON_TYPE,
        allowNull: true,
      },
      profile_overrides: {
        type: JSON_TYPE,
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
        allowNull: true,
      },
      internal_notes: {
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
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await queryInterface.addIndex("partner_hotel_claim", ["hotel_id"], {
      name: "uq_partner_hotel_claim_hotel",
      unique: true,
    });
    await queryInterface.addIndex("partner_hotel_claim", ["user_id"], {
      name: "idx_partner_hotel_claim_user",
    });
    await queryInterface.addIndex("partner_hotel_claim", ["claim_status"], {
      name: "idx_partner_hotel_claim_status",
    });
    await queryInterface.addIndex("partner_hotel_claim", ["trial_ends_at"], {
      name: "idx_partner_hotel_claim_trial_end",
    });
  }

  if (!(await tableExists("partner_email_log"))) {
    await queryInterface.createTable("partner_email_log", {
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
      email_key: {
        type: Sequelize.STRING(80),
        allowNull: false,
      },
      schedule_day: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      delivery_status: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "SENT",
      },
      sent_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
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

    await queryInterface.addIndex("partner_email_log", ["claim_id", "email_key"], {
      name: "uq_partner_email_log_claim_key",
      unique: true,
    });
    await queryInterface.addIndex("partner_email_log", ["hotel_id"], {
      name: "idx_partner_email_log_hotel",
    });
    await queryInterface.addIndex("partner_email_log", ["user_id"], {
      name: "idx_partner_email_log_user",
    });
  }
}

async function down(queryInterface) {
  try {
    await queryInterface.dropTable("partner_email_log");
  } catch (_) {
    // ignore
  }
  try {
    await queryInterface.dropTable("partner_hotel_claim");
  } catch (_) {
    // ignore
  }
}

module.exports = { up, down };
