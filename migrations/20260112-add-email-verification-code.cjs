// Migration: add email verification code fields to user

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

  if (!(await hasColumn("user", "email_verification_code_hash"))) {
    await queryInterface.addColumn("user", "email_verification_code_hash", {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
  }
  if (!(await hasColumn("user", "email_verification_expires_at"))) {
    await queryInterface.addColumn("user", "email_verification_expires_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
  }
  if (!(await hasColumn("user", "email_verification_attempts"))) {
    await queryInterface.addColumn("user", "email_verification_attempts", {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 0,
    });
  }
  if (!(await hasColumn("user", "email_verification_sent_at"))) {
    await queryInterface.addColumn("user", "email_verification_sent_at", {
      type: Sequelize.DATE,
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
  await dropColumn("user", "email_verification_sent_at");
  await dropColumn("user", "email_verification_attempts");
  await dropColumn("user", "email_verification_expires_at");
  await dropColumn("user", "email_verification_code_hash");
}

module.exports = { up, down };
