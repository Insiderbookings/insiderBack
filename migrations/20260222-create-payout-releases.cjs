// Migration: create payout release approvals for auditable maker-checker flow

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const JSON_TYPE = ["mysql", "mariadb"].includes(dialect) ? Sequelize.JSON : Sequelize.JSONB;

  await queryInterface.createTable("payout_release", {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    status: {
      type: Sequelize.ENUM("DRAFT", "APPROVED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"),
      allowNull: false,
      defaultValue: "DRAFT",
    },
    cutoff_date: { type: Sequelize.DATEONLY, allowNull: false },
    batch_limit: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 100 },
    preview_summary: { type: JSON_TYPE, allowNull: false },
    preview_snapshot: { type: JSON_TYPE, allowNull: false },
    snapshot_hash: { type: Sequelize.STRING(128), allowNull: false },
    prepared_by: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: "user", key: "id" },
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    },
    approved_by: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "user", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    approved_at: { type: Sequelize.DATE, allowNull: true },
    expires_at: { type: Sequelize.DATE, allowNull: true },
    executed_by: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "user", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    executed_at: { type: Sequelize.DATE, allowNull: true },
    payout_batch_id: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "payout_batch", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    run_result: { type: JSON_TYPE, allowNull: true },
    notes: { type: Sequelize.TEXT, allowNull: true },
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
  });

  await queryInterface.addIndex("payout_release", ["status"], { name: "idx_payout_release_status" });
  await queryInterface.addIndex("payout_release", ["created_at"], { name: "idx_payout_release_created_at" });
  await queryInterface.addIndex("payout_release", ["cutoff_date"], { name: "idx_payout_release_cutoff_date" });
}

async function down(queryInterface) {
  try {
    await queryInterface.removeIndex("payout_release", "idx_payout_release_cutoff_date");
  } catch (_) {
    // ignore
  }
  try {
    await queryInterface.removeIndex("payout_release", "idx_payout_release_created_at");
  } catch (_) {
    // ignore
  }
  try {
    await queryInterface.removeIndex("payout_release", "idx_payout_release_status");
  } catch (_) {
    // ignore
  }
  await queryInterface.dropTable("payout_release");
}

module.exports = { up, down };
