// Migration: add provider + wallet fields to payout_account

export async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const table = "payout_account";

  // Add enum type for provider
  await queryInterface.addColumn(table, "provider", {
    type: Sequelize.ENUM("BANK", "STRIPE", "PAYPAL"),
    allowNull: false,
    defaultValue: "BANK",
  });

  await queryInterface.addColumn(table, "wallet_email", {
    type: Sequelize.STRING(150),
    allowNull: true,
  });

  await queryInterface.addColumn(table, "external_customer_id", {
    type: Sequelize.STRING(120),
    allowNull: true,
  });

  await queryInterface.addColumn(table, "brand", {
    type: Sequelize.STRING(60),
    allowNull: true,
  });
}

export async function down(queryInterface) {
  const table = "payout_account";
  await queryInterface.removeColumn(table, "brand");
  await queryInterface.removeColumn(table, "external_customer_id");
  await queryInterface.removeColumn(table, "wallet_email");
  await queryInterface.removeColumn(table, "provider");
}
