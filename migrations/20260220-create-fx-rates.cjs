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

  if (await tableExists("fx_rates")) return;

  await queryInterface.createTable("fx_rates", {
    id: {
      type: Sequelize.BIGINT,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    base_currency: {
      type: Sequelize.STRING(3),
      allowNull: false,
    },
    quote_currency: {
      type: Sequelize.STRING(3),
      allowNull: false,
    },
    rate: {
      type: Sequelize.DECIMAL(20, 10),
      allowNull: false,
    },
    provider: {
      type: Sequelize.STRING(40),
      allowNull: false,
      defaultValue: "apilayer",
    },
    rate_date: {
      type: Sequelize.DATEONLY,
      allowNull: true,
    },
    fetched_at: {
      type: Sequelize.DATE,
      allowNull: false,
    },
    expires_at: {
      type: Sequelize.DATE,
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
    "fx_rates",
    ["base_currency", "quote_currency", "provider", "fetched_at"],
    {
      name: "ux_fx_rates_base_quote_provider_fetched_at",
      unique: true,
    }
  );

  await queryInterface.addIndex("fx_rates", ["base_currency", "quote_currency", "fetched_at"], {
    name: "idx_fx_rates_base_quote_fetched_at",
  });

  await queryInterface.addIndex("fx_rates", ["provider", "fetched_at"], {
    name: "idx_fx_rates_provider_fetched_at",
  });
}

async function down(queryInterface) {
  try {
    await queryInterface.removeIndex("fx_rates", "idx_fx_rates_provider_fetched_at");
  } catch (_) {}
  try {
    await queryInterface.removeIndex("fx_rates", "idx_fx_rates_base_quote_fetched_at");
  } catch (_) {}
  try {
    await queryInterface.removeIndex("fx_rates", "ux_fx_rates_base_quote_provider_fetched_at");
  } catch (_) {}
  try {
    await queryInterface.dropTable("fx_rates");
  } catch (_) {}
}

module.exports = { up, down };

