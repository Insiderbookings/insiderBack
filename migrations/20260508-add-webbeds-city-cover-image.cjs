async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize

  const tableExists = async (table) => {
    const dialect = queryInterface.sequelize.getDialect()
    const isMySQL = dialect.startsWith("mysql")
    const [results] = await queryInterface.sequelize.query(
      isMySQL
        ? `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${table}'`
        : `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}'`,
    )
    const row = Array.isArray(results) ? results[0] : results
    const count = Number(row?.count ?? 0)
    return Number.isFinite(count) && count > 0
  }

  const hasColumn = async (table, column) => {
    try {
      const desc = await queryInterface.describeTable(table)
      return Object.prototype.hasOwnProperty.call(desc, column)
    } catch {
      return false
    }
  }

  if (!(await tableExists("webbeds_city"))) return

  if (!(await hasColumn("webbeds_city", "cover_image_url"))) {
    await queryInterface.addColumn("webbeds_city", "cover_image_url", {
      type: Sequelize.STRING(1024),
      allowNull: true,
    })
  }

  if (!(await hasColumn("webbeds_city", "cover_image_source"))) {
    await queryInterface.addColumn("webbeds_city", "cover_image_source", {
      type: Sequelize.STRING(60),
      allowNull: true,
    })
  }

  if (!(await hasColumn("webbeds_city", "cover_image_attribution"))) {
    await queryInterface.addColumn("webbeds_city", "cover_image_attribution", {
      type: Sequelize.STRING(255),
      allowNull: true,
    })
  }
}

async function down() {
  throw new Error("Down migration not implemented. Restore from backup if needed.")
}

module.exports = { up, down }
