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

  if (await tableExists("partner_hotel_verification_code")) return;

  await queryInterface.createTable("partner_hotel_verification_code", {
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
    verification_code: {
      type: Sequelize.STRING(24),
      allowNull: false,
    },
    generated_by_user_id: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "user", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    generated_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },
    used_by_user_id: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "user", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    used_at: {
      type: Sequelize.DATE,
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

  await queryInterface.addIndex("partner_hotel_verification_code", ["hotel_id"], {
    name: "uq_partner_hotel_verification_code_hotel",
    unique: true,
  });
  await queryInterface.addIndex("partner_hotel_verification_code", ["verification_code"], {
    name: "uq_partner_hotel_verification_code_value",
    unique: true,
  });
}

async function down(queryInterface) {
  try {
    await queryInterface.dropTable("partner_hotel_verification_code");
  } catch (_) {
    // ignore
  }
}

module.exports = { up, down };
