// Migration: add user discount code state + last login timestamp

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

  if (!(await hasColumn("user", "last_login_at"))) {
    await queryInterface.addColumn("user", "last_login_at", {
      type: Sequelize.DATE,
      allowNull: true,
    })
  }
  if (!(await hasColumn("user", "discount_code_prompted_at"))) {
    await queryInterface.addColumn("user", "discount_code_prompted_at", {
      type: Sequelize.DATE,
      allowNull: true,
    })
  }
  if (!(await hasColumn("user", "discount_code_reminder_at"))) {
    await queryInterface.addColumn("user", "discount_code_reminder_at", {
      type: Sequelize.DATE,
      allowNull: true,
    })
  }
  if (!(await hasColumn("user", "discount_code_locked_at"))) {
    await queryInterface.addColumn("user", "discount_code_locked_at", {
      type: Sequelize.DATE,
      allowNull: true,
    })
  }
  if (!(await hasColumn("user", "discount_code_entered_at"))) {
    await queryInterface.addColumn("user", "discount_code_entered_at", {
      type: Sequelize.DATE,
      allowNull: true,
    })
  }
}

async function down(queryInterface) {
  const dropColumn = async (table, column) => {
    try {
      await queryInterface.removeColumn(table, column)
    } catch (_) {
      /* ignore */
    }
  }
  await dropColumn("user", "discount_code_entered_at")
  await dropColumn("user", "discount_code_locked_at")
  await dropColumn("user", "discount_code_reminder_at")
  await dropColumn("user", "discount_code_prompted_at")
  await dropColumn("user", "last_login_at")
}

module.exports = { up, down }
