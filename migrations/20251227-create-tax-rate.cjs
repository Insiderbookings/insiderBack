// Migration: create tax_rate table for default taxes by country/state

async function hasTable(queryInterface, table) {
  try {
    const tables = await queryInterface.showAllTables();
    const names = (tables || [])
      .map((t) => (typeof t === "string" ? t : t.tableName || t.name || null))
      .filter(Boolean)
      .map((name) => String(name).toLowerCase());
    return names.includes(String(table).toLowerCase());
  } catch {
    return false;
  }
}

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  if (await hasTable(queryInterface, "tax_rate")) return;

  await queryInterface.createTable("tax_rate", {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    country_code: { type: Sequelize.STRING(8), allowNull: false },
    state_code: { type: Sequelize.STRING(40), allowNull: true },
    rate: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
    label: { type: Sequelize.STRING(120), allowNull: true },
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    deleted_at: { type: Sequelize.DATE, allowNull: true },
  });

  await queryInterface.addIndex("tax_rate", ["country_code"], {
    name: "idx_tax_rate_country",
  });
  await queryInterface.addIndex("tax_rate", ["country_code", "state_code"], {
    name: "uniq_tax_rate_country_state",
    unique: true,
  });
}

async function down(queryInterface) {
  await queryInterface.removeIndex("tax_rate", "uniq_tax_rate_country_state").catch(() => {});
  await queryInterface.removeIndex("tax_rate", "idx_tax_rate_country").catch(() => {});
  await queryInterface.dropTable("tax_rate").catch(() => {});
}

module.exports = { up, down };
