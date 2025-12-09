// Migration: add provider + wallet fields to payout_account

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const table = "payout_account";

  const columnExists = async (column) => {
    try {
      const desc = await queryInterface.describeTable(table);
      return Object.prototype.hasOwnProperty.call(desc, column);
    } catch {
      return false;
    }
  };

  const addColumnIfMissing = async (column, def) => {
    if (await columnExists(column)) return;
    await queryInterface.addColumn(table, column, def);
  };

  await addColumnIfMissing("provider", {
    type: Sequelize.ENUM("BANK", "STRIPE", "PAYPAL"),
    allowNull: false,
    defaultValue: "BANK",
  });

  await addColumnIfMissing("wallet_email", {
    type: Sequelize.STRING(150),
    allowNull: true,
  });

  await addColumnIfMissing("external_customer_id", {
    type: Sequelize.STRING(120),
    allowNull: true,
  });

  await addColumnIfMissing("brand", {
    type: Sequelize.STRING(60),
    allowNull: true,
  });
}

async function down(queryInterface) {
  const table = "payout_account";

  const columnExists = async (column) => {
    try {
      const desc = await queryInterface.describeTable(table);
      return Object.prototype.hasOwnProperty.call(desc, column);
    } catch {
      return false;
    }
  };

  const dropIfExists = async (column) => {
    if (await columnExists(column)) {
      await queryInterface.removeColumn(table, column);
    }
  };

  await dropIfExists("brand");
  await dropIfExists("external_customer_id");
  await dropIfExists("wallet_email");
  await dropIfExists("provider");
}

module.exports = { up, down };
