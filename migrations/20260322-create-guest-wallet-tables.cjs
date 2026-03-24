async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const isMySQL = dialect.startsWith("mysql");
  const JSON_TYPE = isMySQL ? Sequelize.JSON : Sequelize.JSONB;

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

  if (!(await tableExists("guest_wallet_account"))) {
    await queryInterface.createTable("guest_wallet_account", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: "USD",
      },
      available_minor: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      pending_minor: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      locked_minor: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      lifetime_earned_minor: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      lifetime_spent_minor: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      lifetime_reversed_minor: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
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
    });

    await queryInterface.addIndex("guest_wallet_account", ["user_id"], {
      name: "uq_guest_wallet_account_user",
      unique: true,
    });
  }

  if (!(await tableExists("guest_wallet_hold"))) {
    await queryInterface.createTable("guest_wallet_hold", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      stay_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "booking", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      payment_scope_key: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      payment_intent_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: "USD",
      },
      amount_minor: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      refunded_minor: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      public_total_minor: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      minimum_selling_minor: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      status: {
        type: Sequelize.ENUM(
          "HELD",
          "CAPTURED",
          "RELEASED",
          "PARTIALLY_REFUNDED",
          "REFUNDED"
        ),
        allowNull: false,
        defaultValue: "HELD",
      },
      captured_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      released_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
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
    });

    await queryInterface.addIndex("guest_wallet_hold", ["user_id", "stay_id", "payment_scope_key"], {
      name: "idx_guest_wallet_hold_scope",
    });
    await queryInterface.addIndex("guest_wallet_hold", ["payment_intent_id"], {
      name: "idx_guest_wallet_hold_pi",
    });
    await queryInterface.addIndex("guest_wallet_hold", ["status"], {
      name: "idx_guest_wallet_hold_status",
    });
  }

  if (!(await tableExists("guest_wallet_ledger"))) {
    await queryInterface.createTable("guest_wallet_ledger", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      account_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "guest_wallet_account", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      stay_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "booking", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      hold_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "guest_wallet_hold", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      linked_entry_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "guest_wallet_ledger", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      type: {
        type: Sequelize.ENUM(
          "EARN_PENDING",
          "EARN_RELEASE",
          "EARN_REVERSE",
          "USE_HOLD",
          "USE_CAPTURE",
          "USE_RELEASE",
          "USE_REFUND",
          "ADJUSTMENT"
        ),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM("PENDING", "POSTED", "VOIDED"),
        allowNull: false,
        defaultValue: "POSTED",
      },
      amount_minor: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: "USD",
      },
      reference_key: {
        type: Sequelize.STRING(160),
        allowNull: false,
      },
      effective_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      release_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
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
    });

    await queryInterface.addIndex("guest_wallet_ledger", ["reference_key"], {
      name: "uq_guest_wallet_ledger_reference",
      unique: true,
    });
    await queryInterface.addIndex("guest_wallet_ledger", ["user_id", "effective_at"], {
      name: "idx_guest_wallet_ledger_user_effective",
    });
    await queryInterface.addIndex("guest_wallet_ledger", ["stay_id"], {
      name: "idx_guest_wallet_ledger_stay",
    });
    await queryInterface.addIndex("guest_wallet_ledger", ["type", "status"], {
      name: "idx_guest_wallet_ledger_type_status",
    });
    await queryInterface.addIndex("guest_wallet_ledger", ["linked_entry_id"], {
      name: "idx_guest_wallet_ledger_linked_entry",
    });
  }
}

async function down(queryInterface) {
  const removeIndex = async (table, name) => {
    try {
      await queryInterface.removeIndex(table, name);
    } catch (_) {
      // ignore
    }
  };

  await removeIndex("guest_wallet_ledger", "uq_guest_wallet_ledger_reference");
  await removeIndex("guest_wallet_ledger", "idx_guest_wallet_ledger_user_effective");
  await removeIndex("guest_wallet_ledger", "idx_guest_wallet_ledger_stay");
  await removeIndex("guest_wallet_ledger", "idx_guest_wallet_ledger_type_status");
  await removeIndex("guest_wallet_ledger", "idx_guest_wallet_ledger_linked_entry");
  await removeIndex("guest_wallet_hold", "idx_guest_wallet_hold_scope");
  await removeIndex("guest_wallet_hold", "idx_guest_wallet_hold_pi");
  await removeIndex("guest_wallet_hold", "idx_guest_wallet_hold_status");
  await removeIndex("guest_wallet_account", "uq_guest_wallet_account_user");

  try {
    await queryInterface.dropTable("guest_wallet_ledger");
  } catch (_) {
    // ignore
  }
  try {
    await queryInterface.dropTable("guest_wallet_hold");
  } catch (_) {
    // ignore
  }
  try {
    await queryInterface.dropTable("guest_wallet_account");
  } catch (_) {
    // ignore
  }

  if (dialect === "postgres") {
    const enumNames = [
      "enum_guest_wallet_hold_status",
      "enum_guest_wallet_ledger_type",
      "enum_guest_wallet_ledger_status",
    ];
    for (const enumName of enumNames) {
      try {
        await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${enumName}";`);
      } catch (_) {
        // ignore
      }
    }
  }
}

module.exports = { up, down };
