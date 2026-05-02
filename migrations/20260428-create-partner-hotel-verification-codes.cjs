const TABLE = "partner_hotel_verification_code";

const LEGACY_COLUMN_RENAMES = [
  ["verification_code", "code"],
  ["generated_by_user_id", "created_by_user_id"],
  ["used_by_user_id", "claimed_by_user_id"],
  ["used_at", "claimed_at"],
];

const LEGACY_INDEXES = [
  "uq_partner_hotel_verification_code_value",
  "idx_partner_hotel_verification_code_generated_by_user",
  "idx_partner_hotel_verification_code_used_by_user",
];

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const isMySQL = dialect.startsWith("mysql");

  const tableExists = async (table) => {
    const [results] = await queryInterface.sequelize.query(
      isMySQL
        ? `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${table}'`
        : `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}'`,
    );
    const row = Array.isArray(results) ? results[0] : results;
    const count = Number(row?.count ?? 0);
    return Number.isFinite(count) && count > 0;
  };

  const describeTable = async () => {
    if (!(await tableExists(TABLE))) return null;
    return queryInterface.describeTable(TABLE);
  };

  const indexExists = async (name) => {
    const indexes = await queryInterface.showIndex(TABLE).catch(() => []);
    return Array.isArray(indexes) && indexes.some((index) => index?.name === name);
  };

  const removeIndexIfExists = async (name) => {
    if (await indexExists(name)) {
      await queryInterface.removeIndex(TABLE, name);
    }
  };

  const addIndexIfMissing = async (fields, options) => {
    if (!(await indexExists(options.name))) {
      await queryInterface.addIndex(TABLE, fields, options);
    }
  };

  const addColumnIfMissing = async (description, column, definition) => {
    if (description?.[column]) return description;
    await queryInterface.addColumn(TABLE, column, definition);
    return describeTable();
  };

  const renameLegacyColumns = async () => {
    for (const [legacyColumn, targetColumn] of LEGACY_COLUMN_RENAMES) {
      let description = await describeTable();
      if (description?.[legacyColumn] && !description?.[targetColumn]) {
        await queryInterface.renameColumn(TABLE, legacyColumn, targetColumn);
      } else if (description?.[legacyColumn] && description?.[targetColumn]) {
        const qTable = queryInterface.quoteIdentifier(TABLE);
        const qLegacy = queryInterface.quoteIdentifier(legacyColumn);
        const qTarget = queryInterface.quoteIdentifier(targetColumn);
        await queryInterface.sequelize.query(
          `UPDATE ${qTable} SET ${qTarget} = ${qLegacy} WHERE ${qTarget} IS NULL AND ${qLegacy} IS NOT NULL`,
        );
      }
    }
  };

  if (!(await tableExists(TABLE))) {
    await queryInterface.createTable(TABLE, {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      hotel_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: "webbeds_hotel", key: "hotel_id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      code: {
        type: Sequelize.STRING(8),
        allowNull: false,
      },
      created_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      claimed_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      claimed_at: {
        type: Sequelize.DATE,
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
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });
  } else {
    for (const legacyIndex of LEGACY_INDEXES) {
      await removeIndexIfExists(legacyIndex);
    }

    await renameLegacyColumns();

    let description = await describeTable();
    description = await addColumnIfMissing(description, "code", {
      type: Sequelize.STRING(8),
      allowNull: true,
    });
    description = await addColumnIfMissing(description, "created_by_user_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "user", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    });
    description = await addColumnIfMissing(description, "claimed_by_user_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "user", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    });
    description = await addColumnIfMissing(description, "claimed_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    description = await addColumnIfMissing(description, "created_at", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    });
    description = await addColumnIfMissing(description, "updated_at", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    });
    await addColumnIfMissing(description, "deleted_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
  }

  await addIndexIfMissing(["hotel_id"], {
    name: "uq_partner_hotel_verification_code_hotel",
    unique: true,
  });
  await addIndexIfMissing(["code"], {
    name: "uq_partner_hotel_verification_code_code",
    unique: true,
  });
  await addIndexIfMissing(["created_by_user_id"], {
    name: "idx_partner_hotel_verification_code_created_by_user",
  });
  await addIndexIfMissing(["claimed_by_user_id"], {
    name: "idx_partner_hotel_verification_code_claimed_by_user",
  });
}

async function down(queryInterface) {
  await queryInterface.dropTable(TABLE).catch(() => {});
}

module.exports = { up, down };
