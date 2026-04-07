async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;

  const hasColumn = async (table, column) => {
    try {
      const desc = await queryInterface.describeTable(table);
      return Object.prototype.hasOwnProperty.call(desc, column);
    } catch {
      return false;
    }
  };

  const addColumnIfMissing = async (table, column, definition) => {
    if (await hasColumn(table, column)) return;
    await queryInterface.addColumn(table, column, definition);
  };

  await addColumnIfMissing("user", "hotel_pricing_tier", {
    type: Sequelize.STRING(32),
    allowNull: false,
    defaultValue: "STANDARD",
  });
  await addColumnIfMissing("user", "hotel_pricing_request_status", {
    type: Sequelize.STRING(24),
    allowNull: false,
    defaultValue: "none",
  });
  await addColumnIfMissing("user", "hotel_pricing_request_data", {
    type: Sequelize.JSON,
    allowNull: true,
  });
  await addColumnIfMissing("user", "hotel_pricing_requested_at", {
    type: Sequelize.DATE,
    allowNull: true,
  });
  await addColumnIfMissing("user", "hotel_pricing_reviewed_at", {
    type: Sequelize.DATE,
    allowNull: true,
  });
  await addColumnIfMissing("user", "hotel_pricing_reviewed_by_user_id", {
    type: Sequelize.INTEGER,
    allowNull: true,
    references: { model: "user", key: "id" },
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  });
  await addColumnIfMissing("user", "hotel_pricing_note", {
    type: Sequelize.TEXT,
    allowNull: true,
  });

  await addColumnIfMissing("user", "referral_credit_total_minor", {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0,
  });
  await addColumnIfMissing("user", "referral_credit_available_minor", {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0,
  });
  await addColumnIfMissing("user", "referral_credit_used_minor", {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0,
  });
  await addColumnIfMissing("user", "referral_credit_granted_at", {
    type: Sequelize.DATE,
    allowNull: true,
  });
  await addColumnIfMissing("user", "referral_credit_expires_at", {
    type: Sequelize.DATE,
    allowNull: true,
  });
  await addColumnIfMissing("user", "referral_credit_source_influencer_id", {
    type: Sequelize.INTEGER,
    allowNull: true,
    references: { model: "user", key: "id" },
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  });
  await addColumnIfMissing("user", "referral_credit_source_code", {
    type: Sequelize.STRING(32),
    allowNull: true,
  });

  await queryInterface.sequelize.query(
    'UPDATE "user" SET hotel_pricing_tier = COALESCE(hotel_pricing_tier, \'STANDARD\') WHERE hotel_pricing_tier IS NULL OR hotel_pricing_tier = \'\';',
  ).catch(() => {});
  await queryInterface.sequelize.query(
    'UPDATE "user" SET hotel_pricing_request_status = COALESCE(hotel_pricing_request_status, \'none\') WHERE hotel_pricing_request_status IS NULL OR hotel_pricing_request_status = \'\';',
  ).catch(() => {});
}

async function down(queryInterface) {
  const dropColumn = async (table, column) => {
    try {
      await queryInterface.removeColumn(table, column);
    } catch {
      // ignore
    }
  };

  await dropColumn("user", "referral_credit_source_code");
  await dropColumn("user", "referral_credit_source_influencer_id");
  await dropColumn("user", "referral_credit_expires_at");
  await dropColumn("user", "referral_credit_granted_at");
  await dropColumn("user", "referral_credit_used_minor");
  await dropColumn("user", "referral_credit_available_minor");
  await dropColumn("user", "referral_credit_total_minor");
  await dropColumn("user", "hotel_pricing_note");
  await dropColumn("user", "hotel_pricing_reviewed_by_user_id");
  await dropColumn("user", "hotel_pricing_reviewed_at");
  await dropColumn("user", "hotel_pricing_requested_at");
  await dropColumn("user", "hotel_pricing_request_data");
  await dropColumn("user", "hotel_pricing_request_status");
  await dropColumn("user", "hotel_pricing_tier");
}

module.exports = { up, down };
