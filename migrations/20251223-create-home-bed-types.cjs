// Migration: create home bed type catalog + linking table

const BED_TYPES = [
  {
    bed_type_key: "SINGLE_BED",
    label: "Single bed",
    description: "One twin-sized bed.",
    icon: "bed-outline",
    sort_order: 10,
  },
  {
    bed_type_key: "DOUBLE_BED",
    label: "Double bed",
    description: "A full-sized bed for two guests.",
    icon: "bed",
    sort_order: 20,
  },
  {
    bed_type_key: "QUEEN_BED",
    label: "Queen bed",
    description: "A queen-sized bed with extra space.",
    icon: "bed",
    sort_order: 30,
  },
  {
    bed_type_key: "KING_BED",
    label: "King bed",
    description: "A king-sized bed for maximum comfort.",
    icon: "bed",
    sort_order: 40,
  },
  {
    bed_type_key: "BUNK_BED",
    label: "Bunk bed",
    description: "Stacked beds ideal for kids or groups.",
    icon: "layers-outline",
    sort_order: 50,
  },
  {
    bed_type_key: "SOFA_BED",
    label: "Sofa bed",
    description: "A sofa that converts into a bed.",
    icon: "home-outline",
    sort_order: 60,
  },
];

const normalizeTableNames = (tables) =>
  (tables || [])
    .map((table) => {
      if (!table) return null;
      if (typeof table === "string") return table;
      if (table.tableName) return table.tableName;
      return table.name || null;
    })
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());

async function hasTable(queryInterface, table) {
  try {
    const tables = normalizeTableNames(await queryInterface.showAllTables());
    return tables.includes(String(table).toLowerCase());
  } catch {
    return false;
  }
}

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const JSON_TYPE = ["mysql", "mariadb"].includes(dialect) ? Sequelize.JSON : Sequelize.JSONB;

  if (!(await hasTable(queryInterface, "home_bed_type"))) {
    await queryInterface.createTable("home_bed_type", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      bed_type_key: { type: Sequelize.STRING(60), allowNull: false },
      label: { type: Sequelize.STRING(120), allowNull: false },
      description: { type: Sequelize.STRING(255), allowNull: true },
      icon: { type: Sequelize.STRING(120), allowNull: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      metadata: { type: JSON_TYPE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("home_bed_type", ["bed_type_key"], {
      name: "idx_home_bed_type_key",
      unique: true,
    });
  }

  if (!(await hasTable(queryInterface, "home_bed_type_link"))) {
    await queryInterface.createTable("home_bed_type_link", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      home_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      bed_type_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "home_bed_type", key: "id" },
        onDelete: "CASCADE",
      },
      count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("home_bed_type_link", ["home_id"], {
      name: "idx_home_bed_type_link_home",
    });
    await queryInterface.addIndex("home_bed_type_link", ["bed_type_id"], {
      name: "idx_home_bed_type_link_bed_type",
    });
    await queryInterface.addIndex("home_bed_type_link", ["home_id", "bed_type_id"], {
      name: "uniq_home_bed_type_link",
      unique: true,
    });
  }

  const shouldSeed = async () => {
    try {
      const [rows] = await queryInterface.sequelize.query(
        "SELECT COUNT(*) AS count FROM home_bed_type"
      );
      const count =
        Number(rows?.[0]?.count ?? rows?.[0]?.COUNT ?? Object.values(rows?.[0] ?? {})[0]) || 0;
      return count === 0;
    } catch {
      return false;
    }
  };

  if (await shouldSeed()) {
    const now = new Date();
    await queryInterface.bulkInsert(
      "home_bed_type",
      BED_TYPES.map((item) => ({
        ...item,
        created_at: now,
        updated_at: now,
      }))
    );
  }
}

async function down(queryInterface) {
  await queryInterface.removeIndex("home_bed_type_link", "uniq_home_bed_type_link").catch(() => {});
  await queryInterface
    .removeIndex("home_bed_type_link", "idx_home_bed_type_link_bed_type")
    .catch(() => {});
  await queryInterface.removeIndex("home_bed_type_link", "idx_home_bed_type_link_home").catch(() => {});
  await queryInterface.removeIndex("home_bed_type", "idx_home_bed_type_key").catch(() => {});
  await queryInterface.dropTable("home_bed_type_link").catch(() => {});
  await queryInterface.dropTable("home_bed_type").catch(() => {});
}

module.exports = { up, down };
