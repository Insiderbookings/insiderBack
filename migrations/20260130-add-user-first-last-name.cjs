// Migration: add first_name and last_name to user

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

  if (!(await hasColumn("user", "first_name"))) {
    await queryInterface.addColumn("user", "first_name", {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
  }

  if (!(await hasColumn("user", "last_name"))) {
    await queryInterface.addColumn("user", "last_name", {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
  }
}

async function down(queryInterface) {
  const dropColumn = async (table, column) => {
    try {
      await queryInterface.removeColumn(table, column);
    } catch (_) {
      /* ignore */
    }
  };

  await dropColumn("user", "last_name");
  await dropColumn("user", "first_name");
}

module.exports = { up, down };
