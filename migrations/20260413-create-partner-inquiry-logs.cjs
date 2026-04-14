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

  if (await tableExists("partner_inquiry_log")) return;

  await queryInterface.createTable("partner_inquiry_log", {
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
    traveler_name: {
      type: Sequelize.STRING(150),
      allowNull: false,
    },
    traveler_email: {
      type: Sequelize.STRING(150),
      allowNull: false,
    },
    traveler_phone: {
      type: Sequelize.STRING(40),
      allowNull: true,
    },
    message: {
      type: Sequelize.TEXT,
      allowNull: false,
    },
    check_in: {
      type: Sequelize.DATEONLY,
      allowNull: true,
    },
    check_out: {
      type: Sequelize.DATEONLY,
      allowNull: true,
    },
    source_surface: {
      type: Sequelize.STRING(32),
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

  await queryInterface.addIndex("partner_inquiry_log", ["claim_id", "created_at"], {
    name: "idx_partner_inquiry_log_claim_created",
  });
  await queryInterface.addIndex("partner_inquiry_log", ["hotel_id", "created_at"], {
    name: "idx_partner_inquiry_log_hotel_created",
  });
}

async function down(queryInterface) {
  try {
    await queryInterface.dropTable("partner_inquiry_log");
  } catch (_) {
    // ignore
  }
}

module.exports = { up, down };
