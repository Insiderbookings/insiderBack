// Migration to add payout/bank columns to host_profile so it matches the model.

export async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();

  const tableExists = async (table) => {
    const [results] = await queryInterface.sequelize.query(
      dialect.startsWith("mysql")
        ? `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${table}'`
        : `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}'`
    );
    const row = Array.isArray(results) ? results[0] : results;
    const count = Number(row?.count ?? 0);
    return Number.isFinite(count) && count > 0;
  };

  const columnExists = async (table, column) => {
    try {
      const desc = await queryInterface.describeTable(table);
      return Object.prototype.hasOwnProperty.call(desc, column);
    } catch {
      return false;
    }
  };

  const addColumnIfMissing = async (table, column, definition) => {
    if (await columnExists(table, column)) return;
    await queryInterface.addColumn(table, column, definition);
  };

  const table = "host_profile";
  if (!(await tableExists(table))) return;

  await addColumnIfMissing(table, "bank_routing_number", { type: Sequelize.STRING(100), allowNull: true });
  await addColumnIfMissing(table, "bank_account_number", { type: Sequelize.STRING(100), allowNull: true });
  await addColumnIfMissing(table, "bank_account_holder", { type: Sequelize.STRING(150), allowNull: true });
}

export async function down(queryInterface) {
  const table = "host_profile";

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

  await dropIfExists("bank_routing_number");
  await dropIfExists("bank_account_number");
  await dropIfExists("bank_account_holder");
}
