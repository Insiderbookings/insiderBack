// Migration: create payout ledger tables (accounts, batches, items)

export async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const JSON_TYPE = ["mysql", "mariadb"].includes(dialect) ? Sequelize.JSON : Sequelize.JSONB;

  await queryInterface.createTable("payout_account", {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      unique: true,
      references: { model: "user", key: "id" },
      onDelete: "CASCADE",
    },
    status: {
      type: Sequelize.ENUM("INCOMPLETE", "PENDING", "READY", "VERIFIED"),
      allowNull: false,
      defaultValue: "INCOMPLETE",
    },
    holder_name: { type: Sequelize.STRING(150), allowNull: true },
    bank_name: { type: Sequelize.STRING(150), allowNull: true },
    country: { type: Sequelize.STRING(2), allowNull: true },
    currency: { type: Sequelize.STRING(3), allowNull: true },
    routing_last4: { type: Sequelize.STRING(10), allowNull: true },
    account_last4: { type: Sequelize.STRING(10), allowNull: true },
    external_account_id: { type: Sequelize.STRING(120), allowNull: true },
    metadata: { type: JSON_TYPE, allowNull: true },
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
  });

  await queryInterface.createTable("payout_batch", {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: "USD" },
    total_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    status: {
      type: Sequelize.ENUM("PENDING", "PROCESSING", "PAID", "FAILED"),
      allowNull: false,
      defaultValue: "PENDING",
    },
    provider_batch_id: { type: Sequelize.STRING(120), allowNull: true },
    processed_at: { type: Sequelize.DATE, allowNull: true },
    metadata: { type: JSON_TYPE, allowNull: true },
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
  });

  await queryInterface.createTable("payout_item", {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    payout_batch_id: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "payout_batch", key: "id" },
      onDelete: "SET NULL",
    },
    stay_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      unique: true,
      references: { model: "booking", key: "id" },
      onDelete: "CASCADE",
    },
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: "user", key: "id" },
      onDelete: "CASCADE",
    },
    amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: "USD" },
    status: {
      type: Sequelize.ENUM("PENDING", "QUEUED", "PROCESSING", "PAID", "FAILED", "ON_HOLD"),
      allowNull: false,
      defaultValue: "PENDING",
    },
    scheduled_for: { type: Sequelize.DATEONLY, allowNull: true },
    paid_at: { type: Sequelize.DATE, allowNull: true },
    failure_reason: { type: Sequelize.TEXT, allowNull: true },
    metadata: { type: JSON_TYPE, allowNull: true },
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
  });

  await queryInterface.addIndex("payout_item", ["user_id"], { name: "idx_payout_item_user" });
  await queryInterface.addIndex("payout_item", ["status"], { name: "idx_payout_item_status" });
  await queryInterface.addIndex("payout_item", ["scheduled_for"], { name: "idx_payout_item_scheduled" });
}

export async function down(queryInterface) {
  await queryInterface.dropTable("payout_item");
  await queryInterface.dropTable("payout_batch");
  await queryInterface.dropTable("payout_account");
}
