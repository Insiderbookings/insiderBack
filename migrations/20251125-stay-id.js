// Migration to unify stay_id and drop booking_id on child tables using sequelize helpers.

export async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const dialect = queryInterface.sequelize.getDialect();

  const tableExists = async (table) => {
    const [results] = await queryInterface.sequelize.query(
      dialect.startsWith("mysql")
        ? `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${table}'`
        : `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}'`
    );
    const row = Array.isArray(results) ? results[0] : results;
    const count = Number(row?.count ?? 0);
    return Number.isFinite(count) && count > 0;
  };

  const hasColumn = async (table, column) => {
    try {
      const desc = await queryInterface.describeTable(table);
      return Object.prototype.hasOwnProperty.call(desc, column);
    } catch {
      return false;
    }
  };

  const dropColumnIfExists = async (table, column) => {
    if (await hasColumn(table, column)) {
      await queryInterface.removeColumn(table, column);
    }
  };

  const ensureStayId = async ({ table, fkName, uniqueName, addIndexName }) => {
    if (!(await tableExists(table))) return;

    const hasStay = await hasColumn(table, "stay_id");
    if (!hasStay) {
      await queryInterface.addColumn(table, "stay_id", { type: Sequelize.INTEGER, allowNull: true });
    }

    const hasBooking = await hasColumn(table, "booking_id");
    if (hasBooking) {
      await queryInterface.sequelize.query(`UPDATE ${table} SET stay_id = COALESCE(stay_id, booking_id);`);
    }

    await queryInterface.changeColumn(table, "stay_id", { type: Sequelize.INTEGER, allowNull: false });

    if (fkName) {
      try {
        await queryInterface.addConstraint(table, {
          fields: ["stay_id"],
          type: "foreign key",
          name: fkName,
          references: { table: "booking", field: "id" },
          onDelete: "CASCADE",
        });
      } catch (_) {
        // ignore if already exists
      }
    }

    if (uniqueName) {
      try {
        await queryInterface.addConstraint(table, {
          fields: ["stay_id"],
          type: "unique",
          name: uniqueName,
        });
      } catch (_) {
        // ignore if already exists
      }
    }

    await dropColumnIfExists(table, "booking_id");

    if (addIndexName) {
      try {
        await queryInterface.addIndex(table, ["stay_id"], { name: addIndexName, unique: false });
      } catch (_) {
        // ignore if already exists
      }
    }
  };

  // payment
  await ensureStayId({ table: "payment", fkName: "fk_payment_stay", addIndexName: "idx_payment_stay_id" });

  // booking_add_on
  await ensureStayId({
    table: "booking_add_on",
    fkName: "fk_booking_add_on_stay",
    addIndexName: "idx_booking_add_on_stay_id",
  });

  // outside_meta
  await ensureStayId({
    table: "outside_meta",
    fkName: "fk_outside_meta_stay",
    addIndexName: "idx_outside_meta_stay_id",
  });

  // tgx_meta
  await ensureStayId({ table: "tgx_meta", fkName: "fk_tgx_meta_stay", addIndexName: "idx_tgx_meta_stay_id" });

  // commission
  await ensureStayId({
    table: "commission",
    fkName: "fk_commission_stay",
    uniqueName: "commission_stay_id_key",
  });

  // influencer_commission
  await ensureStayId({
    table: "influencer_commission",
    fkName: "fk_influencer_commission_stay",
    uniqueName: "influencer_commission_stay_id_key",
  });

  // discount_code
  await ensureStayId({
    table: "discount_code",
    fkName: "fk_discount_code_stay",
    addIndexName: "idx_discount_code_stay_id",
  });

  // review
  await ensureStayId({
    table: "review",
    fkName: "fk_review_stay",
    addIndexName: "idx_review_stay_id",
  });

  // Indexes for stay_home / stay_hotel lookups
  const addIdx = async (table, field, name) => {
    try {
      await queryInterface.addIndex(table, [field], { name, unique: false });
    } catch (_) {
      // ignore if exists
    }
  };
  await addIdx("stay_home", "home_id", "idx_stay_home_home_id");
  await addIdx("stay_home", "host_id", "idx_stay_home_host_id");
  await addIdx("stay_hotel", "hotel_id", "idx_stay_hotel_hotel_id");
  await addIdx("stay_hotel", "room_id", "idx_stay_hotel_room_id");
}

export async function down() {
  // No automatic rollback provided; restore from backup if needed.
  throw new Error("Down migration not implemented. Restore from backup if needed.");
}
