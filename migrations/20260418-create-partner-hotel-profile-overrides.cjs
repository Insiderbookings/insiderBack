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

  if (!(await tableExists("partner_hotel_profile"))) {
    await queryInterface.createTable("partner_hotel_profile", {
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
      claim_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "partner_hotel_claim", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      status: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "DRAFT",
      },
      updated_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      headline: {
        type: Sequelize.STRING(160),
        allowNull: true,
      },
      description_override: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      contact_name: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      contact_email: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      contact_phone: {
        type: Sequelize.STRING(40),
        allowNull: true,
      },
      website: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      response_time_badge_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      response_time_badge_label: {
        type: Sequelize.STRING(80),
        allowNull: true,
      },
      special_offers_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      special_offers_title: {
        type: Sequelize.STRING(160),
        allowNull: true,
      },
      special_offers_body: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      profile_completion: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      published_at: {
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
    });

    await queryInterface.addIndex("partner_hotel_profile", ["hotel_id"], {
      name: "uq_partner_hotel_profile_hotel",
      unique: true,
    });
    await queryInterface.addIndex("partner_hotel_profile", ["claim_id"], {
      name: "uq_partner_hotel_profile_claim",
      unique: true,
    });
    await queryInterface.addIndex("partner_hotel_profile", ["status"], {
      name: "idx_partner_hotel_profile_status",
    });
    await queryInterface.addIndex("partner_hotel_profile", ["updated_by_user_id"], {
      name: "idx_partner_hotel_profile_updated_by_user",
    });
  }

  if (!(await tableExists("partner_hotel_profile_image"))) {
    await queryInterface.createTable("partner_hotel_profile_image", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      partner_hotel_profile_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "partner_hotel_profile", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      source_type: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "provider",
      },
      provider_image_url: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      image_url: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      caption: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_cover: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex(
      "partner_hotel_profile_image",
      ["partner_hotel_profile_id", "sort_order"],
      {
        name: "idx_partner_hotel_profile_image_profile_sort",
      },
    );
    await queryInterface.addIndex(
      "partner_hotel_profile_image",
      ["partner_hotel_profile_id", "is_active"],
      {
        name: "idx_partner_hotel_profile_image_profile_active",
      },
    );
  }

  if (!(await tableExists("partner_hotel_profile_amenity"))) {
    await queryInterface.createTable("partner_hotel_profile_amenity", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      partner_hotel_profile_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "partner_hotel_profile", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      source_type: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "provider",
      },
      provider_category: {
        type: Sequelize.STRING(32),
        allowNull: true,
      },
      provider_catalog_code: {
        type: Sequelize.BIGINT,
        allowNull: true,
      },
      provider_item_id: {
        type: Sequelize.STRING(80),
        allowNull: true,
      },
      label: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_highlighted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex(
      "partner_hotel_profile_amenity",
      ["partner_hotel_profile_id", "sort_order"],
      {
        name: "idx_partner_hotel_profile_amenity_profile_sort",
      },
    );
    await queryInterface.addIndex(
      "partner_hotel_profile_amenity",
      ["partner_hotel_profile_id", "is_active"],
      {
        name: "idx_partner_hotel_profile_amenity_profile_active",
      },
    );
    await queryInterface.addIndex(
      "partner_hotel_profile_amenity",
      ["partner_hotel_profile_id", "is_highlighted"],
      {
        name: "idx_partner_hotel_profile_amenity_profile_highlighted",
      },
    );
  }
}

async function down(queryInterface) {
  await queryInterface.dropTable("partner_hotel_profile_amenity").catch(() => {});
  await queryInterface.dropTable("partner_hotel_profile_image").catch(() => {});
  await queryInterface.dropTable("partner_hotel_profile").catch(() => {});
}

module.exports = { up, down };
