// Migration: add cancellation_policy to home_policies

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize

  const tableExists = async (table) => {
    try {
      await queryInterface.describeTable(table)
      return true
    } catch {
      return false
    }
  }

  if (!(await tableExists("home_policies"))) return

  const columns = await queryInterface.describeTable("home_policies")
  if (!columns.cancellation_policy) {
    await queryInterface.addColumn("home_policies", "cancellation_policy", {
      type: Sequelize.TEXT,
      allowNull: true,
    })
  }
}

async function down(queryInterface) {
  const tableExists = async (table) => {
    try {
      await queryInterface.describeTable(table)
      return true
    } catch {
      return false
    }
  }

  if (!(await tableExists("home_policies"))) return

  const columns = await queryInterface.describeTable("home_policies")
  if (columns.cancellation_policy) {
    await queryInterface.removeColumn("home_policies", "cancellation_policy")
  }
}

module.exports = { up, down }
