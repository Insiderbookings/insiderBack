// Migration to remove TGX/Outside artifacts and hotel/tgx columns from booking.

export async function up(queryInterface) {
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

  const columnExists = async (table, column) => {
    try {
      const desc = await queryInterface.describeTable(table);
      return Object.prototype.hasOwnProperty.call(desc, column);
    } catch {
      return false;
    }
  };

  // Backfill booking hotel/room into stay_hotel if missing
  if (await tableExists("stay_hotel")) {
    if (dialect.startsWith("mysql")) {
      await queryInterface.sequelize.query(`
        INSERT INTO stay_hotel (stay_id, hotel_id, room_id)
        SELECT b.id, b.hotel_id, b.room_id
        FROM booking b
        LEFT JOIN stay_hotel sh ON sh.stay_id = b.id
        WHERE (b.hotel_id IS NOT NULL OR b.room_id IS NOT NULL)
          AND sh.id IS NULL;
      `);
    } else {
      await queryInterface.sequelize.query(`
        INSERT INTO stay_hotel (stay_id, hotel_id, room_id)
        SELECT b.id, b.hotel_id, b.room_id
        FROM booking b
        LEFT JOIN stay_hotel sh ON sh.stay_id = b.id
        WHERE (b.hotel_id IS NOT NULL OR b.room_id IS NOT NULL)
          AND sh.id IS NULL;
      `);
    }
  }

  // Drop columns from booking
  for (const col of ["hotel_id", "room_id", "tgx_hotel_id"]) {
    if (await columnExists("booking", col)) {
      await queryInterface.removeColumn("booking", col);
    }
  }

  // Drop obsolete tables
  for (const tbl of ["outside_meta", "tgx_meta"]) {
    if (await tableExists(tbl)) {
      await queryInterface.sequelize.query(`DROP TABLE ${tbl};`);
    }
  }
}

export async function down() {
  throw new Error("Down migration not implemented; restore from backup if needed.");
}
