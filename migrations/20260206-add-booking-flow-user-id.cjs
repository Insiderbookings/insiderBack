// Migration: add user_id to booking_flows

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

  if (!(await hasColumn("booking_flows", "user_id"))) {
    await queryInterface.addColumn("booking_flows", "user_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  }

  try {
    await queryInterface.addIndex("booking_flows", ["user_id"], {
      name: "booking_flows_user_id_idx",
    });
  } catch (_) {
    // ignore if index exists
  }
}

async function down(queryInterface) {
  try {
    await queryInterface.removeIndex("booking_flows", "booking_flows_user_id_idx");
  } catch (_) {
    // ignore
  }

  try {
    await queryInterface.removeColumn("booking_flows", "user_id");
  } catch (_) {
    // ignore
  }
}

module.exports = { up, down };
