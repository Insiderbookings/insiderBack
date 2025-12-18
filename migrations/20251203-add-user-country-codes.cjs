// Migration: add WebBeds country codes to user profile (nationality/residence)

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;

  const hasColumn = async (table, column) => {
    try {
      const desc = await queryInterface.describeTable(table);
      return Object.prototype.hasOwnProperty.call(desc, column);
    } catch {
      return false;
    }
  };

  if (!(await hasColumn("user", "country_code"))) {
    await queryInterface.addColumn("user", "country_code", {
      type: Sequelize.STRING(10),
      allowNull: true,
      comment: "Passenger nationality (DOTW internal country code)",
    });
  }

  if (!(await hasColumn("user", "residence_country_code"))) {
    await queryInterface.addColumn("user", "residence_country_code", {
      type: Sequelize.STRING(10),
      allowNull: true,
      comment: "Passenger country of residence (DOTW internal country code)",
    });
  }
}

async function down(queryInterface) {
  await queryInterface.removeColumn("user", "residence_country_code");
  await queryInterface.removeColumn("user", "country_code");
}

module.exports = { up, down };
