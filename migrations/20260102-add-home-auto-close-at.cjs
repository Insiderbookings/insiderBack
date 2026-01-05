// Migration: add auto_close_at to home table

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize

  const hasColumn = async (table, column) => {
    try {
      const desc = await queryInterface.describeTable(table)
      return Object.prototype.hasOwnProperty.call(desc, column)
    } catch {
      return false
    }
  }

  if (!(await hasColumn("home", "auto_close_at"))) {
    await queryInterface.addColumn("home", "auto_close_at", {
      type: Sequelize.DATE,
      allowNull: true,
    })
  }
}

async function down(queryInterface) {
  try {
    await queryInterface.removeColumn("home", "auto_close_at")
  } catch (_) {
    /* ignore */
  }
}

module.exports = { up, down }
