async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize
  const dialect = queryInterface.sequelize.getDialect()
  const isMySQL = dialect.startsWith("mysql")
  const isPostgres = dialect.startsWith("postgres")

  const tableExists = async (table) => {
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

  if (await tableExists("webbeds_city")) {
    if (!(await hasColumn("webbeds_city", "lat"))) {
      await queryInterface.addColumn("webbeds_city", "lat", {
        type: Sequelize.DECIMAL(11, 8),
        allowNull: true,
      })
    }

    if (!(await hasColumn("webbeds_city", "lng"))) {
      await queryInterface.addColumn("webbeds_city", "lng", {
        type: Sequelize.DECIMAL(11, 8),
        allowNull: true,
      })
    }
  }

  if (!(await tableExists("webbeds_city_place_map"))) {
    await queryInterface.createTable("webbeds_city_place_map", {
      place_id: {
        type: Sequelize.STRING(255),
        primaryKey: true,
        allowNull: false,
      },
      city_code: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      label: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      place_city: {
        type: Sequelize.STRING(180),
        allowNull: true,
      },
      place_state: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      place_country: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      lat: {
        type: Sequelize.DECIMAL(11, 8),
        allowNull: true,
      },
      lng: {
        type: Sequelize.DECIMAL(11, 8),
        allowNull: true,
      },
      metadata: {
        type: isPostgres ? Sequelize.JSONB : Sequelize.JSON,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    })
  }

  try {
    await queryInterface.addIndex("webbeds_city_place_map", ["city_code"], {
      name: "idx_webbeds_city_place_map_city_code",
      unique: false,
    })
  } catch {
    // ignore if exists
  }

  if (await tableExists("webbeds_city")) {
    try {
      await queryInterface.addConstraint("webbeds_city_place_map", {
        fields: ["city_code"],
        type: "foreign key",
        name: "webbeds_city_place_map_city_code_fkey",
        references: { table: "webbeds_city", field: "code" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      })
    } catch {
      // ignore if exists
    }
  }
}

async function down() {
  throw new Error("Down migration not implemented. Restore from backup if needed.")
}

module.exports = { up, down }
