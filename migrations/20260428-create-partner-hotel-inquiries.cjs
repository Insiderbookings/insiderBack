async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();
  const isMySQL = dialect.startsWith("mysql");
  const JSON_TYPE = isMySQL ? Sequelize.JSON : Sequelize.JSONB;

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

  const columnExists = async (table, column) => {
    if (!(await tableExists(table))) return false;
    const description = await queryInterface.describeTable(table);
    return Object.prototype.hasOwnProperty.call(description, column);
  };

  if (await tableExists("partner_hotel_profile")) {
    if (!(await columnExists("partner_hotel_profile", "inquiry_enabled"))) {
      await queryInterface.addColumn("partner_hotel_profile", "inquiry_enabled", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
    if (!(await columnExists("partner_hotel_profile", "inquiry_email"))) {
      await queryInterface.addColumn("partner_hotel_profile", "inquiry_email", {
        type: Sequelize.STRING(150),
        allowNull: true,
      });
    }
    if (!(await columnExists("partner_hotel_profile", "inquiry_phone"))) {
      await queryInterface.addColumn("partner_hotel_profile", "inquiry_phone", {
        type: Sequelize.STRING(40),
        allowNull: true,
      });
    }
    if (!(await columnExists("partner_hotel_profile", "inquiry_notes"))) {
      await queryInterface.addColumn("partner_hotel_profile", "inquiry_notes", {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
  }

  if (await tableExists("partner_hotel_inquiry")) return;

  await queryInterface.createTable("partner_hotel_inquiry", {
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
    traveler_user_id: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "user", key: "id" },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    traveler_name: {
      type: Sequelize.STRING(150),
      allowNull: false,
    },
    traveler_email: {
      type: Sequelize.STRING(150),
      allowNull: false,
    },
    traveler_phone: {
      type: Sequelize.STRING(40),
      allowNull: true,
    },
    check_in: {
      type: Sequelize.DATEONLY,
      allowNull: true,
    },
    check_out: {
      type: Sequelize.DATEONLY,
      allowNull: true,
    },
    guests_summary: {
      type: Sequelize.STRING(120),
      allowNull: true,
    },
    inquiry_message: {
      type: Sequelize.TEXT,
      allowNull: false,
    },
    source_surface: {
      type: Sequelize.STRING(40),
      allowNull: false,
      defaultValue: "hotel_detail",
    },
    delivery_status: {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: "PENDING",
    },
    delivered_to_email: {
      type: Sequelize.STRING(150),
      allowNull: true,
    },
    delivered_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },
    error_message: {
      type: Sequelize.TEXT,
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

  await queryInterface.addIndex("partner_hotel_inquiry", ["claim_id"], {
    name: "idx_partner_hotel_inquiry_claim",
  });
  await queryInterface.addIndex("partner_hotel_inquiry", ["hotel_id"], {
    name: "idx_partner_hotel_inquiry_hotel",
  });
  await queryInterface.addIndex("partner_hotel_inquiry", ["traveler_user_id"], {
    name: "idx_partner_hotel_inquiry_traveler_user",
  });
  await queryInterface.addIndex("partner_hotel_inquiry", ["delivery_status"], {
    name: "idx_partner_hotel_inquiry_delivery_status",
  });
}

async function down(queryInterface) {
  await queryInterface.dropTable("partner_hotel_inquiry").catch(() => {});
  await queryInterface.removeColumn("partner_hotel_profile", "inquiry_notes").catch(() => {});
  await queryInterface.removeColumn("partner_hotel_profile", "inquiry_phone").catch(() => {});
  await queryInterface.removeColumn("partner_hotel_profile", "inquiry_email").catch(() => {});
  await queryInterface.removeColumn("partner_hotel_profile", "inquiry_enabled").catch(() => {});
}

module.exports = { up, down };
