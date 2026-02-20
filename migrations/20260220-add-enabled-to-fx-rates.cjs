async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  try {
    const table = await queryInterface.describeTable("fx_rates");
    if (!table?.enabled) {
      await queryInterface.addColumn("fx_rates", "enabled", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
    }
  } catch (_) {
    // ignore if table does not exist yet
  }
}

async function down(queryInterface) {
  try {
    const table = await queryInterface.describeTable("fx_rates");
    if (table?.enabled) {
      await queryInterface.removeColumn("fx_rates", "enabled");
    }
  } catch (_) {
    // ignore
  }
}

module.exports = { up, down };

