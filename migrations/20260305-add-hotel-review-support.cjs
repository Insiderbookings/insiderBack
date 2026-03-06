async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const isMySQL = dialect.startsWith("mysql");

  const tableExists = async (table) => {
    const [results] = await queryInterface.sequelize.query(
      isMySQL
        ? `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${table}'`
        : `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}'`
    );
    const row = Array.isArray(results) ? results[0] : results;
    const count = Number(row?.count ?? 0);
    return Number.isFinite(count) && count > 0;
  };

  const indexExists = async (table, indexName) => {
    if (isMySQL) {
      const [rows] = await queryInterface.sequelize.query(
        `SHOW INDEX FROM \`${table}\` WHERE Key_name = '${indexName}'`
      );
      return Array.isArray(rows) && rows.length > 0;
    }
    const [rows] = await queryInterface.sequelize.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = '${table}' AND indexname = '${indexName}'`
    );
    return Array.isArray(rows) && rows.length > 0;
  };

  if (!(await tableExists("review"))) return;

  const desc = await queryInterface.describeTable("review");
  if (!desc.inventory_type) {
    await queryInterface.addColumn("review", "inventory_type", {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
  }
  if (!desc.inventory_id) {
    await queryInterface.addColumn("review", "inventory_id", {
      type: Sequelize.STRING(120),
      allowNull: true,
    });
  }

  if (dialect === "postgres") {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typname = 'enum_review_target_type'
            AND e.enumlabel = 'HOTEL'
        ) THEN
          ALTER TYPE "enum_review_target_type" ADD VALUE 'HOTEL';
        END IF;
      END
      $$;
    `);
  } else {
    await queryInterface.changeColumn("review", "target_type", {
      type: Sequelize.ENUM("HOME", "HOST", "GUEST", "HOTEL"),
      allowNull: false,
      defaultValue: "HOME",
    });
  }

  if (!(await indexExists("review", "idx_review_inventory_type_id"))) {
    await queryInterface.addIndex("review", ["inventory_type", "inventory_id"], {
      name: "idx_review_inventory_type_id",
    });
  }
}

async function down(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const isMySQL = dialect.startsWith("mysql");

  const tableExists = async (table) => {
    const [results] = await queryInterface.sequelize.query(
      isMySQL
        ? `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${table}'`
        : `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}'`
    );
    const row = Array.isArray(results) ? results[0] : results;
    const count = Number(row?.count ?? 0);
    return Number.isFinite(count) && count > 0;
  };

  if (!(await tableExists("review"))) return;

  try {
    await queryInterface.removeIndex("review", "idx_review_inventory_type_id");
  } catch (_) {
    // ignore
  }

  const desc = await queryInterface.describeTable("review");
  if (desc.inventory_id) {
    await queryInterface.removeColumn("review", "inventory_id");
  }
  if (desc.inventory_type) {
    await queryInterface.removeColumn("review", "inventory_type");
  }

  if (dialect !== "postgres") {
    await queryInterface.changeColumn("review", "target_type", {
      type: Sequelize.ENUM("HOME", "HOST", "GUEST"),
      allowNull: false,
      defaultValue: "HOME",
    });
  }
}

module.exports = { up, down };
