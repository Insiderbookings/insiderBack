async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const isMySQL = dialect.startsWith("mysql");
  const JSON_TYPE = isMySQL ? Sequelize.JSON : Sequelize.JSONB;

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

  if (await tableExists("partner_monthly_report")) return;

  await queryInterface.createTable("partner_monthly_report", {
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
    report_month: {
      type: Sequelize.DATEONLY,
      allowNull: false,
    },
    delivery_status: {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: "PENDING",
    },
    generated_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    },
    sent_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },
    delivered_to_email: {
      type: Sequelize.STRING(150),
      allowNull: true,
    },
    delivery_error: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
    last_downloaded_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },
    metrics: {
      type: JSON_TYPE,
      allowNull: false,
    },
    summary: {
      type: JSON_TYPE,
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

  await queryInterface.addIndex("partner_monthly_report", ["claim_id", "report_month"], {
    name: "uq_partner_monthly_report_claim_month",
    unique: true,
  });
  await queryInterface.addIndex("partner_monthly_report", ["hotel_id", "report_month"], {
    name: "idx_partner_monthly_report_hotel_month",
  });
  await queryInterface.addIndex("partner_monthly_report", ["delivery_status"], {
    name: "idx_partner_monthly_report_delivery_status",
  });
}

async function down(queryInterface) {
  await queryInterface.dropTable("partner_monthly_report").catch(() => {});
}

module.exports = { up, down };
