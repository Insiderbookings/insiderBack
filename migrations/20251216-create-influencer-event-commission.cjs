// Migration: create influencer_event_commission table to track signup/booking payouts

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();

  // Helper: create ENUM only if needed (for Postgres)
  const ensureEnum = async (typeName, values) => {
    if (dialect !== "postgres" && dialect !== "postgresql") return;
    const enumExists = await queryInterface.sequelize
      .query(
        `SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = :name LIMIT 1`,
        { replacements: { name: typeName } },
      )
      .then(([rows]) => rows.length > 0)
      .catch(() => false);
    if (!enumExists) {
      const escaped = values.map((v) => `'${v}'`).join(", ");
      await queryInterface.sequelize.query(`CREATE TYPE "${typeName}" AS ENUM (${escaped});`);
    }
  };

  await ensureEnum("enum_influencer_event_commission_event_type", ["signup", "booking"]);
  await ensureEnum("enum_influencer_event_commission_status", ["hold", "eligible", "paid", "reversed"]);

  await queryInterface.createTable("influencer_event_commission", {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },

    influencer_user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: "user", key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },

    event_type: {
      type:
        dialect === "postgres" || dialect === "postgresql"
          ? Sequelize.ENUM("signup", "booking")
          : Sequelize.STRING(20),
      allowNull: false,
    },

    // signup-specific
    signup_user_id: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "user", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },

    // booking-specific
    stay_id: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "booking", key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },

    amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: "USD" },

    status: {
      type:
        dialect === "postgres" || dialect === "postgresql"
          ? Sequelize.ENUM("hold", "eligible", "paid", "reversed")
          : Sequelize.STRING(20),
      allowNull: false,
      defaultValue: "eligible",
    },

    hold_until: { type: Sequelize.DATE, allowNull: true },
    payout_batch_id: { type: Sequelize.STRING(40), allowNull: true },
    paid_at: { type: Sequelize.DATE, allowNull: true },
    reversal_reason: { type: Sequelize.STRING(160), allowNull: true },

    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    deleted_at: { type: Sequelize.DATE, allowNull: true },
  });

  // Indexes and uniqueness to avoid duplicates per event
  try {
    await queryInterface.addIndex("influencer_event_commission", ["influencer_user_id"], {
      name: "idx_inf_evt_comm_influencer",
    });
  } catch (_) {}
  try {
    await queryInterface.addIndex("influencer_event_commission", ["event_type"], {
      name: "idx_inf_evt_comm_event_type",
    });
  } catch (_) {}
  try {
    await queryInterface.addConstraint("influencer_event_commission", {
      fields: ["event_type", "signup_user_id"],
      type: "unique",
      name: "unique_inf_evt_comm_signup",
    });
  } catch (_) {}
  try {
    await queryInterface.addConstraint("influencer_event_commission", {
      fields: ["event_type", "stay_id"],
      type: "unique",
      name: "unique_inf_evt_comm_stay",
    });
  } catch (_) {}
}

async function down(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect();
  await queryInterface.dropTable("influencer_event_commission");

  // Cleanup enums for Postgres
  if (dialect === "postgres" || dialect === "postgresql") {
    await queryInterface.sequelize
      .query('DROP TYPE IF EXISTS "enum_influencer_event_commission_event_type";')
      .catch(() => {});
    await queryInterface.sequelize
      .query('DROP TYPE IF EXISTS "enum_influencer_event_commission_status";')
      .catch(() => {});
  }
}

module.exports = { up, down };
