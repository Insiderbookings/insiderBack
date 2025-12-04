// Migration: add WebBeds country codes to user profile (nationality/residence)

export async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;

  await queryInterface.addColumn("user", "country_code", {
    type: Sequelize.STRING(10),
    allowNull: true,
    comment: "Passenger nationality (DOTW internal country code)",
  });

  await queryInterface.addColumn("user", "residence_country_code", {
    type: Sequelize.STRING(10),
    allowNull: true,
    comment: "Passenger country of residence (DOTW internal country code)",
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn("user", "residence_country_code");
  await queryInterface.removeColumn("user", "country_code");
}
