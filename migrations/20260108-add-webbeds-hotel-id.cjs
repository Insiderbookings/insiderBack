// Add webbeds_hotel_id to stay_hotel to link Webbeds bookings.

async function up(queryInterface) {
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

  const hasColumn = async (table, column) => {
    try {
      const desc = await queryInterface.describeTable(table);
      return Object.prototype.hasOwnProperty.call(desc, column);
    } catch {
      return false;
    }
  };

  if (!(await tableExists("stay_hotel"))) return;

  if (!(await hasColumn("stay_hotel", "webbeds_hotel_id"))) {
    await queryInterface.addColumn("stay_hotel", "webbeds_hotel_id", {
      type: Sequelize.BIGINT,
      allowNull: true,
    });
  }

  try {
    await queryInterface.addIndex("stay_hotel", ["webbeds_hotel_id"], {
      name: "idx_stay_hotel_webbeds_hotel_id",
      unique: false,
    });
  } catch (_) {
    // ignore if exists
  }

  if (await tableExists("webbeds_hotel")) {
    try {
      await queryInterface.addConstraint("stay_hotel", {
        fields: ["webbeds_hotel_id"],
        type: "foreign key",
        name: "stay_hotel_webbeds_hotel_id_fkey",
        references: { table: "webbeds_hotel", field: "hotel_id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      });
    } catch (_) {
      // ignore if exists
    }
  }
}

async function down() {
  // No automatic rollback provided; restore from backup if needed.
  throw new Error("Down migration not implemented. Restore from backup if needed.");
}

module.exports = { up, down };
