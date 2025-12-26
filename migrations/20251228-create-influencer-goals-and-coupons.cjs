// Migration: create influencer goals + coupon wallet/redemptions tables

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize
  const dialect = queryInterface.sequelize.getDialect()
  const isPg = dialect === "postgres" || dialect === "postgresql"
  const isMySQL = ["mysql", "mariadb"].includes(dialect)
  const JSON_TYPE = isMySQL ? Sequelize.JSON : Sequelize.JSONB

  const tableExists = async (table) => {
    try {
      await queryInterface.describeTable(table)
      return true
    } catch {
      return false
    }
  }

  const ensureEnum = async (typeName, values) => {
    if (!isPg) return
    const exists = await queryInterface.sequelize
      .query(
        `SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = :name LIMIT 1`,
        { replacements: { name: typeName } },
      )
      .then(([rows]) => rows.length > 0)
      .catch(() => false)
    if (!exists) {
      const escaped = values.map((v) => `'${v}'`).join(", ")
      await queryInterface.sequelize.query(`CREATE TYPE "${typeName}" AS ENUM (${escaped});`)
    }
  }

  await ensureEnum("enum_influencer_goal_event_type", ["signup", "booking"])
  await ensureEnum("enum_influencer_goal_reward_type", ["coupon_grant", "cash"])
  await ensureEnum("enum_coupon_redemption_status", ["pending", "redeemed", "reversed"])

  const EVENT_ENUM = isPg
    ? Sequelize.ENUM("signup", "booking")
    : Sequelize.STRING(20)
  const REWARD_ENUM = isPg
    ? Sequelize.ENUM("coupon_grant", "cash")
    : Sequelize.STRING(20)
  const REDEMPTION_ENUM = isPg
    ? Sequelize.ENUM("pending", "redeemed", "reversed")
    : Sequelize.STRING(20)

  // Goals catalog
  if (!(await tableExists("influencer_goal"))) {
    await queryInterface.createTable("influencer_goal", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      code: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(120), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      event_type: { type: EVENT_ENUM, allowNull: false },
      target_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      reward_type: { type: REWARD_ENUM, allowNull: false, defaultValue: "coupon_grant" },
      reward_value: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      reward_currency: { type: Sequelize.STRING(3), allowNull: true, defaultValue: "USD" },
      metadata: { type: JSON_TYPE, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    })
  }

  // Per-influencer progress
  if (!(await tableExists("influencer_goal_progress"))) {
    await queryInterface.createTable("influencer_goal_progress", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      influencer_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      goal_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "influencer_goal", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      progress_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      reward_granted_at: { type: Sequelize.DATE, allowNull: true },
      reward_commission_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "influencer_event_commission", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      last_event_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    })
  }
  try {
    await queryInterface.addConstraint("influencer_goal_progress", {
      fields: ["goal_id", "influencer_user_id"],
      type: "unique",
      name: "uq_inf_goal_progress_goal_influencer",
    })
  } catch {}
  try {
    await queryInterface.addIndex("influencer_goal_progress", ["influencer_user_id"], {
      name: "idx_inf_goal_progress_influencer",
    })
  } catch {}

  // Event idempotency
  if (!(await tableExists("influencer_goal_event"))) {
    await queryInterface.createTable("influencer_goal_event", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      event_type: { type: EVENT_ENUM, allowNull: false },
      influencer_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      signup_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      stay_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "booking", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      occurred_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      metadata: { type: JSON_TYPE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    })
  }
  try {
    await queryInterface.addConstraint("influencer_goal_event", {
      fields: ["event_type", "signup_user_id", "influencer_user_id"],
      type: "unique",
      name: "uq_inf_goal_evt_signup",
    })
  } catch {}
  try {
    await queryInterface.addConstraint("influencer_goal_event", {
      fields: ["event_type", "stay_id", "influencer_user_id"],
      type: "unique",
      name: "uq_inf_goal_evt_stay",
    })
  } catch {}
  try {
    await queryInterface.addIndex("influencer_goal_event", ["influencer_user_id"], {
      name: "idx_inf_goal_evt_influencer",
    })
  } catch {}
  try {
    await queryInterface.addIndex("influencer_goal_event", ["event_type"], {
      name: "idx_inf_goal_evt_type",
    })
  } catch {}

  // Coupon stock per influencer
  if (!(await tableExists("coupon_wallet"))) {
    await queryInterface.createTable("coupon_wallet", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      influencer_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      total_granted: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      total_used: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    })
  }
  try {
    await queryInterface.addConstraint("coupon_wallet", {
      fields: ["influencer_user_id"],
      type: "unique",
      name: "uq_coupon_wallet_influencer",
    })
  } catch {}

  // Coupon redemptions per booking
  if (!(await tableExists("coupon_redemption"))) {
    await queryInterface.createTable("coupon_redemption", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      coupon_wallet_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "coupon_wallet", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      influencer_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
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
        allowNull: false,
        references: { model: "booking", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      status: { type: REDEMPTION_ENUM, allowNull: false, defaultValue: "pending" },
      discount_amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: "USD" },
      reserved_at: { type: Sequelize.DATE, allowNull: true },
      redeemed_at: { type: Sequelize.DATE, allowNull: true },
      reversed_at: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: JSON_TYPE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    })
  }
  try {
    await queryInterface.addConstraint("coupon_redemption", {
      fields: ["stay_id"],
      type: "unique",
      name: "uq_coupon_redemption_stay",
    })
  } catch {}
  try {
    await queryInterface.addIndex("coupon_redemption", ["influencer_user_id"], {
      name: "idx_coupon_redemption_influencer",
    })
  } catch {}
  try {
    await queryInterface.addIndex("coupon_redemption", ["coupon_wallet_id"], {
      name: "idx_coupon_redemption_wallet",
    })
  } catch {}
  try {
    await queryInterface.addIndex("coupon_redemption", ["status"], {
      name: "idx_coupon_redemption_status",
    })
  } catch {}

  // Seed an example booking goal (can be adjusted later)
  const seedGoal = {
    code: "BOOKING_50_COUPONS",
    name: "50 reservas referidas",
    description: "Entrega cupones cuando el influencer llega a 50 bookings confirmadas de referidos.",
    event_type: "booking",
    target_count: 50,
    reward_type: "coupon_grant",
    reward_value: 50,
    reward_currency: "USD",
    metadata: JSON.stringify({ coupon_note: "1 cupon por booking lograda" }),
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  }
  const [existingGoals] = await queryInterface.sequelize.query(
    'SELECT id FROM influencer_goal WHERE code = :code LIMIT 1',
    { replacements: { code: seedGoal.code } }
  )
  if (!existingGoals || existingGoals.length === 0) {
    await queryInterface.bulkInsert("influencer_goal", [seedGoal])
  }
}

async function down(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect()
  const isPg = dialect === "postgres" || dialect === "postgresql"

  await queryInterface.bulkDelete("influencer_goal", { code: "BOOKING_50_COUPONS" }).catch(() => {})
  await queryInterface.dropTable("coupon_redemption").catch(() => {})
  await queryInterface.dropTable("coupon_wallet").catch(() => {})
  await queryInterface.dropTable("influencer_goal_event").catch(() => {})
  await queryInterface.dropTable("influencer_goal_progress").catch(() => {})
  await queryInterface.dropTable("influencer_goal").catch(() => {})

  if (isPg) {
    await queryInterface.sequelize
      .query('DROP TYPE IF EXISTS "enum_coupon_redemption_status";')
      .catch(() => {})
    await queryInterface.sequelize
      .query('DROP TYPE IF EXISTS "enum_influencer_goal_reward_type";')
      .catch(() => {})
    await queryInterface.sequelize
      .query('DROP TYPE IF EXISTS "enum_influencer_goal_event_type";')
      .catch(() => {})
  }
}

module.exports = { up, down }
