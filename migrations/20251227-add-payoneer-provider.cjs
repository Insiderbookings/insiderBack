// Migration: add PAYONEER to payout_account.provider enum

const TABLE = "payout_account";

async function up(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect();
  const desc = await queryInterface.describeTable(TABLE).catch(() => null);
  if (!desc || !desc.provider) return;

  if (dialect === "postgres") {
    await queryInterface.sequelize.query(
      'ALTER TYPE "enum_payout_account_provider" ADD VALUE IF NOT EXISTS \'PAYONEER\';'
    );
    return;
  }

  const { Sequelize } = queryInterface.sequelize;
  await queryInterface.changeColumn(TABLE, "provider", {
    type: Sequelize.ENUM("BANK", "STRIPE", "PAYPAL", "PAYONEER"),
    allowNull: false,
    defaultValue: "BANK",
  });
}

async function down(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect();
  const desc = await queryInterface.describeTable(TABLE).catch(() => null);
  if (!desc || !desc.provider) return;

  if (dialect === "postgres") {
    // Removing enum values is non-trivial in Postgres; skip safely.
    return;
  }

  const { Sequelize } = queryInterface.sequelize;
  await queryInterface.changeColumn(TABLE, "provider", {
    type: Sequelize.ENUM("BANK", "STRIPE", "PAYPAL"),
    allowNull: false,
    defaultValue: "BANK",
  });
}

module.exports = { up, down };
